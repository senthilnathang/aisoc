import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {argumentsFor,target,client,output} from './harness.mjs';

const options=argumentsFor(),server=await target(options),events=[];
const tenant='response-library-'+randomUUID(),req=client(server.url,tenant,events);
const input={kind:'runbook',title:'Identity recovery',description:'Review procedure',domain:'Identity',trigger:'Incident',steps:[{title:'Approve',instructions:'Confirm scope',approval_required:true}]};
try{
  const empty=await req('GET','/api/v1/response-plans');assert.deepEqual(empty.items,[]);
  const created=await req('POST','/api/v1/response-plans',input,201);
  assert.equal(created.version,1);assert.equal(created.state,'active');assert.equal(created.tenant_id,undefined);
  const path='/api/v1/response-plans/'+created.id;
  assert.deepEqual(await req('GET',path),created);
  for(const [method,suffix,body] of [['GET','',undefined],['GET','/history',undefined],['PATCH','',{...input,expected_version:1}],['POST','/state',{expected_version:1,state:'archived'}],['POST','/duplicate',undefined]]){
    const result=await req(method,path+suffix,body,404,{'x-tenant-id':tenant+'-foreign'});assert.equal(result.error.code,'NOT_FOUND');
  }
  const result=await req('PATCH',path,{...input,title:'Version two',expected_version:1});assert.equal(result.version,2);
  assert.equal((await req('PATCH',path,{...input,expected_version:1},409)).error.code,'VERSION_CONFLICT');
  const history=await req('GET',path+'/history');assert.deepEqual(history.items.map(e=>e.version),[2,1]);assert.deepEqual(history.items.map(e=>e.action),['updated','created']);assert.equal(history.items[1].snapshot.title,input.title);
  assert.equal((await req('PATCH',path,{...input,kind:'workflow',expected_version:2},400)).error.code,'INVALID_KIND');
  await req('POST',path+'/state',{expected_version:2,state:'archived'});
  assert.equal((await req('PATCH',path,{...input,expected_version:3},409)).error.code,'ARCHIVED');
  const copy=await req('POST',path+'/duplicate',undefined,201);assert.equal(copy.title,'Version two (copy)');assert.equal(copy.version,1);assert.equal(copy.state,'active');assert.notEqual(copy.id,created.id);
  await req('POST',path+'/state',{expected_version:3,state:'active'});
  const before=(await req('GET',path)).version;
  const writes=await Promise.all(['A','B'].map(async title=>{const response=await fetch(server.url+path,{method:'PATCH',headers:{'content-type':'application/json','x-tenant-id':tenant},body:JSON.stringify({...input,title,expected_version:before}),signal:AbortSignal.timeout(10000)});return {status:response.status,data:await response.json()};}));
  assert.deepEqual(writes.map(row=>row.status).sort(),[200,409]);
  assert.equal((await req('GET',path)).version,before+1);assert.equal((await req('GET',path+'/history')).items.length,before+1);
  assert.deepEqual((await req('GET','/api/v1/response-plans')).items.map(row=>row.id),[copy.id,created.id]);
  for(const invalid of [{...input,title:''},{...input,steps:[]},{...input,steps:[{title:'Missing approval',instructions:''}]},{...input,steps:[{title:'Invalid approval',instructions:'',approval_required:'yes'}]},{...input,title:'x'.repeat(201)}]){
    assert.equal((await req('POST','/api/v1/response-plans',invalid,400)).error.code,'VALIDATION_ERROR');
  }
  for(const [value,expected] of [[null,false],[0,false],[1,true],['true',true],['false',false]]){
    const coerced=await req('POST','/api/v1/response-plans',{...input,title:123,description:null,steps:[{title:'Coercion',instructions:null,approval_required:value}]},201);
    assert.equal(coerced.title,'123');assert.equal(coerced.description,'');assert.equal(coerced.steps[0].instructions,'');assert.equal(coerced.steps[0].approval_required,expected);
    assert.equal((await req('POST','/api/v1/response-plans/'+coerced.id+'/state',{state:'archived',expected_version:'1'})).version,2);
  }
  const large=await req('POST','/api/v1/response-plans',{...input,steps:Array.from({length:50},()=>({...input.steps[0],instructions:'x'.repeat(4000)}))},201);assert.equal(large.steps.length,50);
  assert.equal((await req('POST','/api/v1/response-plans',{...input,description:'x'.repeat(1100000)},413)).error.code,'PAYLOAD_TOO_LARGE');
  await req('GET',path,undefined,401,{authorization:'Bearer invalid'});
  await output(options.output||'output/backend-parity/response-library.json',{passed:true,backend:options.label||(server.owned?'node':'external'),checks:['plan lifecycle','tenant reads/writes','immutable history','archive and restore','copy','optimistic concurrency and atomic audit','stable order','required fields and lengths','invalid credential in local mode'],request_count:events.length});
  console.log('PASS response library lifecycle and concurrency');
}finally{await server.close();}
