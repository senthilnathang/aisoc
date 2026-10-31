// Local breadcrumb checks; rename writes are intercepted. Labels are text, never markup.
async page => {
 const origin=new URL(page.url()).origin;
 if(!['http://127.0.0.1:8080','http://127.0.0.1:8084'].includes(origin))throw Error('Local only');
 const errors=[];const error=e=>errors.push(e.message);page.on('pageerror',error);
 const nav=page.getByRole('navigation',{name:'Breadcrumb',exact:true});
 let release;const checks=[];
 try {
  for(const width of [1440,375]) {
   await page.setViewportSize({width,height:1000});await page.goto(origin+'/');await nav.getByText('Overview',{exact:true}).waitFor();
   await page.goto(origin+'/detect/rules/mock-stream-login');await nav.getByText('mock-stream-login',{exact:true}).waitFor();
   if(await nav.locator('[aria-current=page]').count()!==1)throw Error('Current crumb semantics');
   await nav.getByRole('link',{name:'Rule registry',exact:true}).click();
   await page.waitForURL(origin+'/detect/rules');await nav.getByText('Rule registry',{exact:true}).waitFor();
   await page.goto(origin+'/skills/new');await nav.getByText('Create skill',{exact:true}).waitFor();
   const box=await nav.boundingBox();if(box.x<0||box.x+box.width>width+1)throw Error('Breadcrumb overflow');checks.push({width,parent_link:true,static:true});
  }
  const endpoint=origin+'/api/v1/navigation/breadcrumb?resource=detection-rules&id=mock-stream-login';
  const actual=await page.request.get(endpoint);if(actual.status()!==200)throw Error('Metadata endpoint unavailable');
  const foreign=await page.request.get(endpoint,{headers:{'X-Tenant-Id':'breadcrumb-foreign-fixture'}});if(foreign.status()!==404)throw Error('Tenant metadata leak');
  const invalid=await page.request.get(origin+'/api/v1/navigation/breadcrumb?resource=unknown&id=x');if(invalid.status()!==400)throw Error('Unknown resource accepted');checks.push('API tenant isolation and validation');
  const rulePath=origin+'/api/v1/detection-rules/mock-stream-login';
  const original=await (await page.request.get(rulePath)).json();let renamed=false;
  await page.route(rulePath,r=>{if(r.request().method()==='PATCH')renamed=true;return r.fulfill({json:{...original,name:renamed?'Renamed fixture':original.name}});});
  await page.route('**/api/v1/navigation/breadcrumb?**',r=>r.fulfill({json:{label:renamed?'Renamed fixture':'mock-stream-login'}}));
  await page.goto(origin+'/detect/rules/mock-stream-login');await nav.getByText('mock-stream-login',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Edit rule',exact:true}).click();await page.getByLabel(/Rule name/).fill('Renamed fixture');
  await page.getByLabel(/^Schedule/).fill('Every 5 minutes');await page.getByLabel(/^Lookback window/).fill('15 minutes');
  await page.getByRole('button',{name:'Save changes',exact:true}).click();await nav.getByText('Renamed fixture',{exact:true}).waitFor();checks.push('rename refresh after mocked save');
  await page.unrouteAll({behavior:'wait'});
  await page.route('**/api/v1/navigation/breadcrumb?**',r=>r.fulfill({json:{resource:'detection-rules',id:'mock-stream-login',label:'<img src=x onerror=alert(1)>'}}));
  await page.goto(origin+'/detect/rules/mock-stream-login');await nav.getByText('<img src=x onerror=alert(1)>',{exact:true}).waitFor();if(await nav.locator('img').count())throw Error('Label rendered HTML');checks.push('escaped label');await page.unrouteAll({behavior:'wait'});
  await page.route('**/api/v1/navigation/breadcrumb?**',r=>r.fulfill({status:404,json:{error:{message:'Resource not found'}}}));
  await page.reload();await page.getByText('Resource name unavailable',{exact:true}).waitFor();if(await nav.getByText('<img src=x onerror=alert(1)>',{exact:true}).count())throw Error('Stale label retained');checks.push('missing resource fallback');await page.unrouteAll({behavior:'wait'});
  const held=new Promise(resolve=>release=resolve);let started;const pending=new Promise(resolve=>started=resolve);
  await page.route('**/api/v1/navigation/breadcrumb?**',async r=>{started();await held;try{await r.fulfill({json:{label:'STALE NAME'}});}catch{/* Request may already be aborted by navigation. */}});
  await page.goto(origin+'/detect/rules/mock-stream-login');await pending;await nav.getByRole('link',{name:'Rule registry',exact:true}).click();release();
  await page.waitForURL(origin+'/detect/rules');await page.waitForTimeout(200);if(await nav.getByText('STALE NAME',{exact:true}).count())throw Error('Late label replaced parent');checks.push('late result ignored');
  if(errors.length)throw Error(errors.join('\n'));
  return {passed:true,checks,mutations:'rename intercepted; no database writes'};
 } finally {release?.();await page.unrouteAll({behavior:'wait'});page.off('pageerror',error);await page.setViewportSize({width:1440,height:1000});}
}
