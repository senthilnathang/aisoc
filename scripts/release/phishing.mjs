import assert from 'node:assert/strict';
import {join} from 'node:path';

// Real UI import, evidence review and mock-note approval. Response/feedback
// effects are exercised separately by the API gate and inspected here in the UI.
export async function phishingWorkflow({main,fixture,origin,step,get,waitFor,screenshots,fixtureDir}) {
 const button=name=>main.getByRole('button',{name,exact:true});
 await step('phishing',async()=>{
  await main.goto(origin+'/build/integrations');await button('＋ New local integration').click();
  await main.getByLabel('Profile name',{exact:true}).fill(fixture.name+' phishing');
  await main.getByLabel('Authorized mock source',{exact:true}).selectOption(fixture.scope);
  await button('Load phishing example (replaces JSON)').click();
  await waitFor(async()=> (await main.getByLabel('Events JSON',{exact:true}).inputValue()).includes('email.credential_submitted'),'Phishing example missing');
  await main.getByLabel('Import events JSON',{exact:true}).setInputFiles(join(fixtureDir,'phishing.json'));
  await button('Validate & preview').click();await main.getByRole('heading',{name:'Normalized evidence preview',exact:true}).waitFor();
  await main.getByText('credential phishing',{exact:true}).waitFor();
  await button('Save draft').click();await main.getByText('Draft saved · revision 1',{exact:true}).waitFor();
  assert(await button('Import saved JSON').isDisabled());
  await main.getByText('I confirm local import and freezing this evidence snapshot',{exact:true}).click();await button('Import saved JSON').click();
  await button('Replay local import').waitFor();
  const profile=(await get(main,'/build/integrations')).items.find(p=>p.name===fixture.name+' phishing');assert(profile);
  let current;await waitFor(async()=>{current=await get(main,'/build/integrations/'+profile.id);return current.cases?.[0]?.state==='awaiting_review';},'Phishing did not reach note review');
  const id=current.cases[0].investigation_id;
  await main.goto(origin+'/investigations/'+id+'?tab=review');
  await main.getByText('Possible credential phishing',{exact:true}).waitFor();
  await main.getByText('Possible authorized simulation',{exact:true}).waitFor();
  await main.getByText('Original email headers',{exact:true}).waitFor();
  const review=await get(main,'/investigations/'+id+'/l1');assert.equal(review.evidence.length,4);assert.equal(review.result.verdict,'INCONCLUSIVE');
  for(const width of [1440,390]){
   await main.setViewportSize({width,height:1000});assert(!(await main.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)),'Phishing review overflow');
   await main.screenshot({path:join(screenshots,'phishing-review-'+width+'.png'),fullPage:true});
  }
  await main.setViewportSize({width:1440,height:1000});
  await button('Review mock SOAR note').click();await main.getByLabel('Analyst review comment').fill('Reviewed synthetic email observations and missing evidence; mock note only.');
  assert(await button('Approve mock note').isDisabled());
  const confirm=main.getByRole('checkbox',{name:'I reviewed the evidence and approve this mock note only',exact:true});await confirm.focus();await confirm.press('Space');await button('Approve mock note').click();
  await waitFor(async()=> (await get(main,'/investigations/'+id+'/l1')).sync_state==='synced','Mock note not synced');
  assert.equal((await get(main,'/investigations/'+id)).determination,'unknown');
  await main.goto(origin+'/build/integrations');await main.getByRole('button',{name:fixture.name+' phishing',exact:false}).click();
  await main.getByText('I confirm local import and freezing this evidence snapshot',{exact:true}).click();await button('Replay local import').click();
  await main.getByText(/Local import accepted: 0 new events/).waitFor();
  assert.equal((await get(main,'/build/integrations/'+profile.id)).cases[0].investigation_id,id);
  const completed=fixture.phishing;
  await main.goto(origin+'/investigations/'+completed.case_id+'?tab=review');
  const rows=(await get(main,'/investigations/'+completed.case_id+'/sandbox-responses')).items;
  const action=rows.find(x=>x.id===completed.action_id);assert.equal(action.state,'executed');assert.equal(action.receipt.external_calls,0);
  await main.getByText('Possible credential phishing',{exact:true}).waitFor();
  const actionCard=main.getByRole('region',{name:'Case-linked sandbox responses'}).getByText(`Action ${action.id} · Review ${action.ticket}`,{exact:true}).locator('..');
  await actionCard.getByText('Sandbox revocation recorded · Mock SOAR note saved',{exact:true}).waitFor();
  await actionCard.getByText(/External calls: 0/).waitFor();
  await main.screenshot({path:join(screenshots,'phishing-response.png'),fullPage:true});
  await main.goto(origin+'/skills/'+completed.skill_id);await main.getByLabel('Skill instructions',{exact:true}).waitFor();assert.equal((await get(main,'/skills/'+completed.skill_id)).state,'published');
  await main.goto(origin+'/investigations/'+completed.followup_id+'?tab=transcript');const memoryStep=main.getByRole('heading',{name:'Enterprise insight: '+completed.document.events[0].projection.principal_ref,exact:true}).locator('..');await memoryStep.getByText('Synthetic phishing training context; prior outcome is not a verdict for future cases.',{exact:true}).waitFor();
  return {case_id:id,completed_case_id:completed.case_id,json_upload:true,cited_review:true,explicit_note_approval:true,import_replay:true,response_and_feedback_visible:true};
 });
}
