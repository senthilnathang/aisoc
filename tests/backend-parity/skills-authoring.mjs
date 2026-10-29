import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {argumentsFor,target,client,output} from './harness.mjs';
const options=argumentsFor(),server=await target(options),events=[],tenant='skills-'+randomUUID(),req=client(server.url,tenant,events),root='/api/v1/skills';
try{
 assert.deepEqual(await req('GET',root),{items:[],total:0,limit:25,offset:0});
 const created=await req('POST',root,{name:'  Review endpoint  ',description:'SOC workflow',modules:['investigations'],tags:['PowerShell'],origin:'system',version:99},201),path=root+'/'+created.id;
 assert.equal(created.name,'Review endpoint');assert.equal(created.version,1);assert.equal(created.origin,'user');assert.equal(created.state,'draft');assert.equal(created.enabled,false);assert.equal(created.created_by,'local-development');assert.deepEqual(created.connectors,[]);
 assert.equal((await req('POST',path+'/toggle',undefined,409)).error.code,'SKILL_NOT_PUBLISHED');
 const edited=await req('PATCH',path,{name:'  Edited name  ',content_markdown:'Review carefully',insight_refs:['ctx']});assert.equal(edited.name,'  Edited name  ');assert.equal(edited.version,2);
 assert.equal((await req('PATCH',path,{})).version,3);assert.equal((await req('POST',path+'/publish')).version,4);assert.equal((await req('POST',path+'/toggle')).enabled,false);assert.equal((await req('POST',path+'/publish')).version,6);
 const other=await req('POST',root,{name:'Other',skill_type:'content',modules:['hunting']},201);
 for(const [query,total]of [['state=published',1],['module=investigations',1],['module=INVESTIGATIONS',0],['search=POWERSHELL',1],['search=%25',0],['search=workflow',1],['search=%20%20',2],['limit=1&offset=1',2]])assert.equal((await req('GET',root+'?'+query)).total,total);
 const materials=path+'/materials';const mat=await req('POST',materials,{name:'Guide',filename:'guide.MD',content:'# First',kind:'reference'},201),mp=materials+'/'+mat.id;
 assert.equal(mat.file_type,'markdown');assert.equal(mat.version,1);assert.equal(mat.archived_at,null);assert.equal((await req('GET',path)).version,7);
 const list=await req('GET',materials);assert.equal(list.items.length,1);assert.equal(list.items[0].content,undefined);assert.equal(list.items[0].archived_at,undefined);
 const next=await req('PATCH',mp,{content:'# Revised',filename:'ignored.csv',kind:'checklist'});assert.equal(next.version,2);assert.equal(next.file_type,'markdown');
 const versions=await req('GET',mp+'/versions');assert.deepEqual(versions.items.map(v=>v.version),[2,1]);assert.equal(versions.items[1].snapshot.content,'# First');assert.equal(versions.items[0].snapshot.content,'# Revised');
 const link=await req('POST',materials,{name:'Reference',source_url:' https://example.test/reference '},201);assert.equal(link.file_type,'url');assert.equal(link.source_url,'https://example.test/reference');assert.equal(link.content,'');
 // Editing retains file_type, even when changing a URL reference into content.
 const converted=await req('PATCH',materials+'/'+link.id,{source_url:'',content:'Saved notes'});assert.equal(converted.file_type,'url');assert.equal(converted.source_url,null);
 await req('DELETE',mp,undefined,204);assert.ok((await req('GET',mp)).archived_at);assert.equal((await req('GET',mp+'/versions')).items.length,2);assert.equal((await req('GET',materials)).items.length,1);await req('PATCH',mp,{content:'no'},404);await req('DELETE',mp,undefined,404);
 for(let i=0;i<9;i++)await req('POST',materials,{name:'item-'+i+'.txt',content:'content'},201);
 assert.equal((await req('POST',materials,{name:'overflow.txt',content:'content'},400)).error.code,'MATERIAL_LIMIT_REACHED');
 const invalidCases=[['missing',{},400,'INVALID_MATERIAL'],['type',{name:'image.png',content:'x'},400,'UNSUPPORTED_MATERIAL_TYPE'],['empty',{name:'empty.txt',content:' '},400,'EMPTY_MATERIAL'],['http',{name:'URL',source_url:'http://example.test'},400,'INVALID_MATERIAL_URL'],['mixed',{name:'URL',source_url:'https://example.test',content:'x'},400,'INVALID_MATERIAL'],['bytes',{name:'large.txt',content:'é'.repeat(66000)},413,'MATERIAL_TOO_LARGE']];
 for(const [,body,status,code]of invalidCases)assert.equal((await req('POST',root+'/'+other.id+'/materials',body,status)).error.code,code);
 for(const body of [{name:' '},{name:'x'.repeat(201)},{name:'x',modules:Array(21).fill('x')},{name:'x',content_markdown:'x'.repeat(30001)}])await req('POST',root,body,400);
 assert.equal((await req('POST',root,{},400)).error.code,'INVALID_SKILL');for(const q of ['limit=0','limit=101','offset=-1','state=other','search='+('x'.repeat(201))])await req('GET',root+'?'+q,undefined,400);
 const history=await req('GET',path+'/history');assert.ok(history.items.some(e=>e.action==='material_archived'));assert.ok(history.items.every(e=>e.details.actor==='local-development'));const count=history.items.length;
 const foreign={'x-tenant-id':tenant+'-foreign'};await req('GET',path,undefined,404,foreign);await req('PATCH',path,{},404,foreign);await req('POST',path+'/publish',undefined,404,foreign);await req('GET',mp,undefined,404,foreign);await req('POST',materials,{name:'x.txt',content:'x'},404,foreign);assert.deepEqual((await req('GET',path+'/history',undefined,200,foreign)).items,[]);
 await req('DELETE',path,undefined,204);await req('GET',mp,undefined,404);assert.equal((await req('GET',path+'/history')).items.length,count,'legacy deletion retains history without adding a delete audit');
 await output(options.output||'output/backend-parity/skills-authoring.json',{passed:true,backend:options.label||(server.owned?'node':'external'),request_count:events.length,persistence_fixture:{tenant,skill_id:other.id},checks:['CRUD/publish/toggle/history','search/filter/pagination','material versions and parent revisions','archive and cascade','material size/type/count limits','tenant isolation','validation'],scope:'Skill authoring and materials; matching, suggestions and outcomes are separate migration work.'});
 console.log('PASS Skills authoring and materials');
}finally{await server.close();}
