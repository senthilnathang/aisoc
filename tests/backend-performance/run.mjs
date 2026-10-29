import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { cpus, totalmem, platform, release } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { argumentsFor, target, client, output } from "../backend-parity/harness.mjs";

const options=argumentsFor();
const integer=(name,fallback,min,max)=>{const n=Number(options[name]??fallback);if(!Number.isInteger(n)||n<min||n>max)throw Error("Invalid --"+name);return n;};
const concurrency=integer("concurrency",8,1,64), requests=integer("requests",1000,100,100000), repeats=integer("repeats",3,1,10);
const sizes=String(options.sizes||"small,large").split(",");
if(sizes.some(size=>!["small","large"].includes(size)))throw Error("--sizes must be small, large, or small,large");
const counts={small:100,large:1000};
const spec={version:3,auth:options.auth||'local',tenants:2,rows_per_tenant:counts,requests,concurrency,warmup_requests:100,mix:{list:0.5,detail:0.3,update:0.1,create:0.1},worker_interval_ms:100};
const fingerprint=createHash("sha256").update(JSON.stringify(spec)).digest("hex");
const hz=Number(execFileSync("getconf",["CLK_TCK"],{encoding:"utf8"}));
async function readOptional(path) {try{return (await readFile(path,"utf8")).trim();}catch{return null;}}
async function resource(pids) {
  const roots=new Set(pids);
  if(options["process-roots"]) {
    const found=new Set();
    async function visit(pid) {
      if(found.has(pid))return;
      found.add(pid);
      const children=await readOptional('/proc/'+pid+'/task/'+pid+'/children');
      for(const child of (children||'').split(/\s+/).filter(Boolean))await visit(Number(child));
    }
    for(const pid of pids)await visit(pid);
    pids=[...found];
  }
  let cpuTicks=0,rss=0,threads=0,pss=0;
  for(const pid of pids) {
    let raw,status;
    try {[raw,status]=await Promise.all([readFile("/proc/"+pid+"/stat","utf8"),readFile("/proc/"+pid+"/status","utf8")]);}
    catch(error) {if(error.code==='ENOENT'&&!roots.has(pid))continue;throw error;}
    const fields=raw.slice(raw.lastIndexOf(")")+2).split(" ");
    cpuTicks+=Number(fields[11])+Number(fields[12]);
    // PostgreSQL reaps short-lived autovacuum/backend children. Include waited
    // child CPU so their work is retained after they disappear from /proc.
    if(options['process-roots'])cpuTicks+=Number(fields[13])+Number(fields[14]);
    rss+=Number(status.match(/^VmRSS:\s+(\d+)/m)?.[1]||0)*1024;
    threads+=Number(status.match(/^Threads:\s+(\d+)/m)?.[1]||0);
    const memory=await readOptional('/proc/'+pid+'/smaps_rollup');
    if(memory===null&&roots.has(pid))throw Error('Cannot sample proportional memory for root process '+pid);
    pss+=Number(memory?.match(/^Pss:\s+(\d+)/m)?.[1]||0)*1024;
  }
  return {cpu_ms:cpuTicks/hz*1000,rss_bytes:rss,pss_bytes:pss,threads};
}
const percentile=(samples,p)=>samples[Math.min(samples.length-1,Math.ceil(samples.length*p)-1)]??null;
const reports=[];
for(const size of sizes)for(let repeat=0;repeat<repeats;repeat++) {
  const server=await target(options);
  const pids=options.pids?String(options.pids).split(",").map(Number):server.pid?[server.pid]:[];

  const prefix="benchmark-"+randomUUID();
  const clients=[0,1].map(i=>{
    const key=i===0?'a':'b';
    const request=client(server.url,options.auth==='token'?'auth-'+key:prefix+'-'+i);
    return (method,path,body,expected,headers={})=>request(method,path,body,expected,{...headers,...(options.auth==='token'?{authorization:'Bearer parity_fixture_'+key.repeat(40)}:{})});
  });
  const ids=[[],[]];
  try {
    if(pids.some(pid=>!Number.isInteger(pid)||pid<1))throw Error("Invalid --pids");
    for(let tenant=0;tenant<2;tenant++)for(let i=0;i<counts[size];i++) {
      const row=await clients[tenant]("POST","/api/v1/investigations",{title:"Fixture "+i,source:"Benchmark",severity:i%2?"high":"medium",primary_entity:"host-"+i},201);
      ids[tenant].push(row.id);
    }
    for(let i=0;i<100;i++)await clients[i%2]("GET","/api/v1/investigations?limit=50");
    let peakRss=0,peakPss=0,peakThreads=0,stopping=false,samplingError=null;
    const corePids=options['core-pids']?String(options['core-pids']).split(',').map(Number):[];
    const startResources=pids.length?await resource(pids):null;
    const startCore=corePids.length?await resource(corePids):null;
    let peakCoreRss=0;
    const sampler=(async()=>{
      while(!stopping && pids.length) {
        try {const sample=await resource(pids);peakRss=Math.max(peakRss,sample.rss_bytes);peakPss=Math.max(peakPss,sample.pss_bytes);peakThreads=Math.max(peakThreads,sample.threads);if(corePids.length)peakCoreRss=Math.max(peakCoreRss,(await resource(corePids)).rss_bytes);}
        catch(error){samplingError=error.message;break;}
        await delay(100);
      }
    })();
    let next=0;const latency=[],errors=[],byOperation={};
    const started=performance.now();
    await Promise.all(Array.from({length:concurrency},async()=>{
      while(next<requests) {
        const index=next++,tenant=Math.floor(index/10)%2,slot=index%10,req=clients[tenant];
        const id=ids[tenant][Math.floor(index/10)%ids[tenant].length];
        const op=slot<5?"list":slot<8?"detail":slot===8?"update":"create";
        const start=performance.now();
        try {
          if(op==="list")await req("GET","/api/v1/investigations?limit=50");
          else if(op==="detail")await req("GET","/api/v1/investigations/"+id);
          else if(op==="update")await req("PATCH","/api/v1/investigations/"+id,{primary_entity:"updated-"+index});
          else await req("POST","/api/v1/investigations",{title:"New "+index,source:"Benchmark",severity:"high"},201);
        }catch(error){errors.push({index,operation:op,message:error.message});}
        const elapsed=performance.now()-start;latency.push(elapsed);(byOperation[op]??=[]).push(elapsed);
      }
    }));
    const elapsed=performance.now()-started;
    const endResources=pids.length?await resource(pids):null;
    const endCore=corePids.length?await resource(corePids):null;
    stopping=true;await sampler;
    latency.sort((a,b)=>a-b);
    const stats=samples=>{const sorted=[...samples].sort((a,b)=>a-b);return {count:sorted.length,p50_ms:percentile(sorted,.5),p95_ms:percentile(sorted,.95),p99_ms:percentile(sorted,.99)};};
    const jobTimes=[];
    for(let tenant=0;tenant<2;tenant++) {
      const req=clients[tenant];
      const rule=await req("POST","/api/v1/detection-rules",{name:"Benchmark rule",severity:"high",enabled:true,routing:"Investigate"},201);
      const start=performance.now();
      const accepted=await req("POST","/api/v1/alerts",{source:"Benchmark",external_id:"job-"+tenant,rule_id:rule.id,title:"Benchmark job",severity:"high"},201);
      let complete=false;
      for(let attempt=0;attempt<400;attempt++) {
        const record=await req("GET","/api/v1/investigations/"+accepted.alert.investigation_id);
        if(record.jobs.some(job=>job.status==="failed"))throw Error("Benchmark background job failed");
        if(record.jobs.length && record.jobs.every(job=>job.status==="completed")) {complete=true;break;}
        await delay(50);
      }
      if(!complete)throw Error("Background worker did not complete; external targets require workers enabled");
      jobTimes.push(performance.now()-start);
    }
    const report={size,repeat:repeat+1,initial_case_count:counts[size]*2,request_count:requests,concurrency,duration_ms:elapsed,throughput_rps:requests/(elapsed/1000),successful_rps:(requests-errors.length)/(elapsed/1000),latency:stats(latency),operations:Object.fromEntries(Object.entries(byOperation).map(([key,value])=>[key,stats(value)])),error_count:errors.length,errors,
      resources:startResources&&endResources?{pids,cpu_ms:endResources.cpu_ms-startResources.cpu_ms,cpu_core_equivalents:(endResources.cpu_ms-startResources.cpu_ms)/elapsed,rss_start_bytes:startResources.rss_bytes,rss_end_bytes:endResources.rss_bytes,sampled_peak_rss_bytes:peakRss,sampled_peak_pss_bytes:peakPss,sampled_peak_threads:peakThreads,sampling_error:samplingError}:null,
      core_resources:startCore&&endCore?{cpu_ms:endCore.cpu_ms-startCore.cpu_ms,sampled_peak_rss_bytes:peakCoreRss}:null,
      jobs:{samples:jobTimes,unit:"milliseconds",measurement:"API acceptance through observed completion; 50ms polling; separate from HTTP workload",worker_interval_ms:server.worker_interval_ms??"external; must be configured to 100 for comparison"},
    };
    reports.push(report);
    console.log(size+" repeat "+(repeat+1)+": "+report.successful_rps.toFixed(1)+" req/s; p95 "+report.latency.p95_ms.toFixed(1)+"ms; errors "+errors.length);
  } finally {await server.close();}
}
await output(options.output||"output/backend-performance/node-baseline.json",{
  format_version:1,label:options.label||(options.url?"external":"node-isolated"),created_at:new Date().toISOString(),fixture_fingerprint:fingerprint,workload:spec,
  environment:{platform:platform(),release:release(),node:process.version,cpu_model:cpus()[0]?.model,logical_cpus:cpus().length,host_memory_bytes:totalmem(),cgroup_cpu_max:await readOptional("/sys/fs/cgroup/cpu.max"),cgroup_memory_max:await readOptional("/sys/fs/cgroup/memory.max")},
  limitations:["Closed-loop fixed-operation test, not an open-loop saturation test.","Resource samples include only supplied server/worker PIDs; external PostgreSQL and optional workers must be included in a later whole-stack comparison.","Database lock/wait time and sustained backlog lag are not instrumented yet.","100ms worker interval is a comparison fixture, not the production default.","Shared host measurements are observational; use controlled resources before enforcing release thresholds.","Sampled RSS may miss peaks between 100ms intervals. CPU measurements exclude fixture creation and job probes."],
  reports,
});
if(reports.some(report=>report.error_count || report.resources?.sampling_error))process.exitCode=1;
