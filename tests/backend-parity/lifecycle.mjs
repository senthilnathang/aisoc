import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { client, root, output } from './harness.mjs';

// Process lifecycle adapter for the legacy Node fixture. Never uses active data.
// Go will need its own process adapter over the same HTTP assertions.
const directory = await mkdtemp(join(tmpdir(), 'aisoc-lifecycle-'));
let child, exited;
async function stop(signal='SIGTERM') {
  if (!child) return;
  child.kill(signal);
  const timer = setTimeout(() => child?.kill('SIGKILL'), 5000);
  try { await exited; } finally { clearTimeout(timer); child = undefined; }
}
async function start(overrides={}) {
  child = fork(join(root,'tests/backend-parity/server.mts'), [], {
    execArgv:['--import',join(root,'backend/node_modules/tsx/dist/loader.mjs')],
    env:{...process.env,NODE_ENV:'test',AISOC_TEST_DB:join(directory,'fixture.sqlite'),AISOC_TEST_AUTH:'local',AUTH_OPERATORS_FILE:'',AISOC_TEST_INTERVAL:'1000',...overrides},
    stdio:['ignore','ignore','inherit','ipc'],
  });
  exited = once(child,'exit');
  const info = await new Promise((resolve,reject) => {
    const timer = setTimeout(() => reject(Error('Fixture startup timed out')), 20000);
    child.once('message', value => { clearTimeout(timer); resolve(value); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(Error('Fixture exited: '+code)); });
  });
  return info.url;
}
const checks=[];
try {
  let url = await start({AISOC_TEST_WORKER:'false'});
  let req = client(url,'lifecycle');
  const rule = await req('POST','/api/v1/detection-rules',{name:'Recovery',severity:'high',enabled:true,routing:'Investigate'},201);
  const body = {source:'Fixture',external_id:'one-event',rule_id:rule.id,title:'Durable event',severity:'high',evidence:[{type:'domain',value:'fixture.example'}]};
  const responses = await Promise.all(Array.from({length:8}, async () => {
    const response = await fetch(url+'/api/v1/alerts',{method:'POST',headers:{'content-type':'application/json','x-tenant-id':'lifecycle'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
    return {status:response.status,body:await response.json()};
  }));
  assert.equal(responses.filter(row => row.status===201).length,1);
  assert.equal(responses.filter(row => row.status===200).length,7);
  const alert = responses[0].body.alert;
  assert.ok(responses.every(row => row.body.alert.id===alert.id));
  const path='/api/v1/investigations/'+alert.investigation_id;
  assert.equal((await req('GET',path)).jobs.length,1);
  await req('POST',path+'/reinvestigate',undefined,409);
  await req('DELETE',path,undefined,409);
  await req('POST','/api/v1/alerts',{...body,title:'Conflicting'},409);
  checks.push('eight concurrent identical intakes create one alert, case and job; busy and conflicting mutations rejected');
  const plan=await req('POST','/api/v1/response-plans',{kind:'runbook',title:'Concurrent',description:'Review procedure',domain:'Identity',trigger:'Incident',steps:[{title:'Review',instructions:'Review',approval_required:false}]},201);
  const writes=await Promise.all(['Winner A','Winner B'].map(title => fetch(url+'/api/v1/response-plans/'+plan.id,{method:'PATCH',headers:{'content-type':'application/json','x-tenant-id':'lifecycle'},body:JSON.stringify({kind:'runbook',title,description:'Review procedure',domain:'Identity',trigger:'Incident',steps:[{title:'Review',instructions:'Review',approval_required:false}],expected_version:1}),signal:AbortSignal.timeout(10000)})));
  assert.deepEqual(writes.map(row=>row.status).sort(),[200,409]);
  await Promise.all(writes.map(row=>row.arrayBuffer()));
  assert.equal((await req('GET','/api/v1/response-plans/'+plan.id)).version,2);
  assert.equal((await req('GET','/api/v1/response-plans/'+plan.id+'/history')).items.length,2);
  checks.push('concurrent plan writes commit one version and one audit change');
  await stop('SIGKILL');
  url=await start(); req=client(url,'lifecycle');
  let partial;
  for(let i=0;i<100;i++) {
    partial=await req('GET',path);
    if(partial.jobs[0].phase===1)break;
    await delay(30);
  }
  assert.equal(partial.jobs[0].phase,1);
  await stop('SIGKILL');
  url=await start({AISOC_TEST_INTERVAL:'100'}); req=client(url,'lifecycle');
  let complete;
  for(let i=0;i<200;i++) {
    complete=await req('GET',path);
    if(complete.jobs[0].status==='completed')break;
    await delay(50);
  }
  assert.equal(complete.jobs[0].status,'completed');
  assert.equal(complete.steps.length,3);
  assert.equal(complete.artifacts.length,partial.artifacts.length);
  assert.equal(complete.jobs.length,1);
  assert.equal((await req('POST','/api/v1/alerts',body)).duplicate,true);
  assert.equal((await req('GET','/api/v1/response-plans/'+plan.id)).version,2);
  checks.push('SIGKILL after queued and committed phase states resumes without duplicate steps, artifacts or versions');
  const issued=await req('POST','/api/v1/api-sources',{name:'Expiring fixture',provider:'fixture',rule_id:rule.id,expires_in_days:1},201);
  await stop();
  url=await start({AISOC_TEST_AUTH:'token',AISOC_TEST_SESSION_TTL:'1000',AISOC_TEST_EXPIRE_SOURCE:issued.source.id});
  await client(url,'lifecycle')('POST',issued.source.intake_path,{external_id:'expired',title:'Expired source',severity:'high'},401,{authorization:'Bearer '+issued.api_key});
  checks.push('expired source credential rejected over HTTP after offline disposable fixture expiry setup');
  const login=await fetch(url+'/api/v1/auth/login',{method:'POST',headers:{authorization:'Bearer parity_fixture_'+'a'.repeat(40)},signal:AbortSignal.timeout(10000)});
  assert.equal(login.status,200); await login.arrayBuffer();
  const cookie=login.headers.get('set-cookie').split(';')[0];
  await delay(1100);
  const expired=await fetch(url+'/api/v1/dashboard',{headers:{cookie},signal:AbortSignal.timeout(10000)});
  assert.equal(expired.status,401); await expired.arrayBuffer();
  checks.push('expired browser session rejected over HTTP');
  await output('output/backend-parity/node-lifecycle.json',{passed:true,adapter:'isolated Node process',checks});
  console.log('PASS lifecycle, concurrent writes, crash recovery and session expiry');
} finally { await stop(); await rm(directory,{recursive:true,force:true}); }
