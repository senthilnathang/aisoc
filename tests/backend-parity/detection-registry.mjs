import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {argumentsFor,target,client,output} from './harness.mjs';
const options=argumentsFor(),server=await target(options),events=[];
const tenant='registry-'+randomUUID(),req=client(server.url,tenant,events),base='/api/v1/detection-registry';
try{
 const empty=await req('GET',base);assert.deepEqual(empty,{items:[],total:0,limit:25,offset:0,sources:[]});
 const records=[];
 for(const [name,severity,enabled,description] of [['alpha','high',true,'literal %_ match'],['Beta','low',false,'second'],['Gamma','critical',true,'third'],['ALPHA','medium',false,'fourth'],['Äther','low',true,'non-ASCII']]){
  records.push(await req('POST','/api/v1/detection-rules',{name,severity,enabled,description},201));
 }
 const get=query=>req('GET',base+'?'+query);
 const fold=v=>v.replace(/[A-Z]/g,c=>c.toLowerCase());
 const compare=(a,b)=>a<b?-1:a>b?1:0;
 const ranks={low:1,medium:2,high:3,critical:4};
 for(const sort of ['name','severity','updated_at','detections'])for(const direction of ['asc','desc']){
  const value=r=>sort==='name'?fold(r.name):sort==='severity'?ranks[r.severity]:sort==='detections'?0:r.updated_at;
  const expected=[...records].sort((a,b)=>(direction==='asc'?1:-1)*compare(value(a),value(b))||compare(a.id,b.id));
  const all=await get('sort='+sort+'&direction='+direction);assert.deepEqual(all.items.map(r=>r.id),expected.map(r=>r.id));
  const page=await get('sort='+sort+'&direction='+direction+'&limit=2&offset=2');assert.equal(page.total,5);assert.deepEqual(page.items.map(r=>r.id),expected.slice(2,4).map(r=>r.id));
 }
 const all=await get('sort=name');
 for(const item of all.items){assert.equal(item.version,1);assert.equal(item.detections,0);assert.equal(item.investigations,0);assert.equal(item.suppressed,0);assert.equal(item.false_positive_rate,null);assert.equal(item.last_activity_at,null);assert.equal(item.period,'all_time');assert.deepEqual(item.bindings,[]);assert.deepEqual(item.sources,[]);assert.deepEqual(item.outcomes,[]);assert.equal(item.history,undefined);assert.equal(item.versions,undefined);}
 assert.equal((await get('search=ALPHA')).total,2);
 assert.equal((await get('search='+encodeURIComponent(records[1].id.toLowerCase()))).total,1);
 assert.equal((await get('search=%25_')).total,1);
 assert.equal((await get('search=second')).items[0].id,records[1].id);
 assert.equal((await get('search='+encodeURIComponent('äther'))).total,0);
 assert.equal((await get('severity=high&enabled=true')).total,1);
 assert.equal((await get('enabled=false')).total,2);
 assert.equal((await get('source=unbound-provider')).total,0);
 assert.equal((await get('source=')).total,5);
 const beyond=await get('offset=999');assert.equal(beyond.total,5);assert.deepEqual(beyond.items,[]);
 assert.deepEqual(await req('GET',base,undefined,200,{'x-tenant-id':tenant+'-foreign'}),empty);
 for(const query of ['sort=invalid','direction=invalid','enabled=yes','severity=unknown','limit=0','limit=101','limit=1.5','offset=-1','search='+('x'.repeat(201)),'source='+('x'.repeat(201)),'sort=name&sort=severity']){
  const bad=await req('GET',base+'?'+query,undefined,400);assert.equal(bad.error.code,'VALIDATION_ERROR');assert.ok(bad.error.details.length>0);
 }
 await req('PATCH','/api/v1/detection-rules/'+records[0].id,{name:'Edited',expected_version:1});
 const edited=await get('search=Edited');assert.equal(edited.items[0].version,2);
 await req('POST','/api/v1/detection-rules/'+records[0].id+'/toggle');assert.equal((await get('search=Edited&enabled=false')).total,1);
 await req('DELETE','/api/v1/detection-rules/'+records[1].id,undefined,204);assert.equal((await get('')).total,4);
 await output(options.output||'output/backend-parity/detection-registry.json',{passed:true,backend:options.label||(server.owned?'node':'external'),request_count:events.length,persistence_fixture:{tenant},checks:['literal ASCII search and ID/description matching','all sort directions and stable pagination','filters and totals beyond last page','new-rule metric shapes','tenant isolation','query validation','edits/toggles/deletion reflected'],scope:'Authored rules without source or alert ingestion'});
 console.log('PASS detection registry');
}finally{await server.close();}
