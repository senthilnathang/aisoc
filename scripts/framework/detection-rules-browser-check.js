// Local-only UI/API verification. Mutation requests are intercepted; demo data is not changed.
async page => {
 const origin=new URL(page.url()).origin;
 if(!['http://127.0.0.1:8080','http://127.0.0.1:8084'].includes(origin))throw Error('Local app only');
 const errors=[];const onError=e=>errors.push(e.message);page.on('pageerror',onError);const checks=[];
 try {
  await page.goto(origin+'/detect/detection-rules');
  await page.getByRole('button',{name:'mock-stream-login',exact:true}).waitFor();
  const result=await (await page.request.get(origin+'/api/v1/detection-registry?days=30')).json();
  if(!result.summary||result.days!==30)throw Error('Period projection missing');
  const foreign=await (await page.request.get(origin+'/api/v1/detection-registry?days=30',{headers:{'X-Tenant-Id':'rules-browser-foreign'}})).json();
  if(foreign.total!==0||foreign.summary.triggered_alerts!==0)throw Error('Tenant leak');
  const denied=await page.request.get(origin+'/api/v1/detection-rules/mock-stream-login/metrics?days=30',{headers:{'X-Tenant-Id':'rules-browser-foreign'}});if(denied.status()!==404)throw Error('Foreign metrics accessible');
  checks.push('period metrics and tenant isolation');
  await page.getByLabel('Search detection rules').fill('mock-stream-login');
  await page.getByRole('button',{name:'mock-stream-login',exact:true}).click();
  await page.getByRole('heading',{name:'mock-stream-login',exact:true}).waitFor();
  if(new URL(page.url()).searchParams.get('rule')!=='mock-stream-login')throw Error('Selection not shareable');
  await page.getByRole('tab',{name:'History',exact:true}).click();
  await page.reload();await page.getByRole('tab',{name:'History',exact:true}).waitFor();
  if(await page.getByRole('tab',{name:'History',exact:true}).getAttribute('aria-selected')!=='true')throw Error('Tab not restored');
  if(await page.getByLabel('Search detection rules').inputValue()!=='mock-stream-login')throw Error('Filter lost');
  await page.getByRole('tab',{name:'Recommendations',exact:true}).click();await page.getByRole('heading',{name:'Not assessed',exact:true}).waitFor();
  await page.goBack();await page.getByRole('tab',{name:'History',exact:true}).waitFor();
  if(await page.getByRole('tab',{name:'History',exact:true}).getAttribute('aria-selected')!=='true')throw Error('Back lost state');
  await page.getByRole('button',{name:'Close',exact:true}).click();
  if(new URL(page.url()).searchParams.has('rule'))throw Error('Close did not clear selection');
  checks.push('deep-link reload/back and preserved filters');
  await page.getByRole('button',{name:'Reset',exact:true}).click();
  await page.getByRole('tab',{name:'Catalog',exact:true}).click();
  await page.getByRole('heading',{name:'Kerberoasting via SPN Request',exact:true}).waitFor();
  await page.getByRole('button',{name:'Use template',exact:true}).first().click();
  const dialog=page.getByRole('dialog');await dialog.waitFor();
  if(await dialog.getByLabel(/^Name/).inputValue()!=='Kerberoasting via SPN Request')throw Error('Template not populated');
  if(await dialog.getByLabel('Detection query',{exact:true}).inputValue()!=='')throw Error('Invented catalog query');
  let submitted;
  await page.route('**/api/v1/detection-rules',r=>{if(r.request().method()!=='POST')return r.continue();submitted=r.request().postDataJSON();return r.fulfill({status:201,json:{id:'mock-stream-login',...submitted}});});
  await dialog.getByRole('button',{name:'Create disabled rule',exact:true}).click();
  await page.getByRole('heading',{name:'mock-stream-login',exact:true}).waitFor();
  if(submitted?.enabled!==false||!submitted.mitre_techniques.includes('T1558.003'))throw Error('Unsafe template defaults');
  await page.unrouteAll({behavior:'wait'});
  checks.push('backend catalog and intercepted disabled-template creation');
  for(const width of [1440,768,375]) {
   await page.setViewportSize({width,height:1000});await page.goto(origin+'/detect/rules?rule=mock-stream-login&days=7&tab=details');
   await page.getByRole('heading',{name:'mock-stream-login',exact:true}).waitFor();await page.getByText('No techniques mapped.',{exact:true}).waitFor();
   if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw Error('Page overflow '+width);
  }
  checks.push('desktop/tablet/mobile and sparse-rule compatibility');
  await page.getByRole('button',{name:'Edit rule',exact:true}).click();
  await page.getByLabel(/Rule name/).fill('Unsaved rule draft');
  await page.getByLabel('Rule metrics period',{exact:true}).selectOption('30');
  await page.getByText('Last 30 days · UTC',{exact:true}).waitFor();
  if(await page.getByLabel(/Rule name/).inputValue()!=='Unsaved rule draft')throw Error('Metrics period discarded draft');
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  checks.push('metrics period preserves unsaved edit');
  await page.route('**/api/v1/detection-registry?**',r=>r.fulfill({status:503,json:{error:{message:'Rules fixture unavailable'}}}));
  await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.getByRole('alert').filter({hasText:'Rules fixture unavailable'}).waitFor();
  await page.unrouteAll({behavior:'wait'});await page.getByRole('button',{name:'Retry',exact:true}).click();await page.getByRole('button',{name:'mock-stream-login',exact:true}).waitFor();
  checks.push('registry failure and recovery');
  if(errors.length)throw Error(errors.join('\n'));
  return {passed:true,checks,mutations:'POST intercepted; no database writes'};
 }finally{await page.unrouteAll({behavior:'wait'});page.off('pageerror',onError);await page.setViewportSize({width:1440,height:1000});}
}
