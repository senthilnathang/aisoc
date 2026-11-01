// Authorized local showcase: create one named fixture profile, import, approve a
// mock note and replay. Subsequent runs reuse the same profile.
async page => {
 const origin='http://127.0.0.1:8080',name='Build local IAM/EDR showcase';
 await page.goto(origin+'/build/integrations');
 await page.getByRole('heading',{name:'Local integration studio',exact:true}).waitFor();
 const catalog=await (await page.request.get(origin+'/api/v1/build/integrations')).json();
 let profile=catalog.items.find(p=>p.name===name);
 if(!profile){
  await page.getByRole('button',{name:'＋ New local integration',exact:true}).click();
  await page.getByLabel('Profile name',{exact:true}).fill(name);
  await page.getByLabel('Authorized mock source',{exact:true}).selectOption('login-context-suspicious');
  await page.getByRole('button',{name:'Load local example (replaces JSON)',exact:true}).click();
  await page.getByRole('button',{name:'Validate & preview',exact:true}).click();
  await page.getByRole('heading',{name:'Normalized evidence preview',exact:true}).waitFor();
  await page.getByText('2 context observations',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Save draft',exact:true}).click();
  await page.getByText('Draft saved · revision 1',{exact:true}).waitFor();
  const saved=await (await page.request.get(origin+'/api/v1/build/integrations')).json();profile=saved.items.find(p=>p.name===name);
  if(!profile)throw Error('Saved profile missing');
 }else{await page.getByRole('button',{name:new RegExp(name)}).click()}
 await page.getByRole('button',{name:'Validate & preview',exact:true}).click();
 await page.getByRole('heading',{name:'Normalized evidence preview',exact:true}).waitFor();
 const confirmation=page.getByText('I confirm local import and freezing this evidence snapshot',{exact:true});
 await confirmation.click();
 await page.getByRole('button',{name:profile.state==='sealed'?'Replay local import':'Import saved JSON',exact:true}).click();
 await page.getByText('Local import accepted:',{exact:false}).waitFor();
 let status;
 for(let i=0;i<60;i++){
  status=await (await page.request.get(origin+'/api/v1/build/integrations/'+profile.id)).json();
  if(status.cases?.[0]&&['awaiting_review','synced'].includes(status.cases[0].state))break;
  await page.waitForTimeout(500);
 }
 if(!status.cases?.length)throw Error('No generated investigation');
 await page.getByRole('button',{name:'Refresh pipeline status',exact:true}).click();
 await page.getByRole('button',{name:'Open investigation',exact:true}).waitFor();
 for(const width of [1440,375]){
  await page.setViewportSize({width,height:1000});
  if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw Error('Integration editor overflow');
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:`output/playwright/local-integrations-${width}.png`,fullPage:true});
 }
 await confirmation.click();await page.getByRole('button',{name:'Replay local import',exact:true}).click();
 await page.getByText('Local import accepted: 0 new events.',{exact:false}).waitFor();
 await page.getByRole('button',{name:'Open investigation',exact:true}).click();
 const review=page.getByRole('region',{name:'L1 investigation review',exact:true});
 await review.getByRole('heading',{name:'inconclusive',exact:true}).waitFor();
 if(status.cases[0].state!=='synced'){
  await review.getByRole('button',{name:'Review mock SOAR note',exact:true}).click();
  await review.getByRole('textbox',{name:'Analyst review comment'}).fill('Automated Build UI showcase: reviewed local JSON evidence and gaps; mock note only.');
  await review.getByText('I reviewed the evidence and approve this mock note only',{exact:true}).click();
  await review.getByRole('button',{name:'Approve mock note',exact:true}).click();
 }
 await review.getByText('A note was saved to the mock SOAR case.',{exact:false}).waitFor({timeout:30000});
 await page.setViewportSize({width:1440,height:1000});
 return {passed:true,profile_id:profile.id,case_id:status.cases[0].investigation_id,preview:true,replay_inserted:0,note:'mock only',case_url:page.url()};
}
