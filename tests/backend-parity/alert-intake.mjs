import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {argumentsFor,target,client,output} from './harness.mjs';
process.env.AISOC_TEST_WORKER='false';
const options=argumentsFor(),server=await target(options),events=[],tenant='intake-'+randomUUID(),req=client(server.url,tenant,events);
try{
 const rule=await req('POST','/api/v1/detection-rules',{name:'Intake rule',severity:'high'},201),rulePath='/api/v1/detection-rules/'+rule.id;
 const created=await req('POST','/api/v1/api-sources',{name:'Sensor',provider:'Provider',rule_id:rule.id},201);let key=created.api_key;
 const source=created.source,sourcePath='/api/v1/api-sources/'+source.id,path='/api/v1/intake/'+source.id;
 const body={external_id:' event-1 ',title:' Example ',severity:'high',summary:' Context ',insight_refs:['b',' a ','b',''],evidence:[{type:'ip',value:' 192.0.2.1 '}]};
 const send=(suffix,data,status=201,headers={})=>req('POST',path+suffix,data,status,{authorization:'Bearer '+key,...headers});
 await req('POST',path+'/alerts',body,401);await send('/alerts',body,401,{authorization:'Bearer '+'x'.repeat(40)});await send('/alerts',body,403,{'x-tenant-id':'foreign'});
 await req('GET','/api/v1/alerts',undefined,401,{authorization:'Bearer '+key});
 const ingested=await send('/alerts',{...body,rule_id:'spoof',source:'spoof'});const alert=ingested.alert;assert.equal(ingested.duplicate,false);assert.equal(alert.source,source.source);assert.equal(alert.rule_id,rule.id);assert.equal(alert.disposition,'investigate');assert.equal(alert.payload.external_id,'event-1');assert.equal(alert.payload.title,'Example');assert.deepEqual(alert.payload.insight_refs,['a','b']);assert.deepEqual(alert.payload.evidence,[{type:'ip',value:'192.0.2.1',label:''}]);
 const duplicate=await send('/alerts',{...body,external_id:'event-1'},200);assert.deepEqual(duplicate,{duplicate:true,alert});
 const conflict=await send('/alerts',{...body,title:'Different'},409);assert.equal(conflict.error.code,'ALERT_CONFLICT');
 assert.deepEqual(await req('GET','/api/v1/alerts/'+alert.id),alert);assert.equal((await req('GET','/api/v1/alerts')).items.length,1);await req('GET','/api/v1/alerts/'+alert.id,undefined,404,{'x-tenant-id':'foreign'});
 const casePath='/api/v1/investigations/'+alert.investigation_id;const investigation=await req('GET',casePath);assert.deepEqual(investigation.alerts,[alert]);assert.equal(investigation.owner,'Local investigation worker');assert.equal(investigation.jobs.length,1);assert.equal(investigation.jobs[0].status,'queued');assert.equal(investigation.jobs[0].phase,0);assert.equal(investigation.jobs[0].mode,'local-deterministic');assert.equal(investigation.history[0].action,'alert_received');
 for(const patch of [{status:'closed'},{determination:'benign'},{summary:'Edit'},{risk_score:1},{replay_count:4}])assert.equal((await req('PATCH',casePath,patch,409)).error.code,'INVESTIGATION_RUNNING');
 await req('POST',casePath+'/reinvestigate',undefined,409);assert.equal((await req('DELETE',casePath,undefined,409)).error.code,'ALERT_REFERENCE_EXISTS');
 const metrics=await req('GET',rulePath);assert.equal(metrics.detections,1);assert.equal(metrics.investigations,1);assert.equal(metrics.version,1);assert.deepEqual(metrics.outcomes,[{determination:'unknown',count:1}]);assert.deepEqual(metrics.sources,[source.source]);
 const registry=await req('GET','/api/v1/detection-registry?source='+encodeURIComponent(source.source)+'&sort=detections');assert.equal(registry.total,1);assert.equal(registry.items[0].detections,1);assert.deepEqual(registry.sources,['Provider',source.source].sort());
 await req('POST',rulePath+'/toggle');await send('/alerts',body,200);assert.equal((await send('/alerts',{...body,external_id:'disabled'},409)).error.code,'RULE_DISABLED');await req('POST',rulePath+'/toggle');
 await req('PATCH',rulePath,{routing:'Suppress'});const suppressed=await send('/alerts',{...body,external_id:'suppressed'});assert.equal(suppressed.alert.disposition,'suppressed');assert.equal(suppressed.alert.investigation_id,null);
 await req('PATCH',rulePath,{routing:'Escalate'});const escalated=await send('/alerts',{...body,external_id:'escalate'});assert.equal((await req('GET','/api/v1/investigations/'+escalated.alert.investigation_id)).owner,'Analyst review');
 await req('PATCH',rulePath,{routing:'Sample (10%)'});
 for(const want of [true,false]){let external='';for(let i=0;i<200;i++){const candidate='sample-'+i;const sampled=createHash('sha256').update(JSON.stringify([tenant,source.source,candidate])).digest().readUInt32BE(0)%10===0;if(sampled===want){external=candidate;break}}assert.ok(external);assert.equal((await send('/alerts',{...body,external_id:external})).alert.disposition,want?'investigate':'not_sampled')}
 await req('PATCH',rulePath,{routing:'Suppress'});
 const race=await Promise.all(Array.from({length:6},async()=>{const r=await fetch(server.url+path+'/alerts',{method:'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json'},body:JSON.stringify({...body,external_id:'concurrent'})});const data=await r.json();assert.ok([200,201].includes(r.status));return {status:r.status,id:data.alert.id}}));assert.equal(race.filter(r=>r.status===201).length,1);assert.equal(new Set(race.map(r=>r.id)).size,1);
 assert.equal((await send('/events',{id:'native'},409)).error.code,'MAPPING_NOT_CONFIGURED');
 await req('PATCH',sourcePath+'/mapping',{mapping:{fields:{title:'event.title',external_id:'event.id',severity:'event.level'},severity_map:{WARN:'high'}}});
 const native={event:{id:'native',title:' Native ',level:'WARN'}};const mapped=await send('/events',native);assert.equal(mapped.alert.payload.title,'Native');await send('/events',native,200);
 const invalid=await send('/events',{event:{}},400);assert.equal(invalid.error.code,'NATIVE_EVENT_INVALID');assert.deepEqual(invalid.error.details,['title: no value found at event.title.','external_id: no value found at event.id.','severity: no value found at event.level.']);
 await send('/alerts',{...body,external_id:'invalid',severity:'unknown'},400);await send('/alerts',{...body,external_id:'large',padding:'x'.repeat(131072)},413);
 const beforeRotate=key;key=(await req('POST',sourcePath+'/rotate-key',{})).api_key;await send('/alerts',body,401,{authorization:'Bearer '+beforeRotate});await send('/alerts',body,200);await req('POST',sourcePath+'/revoke');await send('/alerts',body,401);
 assert.equal((await req('GET',rulePath)).detections,7);assert.equal((await req('GET',rulePath)).suppressed,3);
 await output(options.output||'output/backend-parity/alert-intake.json',{passed:true,backend:options.label||(server.owned?'node':'external'),request_count:events.length,persistence_fixture:{tenant,alert_id:alert.id,case_id:alert.investigation_id,rule_id:rule.id},checks:['source-bound authentication','normalized and native intake','deduplication and conflicts','concurrent duplicate intake','routing and deterministic sampling','atomic queued case context','actual rule metrics','active-run/deletion guards','key rotation and revocation','mapping order and payload limits'],scope:'Durable acceptance and queued jobs; investigation worker and Skills pending'});
 console.log('PASS authenticated alert intake');
}finally{await server.close();}
