import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {argumentsFor,target,client,output} from './harness.mjs';
process.env.AISOC_TEST_WORKER='false';
const options=argumentsFor(),server=await target(options),events=[],tenant='operator-alert-'+randomUUID(),req=client(server.url,tenant,events),base='/api/v1/alerts';
try{
 const first=await req('POST','/api/v1/detection-rules',{name:'Direct rule',severity:'high'},201),second=await req('POST','/api/v1/detection-rules',{name:'Other rule',severity:'low',routing:'Suppress'},201);
 const body={source:' Custom sensor ',external_id:' event ',rule_id:' '+first.id+' ',title:' Direct alert ',severity:'high',summary:' Context ',primary_entity:' host ',insight_refs:['b',' a ','b'],evidence:[{type:'ip',value:' 192.0.2.1 ',label:' Address '}],tenant_id:'forged',unknown:'removed'};
 const accepted=await req('POST',base,body,201),alert=accepted.alert;assert.equal(accepted.duplicate,false);assert.equal(alert.tenant_id,tenant);assert.equal(alert.source,'Custom sensor');assert.equal(alert.payload.rule_id,first.id);assert.equal(alert.payload.title,'Direct alert');assert.equal(alert.payload.primary_entity,'host');assert.equal(alert.payload.tenant_id,undefined);assert.deepEqual(alert.payload.insight_refs,['a','b']);assert.deepEqual(alert.payload.evidence,[{type:'ip',value:'192.0.2.1',label:'Address'}]);
 assert.deepEqual(await req('POST',base,{...body,source:'Custom sensor',external_id:'event'},200),{duplicate:true,alert});
 for(const changed of [{title:'Changed'},{rule_id:second.id},{rule_id:'missing'}])assert.equal((await req('POST',base,{...body,...changed},409)).error.code,'ALERT_CONFLICT');
 const missing=await req('POST',base,{...body,external_id:'missing',rule_id:'missing'},404);assert.equal(missing.error.message,'Detection rule not found');
 const detail=await req('GET','/api/v1/investigations/'+alert.investigation_id);assert.equal(detail.jobs.length,1);assert.equal(detail.jobs[0].status,'queued');assert.equal(detail.owner,'Local investigation worker');
 const metrics=await req('GET','/api/v1/detection-rules/'+first.id);assert.equal(metrics.detections,1);assert.equal(metrics.version,1);assert.deepEqual(metrics.sources,['Custom sensor']);
 const retained=await req('DELETE','/api/v1/detection-rules/'+first.id,undefined,409);assert.equal(retained.error.code,'ALERT_REFERENCE_EXISTS');
 await req('POST','/api/v1/detection-rules/'+first.id+'/toggle');await req('POST',base,body,200);assert.equal((await req('POST',base,{...body,external_id:'disabled'},409)).error.code,'RULE_DISABLED');await req('POST','/api/v1/detection-rules/'+first.id+'/toggle');
 async function raw(data){const r=await fetch(server.url+base,{method:'POST',headers:{'x-tenant-id':tenant,'content-type':'application/json'},body:JSON.stringify(data)});return {status:r.status,data:await r.json()}}
 const duplicateRace=await Promise.all(Array.from({length:6},()=>raw({...body,external_id:'race',rule_id:second.id})));assert.equal(duplicateRace.filter(r=>r.status===201).length,1);assert.equal(duplicateRace.filter(r=>r.status===200).length,5);assert.equal(new Set(duplicateRace.map(r=>r.data.alert.id)).size,1);
 const ruleRace=await Promise.all([first,second].map(r=>raw({...body,external_id:'different-rules',rule_id:r.id})));assert.deepEqual(ruleRace.map(r=>r.status).sort(),[201,409]);assert.equal(ruleRace.find(r=>r.status===409).data.error.code,'ALERT_CONFLICT');
 const source=await req('POST','/api/v1/api-sources',{name:'Cross-channel',provider:'Fixture',rule_id:first.id},201);const sourcePath='/api/v1/intake/'+source.source.id+'/alerts';
 const shared={external_id:'shared',title:'Shared content',severity:'low'};
 const cross=await req('POST',base,{...shared,source:source.source.source,rule_id:first.id},201);
 const duplicate=await req('POST',sourcePath,shared,200,{authorization:'Bearer '+source.api_key});assert.equal(duplicate.alert.id,cross.alert.id);
 await req('POST',base,{...shared,source:'Anything',rule_id:first.id},401,{authorization:'Bearer '+source.api_key});
 await req('POST','/api/v1/api-sources/'+source.source.id+'/revoke');await req('POST',sourcePath,shared,401,{authorization:'Bearer '+source.api_key});await req('POST',base,{...shared,source:source.source.source,rule_id:first.id},200);
 const foreign=tenant+'-foreign';await req('POST',base,body,404,{'x-tenant-id':foreign});const foreignRule=await req('POST','/api/v1/detection-rules',{name:'Foreign',severity:'low',routing:'Suppress'},201,{'x-tenant-id':foreign});const foreignAlert=await req('POST',base,{...body,rule_id:foreignRule.id},201,{'x-tenant-id':foreign});assert.notEqual(foreignAlert.alert.id,alert.id);await req('GET',base+'/'+foreignAlert.alert.id,undefined,404);
 for(const invalid of [{source:''},{source:' '},{source:'x'.repeat(121)},{rule_id:''},{rule_id:'x'.repeat(101)},{external_id:''},{title:' '},{severity:'other'},{evidence:[{type:'ip',value:' '}]},{insight_refs:Array(51).fill('x')}])await req('POST',base,{...body,...invalid},400);
 await req('POST',base,{...body,padding:'x'.repeat(131072)},413);
 assert.equal((await req('GET',base)).items.length,4);
 await output(options.output||'output/backend-parity/operator-alerts.json',{passed:true,backend:options.label||(server.owned?'node':'external'),request_count:events.length,persistence_fixture:{tenant,alert_id:alert.id},checks:['operator payload normalization','duplicate/conflict precedence','cross-rule concurrent deduplication','source/operator shared deduplication','tenant and source-key isolation','disabled rule handling','atomic case/job creation','rule metrics and deletion guard','schema and payload limits'],scope:'Operator submission; automatic Skills pending'});
 console.log('PASS operator alert submission');
}finally{await server.close();}
