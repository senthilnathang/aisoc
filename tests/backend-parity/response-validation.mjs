import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {argumentsFor,target,output,root} from './harness.mjs';
const options=argumentsFor(),server=await target(options);
const plan={kind:'runbook',title:'Validation',description:'',domain:'Identity',trigger:'Test',steps:[{title:'Review',instructions:'',approval_required:false}]};
const base='/api/v1/response-plans';
const fixtures=[];
const add=(name,body,path=base,method='POST')=>fixtures.push({name,path,method,body});
add('missing all',{});
for(const key of Object.keys(plan)){const input={...plan};delete input[key];add('missing '+key,input);}
for(const value of ['', ' ', 'x'.repeat(201), {}, [], null])add('title '+JSON.stringify(value).slice(0,20),{...plan,title:value});
add('bad kind',{...plan,kind:'invalid'});add('object kind',{...plan,kind:{}});
for(const value of [[],null,{},[null],[{}],[{title:'x',instructions:''}],[{title:'x',instructions:'',approval_required:'yes'}]])add('steps '+JSON.stringify(value),{...plan,steps:value});
add('long instructions',{...plan,steps:[{...plan.steps[0],instructions:'x'.repeat(4001)}]});
add('too many steps',{...plan,steps:Array(51).fill(plan.steps[0])});
add('patch required priority',{...plan,title:''},base+'/missing','PATCH');
add('state required',{},base+'/missing/state');
add('state enum',{expected_version:1,state:'invalid'},base+'/missing/state');
for(const value of [0,-1,1.5,'no',{},null])add('version '+JSON.stringify(value),{expected_version:value,state:'active'},base+'/missing/state');
for(const body of [null,[],1,'text'])add('root '+JSON.stringify(body),body);
add('attach required',{},'/api/v1/investigations/missing/runbooks');
add('step required',{},'/api/v1/investigations/missing/runbooks/missing','PATCH');
for(const step_index of [-1,50,1.5])add('step index '+step_index,{expected_version:1,step_index,completed:false,note:'',approval_confirmed:false},'/api/v1/investigations/missing/runbooks/missing','PATCH');
add('parameter whitespace',undefined,base+'/%20','GET');
add('parameter length',undefined,base+'/'+('x'.repeat(101)),'GET');
fixtures.push({name:'empty JSON',path:base,method:'POST',raw:''},{name:'unsupported media',path:base,method:'POST',raw:'{}',contentType:'application/xml'},{name:'malformed JSON',path:base,method:'POST',raw:'{'},{name:'trailing JSON',path:base,method:'POST',raw:'{} {}'});
fixtures.push({name:'whitespace JSON',path:base,method:'POST',raw:'  '},{name:'plain text',path:base,method:'POST',raw:'{}',contentType:'text/plain'},{name:'prototype key',path:base,method:'POST',raw:'{"__proto__":{}}'},{name:'constructor prototype',path:base,method:'POST',raw:'{"constructor":{"prototype":{}}}'});
add('hex version',{expected_version:'0x10',state:'active'},base+'/missing/state');
add('singleton empty title',{...plan,title:['']});
try{
 const results=[];
 for(const f of fixtures){
  const response=await fetch(server.url+f.path,{method:f.method,headers:{...(f.method==='GET'?{}:{'content-type':f.contentType||'application/json'}),'x-tenant-id':'validation-fixture'},...(f.method==='GET'?{}:{body:f.raw??JSON.stringify(f.body)}),signal:AbortSignal.timeout(10000)});
  const body=await response.json();assert.ok(response.status>=400,f.name+' accepted');
  results.push({name:f.name,status:response.status,body});
 }
 const baseline=root+'/contracts/response-validation.json';
 if(options.record){assert.equal(server.owned,true,'Record only from disposable Node');await writeFile(baseline,JSON.stringify(results,null,2)+'\n');}
 else{
  const expected=JSON.parse(await readFile(baseline,'utf8'));
  for(let i=0;i<results.length;i++){
   assert.deepEqual(results[i],expected[i],results[i].name);
  }
 }
 await output(options.output||'output/backend-parity/response-validation.json',{passed:true,backend:options.label||(server.owned?'node':'external'),fixture_count:results.length,exact_message_exclusions:[]});
 console.log('PASS response schema and parser contracts');
}finally{await server.close();}
