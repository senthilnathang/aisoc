import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {argumentsFor,target,client,output} from './harness.mjs';
const options=argumentsFor(),server=await target(options),events=[],tenant='mapping-'+randomUUID(),req=client(server.url,tenant,events);
try{
 const rule=await req('POST','/api/v1/detection-rules',{name:'Mapping rule',severity:'high'},201);
 const created=await req('POST','/api/v1/api-sources',{name:'Map source',provider:'Fixture',rule_id:rule.id},201),source=created.source,path='/api/v1/api-sources/'+source.id;
 const mapping={fields:{external_id:'alert.id',title:'alert.title',severity:'alert.level',summary:'alert.summary',category:'alert.category',alert_type:'alert.type',primary_entity:'alert.entity',insight_refs:'alert.refs',evidence:'alert.evidence'},severity_map:{WARN:'high','2':'medium'}};
 const sample={alert:{id:42,title:' Test alert ',level:' WARN ',summary:' Summary ',category:' Login ',type:' Native ',entity:123,refs:[' one ','one','',' two '],evidence:[{type:'ip',value:' 192.0.2.1 ',label:' Keep label '},{type:'entity',value:99,label:1}]}};
 const preview=body=>req('POST',path+'/mapping/preview',body);
 const result=await preview({mapping,sample});assert.deepEqual(result,{valid:true,errors:[],normalized_alert:{source:source.source,rule_id:rule.id,external_id:'42',title:'Test alert',severity:'high',summary:'Summary',category:'Login',alert_type:'Native',primary_entity:'123',insight_refs:['one','two'],evidence:[{type:'ip',value:'192.0.2.1',label:' Keep label '},{type:'entity',value:'99'}]}});
 assert.deepEqual(await req('GET',path),source,'preview does not mutate the source');
 const saved=await req('PATCH',path+'/mapping',{mapping,unknown:'removed'});assert.deepEqual(saved.mapping,{...mapping,severity_map:{warn:'high','2':'medium'}});assert.equal(saved.status,'active');
 const invalidMapping={fields:{unsupported:'bad',external_id:'alert[0]',title:'',severity:'alert.level'}};
 const issues=['Unsupported normalized field: unsupported.','Field external_id must use a safe dot path, such as alert.id.','Field title must use a safe dot path, such as alert.id.','Map required field title.'];
 assert.deepEqual(await preview({mapping:invalidMapping,sample}),{valid:false,errors:issues,normalized_alert:null});
 const badSave=await req('PATCH',path+'/mapping',{mapping:invalidMapping},400);assert.equal(badSave.error.code,'INVALID_EVENT_MAPPING');assert.equal(badSave.error.message,issues.join(' '));assert.deepEqual((await req('GET',path)).mapping,saved.mapping);
 const minimal={fields:{external_id:'id',title:'title',severity:'level'}};
 assert.deepEqual((await preview({mapping:minimal,sample:{}})).errors,['external_id: no value found at id.','title: no value found at title.','severity: no value found at level.']);
 assert.deepEqual((await preview({mapping:minimal,sample:{id:{},title:true,level:'urgent'}})).errors,['external_id: expected a string or number at id.','title: expected a string or number at title.','severity: urgent is not a supported severity. Add it to severity_map.']);
 const invalidEvidence=await preview({mapping,sample:{alert:{id:1,title:'a',level:'low',refs:[1],evidence:[null,[],{type:'other',value:'x'},{type:'ip',value:' '}]}}});assert.deepEqual(invalidEvidence.errors,['insight_refs: expected an array of strings at alert.refs.','evidence[0]: expected an object with type and value.','evidence[1]: expected an object with type and value.','evidence[2]: expected a supported type and non-empty value.','evidence[3]: expected a supported type and non-empty value.']);
 assert.deepEqual((await preview({mapping:{fields:{external_id:'a.id',title:'title',severity:'level'}},sample:{a:[{id:'x'}],title:'t',level:'low'}})).errors,['external_id: no value found at a.id.']);
 assert.equal((await preview({mapping:minimal,sample:{id:1e21,title:1e-7,level:'LOW'}})).normalized_alert.title,'1e-7');
 const aliases={fields:minimal.fields,severity_map:{WARN:'low',warn:'critical'}};assert.equal((await preview({mapping:aliases,sample:{id:0,title:'x',level:'warn'}})).normalized_alert.severity,'critical');
 assert.equal((await preview({mapping:{...minimal,severity_map:{' ':'low'}},sample:{}})).valid,false);
 // Missing source takes precedence over domain mapping errors.
 await req('PATCH','/api/v1/api-sources/missing/mapping',{mapping:invalidMapping},404);
 await req('POST','/api/v1/api-sources/missing/mapping/preview',{mapping:invalidMapping,sample},404);
 for(const [method,suffix]of [['PATCH','/mapping'],['POST','/mapping/preview']])await req(method,path+suffix,{mapping,sample},404,{'x-tenant-id':tenant+'-foreign'});
 for(const body of [{sample},{mapping:{},sample},{mapping:{fields:[]},sample},{mapping,sample:[]},{mapping:{...minimal,severity_map:{X:'invalid'}},sample}])await req('POST',path+'/mapping/preview',body,400);
 await req('POST',path+'/mapping/preview',{mapping,sample:{padding:'x'.repeat(131072)}},413);
 await req('POST',path+'/revoke');const revoked=await req('PATCH',path+'/mapping',{mapping:minimal});assert.equal(revoked.status,'revoked');assert.equal((await preview({mapping:minimal,sample:{id:1,title:'x',level:'low'}})).valid,true);
 await output(options.output||'output/backend-parity/source-mapping.json',{passed:true,backend:options.label||(server.owned?'node':'external'),request_count:events.length,persistence_fixture:{tenant,source_id:source.id},checks:['nested path normalization','severity aliases and order','numeric values and evidence','insight deduplication','read-only preview','invalid save preserves mapping','tenant isolation','schema and payload limits','revoked-source mapping management'],scope:'Mapping and preview only; authenticated intake pending'});
 console.log('PASS source mapping and preview');
}finally{await server.close();}
