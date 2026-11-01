// Credential-free local browser regression. Synthetic records only.
async page => {
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://localhost:8080/respond/inbox');
 const prefix='inbox-browser-'+Date.now();
 const fixture=await page.evaluate(async name=>{
  const call=async(path,body)=>{const r=await fetch('/api/v1'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw Error(await r.text());return r.json();};
  const memory=await call('/enterprise-insights',{id:'EI-'+crypto.randomUUID(),artifact:name,kind:'user',content:'Synthetic context for inbox review.'});
  const skill=await call('/skills',{name:name+' skill',content_markdown:'Synthetic saved Skill instructions.'});
  return {memory,skill};
 },prefix);
 await page.getByRole('button',{name:'Refresh inbox',exact:true}).click();
 await page.getByLabel('Search proposals').fill(prefix);
 await page.getByRole('button',{name:'Preview '+prefix,exact:true}).waitFor();
 // Edit after list load: lifecycle must not approve a newer revision behind an old preview.
 await page.evaluate(async item=>{
  const r=await fetch('/api/v1/enterprise-insights/'+item.id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({expected_version:item.version,artifact:item.artifact,kind:'user',content:'Changed synthetic context requires a refreshed preview.'})});
  if(!r.ok)throw Error(await r.text());
 },fixture.memory);
 await page.getByRole('button',{name:'Preview '+prefix,exact:true}).click();
 await page.getByText('The saved revision changed after this preview loaded. Refresh the owning page or inbox before reviewing.',{exact:true}).waitFor();
 if(await page.getByRole('button',{name:'Approve Memory proposal',exact:true}).count())throw Error('Stale preview exposes approval');
 await page.getByRole('button',{name:'Refresh inbox',exact:true}).click();
 await page.getByRole('button',{name:'Preview '+prefix,exact:true}).click();
 await page.getByText('Changed synthetic context requires a refreshed preview.',{exact:true}).waitFor();
 if(!await page.getByRole('button',{name:'Approve Memory proposal',exact:true}).isDisabled())throw Error('Author can approve');
 await page.screenshot({path:'/opt/aisoc/output/playwright/approval-inbox-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});
 if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw Error('Mobile overflow');
 await page.screenshot({path:'/opt/aisoc/output/playwright/approval-inbox-mobile.png',fullPage:true});
 await page.setViewportSize({width:1440,height:1000});
 await page.getByLabel('Area',{exact:true}).selectOption('skill');
 await page.getByRole('button',{name:'Preview '+prefix+' skill',exact:true}).click();
 await page.getByText('Synthetic saved Skill instructions.',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Open Skills review',exact:true}).click();
 await page.waitForURL('**/skills/'+fixture.skill.id);
 await page.goto('http://localhost:8080/respond/inbox');
 await page.getByLabel('Search proposals').fill('no-matching-proposal-'+crypto.randomUUID());
 await page.getByText('No pending proposals match these filters.',{exact:true}).waitFor();
 await page.route('**/api/v1/approvals?*',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'TEST_UNAVAILABLE',message:'Synthetic inbox unavailable'}})}));
 await page.getByRole('button',{name:'Refresh inbox',exact:true}).click();
 await page.getByText('Synthetic inbox unavailable',{exact:true}).waitFor();
 await page.unroute('**/api/v1/approvals?*');
 await page.getByRole('button',{name:'Refresh inbox',exact:true}).click();
 await page.getByText('No pending proposals match these filters.',{exact:true}).waitFor();
 if(errors.length)throw Error(JSON.stringify(errors));
 return {passed:true,stale_preview_blocked:true,self_approval_disabled:true,skill_handoff:true,mobile:true,empty_state:true,error_recovery:true,page_errors:errors,ids:[fixture.memory.id,fixture.skill.id]};
}
