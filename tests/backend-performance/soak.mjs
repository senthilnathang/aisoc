import {setTimeout as delay} from 'node:timers/promises';
import {argumentsFor,target,client,output} from '../backend-parity/harness.mjs';
const options=argumentsFor();
const seconds=Number(options.seconds||600);
if(!Number.isInteger(seconds)||seconds<60||seconds>3600)throw Error('Duration must be 60..3600 seconds');
const server=await target(options),tenant='auth-a',bearer='Bearer parity_fixture_'+'a'.repeat(40);
const raw=client(server.url,tenant);
const request=(method,path,body,status=200,headers={})=>raw(method,path,body,status,{authorization:bearer,...headers});
const samples=[],latencies=[],errors=[],jobs=[];
const started=performance.now();let operations=0,sequence=0;
const rule=await request('POST','/api/v1/detection-rules',{name:'Soak rule',severity:'high',enabled:true,routing:'Investigate'},201);
const source=await request('POST','/api/v1/api-sources',{name:'Soak source',provider:'Soak',rule_id:rule.id},201);
const skill=await request('POST','/api/v1/skills',{name:'Soak guidance',connectors:['Soak'],content_markdown:'Record observed evidence.'},201);
await request('POST','/api/v1/skills/'+skill.id+'/materials',{name:'guide.txt',content:'Check identity and timestamp.'},201);
await request('POST','/api/v1/skills/'+skill.id+'/publish',{});
const cases=[];
for(let i=0;i<20;i++)cases.push(await request('POST','/api/v1/investigations',{title:'Soak fixture '+i,source:'Soak',severity:'high'},201));
let nextAlert=0,nextSample=0;
async function timed(method,path,body,status=200,headers) {
 const start=performance.now();try{return await request(method,path,body,status,headers);}
 catch(error){errors.push({method,path:path.replace(/\/[A-Z]{2,5}-[^/]+/g,'/:id'),message:error.message});throw error;}
 finally {operations++;latencies.push(performance.now()-start);}
}
while(performance.now()-started<seconds*1000) {
 const elapsed=performance.now()-started;
 const selected=cases[sequence%cases.length];
 await Promise.all([
  timed('GET','/api/v1/investigations?limit=50'),
  timed('GET','/api/v1/investigations/'+selected.id),
  timed('GET','/api/v1/dashboard'),
  timed('GET','/api/v1/skills/outcomes'),
  timed('PATCH','/api/v1/investigations/'+selected.id,{primary_entity:'host-'+sequence}),
 ]);
 if(elapsed>=nextAlert) {
  const body={external_id:'soak-'+sequence,title:'Soak alert '+sequence,severity:'high',evidence:[{type:'ip',value:'192.0.2.10'}]};
  const path='/api/v1/intake/'+source.source.id+'/alerts',headers={authorization:'Bearer '+source.api_key};
  const accepted=await timed('POST',path,body,201,headers);
  const retried=await timed('POST',path,body,200,headers);
  if(accepted.alert.id!==retried.alert.id)throw Error('Duplicate intake created another alert');
  jobs.push({id:accepted.alert.investigation_id,accepted_at:performance.now()});nextAlert=elapsed+1000;
 }
 if(elapsed>=nextSample) {
  const response=await fetch(server.url+'/metrics');if(!response.ok)throw Error('Metrics unavailable');
  const metric=await response.json();
  samples.push({elapsed_ms:elapsed,heap_bytes:metric.go_heap_bytes,goroutines:metric.go_goroutines,queue:metric.investigation_jobs,pool:metric.database_pool});
  if(metric.go_heap_bytes>256*1024*1024||metric.investigation_jobs.active>50||metric.investigation_jobs.failed>0)throw Error('Soak memory or queue budget exceeded');
  console.log(JSON.stringify({elapsed_seconds:Math.round(elapsed/1000),operations,queued:metric.investigation_jobs.active,heap_bytes:metric.go_heap_bytes}));
  nextSample=elapsed+10000;
 }
 sequence++;await delay(100);
}
const drain=performance.now();
for(;;) {
 const metrics=await (await fetch(server.url+'/metrics')).json();
 if(metrics.investigation_jobs.active===0)break;
 if(performance.now()-drain>60000)throw Error('Queue failed to drain in 60 seconds');
 await delay(500);
}
for(const job of jobs) {
 const detail=await request('GET','/api/v1/investigations/'+job.id);
 if(detail.jobs.length!==1||detail.jobs[0].status!=='completed'||!detail.skill_applications.length)throw Error('Missing completed job or Skills snapshot');
}
latencies.sort((a,b)=>a-b);const p99=latencies[Math.ceil(latencies.length*.99)-1];
const report={passed:errors.length===0&&p99<1000,duration_seconds:seconds,operations,alerts:jobs.length,errors,p99_ms:p99,queue_drain_ms:performance.now()-drain,samples,limits:{p99_ms:1000,heap_bytes:256*1024*1024,max_active_jobs:50,drain_ms:60000},fixture:{tenant,rule_id:rule.id,source_id:source.source.id,case_id:cases[0].id}};
await output(options.output||'output/backend-performance/soak.json',report);
if(!report.passed)process.exitCode=1;
