import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {argumentsFor,target,client,output} from './harness.mjs';
process.env.AISOC_TEST_WORKER='true';process.env.AISOC_TEST_INTERVAL='100';
const options=argumentsFor(),server=await target(options),events=[],tenant='worker-'+randomUUID(),req=client(server.url,tenant,events);
try{
 const rule=await req('POST','/api/v1/detection-rules',{name:'Worker rule',severity:'high'},201);
 const created=await req('POST','/api/v1/api-sources',{name:'Sensor',provider:'Worker fixture',rule_id:rule.id},201);
 const ingest=async(external,severity='low')=>req('POST','/api/v1/intake/'+created.source.id+'/alerts',{external_id:external,title:'Review evidence',severity,primary_entity:'host-1',evidence:[{type:'entity',value:'host-1',label:'Explicit host'},{type:'ip',value:'192.0.2.1',label:'First label'},{type:'ip',value:'192.0.2.1',label:'Last label'}]},201,{authorization:'Bearer '+created.api_key});
 async function completed(caseId,runs=1){for(let i=0;i<300;i++){const detail=await req('GET','/api/v1/investigations/'+caseId);if(detail.jobs.length===runs&&detail.jobs.every(j=>j.status==='completed'))return detail;assert.ok(!detail.jobs.some(j=>j.status==='failed'),'worker failed');await new Promise(r=>setTimeout(r,100));}throw Error('Worker did not complete');}
 const accepted=await ingest('first'),caseId=accepted.alert.investigation_id,path='/api/v1/investigations/'+caseId;
 let detail=await completed(caseId);assert.equal(detail.status,'open');assert.equal(detail.determination,'unknown');assert.equal(detail.jobs[0].phase,3);assert.deepEqual(detail.jobs[0].result,{matches:[]});assert.equal(detail.jobs[0].error,null);assert.equal(detail.steps.length,3);assert.deepEqual(detail.steps.map(s=>s.title),['Record supplied evidence','Compare with local threat indicators','Record review outcome']);
 for(const step of detail.steps){assert.equal(step.tool,'Local deterministic worker');assert.equal(step.response.external_tools_executed,false);assert.equal(step.request.run_id,detail.jobs[0].id)}
 assert.equal(detail.steps[0].response.artifacts_recorded,2);assert.equal(detail.steps[0].request.evidence.length,4);assert.deepEqual(detail.steps[1].response.matches,[]);assert.equal(detail.steps[2].response.analyst_review_required,true);
 assert.equal(detail.summary,'Local review: 0 matching indicators; source severity low. Insufficient evidence for a determination. No external tools executed.');
 assert.equal(detail.artifacts.length,2);for(const artifact of detail.artifacts){const hash=createHash('sha256').update(JSON.stringify([artifact.type,artifact.value])).digest('hex').slice(0,20);assert.equal(artifact.id,'ART-'+accepted.alert.id+'-'+hash);assert.deepEqual(artifact.metadata,{provenance:'Submitted alert; not independently verified',alert_id:accepted.alert.id,source:created.source.source})}
 assert.equal(detail.artifacts.find(a=>a.type==='ip').label,'Last label');assert.equal(detail.artifacts.find(a=>a.type==='entity').label,'Explicit host');
 assert.equal(detail.history.filter(e=>e.action==='investigation_progress').length,2);assert.equal(detail.history.filter(e=>e.action==='investigation_completed').length,1);
 await req('PATCH',path,{determination:'benign'});
 const beforeQueue=await req('GET','/api/v1/investigation-queue');assert.equal(beforeQueue.items.find(i=>i.id===caseId).run_status,'completed');assert.equal(beforeQueue.summary.active_runs,0);
 const artifacts=detail.artifacts;const queued=await req('POST',path+'/reinvestigate');assert.equal(queued.status,'open');assert.equal(queued.determination,'unknown');assert.equal(queued.replay_count,1);
 detail=await completed(caseId,2);assert.equal(detail.steps.length,6);assert.deepEqual(detail.artifacts,artifacts);assert.equal(detail.determination,'unknown');assert.ok(detail.history.some(e=>e.action==='reinvestigated'&&e.details.queued===true));assert.ok(detail.history.some(e=>e.action==='investigation_queued'));
 const batch=await Promise.all(Array.from({length:4},(_,i)=>ingest('batch-'+i,i%2?'high':'low')));
 for(let i=0;i<batch.length;i++){const result=await completed(batch[i].alert.investigation_id);assert.equal(result.determination,i%2?'suspicious':'unknown');assert.equal(result.steps.length,3);assert.equal(result.artifacts.length,2);assert.equal(result.jobs.length,1)}
 const direct=await req('POST','/api/v1/alerts',{source:'Operator worker fixture',external_id:'direct',rule_id:rule.id,title:'Direct worker review',severity:'high'},201);const directResult=await completed(direct.alert.investigation_id);assert.equal(directResult.determination,'suspicious');assert.equal(directResult.steps.length,3);
 const finalQueue=await req('GET','/api/v1/investigation-queue');assert.equal(finalQueue.items.find(i=>i.id===caseId).job_id,detail.jobs[0].id);assert.ok(finalQueue.items.every(i=>i.run_status==='completed'&&i.run_phase===3));assert.deepEqual(finalQueue.summary,{alerts:6,active_runs:0,open_cases:6});
 const intelligence=await req('GET','/api/v1/detection-intelligence');assert.equal(intelligence.totals.total_alerts,6);assert.equal(intelligence.totals.investigated,6);assert.equal(intelligence.totals.pending_review,3);assert.deepEqual(Object.fromEntries(intelligence.outcomes.map(o=>[o.name,o.count])),{suspicious:3,unknown:3});
 // Indicators authored through the API feed the next local review phase.
 const report=await req('POST','/api/v1/threat-intel-reports',{title:'Local match fixture',severity:'high'},201);
 const indicator=await req('POST','/api/v1/threat-indicators',{report_id:report.id,indicator_type:'ip',value:'192.0.2.1'},201);
 const matched=await ingest('matched-low');const matchedResult=await completed(matched.alert.investigation_id);assert.equal(matchedResult.determination,'suspicious');assert.equal(matchedResult.jobs[0].result.matches.length,1);
 await req('PATCH','/api/v1/threat-indicators/'+indicator.id,{status:'expired'});
 const expired=await ingest('expired-low');assert.equal((await completed(expired.alert.investigation_id)).determination,'unknown');
 await req('DELETE','/api/v1/threat-intel-reports/'+report.id,undefined,204);
 await req('GET','/api/v1/threat-indicators/'+indicator.id,undefined,404);
 const dashboard=await req('GET','/api/v1/dashboard');assert.equal(dashboard.queueItems,8);assert.equal(dashboard.openInvestigations,8);assert.equal(dashboard.enabledDetectionRules,1);assert.equal(dashboard.recentInvestigations.length,5);assert.ok(dashboard.recentInvestigations.every(i=>i.status==='open'));
 await req('GET',path,undefined,404,{'x-tenant-id':tenant+'-foreign'});
 await output(options.output||'output/backend-parity/investigation-worker.json',{passed:true,backend:options.label||(server.owned?'node':'external'),request_count:events.length,persistence_fixture:{tenant,case_id:caseId},checks:['three committed phases','stable artifact IDs and last-value deduplication','local review outcomes','audit progression','explicit requeue','no duplicate artifacts on retry','multiple jobs','tenant isolation'],scope:'Local deterministic worker; automatic Skills pending; API-authored indicators exercised'});
 console.log('PASS local investigation worker');
}finally{await server.close();}
