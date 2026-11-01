// Local, credential-free synthetic ownership and notification regression.
async page => {
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setViewportSize({width:1440,height:1000});
 await page.goto('http://localhost:8080/respond/inbox');
 const name='ownership-browser-'+Date.now();
 const fixture=await page.evaluate(async name=>{
  const create=async(body)=>{const r=await fetch('/api/v1/enterprise-insights',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw Error(await r.text());return r.json();};
  return {pending:await create({id:'EI-'+crypto.randomUUID(),artifact:name,kind:'user',content:'Synthetic approval ownership context.'}),expired:await create({id:'EI-'+crypto.randomUUID(),artifact:name+' repair',kind:'user',content:'Synthetic expired context needing repair.',valid_until:'2000-01-01T00:00:00Z'})};
 },name);
 await page.getByRole('button',{name:'Refresh inbox',exact:true}).click();
 await page.getByLabel('Search proposals').fill(name);
 await page.getByRole('button',{name:'Preview '+name,exact:true}).click();
 await page.getByLabel('Ownership reason').fill('Hand off synthetic context for independent review.');
 if(!await page.getByRole('button',{name:'Claim for me',exact:true}).isDisabled())throw Error('Author self-claim allowed');
 await page.getByLabel('Eligible next operator').selectOption('local-approver');
 await page.getByRole('button',{name:'Assign review',exact:true}).click();
 await page.getByRole('button',{name:'Preview '+name,exact:true}).click();
 await page.getByText('Owner: local-approver · Ownership version 1',{exact:true}).waitFor();
 if(!await page.getByRole('button',{name:'Approve Memory proposal',exact:true}).isDisabled())throw Error('Assignment granted approval');
 await page.getByLabel('Ownership reason').fill('Release synthetic ownership after browser verification.');
 await page.getByRole('button',{name:'Release ownership',exact:true}).click();
 await page.getByRole('button',{name:'Preview '+name,exact:true}).click();
 await page.getByText('Owner: Unassigned · Ownership version 2',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Preview '+name+' repair',exact:true}).click();
 await page.getByLabel('Ownership reason').fill('Claim expired context for proposer repair only.');
 await page.getByRole('button',{name:'Claim for me',exact:true}).click();
 await page.getByRole('button',{name:'Preview '+name+' repair',exact:true}).click();
 await page.getByText('Owner: local-development · Ownership version 1',{exact:true}).waitFor();
 await page.getByRole('button',{name:/^Notifications,/}).click();
 const dialog=page.getByRole('dialog');
 await dialog.getByText(name+' repair',{exact:true}).waitFor();
 await dialog.getByRole('button',{name:'Mark as read',exact:true}).first().click();
 await dialog.getByText(/0 unread/).waitFor();
 await page.screenshot({path:'/opt/aisoc/output/playwright/approval-ownership-notifications.png',fullPage:true});
 await dialog.getByRole('link',{name:'Open current review',exact:true}).first().click();
 await page.getByText('Owner: local-development · Ownership version 1',{exact:true}).waitFor();
 await page.screenshot({path:'/opt/aisoc/output/playwright/approval-ownership-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});
 if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw Error('Mobile overflow');
 await page.screenshot({path:'/opt/aisoc/output/playwright/approval-ownership-mobile.png',fullPage:true});
 await page.getByRole('button',{name:/^Notifications,/}).click();
 await page.getByRole('dialog').getByText(name+' repair',{exact:true}).waitFor();
 if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw Error('Mobile notification overflow');
 await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();
 if(errors.length)throw Error(JSON.stringify(errors));
 return {passed:true,self_claim_denied:true,assignment_release:true,expired_memory_repair_claim:true,notification_read_and_link:true,mobile:true,page_errors:errors,ids:[fixture.pending.id,fixture.expired.id]};
}
