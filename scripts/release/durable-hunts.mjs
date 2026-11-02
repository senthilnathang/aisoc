import assert from 'node:assert/strict';

export async function durableHunts({main,login,get,step,fixture,origin,screenshots}) {
 const {retry_hunt:h,retry,cancel_hunt:ch}=fixture.durable_hunt;
 const waitFor=async(fn)=>{for(let i=0;i<150;i++){if(await fn())return;await new Promise(r=>setTimeout(r,200));}throw Error('Durable Hunt did not reach expected state');};
 await step('durable_hunt',async()=>{
  await main.goto(origin+'/hunt/threat-hunting/'+h.id);
  const panel=main.getByRole('region',{name:'Hunt execution jobs'});
  await panel.getByRole('button',{name:'Retry run '+retry.id,exact:true}).click();
  await panel.getByRole('button',{name:'View results '+retry.id,exact:true}).waitFor();
  const w=await get(main,'/hunts/'+h.id+'/workspace');
  const run=w.runs.find(r=>r.id===retry.id),job=w.executions.find(j=>j.id===retry.id);
  assert.equal(job.state,'completed');assert.equal(job.attempts,4);assert.equal(job.max_attempts,6);assert(run.findings.length>0);
  const replay=await main.request.post(origin+'/api/v1/hunts/'+h.id+'/executions',{data:{id:retry.id,expected_updated_at:h.updated_at},headers:await csrf(main)});
  assert.equal(replay.status(),202);assert.equal((await replay.json()).job_id,retry.job_id);
  await main.screenshot({path:screenshots+'/hunt-retry-completed.png',fullPage:true});
  await main.setViewportSize({width:390,height:1000});assert(!(await main.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)));
  await main.screenshot({path:screenshots+'/hunt-completed-mobile.png',fullPage:true});
  await main.setViewportSize({width:1440,height:1000});
  // Simulate a successfully accepted enqueue whose response never reaches React.
  await main.evaluate(() => {
    const original = window.fetch;
    window.fetch = async (...args) => {
      const url = String(args[0]);
      if (url.endsWith('/executions') && args[1]?.method === 'POST') {
        window.fetch = original;
        await original(...args);
        throw new TypeError('Synthetic lost enqueue response');
      }
      return original(...args);
    };
  });
  await main.getByRole('button',{name:'Run local search',exact:true}).click();
  await main.getByRole('alert').filter({hasText:'Synthetic lost enqueue response'}).waitFor();
  let recovered;
  await waitFor(async()=>{const state=await get(main,'/hunts/'+h.id+'/workspace');recovered=state.executions.find(j=>j.id!==retry.id&&j.state==='completed');return !!recovered;});
  await main.getByRole('button',{name:'Run local search',exact:true}).click();
  await panel.getByRole('button',{name:'View results '+recovered.id,exact:true}).waitFor();
  const recoveredState=await get(main,'/hunts/'+h.id+'/workspace');assert.equal(recoveredState.executions.length,2);assert.equal(recoveredState.runs.length,2);

  const other=await login('b');await other.goto(origin+'/hunt/threat-hunting/'+ch.id);
  await other.getByRole('button',{name:'Run local search',exact:true}).click();
  const cancelPanel=other.getByRole('region',{name:'Hunt execution jobs'});
  await cancelPanel.getByRole('button',{name:/^Cancel run /}).click();
  await cancelPanel.getByText('cancelled',{exact:true}).waitFor();
  let cw;await waitFor(async()=>{cw=await get(other,'/hunts/'+ch.id+'/workspace');return cw.executions[0]?.state==='cancelled';});assert.equal(cw.runs.length,0);
  await other.reload();await other.getByRole('region',{name:'Hunt execution jobs'}).getByText('cancelled',{exact:true}).waitFor();
  await other.setViewportSize({width:390,height:1000});assert(!(await other.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)));
  await other.screenshot({path:screenshots+'/hunt-cancelled-mobile.png',fullPage:true});
  return {queued:true,progress:true,explicit_retry:true,cancellation_persisted:true,enqueue_replay:true,lost_response_replay:true};
 });
}
async function csrf(page){
 const response=await page.request.get(new URL('/api/v1/auth/session',page.url()).href);
 const session=await response.json();
 return {'X-CSRF-Token':session.csrf_token,'Origin':new URL(page.url()).origin};
}
