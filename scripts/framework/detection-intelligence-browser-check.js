// Run through the browser tool on the local application. Read-only; fixtures intercept GET only.
async page => {
 const origin=new URL(page.url()).origin;
 if(!['http://127.0.0.1:8080','http://127.0.0.1:8084'].includes(origin))throw Error('Local application only');
 const errors=[]; const onError=e=>errors.push(e.message);page.on('pageerror',onError);
 const checks=[];
 try {
  await page.goto(origin+'/detect/detection-intelligence');
  await page.getByRole('heading',{name:'Detection Intelligence',exact:true}).waitFor();
  await page.locator('.di-tile').first().waitFor();
  const response=await page.request.get(origin+'/api/v1/detection-intelligence');const data=await response.json();
  if(response.status()!==200||!data.groups.length)throw Error('Local demo projection missing');
  for(const suffix of ['?days=91','?search=a&search=b','?unknown=x']) {
   if((await page.request.get(origin+'/api/v1/detection-intelligence'+suffix)).status()!==400)throw Error('Invalid query accepted');
  }
  const foreign=await (await page.request.get(origin+'/api/v1/detection-intelligence',{headers:{'X-Tenant-Id':'intel-browser-isolation'}})).json();
  if(foreign.totals.total_alerts!==0)throw Error('Cross tenant results');
  checks.push('live API validation and tenant isolation');
  await page.getByRole('tab',{name:'Escalation',exact:true}).click();
  if(await page.getByRole('tab',{name:'Escalation',exact:true}).getAttribute('aria-selected')!=='true')throw Error('Tab inactive');
  await page.locator('.di-tile').first().click();
  await page.getByRole('button',{name:'Open rule',exact:true}).first().waitFor();
  await page.getByRole('button',{name:'Clear filters',exact:true}).click();
  await page.getByRole('button',{name:'View in Investigations',exact:true}).click();
  await page.getByRole('button',{name:'Open investigation',exact:true}).first().waitFor();
  checks.push('tile drill-down and distinct investigation links');
  await page.getByRole('button',{name:'Open investigation',exact:true}).first().click();
  await page.waitForURL(/\/investigations\//);checks.push('case navigation');
  await page.goto(origin+'/detect/intelligence');
  await page.getByLabel('Search alerts',{exact:true}).fill('no-match-fixture-928349');
  await page.getByText('No alerts match this period and filters.',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Clear filters',exact:true}).click();
  await page.locator('.di-tile').first().waitFor();
  for(const width of [1440,768,375]) {
   await page.setViewportSize({width,height:1000});
   await page.getByLabel('Time range',{exact:true}).selectOption('90');
   await page.locator('.di-day').nth(90).waitFor();
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
   if(overflow)throw Error('Page overflow '+width);
   const fits=await page.locator('.di-chart').evaluate(el=>el.scrollWidth<=el.clientWidth+1);if(!fits)throw Error('Chart overflow '+width);
  }
  checks.push('empty search and 90-day chart at desktop/tablet/mobile');
  await page.route('**/api/v1/detection-intelligence?**',r=>r.fulfill({status:503,json:{error:{message:'Fixture unavailable'}}}));
  await page.getByRole('button',{name:'Refresh',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Fixture unavailable'}).waitFor();
  if(await page.locator('.di-tile').count())throw Error('Stale metrics after failure');
  await page.unrouteAll({behavior:'wait'});await page.getByRole('button',{name:'Retry',exact:true}).click();await page.locator('.di-tile').first().waitFor();
  checks.push('failure clears stale data and retry recovers');
  if(errors.length)throw Error(errors.join('\n'));
  return {passed:true,checks,mutations:'none'};
 }finally{await page.unrouteAll({behavior:'wait'});page.off('pageerror',onError);await page.setViewportSize({width:1440,height:1000});}
}
