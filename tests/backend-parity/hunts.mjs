import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {argumentsFor,target,client,output} from './harness.mjs';
const options=argumentsFor(),server=await target(options),events=[],tenant='hunts-'+randomUUID(),req=client(server.url,tenant,events),root='/api/v1/hunts';
try{
 assert.deepEqual(await req('GET',root),{items:[]});
 const hunt=await req('POST',root,{name:'PowerShell hunt',query:'process = powershell',insight_refs:['ref-1','ref-1'],ignored:'ignore',id:'override',tenant_id:'override'},201),path=root+'/'+hunt.id;
 assert.match(hunt.id,/^HUNT-/);assert.equal(hunt.tenant_id,tenant);assert.equal(hunt.source,'ad_hoc');assert.equal(hunt.status,'draft');assert.equal(hunt.verdict,null);assert.equal(hunt.findings_count,0);assert.equal(hunt.last_run_at,null);assert.deepEqual(hunt.insight_refs,['ref-1','ref-1']);assert.equal(hunt.ignored,undefined);
 assert.deepEqual(await req('GET',path),{...hunt,skill_applications:[]});
 assert.deepEqual(await req('PATCH',path,{ignored:true,id:'other',tenant_id:'other'}),hunt);
 const changed=await req('PATCH',path,{name:'Reviewed PowerShell',query:'new query',source:'Analyst',status:'custom-state',verdict:'custom-verdict',findings_count:8,last_run_at:'legacy date text',insight_refs:['ref-2']});
 assert.equal(changed.status,'custom-state');assert.equal(changed.last_run_at,'legacy date text');assert.equal(changed.findings_count,8);assert.deepEqual(changed.insight_refs,['ref-2']);
 const second=await req('POST',root,{name:'Other',query:'query test',status:'paused',findings_count:2,source:'Feed'},201);
 assert.equal(second.status,'paused');assert.equal(second.findings_count,2);
 assert.equal((await req('GET',root+'?search=POWERSHELL')).items.length,1);assert.equal((await req('GET',root+'?search=query')).items.length,2);assert.equal((await req('GET',root+'?search=%25')).items.length,2);assert.equal((await req('GET',root+'?status=paused')).items[0].id,second.id);
 assert.equal((await req('GET',root+'?severity=critical&reportId=ignored&investigationId=ignored')).items.length,2);assert.equal((await req('GET',root+'?limit=1&offset=1')).items.length,1);
 for(let i=0;i<2;i++){const run=await req('POST',path+'/run');assert.equal(run.status,'completed');assert.equal(run.findings_count,hunt.id.length%4+1);assert.equal(run.verdict,run.findings_count>1?'review_required':'no_findings');assert.deepEqual(run.applied_skills,[]);assert.ok(!Number.isNaN(Date.parse(run.last_run_at)));assert.equal(run.name,changed.name);assert.deepEqual(run.insight_refs,['ref-2']);const {applied_skills,...stored}=run;assert.deepEqual(await req('GET',path),{...stored,skill_applications:[]})}
 const foreign={'x-tenant-id':tenant+'-foreign'};assert.deepEqual(await req('GET',root,undefined,200,foreign),{items:[]});
 for(const [method,suffix,body]of [['GET',''],['PATCH','',{}],['DELETE',''],['POST','/run']])await req(method,path+suffix,body,404,foreign);
 for(const body of [{query:'x'},{name:'x'},{name:'',query:'x'},{name:'x',query:''},{name:'x',query:'x',insight_refs:Array(51).fill('x')},{name:'x',query:'x',insight_refs:['x'.repeat(201)]}])assert.equal((await req('POST',root,body,400)).error.code,'VALIDATION_ERROR');
 for(const q of ['limit=0','limit=501','limit=1.5','offset=-1','limit=2&limit=3'])await req('GET',root+'?'+q,undefined,400);
 // Match the legacy distinction: create strings may coerce, PATCH uses SQLite text affinity.
 const scalar=await req('POST',root,{name:123,query:true},201);assert.equal(scalar.name,'123');assert.equal(scalar.query,'true');const patch=await req('PATCH',root+'/'+scalar.id,{name:123,verdict:null,last_run_at:null});assert.equal(patch.name,'123.0');assert.equal(patch.verdict,null);assert.equal(patch.last_run_at,null);
 await req('DELETE',root+'/'+scalar.id,undefined,204);await req('DELETE',root+'/'+second.id,undefined,204);await req('GET',root+'/'+second.id,undefined,404);await req('POST',root+'/'+second.id+'/run',undefined,404);
 await output(options.output||'output/backend-parity/hunts.json',{passed:true,backend:options.label||(server.owned?'node':'external'),request_count:events.length,persistence_fixture:{tenant,hunt_id:hunt.id},checks:['CRUD/defaults/allowlists','simulated run and repeat','filters/pagination','tenant isolation','schema validation','legacy text coercion'],scope:'New hunts without Skills. Skills application and existing record import remain pending; run is the legacy local simulation, not query execution.'});
 console.log('PASS hunts lifecycle');
}finally{await server.close();}
