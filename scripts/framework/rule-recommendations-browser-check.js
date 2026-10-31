// Local UI checks. All mutations are intercepted; demo labels and rules are preserved.
async page => {
 const origin=new URL(page.url()).origin;
 if(!['http://127.0.0.1:8080','http://127.0.0.1:8084'].includes(origin))throw Error('Local app only');
 const checks=[],errors=[],writes=[];const onError=e=>errors.push(e.message);page.on('pageerror',onError);
 const path='/api/v1/detection-rules/mock-stream-login/recommendations';
 try {
  const real=await page.request.get(origin+path+'?days=30');if(real.status()!==200)throw Error('Recommendations unavailable');
  const data=await real.json();
  const detail=await (await page.request.get(origin+'/api/v1/detection-rules/mock-stream-login')).json();
  const ruleFixture={...detail,enabled:false,bindings:[]};
  await page.route('**/api/v1/detection-rules/mock-stream-login',r=>r.request().method()==='GET'?r.fulfill({json:ruleFixture}):r.abort());
  const foreign=await page.request.get(origin+path+'?days=30',{headers:{'X-Tenant-Id':'recommendation-browser-foreign'}});if(foreign.status()!==404)throw Error('Foreign recommendations accessible');
  checks.push('real Go API projection and tenant isolation');
  const rec={id:'REC-browser',base_version:data.rule_version,base_query:'provider baseline',proposed_query:'{"dialect":"aisoc-exclusion-v1","field":"source","value":"scanner"}',title:'Exclude reviewed noise by source',rationale:'Explicit reviewed evidence; frozen local replay.',created_by:'browser-fixture',status:'pending',window_start:new Date().toISOString(),window_end:new Date().toISOString(),validation:null,test_result:null,stale_rule:false};
  const fixture={...data,rule_enabled:false,sample_truncated:false,statistics:{received:2,reviewed:2,false_positives:1,true_positives:1,false_positive_share:50},alerts:[{id:'alert-fixture',title:'Reviewed scanner activity',source:'scanner',primary_entity:'host-1',severity:'high',created_at:new Date().toISOString(),label:'false_positive',label_version:1,rationale:'Reviewed scanner',investigation_id:''}],items:[rec]};
  let rejectLabel=true;
  await page.route('**/api/v1/detection-rules/mock-stream-login/**',async route=>{
   const req=route.request(),url=new URL(req.url());
   if(req.method()==='GET'&&url.pathname===path)return route.fulfill({json:fixture});
   if(['POST','PUT'].includes(req.method())){
    writes.push({path:url.pathname,body:req.postDataJSON()});
    if(url.pathname.includes('/alert-labels/'))return route.fulfill({status:rejectLabel?409:200,json:rejectLabel?{error:{message:'Label changed; reload'}}:{version:2}});
    const action=url.pathname.split('/').pop();
    if(action==='validate')rec.validation={valid:true};
    if(action==='test'){rec.test_result={passed:true,sample_size:2,false_positives:1,false_positives_removed:1,true_positives_removed:0,unreviewed_removed:0};rec.tested_at=new Date().toISOString();}
    if(action==='apply')rec.status='applied';
    if(action==='dismiss')rec.status='dismissed';
    return route.fulfill({json:{status:rec.status,test_result:rec.test_result,created:0}});
   }
   return route.continue();
  });
  await page.goto(origin+'/detect/detection-rules/recommendations?rule=mock-stream-login');
  await page.getByRole('heading',{name:rec.title,exact:true}).waitFor();
  if(await page.getByRole('tab',{name:'Recommendations',exact:true}).getAttribute('aria-selected')!=='true')throw Error('Alias did not select recommendations');
  if(!await page.getByRole('button',{name:'Apply locally',exact:true}).isDisabled())throw Error('Apply without receipt');
  if(!await page.getByRole('button',{name:'Sync Now',exact:true}).isDisabled())throw Error('Provider sync enabled');
  await page.getByRole('button',{name:'Validate Query',exact:true}).click();await page.getByText('Validation: local syntax passed',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Test Query',exact:true}).click();await page.getByText('Replay passed',{exact:true}).waitFor();
  rec.tested_at=new Date(Date.now()-25*60*60*1000).toISOString();
  await page.reload();await page.getByRole('heading',{name:rec.title,exact:true}).waitFor();
  if(!await page.getByRole('button',{name:'Apply locally',exact:true}).isDisabled())throw Error('Expired receipt enabled');
  await page.getByRole('button',{name:'Test Query',exact:true}).click();await page.getByRole('button',{name:'Apply locally',exact:true}).waitFor();
  ruleFixture.bindings=[{id:'fixture-binding',name:'Fixture provider',provider:'QRadar'}];
  await page.reload();await page.getByRole('heading',{name:rec.title,exact:true}).waitFor();
  if(!await page.getByRole('button',{name:'Apply locally',exact:true}).isDisabled())throw Error('Provider-bound apply enabled');
  ruleFixture.bindings=[];await page.reload();await page.getByRole('heading',{name:rec.title,exact:true}).waitFor();
  await page.getByRole('button',{name:'Apply locally',exact:true}).click();
  if(writes.some(w=>w.path.endsWith('/apply')))throw Error('Applied before confirmation');
  await page.getByRole('button',{name:'Confirm local apply',exact:true}).click();await page.getByText('applied',{exact:true}).waitFor();
  checks.push('deep link, syntax/replay receipts, explicit apply confirmation, expiry/binding guards, unsupported sync');
  await page.locator('summary').filter({hasText:'Review alert evidence'}).click();
  await page.getByRole('button',{name:'Review label',exact:true}).click();
  const dialog=page.getByRole('dialog');await dialog.getByLabel('Evidence rationale').fill('Keep this analyst draft');await dialog.getByRole('button',{name:'Save label',exact:true}).click();await dialog.getByText('Label changed; reload',{exact:true}).waitFor();
  if(await dialog.getByLabel('Evidence rationale').inputValue()!=='Keep this analyst draft')throw Error('Conflict discarded draft');
  rejectLabel=false;await dialog.getByRole('button',{name:'Save label',exact:true}).click();await dialog.waitFor({state:'hidden'});
  checks.push('label CAS request and conflict draft preservation');
  rec.status='pending';
  for(const width of [1440,768,375]){
   await page.setViewportSize({width,height:1000});await page.reload();await page.getByRole('heading',{name:rec.title,exact:true}).waitFor();
   if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw Error('Page overflow '+width);
  }
  await page.getByRole('button',{name:'Dismiss',exact:true}).click();await page.getByText('dismissed',{exact:true}).waitFor();checks.push('responsive cards and dismissal');
  if(errors.length)throw Error(errors.join('\n'));
  return {passed:true,checks,interceptedMutations:writes.length};
 }catch(e){throw Error(e.message+'\nChecks: '+checks.join(', ')+'\n'+(await page.locator('body').innerText()).slice(-5000));}finally{await page.unrouteAll({behavior:'wait'});page.off('pageerror',onError);await page.setViewportSize({width:1440,height:1000});await page.goto(origin+'/detect/rules?rule=mock-stream-login&tab=recommendations');}
}
