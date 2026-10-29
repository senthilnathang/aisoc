import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {argumentsFor,target,client,output} from './harness.mjs';
const options=argumentsFor(),server=await target(options),events=[],tenant='sources-'+randomUUID(),req=client(server.url,tenant,events),base='/api/v1/api-sources';
const safe=value=>{const text=JSON.stringify(value);assert.ok(!text.includes('key_hash'));assert.ok(!text.includes('aisoc_src_'));};
try{
 assert.deepEqual(await req('GET',base),{items:[]});
 const rule=await req('POST','/api/v1/detection-rules',{name:'Bound rule',severity:'high'},201);
 const input={name:' Source A ',provider:' Provider ',rule_id:rule.id};
 const created=await req('POST',base,input,201),source=created.source,path=base+'/'+source.id;
 assert.match(created.api_key,/^aisoc_src_[A-Za-z0-9_-]{43}$/);assert.equal(source.name,'Source A');assert.equal(source.provider,'Provider');assert.equal(source.status,'active');assert.equal(source.revoked_at,null);assert.deepEqual(source.mapping,{fields:{}});assert.equal(source.format,'normalized-alert-v1');assert.equal(source.source,'api-source:'+source.id);assert.equal(source.intake_path,'/api/v1/intake/'+source.id+'/alerts');assert.equal(source.native_intake_path,'/api/v1/intake/'+source.id+'/events');safe(source);
 assert.ok(Math.abs(Date.parse(source.expires_at)-Date.parse(source.created_at)-30*86400000)<1000);
 assert.deepEqual(await req('GET',path),source);safe(await req('GET',base));
 const conflict=await req('DELETE','/api/v1/detection-rules/'+rule.id,undefined,409);assert.equal(conflict.error.code,'SOURCE_REFERENCE_EXISTS');assert.equal(conflict.error.message,'An API source references this rule. Disable the rule instead.');
 const registry=await req('GET','/api/v1/detection-registry?source=Provider');assert.equal(registry.total,1);assert.deepEqual(registry.sources,['Provider']);assert.deepEqual(registry.items[0].bindings,[{id:source.id,name:'Source A',provider:'Provider'}]);
 assert.deepEqual((await req('GET','/api/v1/detection-rules/'+rule.id)).bindings,registry.items[0].bindings);
 const clone=await req('POST','/api/v1/detection-rules/'+rule.id+'/clone',undefined,201);assert.deepEqual((await req('GET','/api/v1/detection-rules/'+clone.id)).bindings,[]);
 const rotated=await req('POST',path+'/rotate-key',{expires_in_days:1});assert.notEqual(rotated.api_key,created.api_key);assert.equal(rotated.source.status,'active');assert.ok(Math.abs(Date.parse(rotated.source.expires_at)-Date.parse(rotated.source.updated_at)-86400000)<1000);safe(rotated.source);
 const revoked=await req('POST',path+'/revoke');assert.equal(revoked.status,'revoked');assert.ok(revoked.revoked_at);safe(revoked);assert.deepEqual(await req('POST',path+'/revoke'),revoked);
 assert.equal((await req('GET','/api/v1/detection-registry?source=Provider')).total,1);await req('DELETE','/api/v1/detection-rules/'+rule.id,undefined,409);
 const restored=await req('POST',path+'/rotate-key',{});assert.equal(restored.source.status,'active');assert.equal(restored.source.revoked_at,null);assert.notEqual(restored.api_key,rotated.api_key);
 for(const [method,suffix,body]of [['GET','',undefined],['POST','/revoke',undefined],['POST','/rotate-key',{}]])await req(method,path+suffix,body,404,{'x-tenant-id':tenant+'-foreign'});
 await req('POST',base,input,404,{'x-tenant-id':tenant+'-foreign'});assert.deepEqual(await req('GET',base,undefined,200,{'x-tenant-id':tenant+'-foreign'}),{items:[]});
 await req('POST',base,{...input,rule_id:'missing'},404);
 for(const body of [{...input,name:' '},{...input,provider:''},{...input,expires_in_days:0},{...input,expires_in_days:366}])await req('POST',base,body,400);
 await req('POST',path+'/rotate-key',{expires_in_days:-1},400);
 for(const [endpoint,body,status]of [[base,input,201],[path+'/rotate-key',{},200]]){
  const r=await fetch(server.url+endpoint,{method:'POST',headers:{'x-tenant-id':tenant,'content-type':'application/json'},body:JSON.stringify(body)});assert.equal(r.status,status);assert.equal(r.headers.get('cache-control'),'no-store');await r.json();
 }
 await output(options.output||'output/backend-parity/api-sources.json',{passed:true,backend:options.label||(server.owned?'node':'external'),request_count:events.length,persistence_fixture:{tenant,source_id:source.id},checks:['one-time key disclosure and no-store','source views and trimming','rotation and idempotent revocation','tenant isolation and validation','rule deletion guard','registry bindings and provider filtering'],scope:'Source management only; intake and mapping pending'});
 console.log('PASS API source lifecycle');
}finally{await server.close();}
