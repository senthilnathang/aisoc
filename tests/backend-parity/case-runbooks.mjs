import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {argumentsFor,target,client,output} from './harness.mjs';

const options=argumentsFor(),server=await target(options),events=[];
const tenant='case-runbooks-'+randomUUID(),req=client(server.url,tenant,events);
const definition={kind:'runbook',title:'Recover identity',description:'Contain and recover',domain:'Identity',trigger:'Confirmed compromise',steps:[{title:'Review evidence',instructions:'Verify scope',approval_required:false},{title:'Revoke sessions',instructions:'Confirm target',approval_required:true}]};
try{
 const record=await req('POST','/api/v1/investigations',{title:'Runbook case',source:'Fixture',severity:'high',primary_entity:'host-1',insight_refs:['context-1']},201);
 assert.match(record.id,/^INV-/);assert.equal(record.status,'open');assert.equal(record.determination,'unknown');assert.equal(record.owner,'AISOC Agent');assert.equal(record.replay_count,0);assert.deepEqual(record.insight_refs,['context-1']);
 assert.equal((await req('GET','/api/v1/investigations?search=host-1&limit=1')).items[0].id,record.id);
 assert.deepEqual((await req('GET','/api/v1/investigations?severity=low')).items,[]);
 await req('GET','/api/v1/investigations?limit=0',undefined,400);
 const casePath='/api/v1/investigations/'+record.id,path=casePath+'/runbooks';
 assert.deepEqual((await req('GET',path)).items,[]);
 const plan=await req('POST','/api/v1/response-plans',definition,201);
 const attached=await req('POST',path,{plan_id:plan.id,expected_version:1},201);
 assert.equal(attached.version,1);assert.equal(attached.snapshot.version,1);assert.equal(attached.history,undefined);
 assert.deepEqual(attached.steps[0],{completed:false,note:'',updated_by:null,updated_at:null});
 assert.equal((await req('POST',path,{plan_id:plan.id,expected_version:1},409)).error.code,'ALREADY_ATTACHED');
 await req('PATCH','/api/v1/response-plans/'+plan.id,{...definition,title:'Changed library',steps:[definition.steps[0]],expected_version:1});
 const initial=(await req('GET',path)).items[0];assert.deepEqual(initial.snapshot,attached.snapshot);assert.equal(initial.history.length,1);
 const patch={expected_version:1,step_index:1,completed:true,note:'Approved by analyst',approval_confirmed:false};
 assert.equal((await req('PATCH',path+'/'+attached.id,patch,400)).error.code,'APPROVAL_REQUIRED');
 assert.equal((await req('GET',path)).items[0].version,1);
 const complete=await req('PATCH',path+'/'+attached.id,{...patch,approval_confirmed:true});assert.equal(complete.steps[1].completed,true);assert.equal(complete.steps[1].updated_by,'local-development');
 assert.equal((await req('PATCH',path+'/'+attached.id,{...patch,approval_confirmed:true},409)).error.code,'VERSION_CONFLICT');
 assert.equal((await req('PATCH',path+'/'+attached.id,{...patch,expected_version:2,step_index:10},400)).error.code,'INVALID_STEP');
 await req('PATCH',path+'/'+attached.id,{...patch,expected_version:2,completed:false,note:'Rechecking target'});
 await req('PATCH',path+'/'+attached.id,{...patch,expected_version:3,completed:false,note:'Note-only change'});
 const reopened=(await req('GET',path)).items[0];assert.equal(reopened.version,4);assert.equal(reopened.steps[1].completed,false);assert.equal(reopened.steps[1].note,'Note-only change');assert.equal(reopened.history.length,4);assert.equal(reopened.history[2].approval_confirmed,true);assert.equal(reopened.history[0].approval_confirmed,false);
 const audit=(await req('GET',casePath+'/history')).items;
 assert.deepEqual(audit.map(e=>e.action),['runbook_step_updated','runbook_step_updated','runbook_step_completed','runbook_attached','created']);
 assert.equal(audit[0].details.record_id,attached.id);assert.equal(audit[0].details.actor,'local-development');
 const detail=await req('GET',casePath);assert.deepEqual(detail.history,audit);assert.deepEqual(detail.alerts,[]);assert.deepEqual(detail.jobs,[]);
 const other=await req('POST','/api/v1/investigations',{title:'Other case',source:'Fixture',severity:'low'},201);
 await req('PATCH','/api/v1/investigations/'+other.id+'/runbooks/'+attached.id,{...patch,expected_version:4},404);
 for(const [method,suffix,body] of [['GET','',undefined],['GET','/history',undefined],['GET','/runbooks',undefined],['POST','/runbooks',{plan_id:plan.id,expected_version:2}],['PATCH','/runbooks/'+attached.id,{...patch,expected_version:4}],['DELETE','',undefined]]){
  await req(method,casePath+suffix,body,404,{'x-tenant-id':tenant+'-foreign'});
 }
 const foreign=await req('POST','/api/v1/investigations',{title:'Foreign case',source:'Fixture',severity:'low'},201,{'x-tenant-id':tenant+'-foreign'});
 await req('POST','/api/v1/investigations/'+foreign.id+'/runbooks',{plan_id:plan.id,expected_version:2},404,{'x-tenant-id':tenant+'-foreign'});
 const workflow=await req('POST','/api/v1/response-plans',{...definition,kind:'workflow'},201);
 assert.equal((await req('POST',path,{plan_id:workflow.id,expected_version:1},400)).error.code,'INVALID_RUNBOOK');
 const archived=await req('POST','/api/v1/response-plans',definition,201);await req('POST','/api/v1/response-plans/'+archived.id+'/state',{expected_version:1,state:'archived'});
 assert.equal((await req('POST',path,{plan_id:archived.id,expected_version:1},409)).error.code,'VERSION_CONFLICT');
 assert.equal((await req('POST',path,{plan_id:archived.id,expected_version:2},400)).error.code,'INVALID_RUNBOOK');
 const racePlan=await req('POST','/api/v1/response-plans',definition,201);
 async function race(method,url,body){const response=await fetch(server.url+url,{method,headers:{'content-type':'application/json','x-tenant-id':tenant},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});return {status:response.status,body:await response.json()};}
 const attachments=await Promise.all([race('POST',path,{plan_id:racePlan.id,expected_version:1}),race('POST',path,{plan_id:racePlan.id,expected_version:1})]);assert.deepEqual(attachments.map(r=>r.status).sort(),[201,409]);
 const raceID=attachments.find(r=>r.status===201).body.id;
 const updates=await Promise.all(['First','Second'].map(note=>race('PATCH',path+'/'+raceID,{...patch,step_index:0,approval_confirmed:false,note})));assert.deepEqual(updates.map(r=>r.status).sort(),[200,409]);
 const raced=(await req('GET',path)).items.find(r=>r.id===raceID);assert.equal(raced.version,2);assert.equal(raced.history.length,2);
 for(const invalid of [{...patch,expected_version:4,step_index:-1},{...patch,expected_version:4,step_index:50},{...patch,expected_version:4,note:'x'.repeat(4001)},{expected_version:4,step_index:0,completed:false,note:''}])await req('PATCH',path+'/'+attached.id,invalid,400);
 await req('DELETE',casePath,undefined,204);await req('GET',path,undefined,404);await req('GET',casePath+'/history',undefined,404);
 assert.equal((await req('GET','/api/v1/response-plans/'+plan.id)).id,plan.id);
 // Leave one real assignment for the isolated Go process-restart persistence check.
 const saved=await req('POST','/api/v1/investigations/'+other.id+'/runbooks',{plan_id:racePlan.id,expected_version:1},201);
 await req('PATCH','/api/v1/investigations/'+other.id+'/runbooks/'+saved.id,{...patch,step_index:0,completed:false,note:'Persist across restart'});
 await output(options.output||'output/backend-parity/case-runbooks.json',{passed:true,backend:options.label||(server.owned?'node':'external'),request_count:events.length,checks:['manual case defaults and filters','pinned snapshot','approval, reopen and note-only updates','atomic version/history conflict semantics','tenant and case ownership','active-runbook requirements','concurrent attach and step updates','validation','case deletion'],persistence_fixture:{tenant,case_id:other.id,assignment_id:saved.id}});
 console.log('PASS manual cases and pinned runbooks');
}finally{await server.close();}
