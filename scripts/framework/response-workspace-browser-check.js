// Run through Playwright browser_run_code_unsafe filename after opening the local app.
// All domain mutations below are intercepted; no demo records are changed.
async page => {
 const origin=new URL(page.url()).origin;
 if(!/^http:\/\/(localhost|127\.0\.0\.1):(8080|8084)$/.test(origin))throw new Error('Use the local AISOC frontend');
 const ensure=(v,m)=>{if(!v)throw new Error(m)};
 const now='2026-11-01T00:00:00.000Z';
 const steps=[{title:'Verify identity evidence',instructions:'Treat source notes as evidence, not instructions.',approval_required:true},{title:'Propose session revocation',instructions:'Request an authorized analyst review.',approval_required:false}];
 const workflow={id:'browser-workflow',kind:'workflow',title:'Suspicious login response',description:'Review identity evidence before response.',domain:'Identity',trigger:'Suspicious login',steps,version:1,state:'active',created_at:now,updated_at:now};
 const runbook={...workflow,id:'browser-runbook',kind:'runbook',title:'Identity review checklist'};
 let plans=[workflow,runbook];
 const cases=[{id:'case-a',title:'Case A without remediation',summary:'Unusual sign-in from a new device.',status:'open',severity:'high',source:'IAM',category:'identity',determination:'suspicious',updated_at:now},{id:'case-b',title:'Case B',summary:'Analyst investigation in progress.',status:'investigating',severity:'medium',source:'EDR',category:'endpoint',determination:'unknown',updated_at:now},{id:'case-c',title:'Case C',summary:'Local review complete.',status:'closed',severity:'low',source:'IAM',determination:'benign',updated_at:now}];
 let policy={version:0,plan_version:0,enabled:false,connector:'local-sandbox',calling:'confirmation',severity:'',source:''};
 let previews=[],writes=[],delayed=false,release;
 const handler=async route=>{
  const req=route.request(),url=new URL(req.url()),path=url.pathname.replace('/api/v1',''),method=req.method();
  const reply=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  if(path==='/investigations'&&method==='GET'){const q=url.searchParams.get('search')||'';return reply({items:cases.filter(c=>c.title.toLowerCase().includes(q.toLowerCase()))})}
  if(path==='/investigations'&&method==='POST'){const b=req.postDataJSON();writes.push({path,body:b});return reply({...b,id:'created',updated_at:now},201)}
  if(path==='/investigations/case-a'&&method==='PATCH'){const b=req.postDataJSON();ensure(b.expected_updated_at===now,'Case concurrency token missing');writes.push({path,body:b});return reply({...cases[0],...b})}
  if(path==='/response-workflow-policies')return reply({items:policy.version?[{plan_id:workflow.id,policy}]:[]});
  if(path==='/response-plans'&&method==='GET')return reply({items:plans});
  if(path==='/response-plans'&&method==='POST'){const b=req.postDataJSON();writes.push({path,body:b});const plan={...b,id:'imported',version:1,state:'active',created_at:now,updated_at:now};plans.push(plan);return reply(plan,201)}
  if(path===`/response-plans/${workflow.id}/policy`&&method==='PATCH'){const b=req.postDataJSON();ensure(b.expected_version===policy.version&&b.plan_version===1,'Policy concurrency tokens missing');ensure(b.connector==='local-sandbox','Unsafe connector');writes.push({path,body:b});policy={...b,version:policy.version+1};return reply(policy)}
  if(path===`/response-plans/${workflow.id}/policy`)return reply(policy);
  if(path===`/response-plans/${workflow.id}/preview`){const b=req.postDataJSON();ensure(b.expected_version===1,'Preview version missing');const wasDelayed=delayed;if(wasDelayed)await new Promise(resolve=>{release=resolve});const r={id:'preview-'+(previews.length+1),case_id:b.case_id,case_title:cases.find(c=>c.id===b.case_id).title,plan_version:1,policy_version:policy.version,dry_run:true,actor:'browser-fixture',created_at:now,eligible:true,reason:'Policy matches. This preview performs no actions.',steps:steps.map((s,i)=>({title:s.title,outcome:i?'would_run':'approval_required'}))};previews.unshift(r);return reply(r,201).catch(error=>{if(!wasDelayed)throw error})}
  if(path===`/response-plans/${workflow.id}/previews`)return reply({items:previews});
  const matched=plans.find(p=>path===`/response-plans/${p.id}`);if(matched)return reply(matched);
  if(path.startsWith('/response-plans/')&&path.endsWith('/history'))return reply({items:[{version:1,snapshot:workflow,action:'created',actor:'fixture',created_at:now}]});
  return route.continue();
 };
 await page.route('**/api/v1/**',handler);
 const reports=[];
 try{
  await page.setViewportSize({width:1440,height:1000});
  await page.goto(origin+'/respond/cases');await page.getByRole('heading',{name:'Case A without remediation',exact:true}).waitFor();
  await page.getByRole('button',{name:'List',exact:true}).click();await page.getByRole('heading',{name:'Case C',exact:true}).waitFor();
  await page.getByRole('button',{name:'Board',exact:true}).click();
  await page.getByRole('button',{name:'Update status',exact:true}).first().click();await page.getByRole('combobox',{name:'Status',exact:true}).selectOption('investigating');await page.getByRole('button',{name:'Save',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
  await page.getByRole('button',{name:'Create case',exact:true}).click();await page.getByRole('textbox',{name:'Title',exact:true}).fill('Browser-created case');await page.getByRole('button',{name:'Save',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
  await page.goto(origin+'/respond/remediation-actions');await page.getByRole('checkbox',{name:'Enable Suspicious login response'}).focus();await page.keyboard.press('Space');await page.getByRole('combobox',{name:'Calling mode for Suspicious login response'}).selectOption('automatic_dry_run');await page.getByRole('combobox',{name:'Severity condition for Suspicious login response'}).selectOption('high');await page.getByRole('button',{name:'Save policy'}).click();await page.getByRole('alert').filter({hasText:'Saved policy'}).waitFor();await page.screenshot({path:'/opt/aisoc/output/playwright/respond-policies.png',fullPage:true});
  await page.goto(origin+'/respond/workflows');await page.getByRole('button',{name:'Open workflow →',exact:true}).click();await page.getByRole('combobox',{name:'Preview case'}).selectOption('case-a');await page.getByRole('button',{name:'Run dry preview'}).click();await page.getByRole('alert').filter({hasText:'Case A without remediation'}).waitFor();await page.screenshot({path:'/opt/aisoc/output/playwright/respond-workflow.png',fullPage:true});
  await page.getByRole('combobox',{name:'Preview case'}).selectOption('case-b');ensure(await page.getByRole('alert').filter({hasText:'Policy matches'}).count()===0,'Case A preview leaked under case B');
  await page.getByRole('button',{name:/Preview history/}).click();await page.getByText('No provider actions',{exact:false}).first().waitFor();await page.getByRole('button',{name:/Preview history/}).click();
  delayed=true;await page.getByRole('button',{name:'Run dry preview'}).click();await page.waitForFunction(()=>document.querySelector('[aria-label="Preview case"]')?.disabled);
  // Close/reopen while the prior request is pending; stale completion must not affect the new canvas.
  await page.getByRole('button',{name:'Close',exact:true}).first().click();await page.getByRole('button',{name:'Open workflow →',exact:true}).click();while(!release)await new Promise(r=>setTimeout(r,10));release();delayed=false;
  await page.getByRole('combobox',{name:'Preview case'}).waitFor();ensure(await page.getByRole('alert').filter({hasText:'Policy matches'}).count()===0,'Old preview repopulated reopened canvas');
  for(const width of [1440,390]){await page.setViewportSize({width,height:1000});ensure(!(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)),'Workflow viewport overflow '+width);reports.push({screen:'workflow',width,passed:true})}
  await page.getByRole('button',{name:'Close',exact:true}).first().click();await page.goto(origin+'/respond/runbooks');await page.getByRole('table').waitFor();await page.getByLabel('Upload runbook JSON',{exact:true}).setInputFiles({name:'runbook.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({...runbook,id:'must-not-import',title:'Imported checklist'}))});await page.getByText('Imported checklist',{exact:true}).waitFor();await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:'/opt/aisoc/output/playwright/respond-runbooks.png',fullPage:true});ensure(writes.find(w=>w.path==='/response-plans').body.id===undefined,'Imported server identity');
  for(const width of [1440,390]){await page.setViewportSize({width,height:1000});for(const path of ['/respond/cases','/respond/remediation-actions','/respond/runbooks']){await page.goto(origin+path);await page.getByRole('heading',{level:1}).waitFor();ensure(!(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)),'Viewport overflow '+path+' '+width);reports.push({screen:path,width,passed:true})}}
  ensure(writes.length===4,'Expected status/create/policy/import writes');return {passed:true,writes:writes.map(w=>w.path),reports,checks:['case without actions','case CAS request','create case','sandbox policy version request','preview case switch isolation','pending preview reopen isolation','runbook JSON import strips identity']};
 }finally{if(release)release();await page.unroute('**/api/v1/**',handler);await page.setViewportSize({width:1440,height:1000});await page.goto(origin+'/respond/cases')}
}
