import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {argumentsFor,target,client,output} from './harness.mjs';
process.env.AISOC_TEST_WORKER='false';
const options=argumentsFor(),server=await target(options),events=[],tenant='queue-'+randomUUID(),req=client(server.url,tenant,events),path='/api/v1/investigation-queue';
try{
 const empty={items:[],summary:{alerts:0,active_runs:0,open_cases:0}};assert.deepEqual(await req('GET',path),empty);
 const manual=await req('POST','/api/v1/investigations',{title:'Manual',source:'Fixture',severity:'low',insight_refs:['alpha','<tag>','quoted"value']},201);
 const {insight_refs,...fields}=manual;
 let queue=await req('GET',path);assert.deepEqual(queue.items,[{...fields,insight_refs_json:JSON.stringify(insight_refs),job_id:null,run_status:null,run_phase:null}]);assert.deepEqual(queue.summary,{alerts:0,active_runs:0,open_cases:1});
 const rule=await req('POST','/api/v1/detection-rules',{name:'Queue rule',severity:'high'},201),source=await req('POST','/api/v1/api-sources',{name:'Queue source',provider:'Fixture',rule_id:rule.id},201);
 const send=external_id=>req('POST','/api/v1/intake/'+source.source.id+'/alerts',{external_id,title:'Queue alert',severity:'high'},201,{authorization:'Bearer '+source.api_key});
 const alert=await send('investigate');const caseId=alert.alert.investigation_id;const detail=await req('GET','/api/v1/investigations/'+caseId);
 queue=await req('GET',path);assert.equal(queue.items[0].id,caseId);assert.equal(queue.items[0].job_id,detail.jobs[0].id);assert.equal(queue.items[0].run_status,'queued');assert.equal(queue.items[0].run_phase,0);assert.deepEqual(queue.summary,{alerts:1,active_runs:1,open_cases:2});
 await req('PATCH','/api/v1/detection-rules/'+rule.id,{routing:'Suppress'});await send('suppressed');queue=await req('GET',path);assert.equal(queue.items.length,2);assert.deepEqual(queue.summary,{alerts:2,active_runs:1,open_cases:2});
 await req('PATCH','/api/v1/investigations/'+manual.id,{status:'closed'});queue=await req('GET',path);assert.deepEqual(queue.summary,{alerts:2,active_runs:1,open_cases:1});assert.equal(queue.items[1].status,'closed');
 await req('PATCH','/api/v1/investigations/'+manual.id,{status:'resolved'});assert.equal((await req('GET',path)).summary.open_cases,1);
 await req('PATCH','/api/v1/investigations/'+manual.id,{status:'contained'});assert.equal((await req('GET',path)).summary.open_cases,2);
 // A fixed page cap must not cap summary totals. Sequential insert order also
 // exercises ties when cases share the same millisecond timestamp.
 const created=[];for(let i=0;i<103;i++)created.push(await req('POST','/api/v1/investigations',{title:'Page '+i,source:'Fixture',severity:'low'},201));
 queue=await req('GET',path);assert.equal(queue.items.length,100);assert.deepEqual(queue.items.map(i=>i.id),created.slice(-100).reverse().map(i=>i.id));assert.deepEqual(queue.summary,{alerts:2,active_runs:1,open_cases:105});
 await req('PATCH','/api/v1/investigations/'+manual.id,{title:'Edited oldest'});assert.deepEqual((await req('GET',path)).items.map(i=>i.id),queue.items.map(i=>i.id),'editing must not move an old case onto the creation-ordered page');
 assert.deepEqual(await req('GET',path,undefined,200,{'x-tenant-id':tenant+'-foreign'}),empty);
 await req('GET',path,undefined,401,{authorization:'Bearer '+source.api_key});
 await output(options.output||'output/backend-parity/investigation-queue.json',{passed:true,backend:options.label||(server.owned?'node':'external'),request_count:events.length,persistence_fixture:{tenant},checks:['legacy queue shape and nullable job fields','latest queued run','suppressed alerts counted without cases','open/closed/resolved/contained totals','100-row creation-ordered page with uncapped totals','tenant isolation and source-key rejection'],scope:'Paused-worker queue snapshots; worker suite and PostgreSQL tests cover run transitions'});
 console.log('PASS investigation queue');
}finally{await server.close();}
