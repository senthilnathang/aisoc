import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {argumentsFor,target,client,output} from './harness.mjs';
const options=argumentsFor(),server=await target(options),events=[];
const req=client(server.url,'response-errors-'+randomUUID(),events);
const input={kind:'runbook',title:'Error contracts',description:'',domain:'Identity',trigger:'Test',steps:[{title:'Approve',instructions:'Review',approval_required:true}]};
const conflict=[409,'VERSION_CONFLICT','This record changed. Reload it before saving your changes.'];
async function error(method,path,body,[status,code,message]){
 assert.deepEqual(await req(method,path,body,status),{error:{code,message,details:null}});
}
try{
 await error('GET','/api/v1/response-plans/missing',undefined,[404,'NOT_FOUND','Response plan not found']);
 const plan=await req('POST','/api/v1/response-plans',input,201),path='/api/v1/response-plans/'+plan.id;
 await error('PATCH',path,{...input,expected_version:2},conflict);
 await error('PATCH',path,{...input,kind:'workflow',expected_version:1},[400,'INVALID_KIND',"A plan's kind cannot be changed."]);
 await req('POST',path+'/state',{expected_version:1,state:'archived'});
 await error('PATCH',path,{...input,expected_version:1},conflict);
 await error('PATCH',path,{...input,expected_version:2},[409,'ARCHIVED','Restore this plan before editing it.']);
 assert.equal((await req('GET',path+'/history')).items.length,2);
 const c=await req('POST','/api/v1/investigations',{title:'Error case',source:'Fixture',severity:'high'},201),cp='/api/v1/investigations/'+c.id;
 await error('POST',cp+'/runbooks',{plan_id:plan.id,expected_version:2},[400,'INVALID_RUNBOOK','Choose an active runbook.']);
 await error('POST','/api/v1/investigations/missing/runbooks',{plan_id:plan.id,expected_version:2},[404,'NOT_FOUND','Investigation not found']);
 await req('POST',path+'/state',{expected_version:2,state:'active'});
 const attached=await req('POST',cp+'/runbooks',{plan_id:plan.id,expected_version:3},201);
 await error('POST',cp+'/runbooks',{plan_id:plan.id,expected_version:3},[409,'ALREADY_ATTACHED','This runbook is already attached to the case.']);
 const step={expected_version:1,step_index:0,completed:true,note:'',approval_confirmed:false};
 await error('PATCH',cp+'/runbooks/missing',step,[404,'NOT_FOUND','Attached runbook not found']);
 await error('PATCH',cp+'/runbooks/'+attached.id,{...step,expected_version:2},conflict);
 await error('PATCH',cp+'/runbooks/'+attached.id,{...step,step_index:1},[400,'INVALID_STEP','Runbook step not found']);
 await error('PATCH',cp+'/runbooks/'+attached.id,step,[400,'APPROVAL_REQUIRED','Confirm analyst approval for this step.']);
 const unchanged=(await req('GET',cp+'/runbooks')).items[0];assert.equal(unchanged.version,1);assert.equal(unchanged.history.length,1);assert.equal(unchanged.steps[0].completed,false);
 assert.deepEqual((await req('GET',cp+'/history')).items.map(e=>e.action),['runbook_attached','created']);
 await req('DELETE',cp,undefined,204);
 await output(options.output||'output/backend-parity/response-errors.json',{passed:true,backend:options.label||(server.owned?'node':'external'),request_count:events.length,checks:['exact domain error status/code/message/details','conflict precedence','no mutation or audit on rejected writes'],excludes:['schema validation details','malformed JSON parser messages','legacy case/remediation invalid-type status differences']});
 console.log('PASS response domain error contracts');
}finally{await server.close();}
