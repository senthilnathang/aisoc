// Read-only local browser validation. Assessment PUTs are intercepted, not persisted.
async page=>{
 const origin=new URL(page.url()).origin;if(!['http://127.0.0.1:8080','http://127.0.0.1:8084'].includes(origin))throw Error('Local app only');
 const errors=[];const onError=e=>errors.push(e.message);page.on('pageerror',onError);const checks=[];
 try{
  await page.goto(origin+'/detect/detection-coverage');await page.getByRole('button',{name:'Inspect Execution',exact:true}).waitFor();
  const response=await page.request.get(origin+'/api/v1/detection-coverage');const data=await response.json();
  if(response.status()!==200||data.tactics.length!==14||data.techniques.length!==679)throw Error('Reference projection invalid');
  const foreign=await(await page.request.get(origin+'/api/v1/detection-coverage',{headers:{'X-Tenant-Id':'coverage-browser-foreign'}})).json();
  if(foreign.techniques.some(t=>t.rules.length||t.assessment)||foreign.tactics.some(t=>t.coverage_percent!==null))throw Error('Tenant leak or fabricated coverage');
  checks.push('pinned reference, tenant isolation and unassessed semantics');
  await page.getByRole('button',{name:'Table view',exact:true}).click();await page.getByRole('button',{name:'Execution',exact:true}).click();
  await page.getByLabel('Search techniques',{exact:true}).fill('T1059.001');
  await page.getByRole('button',{name:'Assess',exact:true}).click();
  const dialog=page.getByRole('dialog');await dialog.waitFor();
  await dialog.getByLabel('Assessment state',{exact:true}).selectOption('covered');
  if(!data.techniques.find(t=>t.id==='T1059.001').rules.some(r=>r.enabled)){
   if(!await dialog.getByRole('button',{name:'Save assessment',exact:true}).isDisabled())throw Error('Unmapped coverage allowed');
  }
  await dialog.getByLabel('Assessment state',{exact:true}).selectOption('gap');await dialog.getByLabel(/Assessment rationale/).fill('Browser-only fixture; no database write');
  let saved;
  await page.route('**/api/v1/detection-coverage/T1059.001',route=>{if(route.request().method()!=='PUT')return route.continue();saved=route.request().postDataJSON();return route.fulfill({status:409,json:{error:{message:'Assessment changed. Reload before saving.'}}});});
  await dialog.getByRole('button',{name:'Save assessment',exact:true}).click();await dialog.getByRole('button',{name:'Reload latest assessment',exact:true}).waitFor();
  if(await dialog.getByLabel(/Assessment rationale/).inputValue()!=='Browser-only fixture; no database write')throw Error('Conflict discarded draft');
  await page.unrouteAll({behavior:'wait'});
  await page.route('**/api/v1/detection-coverage/T1059.001',route=>{if(route.request().method()!=='PUT')return route.continue();saved=route.request().postDataJSON();return route.fulfill({json:{version:1}});});
  await dialog.getByRole('button',{name:'Save assessment',exact:true}).click();await dialog.waitFor({state:'hidden'});await page.getByLabel('Search techniques',{exact:true}).waitFor();
  if(saved.reference_version!=='17.1'||saved.state!=='gap'||saved.reviewer!==undefined||saved.rule_id!=='')throw Error('Assessment contract invalid');
  await page.unrouteAll({behavior:'wait'});checks.push('mapping gate, optimistic conflict and intercepted save');
  await page.getByRole('button',{name:'Create mapped rule',exact:true}).click();const create=page.getByRole('dialog');await create.waitFor();
  if(await create.getByLabel('Detection query',{exact:true}).inputValue()!=='')throw Error('Fake query');
  await create.getByRole('button',{name:'Create disabled rule',exact:true}).waitFor();await create.getByRole('button',{name:'Cancel',exact:true}).click();checks.push('mapped disabled-rule create form');
  for(const width of [1440,768,375]){
   await page.setViewportSize({width,height:1000});await page.goto(origin+'/detect/coverage');await page.getByRole('button',{name:'Inspect Execution',exact:true}).waitFor();
   if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw Error('Radar page overflow '+width);
   await page.getByRole('button',{name:'Table view',exact:true}).click();await page.getByRole('button',{name:'Execution',exact:true}).click();
   if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw Error('Table page overflow '+width);
  }
  checks.push('radar/table at desktop/tablet/mobile');
  const visualFixture=structuredClone(data);
  visualFixture.tactics.forEach((t,i)=>{t.coverage_percent=40+i*3;});
  const originalExpiry=new Date(Date.now()+17*86400000);originalExpiry.setUTCHours(14,25,30,123);
  const fixtureTechnique=visualFixture.techniques.find(t=>t.id==='T1059.001');
  fixtureTechnique.status='gap';fixtureTechnique.assessment={state:'gap',notes:'Existing fixture rationale',evidence_ref:'',rule_id:'',rule_version:0,version:4,reviewer:'fixture-reviewer',reviewed_at:new Date().toISOString(),expires_at:originalExpiry.toISOString()};
  await page.route('**/api/v1/detection-coverage',r=>r.fulfill({json:visualFixture}));
  await page.goto(origin+'/detect/coverage');await page.locator('.coverage-radar polygon[fill="#bba9ee"]').waitFor();
  await page.getByRole('button',{name:'Inspect Execution',exact:true}).click();await page.getByLabel('Search techniques',{exact:true}).fill('T1059.001');await page.getByRole('button',{name:'Assess',exact:true}).click();
  const existing=page.getByRole('dialog');
  if(await existing.getByLabel(/Review expires/).inputValue()!==originalExpiry.toISOString().slice(0,10))throw Error('Existing expiry changed on open');
  let update;
  await page.route('**/api/v1/detection-coverage/T1059.001',r=>{update=r.request().postDataJSON();return r.fulfill({status:409,json:{error:{message:'Fixture conflict'}}});});
  await existing.getByLabel(/Assessment rationale/).fill('Updated fixture rationale');await existing.getByRole('button',{name:'Save assessment',exact:true}).click();await existing.getByRole('button',{name:'Reload latest assessment',exact:true}).waitFor();
  if(update.expires_at!==originalExpiry.toISOString()||update.expected_version!==4)throw Error('Editing renewed expiry or lost version');
  await existing.getByRole('button',{name:'Cancel',exact:true}).click();await page.unrouteAll({behavior:'wait'});
  await page.goto(origin+'/detect/coverage');await page.getByRole('button',{name:'Inspect Execution',exact:true}).waitFor();await page.getByRole('button',{name:'Table view',exact:true}).click();
  checks.push('filled radar fixture and exact saved-expiry preservation');
  await page.route('**/api/v1/detection-coverage',r=>r.fulfill({status:503,json:{error:{message:'Coverage fixture unavailable'}}}));
  await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.getByRole('alert').filter({hasText:'Coverage fixture unavailable'}).waitFor();
  if(await page.locator('.coverage-radar').count())throw Error('Stale radar after failure');
  await page.unrouteAll({behavior:'wait'});await page.getByRole('button',{name:'Retry',exact:true}).click();await page.getByRole('button',{name:'Execution',exact:true}).waitFor();
  checks.push('failure clears stale metrics and retry recovers');if(errors.length)throw Error(errors.join('\n'));
  return {passed:true,checks,mutations:'PUT intercepted; no database writes'};
 }finally{await page.unrouteAll({behavior:'wait'});page.off('pageerror',onError);await page.setViewportSize({width:1440,height:1000});}
}
