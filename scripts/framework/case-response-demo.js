// RETAINED LOCAL DEMO: explicitly approves and executes ONE mock session revocation.
// Uses an existing reviewed Build showcase. Stops the sandbox execution gate afterward.
// No live providers, credentials or actual sessions. Reuses the retained proposal on rerun.
async page => {
 const origin='http://127.0.0.1:8080',marker='Reviewed Build IAM/MFA and EDR evidence for local session revocation showcase.';
 const profiles=await(await page.request.get(origin+'/api/v1/build/integrations')).json();
 const profile=profiles.items.find(x=>x.name==='Build local IAM/EDR showcase');if(!profile)throw Error('Create the reviewed Build showcase first');
 const detail=await(await page.request.get(origin+'/api/v1/build/integrations/'+profile.id)).json();const caseId=detail.cases[0].investigation_id;
 const url=origin+'/investigations/'+caseId;
 let records=await(await page.request.get(origin+'/api/v1/investigations/'+caseId+'/sandbox-responses')).json();
 const scope=records.scopes[0]?.id;if(!scope)throw Error('No separately configured sandbox grant');
 let item=records.items.find(x=>x.reason===marker),enabled=false;
 const check=async loc=>{await loc.focus();if(!await loc.isChecked())await loc.press('Space');};
 await page.setViewportSize({width:1440,height:1000});await page.goto(url);
 const panel=page.getByRole('region',{name:'Case-linked sandbox responses'});
 try{
  if(!item){
   await panel.getByText('Propose a mock session revocation',{exact:true}).click();
   await panel.getByLabel('Sandbox response scope',{exact:true}).selectOption(scope);
   await panel.getByLabel('Mock session ID',{exact:true}).fill('showcase-session-'+caseId.slice(4,12));await panel.getByLabel('Mock principal reference',{exact:true}).fill('demo-user');await panel.getByLabel('Response review reference',{exact:true}).fill('LOCAL-RESPONSE-SHOWCASE');await panel.getByLabel('Response rationale',{exact:true}).fill(marker);
   await check(panel.getByRole('checkbox').first());await panel.getByRole('button',{name:'Save response proposal'}).click();
   await panel.getByRole('button',{name:'Approve sandbox revocation'}).waitFor();
   records=await(await page.request.get(origin+'/api/v1/investigations/'+caseId+'/sandbox-responses')).json();item=records.items.find(x=>x.reason===marker);
  }
  if(item.state!=='executed'){
   if(item.state!=='approved'||!item.approval_fresh){
    await panel.getByLabel('Response approval comment',{exact:true}).fill('Reviewed exact mock session and selected evidence. Approve this local simulation only; no live identity action.');await check(panel.getByRole('checkbox',{name:'I reviewed this exact mock session, evidence and scope'}));await panel.getByRole('button',{name:/^(Approve sandbox revocation|Renew sandbox approval)$/}).click();
   }
   // The ticket also documents the explicit scoped kill-switch change.
   const draft=panel.getByLabel('Response review reference',{exact:true});
   if(!await draft.isVisible())await panel.getByText('Propose a mock session revocation',{exact:true}).click();
   await draft.fill('LOCAL-RESPONSE-SHOWCASE');await panel.getByText('Sandbox execution gate',{exact:true}).click();await check(panel.getByRole('checkbox',{name:'I confirm this sandbox scope policy change'}));await panel.getByRole('button',{name:'Enable sandbox execution'}).click();enabled=true;
   await panel.getByRole('button',{name:'Preview revocation'}).click();await panel.getByText('Preview permits mock execution.',{exact:false}).waitFor();await check(panel.getByRole('checkbox',{name:'I reviewed this exact mock session, evidence and scope'}));await panel.getByRole('button',{name:'Execute mock revocation'}).click();await panel.getByText('Sandbox revocation recorded · Mock SOAR note saved',{exact:true}).waitFor();
  }
 }finally{
  if(enabled){const stop=await page.request.post(origin+'/api/v1/investigations/'+caseId+'/sandbox-responses',{data:{operation:'policy',scope_id:scope,ticket:'LOCAL-RESPONSE-SHOWCASE',stopped:true,confirm:true}});if(!stop.ok())throw Error('Sandbox gate stop failed: '+stop.status());}
 }
 await page.reload();await panel.getByText('Sandbox revocation recorded · Mock SOAR note saved',{exact:true}).waitFor();
 records=await(await page.request.get(origin+'/api/v1/investigations/'+caseId+'/sandbox-responses')).json();item=records.items.find(x=>x.reason===marker);
 if(item.state!=='executed'||!item.stopped||item.receipt.external_calls!==0)throw Error('Incomplete receipt or sandbox gate left enabled');
 for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await panel.scrollIntoViewIfNeeded();await page.screenshot({path:'/opt/aisoc/output/playwright/case-response-live-'+width+'.png'});if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Receipt overflows viewport');}
 await page.goto(origin+'/respond/activity');await page.getByRole('button',{name:'Review in investigation'}).first().click();
 if(!page.url().includes(caseId))throw Error('Respond case link incorrect');
 await page.setViewportSize({width:1440,height:1000});
 return {passed:true,caseId,url,actionId:item.id,noteId:item.receipt.note_id,state:item.state,stopped:item.stopped,externalCalls:0,retainedDemo:true};
}
