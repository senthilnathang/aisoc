import assert from 'node:assert/strict';
import {join} from 'node:path';

// Mutations use rendered controls. Only the exact successful execute request is
// replayed via the executor's authenticated session to test transport retries.
export async function criticalWorkflows({main,reviewer,login,fixture,origin,step,get,waitFor,screenshots}) {
 const button=(p,name)=>p.getByRole('button',{name,exact:true});
 const check=async(p,name)=>{const c=p.getByRole('checkbox',{name,exact:true});await c.focus();await c.press('Space');};
 const goto=async(p,path)=>{await p.goto(origin+path);await p.waitForLoadState('networkidle');};
 const shot=async(p,name)=>{
  for(const width of [1440,390]){
   await p.setViewportSize({width,height:1000});
   assert(!(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)),'Workflow overflow: '+name+' at '+width);
   await p.screenshot({path:join(screenshots,name+'-'+width+'.png'),fullPage:true});
  }
  await p.setViewportSize({width:1440,height:1000});
 };
 const lifecycle=async(p,action)=>{
  await button(p,action).click();await p.getByLabel('Review rationale',{exact:true}).fill('Independent review of synthetic evidence and the saved revision.');
  const submit=button(p,'Confirm '+action.toLowerCase());assert(await submit.isDisabled(),'Lifecycle confirmation missing');
  await check(p,'I reviewed this guidance and explicitly approve this operation.');await submit.click();await submit.waitFor({state:'hidden'});await p.waitForLoadState('networkidle');
 };
 const changeSource=async(id)=>{
  await goto(main,'/investigations/'+id);await main.getByLabel('Analyst determination',{exact:true}).selectOption('benign');
  await waitFor(async()=> (await get(main,'/investigations/'+id)).determination==='benign','Source determination not saved');
 };
 await step('respond_replay',async()=>{
  const id=fixture.details.case_id,path='/investigations/'+id+'/sandbox-responses';
  const panel=p=>p.getByRole('region',{name:'Case-linked sandbox responses'});
  await goto(main,'/investigations/'+id+'?tab=review');
  await panel(main).getByText('Propose a mock session revocation',{exact:true}).click();
  await panel(main).getByLabel('Sandbox response scope').selectOption('release-response');
  await panel(main).getByLabel('Mock session ID',{exact:true}).fill('release-'+fixture.run_id);
  await panel(main).getByLabel('Mock principal reference',{exact:true}).fill('release-user');
  await panel(main).getByLabel('Response review reference',{exact:true}).fill('BROWSER-RELEASE');
  await panel(main).getByLabel('Response rationale',{exact:true}).fill('Synthetic evidence reviewed; sandbox session revocation only.');
  const evidence=panel(main).getByRole('checkbox').first();await evidence.focus();await evidence.press('Space');
  await button(panel(main),'Save response proposal').click();
  let proposal;await waitFor(async()=>{proposal=(await get(main,path)).items.find(x=>x.session_id==='release-'+fixture.run_id);return !!proposal;},'Response proposal missing');
  assert(await button(panel(main),'Approve sandbox revocation').isDisabled(),'Self approval enabled');
  await goto(reviewer,'/investigations/'+id+'?tab=review');
  await panel(reviewer).getByLabel('Response approval comment',{exact:true}).fill('Independent evidence and exact sandbox session review.');
  assert(await button(panel(reviewer),'Approve sandbox revocation').isDisabled(),'Approval confirmation missing');
  await check(panel(reviewer),'I reviewed this exact mock session, evidence and scope');await button(panel(reviewer),'Approve sandbox revocation').click();
  await waitFor(async()=> (await get(reviewer,path)).items.find(x=>x.id===proposal.id)?.state==='approved','Response approval missing');
  assert(await button(panel(reviewer),'Preview revocation').isDisabled(),'Approver can execute own approval');
  const executor=await login('d');await goto(executor,'/investigations/'+id+'?tab=review');
  await button(panel(executor),'Preview revocation').click();await panel(executor).getByText('Preview blocked.',{exact:false}).waitFor();
  assert(await button(panel(executor),'Execute mock revocation').isDisabled(),'Kill switch bypass');
  await panel(reviewer).getByText('Propose a mock session revocation',{exact:true}).click();
  await panel(reviewer).getByLabel('Sandbox response scope').selectOption('release-response-c');
  await panel(reviewer).getByLabel('Response review reference',{exact:true}).fill('BROWSER-RELEASE');
  await panel(reviewer).getByText('Sandbox execution gate',{exact:true}).click();
  await check(panel(reviewer),'I confirm this sandbox scope policy change');await button(panel(reviewer),'Enable sandbox execution').click();
  await waitFor(async()=> !(await get(reviewer,path)).items.find(x=>x.id===proposal.id).stopped,'Sandbox gate not enabled');
  await button(panel(executor),'Refresh responses').click();await button(panel(executor),'Preview revocation').click();
  await panel(executor).getByText('Preview permits mock execution.',{exact:false}).waitFor();
  assert(await button(panel(executor),'Execute mock revocation').isDisabled(),'Execution confirmation missing');
  await check(panel(executor),'I reviewed this exact mock session, evidence and scope');
  const sent=executor.waitForRequest(r=>new URL(r.url()).pathname==='/api/v1'+path&&r.method()==='POST'&&r.postDataJSON().operation==='execute');
  await button(panel(executor),'Execute mock revocation').click();const request=await sent;
  await waitFor(async()=> (await get(executor,path)).items.find(x=>x.id===proposal.id)?.state==='executed','Execution not recorded');
  const before=(await get(executor,path)).items.find(x=>x.id===proposal.id);
  assert.equal(before.requested_by,'fixture-a');assert.equal(before.approved_by,'fixture-c');assert.equal(before.receipt.executed_by,'fixture-d');assert.equal(before.receipt.external_calls,0);
  // Session-bound repeat of the actual browser request, including its CSRF header.
  const headers=await request.allHeaders();const replayHeaders=Object.fromEntries(Object.entries(headers).filter(([k])=>k==='content-type'||k==='origin'||k.includes('csrf')));
  const replay=await executor.request.post(request.url(),{headers:replayHeaders,data:request.postDataJSON()});assert.equal(replay.status(),200);
  const receipt=await replay.json();assert.equal(receipt.replayed,true);assert.equal(receipt.receipt.note_id,before.receipt.note_id);
  await executor.reload();await executor.waitForLoadState('networkidle');assert.equal((await get(executor,path)).items.filter(x=>x.id===proposal.id).length,1);
  await shot(executor,'respond-executed-replay');
  // Restore the dedicated scope to stopped through the approver UI.
  await check(panel(reviewer),'I confirm this sandbox scope policy change');await button(panel(reviewer),'Stop sandbox execution').click();
  await waitFor(async()=> (await get(reviewer,path)).items.find(x=>x.id===proposal.id).stopped,'Sandbox gate not restored');
  return {action_id:proposal.id,case_id:id,independent_approval:true,kill_switch:true,explicit_execution:true,same_receipt_replay:true,external_calls_zero:true,replay_transport:'executor session HTTP repeat of UI request'};
 });
 await step('skills_lifecycle',async()=>{
  const f=fixture.workflows.skill,id=f.receipt.skill_id,path='/skills/'+id;
  await goto(main,path);assert(await button(main,'Approve saved draft').isDisabled(),'Skill self approval enabled');
  await goto(reviewer,path);await button(reviewer,'Approve saved draft').click();
  await waitFor(async()=> (await get(main,path)).state==='published','Skill not published');
  const original=(await get(main,path)).content_markdown,edited='Staged browser release instructions: verify current MFA and endpoint evidence.';
  await goto(main,path);await main.getByLabel('Skill instructions',{exact:true}).fill(edited);await button(main,'Save staged edits').click();
  await waitFor(async()=> !!(await get(main,path)).staged_edit,'Staged edits missing');assert.equal((await get(main,path)).content_markdown,original);
  assert(await button(main,'Publish saved staged edits').isDisabled(),'Contributor can publish own edits');
  await changeSource(f.source.id);await goto(reviewer,path);await reviewer.getByText('Source review required',{exact:true}).waitFor();
  assert(await button(reviewer,'Publish saved staged edits').isDisabled(),'Changed source publication allowed');await shot(reviewer,'skill-source-review');
  await lifecycle(reviewer,'Reapprove guidance');await reviewer.getByText('Source current',{exact:true}).waitFor();await lifecycle(reviewer,'Publish saved staged edits');
  const released=await get(reviewer,path);assert.equal(released.content_markdown,edited);assert(!released.staged_edit);
  await goto(main,path);await lifecycle(main,'Archive guidance');assert.equal((await get(main,path+'/lifecycle')).archived,true);
  await main.reload();await main.getByText('Archived',{exact:true}).waitFor();assert(await button(main,'Save staged edits').isDisabled());await shot(main,'skill-archived');
  return {skill_id:id,published_unchanged_while_staged:true,source_change_blocked:true,independent_reapproval:true,staged_publication:true,archived:true};
 });
 await step('memory_hunt',async()=>{
  const f=fixture.workflows.memory,mid=f.receipt.insight_id,h=fixture.workflows.hunt,hp='/hunts/'+h.id;
  await goto(reviewer,'/respond/inbox');await reviewer.getByLabel('Search proposals').fill(mid);
  await reviewer.getByRole('button',{name:/^Preview /}).click();await lifecycle(reviewer,'Approve Memory proposal');
  await goto(main,'/hunt/threat-hunting/'+h.id);await button(main,'Run local search').click();
  let run;await waitFor(async()=>{run=(await get(main,hp+'/workspace')).runs[0];return !!run;},'Hunt run missing');
  assert.equal(run.memory.length,1);assert.equal(run.memory[0].id,mid);assert(run.memory[0].learning_origin.approved_by);assert.equal(run.verdict,'review_required');
  await main.getByText(f.input.context,{exact:true}).first().waitFor();await shot(main,'memory-hunt-approved');
  await changeSource(f.source.id);await goto(main,'/hunt/threat-hunting/'+h.id);await button(main,'Run local search').click();
  await waitFor(async()=>{const r=(await get(main,hp+'/workspace')).runs[0];return r.id!==run.id&&r.memory.length===0;},'Stale Memory was not excluded');
  await main.getByText('No eligible Memory matched this run. Missing context does not establish safety.',{exact:true}).first().waitFor();
  await main.getByLabel('Search history',{exact:true}).selectOption(run.id);await main.getByText(f.input.context,{exact:true}).first().waitFor();
  assert.deepEqual((await get(main,hp+'/workspace')).runs.find(x=>x.id===run.id).memory,run.memory);
  await button(main,'Promote to investigation').first().click();await main.getByLabel('Promotion review comment').fill('Review synthetic evidence; historical Memory remains advisory.');
  assert(await button(main,'Confirm promotion').isDisabled(),'Promotion confirmation missing');
  await check(main,'I reviewed this saved finding and want to investigate it.');await button(main,'Confirm promotion').click();
  await button(main,'Open promoted investigation →').first().click();await main.getByText(f.input.context,{exact:true}).first().waitFor();
  const promotion=(await get(main,hp+'/workspace')).promotions[0];assert.deepEqual(promotion.memory,run.memory);
  assert.equal((await get(main,'/investigations/'+promotion.investigation_id)).determination,'unknown');
  await shot(main,'memory-hunt-investigation');await main.reload();await main.getByText(f.input.context,{exact:true}).first().waitFor();
  return {memory_id:mid,hunt_id:h.id,run_id:run.id,case_id:promotion.investigation_id,approved_provenance:true,stale_excluded:true,immutable_history:true,promotion:true,unknown_determination:true};
 });
 await step('detect_feedback',async()=>{
  const f=fixture.workflows.feedback,rp='/detection-rules/'+f.rule.id;
  for(const [i,label] of ['false_positive','true_positive'].entries()){
   const a=f.alerts[i],cp='/investigations/'+a.investigation_id,before=(await get(main,cp)).determination;
   await goto(main,cp+'?tab=review');await button(main,'Review source alert label').click();const dialog=main.getByRole('dialog');
   await dialog.getByLabel('Analyst label').selectOption(label);await dialog.getByLabel('Evidence rationale').fill('Explicit review of synthetic browser source evidence.');
   assert(await button(dialog,'Save label').isDisabled(),'Label confirmation missing');
   await check(dialog,'I reviewed this source alert and approve this label independently of the case determination.');await button(dialog,'Save label').click();await dialog.waitFor({state:'hidden'});
   assert.equal((await get(main,cp+'/detection-feedback')).items[0].label,label);assert.equal((await get(main,cp)).determination,before);
  }
  await main.getByRole('link',{name:'Review rule recommendations →',exact:true}).click();await button(main,'Generate suggestions').click();
  await main.locator('article.recommendation-card').first().waitFor();const card=main.locator('article.recommendation-card').first();
  assert(await button(card,'Apply locally').isDisabled(),'Apply enabled without replay');
  await button(card,'Validate Query').click();await card.getByText('Validation: local syntax passed',{exact:true}).waitFor();
  await button(card,'Test Query').click();await card.getByText('Replay passed',{exact:true}).waitFor();
  const recs=await get(main,rp+'/recommendations?days=30');const rec=recs.items[0];assert(rec.test_result.passed);assert.equal(rec.test_result.true_positives_removed,0);assert.equal(rec.test_result.unreviewed_removed,0);assert.equal(rec.test_result.false_positives_removed,1);
  const version=(await get(main,rp)).version;await button(card,'Apply locally').click();assert.equal((await get(main,rp)).version,version);
  await button(card,'Confirm local apply').click();await card.getByText('applied',{exact:true}).waitFor();
  const applied=await get(main,rp);assert.equal(applied.enabled,false);assert.equal(applied.version,version+1);
  assert(await button(main,'Sync Now').isDisabled(),'Provider sync enabled');await main.reload();await main.waitForLoadState('networkidle');
  assert(await button(main.locator('article.recommendation-card').first(),'Apply locally').isDisabled(),'Applied recommendation can apply again');await shot(main,'detect-feedback-applied');
  return {rule_id:f.rule.id,recommendation_id:rec.id,explicit_labels:true,determination_unchanged:true,replay_passed:true,guarded_apply:true,rule_remains_disabled:true};
 });
}
