// Case response UI regression. All response writes are intercepted; no provider calls.
async page => {
 const origin='http://127.0.0.1:8080',ensure=(ok,msg)=>{if(!ok)throw Error(msg)};
 const cases=await (await page.request.get(origin+'/api/v1/investigations?limit=50')).json();
 let caseId,review;
 for(const c of cases.items||[]){const r=await(await page.request.get(origin+'/api/v1/investigations/'+encodeURIComponent(c.id)+'/l1')).json();if(r.result_status==='verified'){caseId=c.id;review=r;break;}}
 ensure(caseId,'A retained local L1 case is required');
 review={...review,mode:'mock-v1',sync_state:'synced',reviewed_by:'fixture-analyst'};
 let items=[],stopped=true,failPropose=true,scopes=[{id:'sandbox-test',connector_id:'mock-identity'}],writes=[];
 const handler=async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;
  if(path.endsWith('/l1'))return route.fulfill({json:review});
  if(!path.endsWith('/sandbox-responses'))return route.continue();
  if(req.method()==='GET')return route.fulfill({json:{items,scopes,mode:'sandbox',limit:100}});
  const b=req.postDataJSON();writes.push(b);let item=items.find(i=>i.id===b.id);
  if(b.operation==='propose'){
   if(!item){item={...b,case_id:caseId,requested_by:'fixture-analyst',expected_version:1,evidence:review.evidence.slice(0,1),state:'proposed',stopped};items.push(item);}
   if(failPropose){failPropose=false;return route.fulfill({status:503,json:{error:{message:'Uncertain network response'}}});}
  }else if(b.operation==='approve'){
   ensure(b.confirm&&b.comment.length>=10,'Missing explicit approval');Object.assign(item,{state:'approved',approved_by:'fixture-analyst',approval_fresh:true,approval_expires_at:new Date(Date.now()+300000).toISOString(),approval_comment:b.comment});
  }else if(b.operation==='policy'){
   ensure(b.confirm,'Policy not explicitly confirmed');stopped=b.stopped;items.forEach(i=>i.stopped=stopped);
  }else if(b.operation==='dry_run'){
   return route.fulfill({json:{would_execute:!stopped&&item.state==='approved',stopped,state:item.state}});
  }else if(b.operation==='execute'){
   ensure(b.confirm&&item.state==='approved'&&!stopped,'Unsafe execution');Object.assign(item,{state:'executed',receipt:{note_id:'sandbox-note-1',soar_connector:'mock-soar',soar_external_id:'case-1',external_calls:0,compensation:'Create a new mock session to simulate reauthentication.'}});
  }
  return route.fulfill({json:{state:item?.state||'policy',mode:'sandbox',external_calls:0}});
 };
 await page.route('**/api/v1/**',handler);
 const checks=[];
 const check=async locator=>{await locator.focus();await locator.press('Space');};
 try{
  await page.setViewportSize({width:1440,height:1000});await page.goto(origin+'/investigations/'+caseId);
  const panel=page.getByRole('region',{name:'Case-linked sandbox responses'});
  await panel.getByText('Propose a mock session revocation',{exact:true}).click();
  await panel.getByLabel('Mock session ID',{exact:true}).fill('browser-session');await panel.getByLabel('Mock principal reference',{exact:true}).fill('demo-user');await panel.getByLabel('Response review reference',{exact:true}).fill('UI-REVIEW');await panel.getByLabel('Response rationale',{exact:true}).fill('Reviewed local evidence for sandbox revocation only.');
  await check(panel.getByRole('checkbox').first());await panel.getByRole('button',{name:'Save response proposal'}).click();await panel.getByRole('alert').filter({hasText:'Uncertain network response'}).waitFor();
  await panel.getByRole('button',{name:'Refresh responses'}).click();await panel.getByRole('button',{name:'Approve sandbox revocation'}).waitFor();ensure(items.length===1,'Duplicate proposal after uncertain response');checks.push('uncertain proposal recovery');
  const approval=panel.getByRole('button',{name:'Approve sandbox revocation'});ensure(await approval.isDisabled(),'Approval enabled without explicit confirmation');
  await panel.getByLabel('Response approval comment',{exact:true}).fill('Reviewed evidence and exact sandbox target');await check(panel.getByRole('checkbox',{name:'I reviewed this exact mock session, evidence and scope'}));await approval.click();
  await panel.getByRole('button',{name:'Preview revocation'}).click();await panel.getByText('Preview blocked.',{exact:false}).waitFor();ensure(await panel.getByRole('button',{name:'Execute mock revocation'}).isDisabled(),'Kill switch bypass');checks.push('explicit approval and stopped preview');
  await panel.getByText('Sandbox execution gate',{exact:true}).click();await check(panel.getByRole('checkbox',{name:'I confirm this sandbox scope policy change'}));await panel.getByRole('button',{name:'Enable sandbox execution'}).click();
  await panel.getByRole('button',{name:'Preview revocation'}).click();await panel.getByText('Preview permits mock execution.',{exact:false}).waitFor();ensure(await panel.getByRole('button',{name:'Execute mock revocation'}).isDisabled(),'Execution did not require reconfirmation');await check(panel.getByRole('checkbox',{name:'I reviewed this exact mock session, evidence and scope'}));
  await panel.getByRole('button',{name:'Execute mock revocation'}).click();await panel.getByText('Sandbox revocation recorded · Mock SOAR note saved',{exact:true}).waitFor();checks.push('confirmed execution and durable receipt rendering');
  await page.reload();await page.getByText('Sandbox revocation recorded · Mock SOAR note saved',{exact:true}).waitFor();
  for(const width of [1440,390]){await page.setViewportSize({width,height:1000});ensure(!await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),'Case response overflow');await page.screenshot({path:'/opt/aisoc/output/playwright/case-response-'+width+'.png',fullPage:true});}checks.push('reload and desktop/mobile');
  await panel.getByRole('button',{name:'View Respond approvals'}).click();await page.getByRole('heading',{name:'Investigation response handoffs'}).waitFor();await page.goto(origin+'/respond/activity');await page.getByRole('button',{name:'Review in investigation'}).click();ensure(page.url().endsWith(caseId),'Response did not link back to case');checks.push('Respond activity to investigation roundtrip');
  scopes=[];await page.reload();await page.getByText('No sandbox response grant configured',{exact:false}).waitFor();ensure(await page.getByRole('button',{name:'Save response proposal'}).count()===0,'No-grant operator can propose');checks.push('read-only without grant');
  return {passed:true,checks,interceptedWrites:writes.length,externalCalls:0};
 }finally{await page.unroute('**/api/v1/**',handler);await page.setViewportSize({width:1440,height:1000});}
}
