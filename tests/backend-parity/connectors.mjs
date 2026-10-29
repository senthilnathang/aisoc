import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {argumentsFor,target,client,output} from './harness.mjs';
const options=argumentsFor(),server=await target(options),events=[],tenant='connectors-'+randomUUID(),req=client(server.url,tenant,events),root='/api/v1/connectors';
const safe=r=>{assert.equal(r.secret,undefined);assert.equal(r.secret_ciphertext,undefined);assert.ok(!JSON.stringify(r).includes('fixture-private-secret'))};
try{
 assert.deepEqual(await req('GET',root),{items:[]});
 const connector=await req('POST',root,{type:'crowdstrike',name:'Sensor',secret:'fixture-private-secret',config:{region:'us',nested:{enabled:true}},id:'override',tenant_id:'override',secret_ciphertext:'override'},201),path=root+'/'+connector.id;
 safe(connector);assert.match(connector.id,/^CON-/);assert.equal(connector.tenant_id,tenant);assert.equal(connector.status,'untested');assert.equal(connector.last_tested_at,null);assert.equal(connector.description,'');assert.equal(connector.workspace_url,'');assert.equal(connector.client_id,'');assert.deepEqual(connector.config,{region:'us',nested:{enabled:true}});assert.deepEqual(await req('GET',path),connector);
 assert.deepEqual(await req('PATCH',path,{id:'override',ignored:true,secret_ciphertext:'override'}),connector);
 const changed=await req('PATCH',path,{description:'Endpoint telemetry',workspace_url:'https://example.invalid',client_id:'client',secret:'fixture-private-secret-rotated',status:'operational',last_tested_at:'legacy date',config:{region:'eu'}});safe(changed);assert.deepEqual(changed.config,{region:'eu'});
 const tested=await req('POST',path+'/test');safe(tested);assert.equal(tested.status,'untested');assert.equal(tested.last_tested_at,'legacy date');assert.deepEqual(tested.test_result,{status:'not_configured',message:'CrowdStrike read-only adapter is not configured yet. No provider request was made.'});const {test_result,...stored}=tested;assert.deepEqual(await req('GET',path),stored);
 const other=await req('POST',root,{type:'other-provider',name:'Other',status:'custom',config:{},secret:''},201);assert.equal(other.status,'custom');const unsupported=await req('POST',root+'/'+other.id+'/test');assert.deepEqual(unsupported.test_result,{status:'unsupported',message:'No live test adapter is installed for other-provider. No provider request was made.'});
 assert.equal((await req('GET',root+'?search=TELEMETRY')).items[0].id,connector.id);assert.equal((await req('GET',root+'?search=%25&severity=ignored&reportId=ignored')).items.length,2);assert.equal((await req('GET',root+'?status=untested&limit=1&offset=1')).items.length,1);safe(await req('GET',root));
 await req('PATCH',path,{secret:''});safe(await req('PATCH',path,{secret:'fixture-private-secret-persisted',last_tested_at:null}));
 const foreign={'x-tenant-id':tenant+'-foreign'};assert.deepEqual(await req('GET',root,undefined,200,foreign),{items:[]});
 for(const [method,suffix,body]of [['GET',''],['PATCH','',{secret:'foreign'}],['DELETE',''],['POST','/test']])await req(method,path+suffix,body,404,foreign);
 for(const body of [{name:'x'},{type:'x'},{type:'',name:'x'},{type:'x',name:''},{type:'x',name:'x',config:[]}])await req('POST',root,body,400);
 for(const q of ['limit=0','limit=501','limit=1.5','offset=-1','limit=2&limit=3'])await req('GET',root+'?'+q,undefined,400);
 await req('DELETE',root+'/'+other.id,undefined,204);await req('GET',root+'/'+other.id,undefined,404);await req('POST',root+'/'+other.id+'/test',undefined,404);
 await output(options.output||'output/backend-parity/connectors.json',{passed:true,backend:options.label||(server.owned?'node':'external'),request_count:events.length,persistence_fixture:{tenant,connector_id:connector.id},checks:['CRUD/defaults/allowlists','secret redaction and replacement','config replacement','test adapter unavailable behavior','filters/pagination','tenant isolation','validation'],scope:'No provider request is made. Go encrypts dedicated secrets; non-string PATCH secrets intentionally rejected rather than legacy String coercion.'});
 console.log('PASS connectors lifecycle');
}finally{await server.close();}
