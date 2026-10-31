// Read-only API requests; all mutations intercepted. Run against local preview.
async page => {
  const origin=new URL(page.url()).origin;
  if(!['http://127.0.0.1:8084','http://127.0.0.1:8080'].includes(origin))throw Error('Local only');
  let releaseOld;
  const checks=[],errors=[]; const error=e=>errors.push(e.message);page.on('pageerror',error);
  await page.route('**/api/**',r=>r.request().method()==='GET'?r.continue():r.fulfill({status:503,json:{error:{message:'Mock write failure'}}}));
  try {
    await page.goto(origin+'/build-operations');
    await page.getByRole('heading',{name:'Retained telemetry',exact:true}).waitFor();
    const loaded=page.waitForResponse(r=>r.url().includes('/demo-showcase-01/events?'));
    await page.getByLabel('Source',{exact:true}).selectOption('demo-showcase-01');await loaded;
    const next=page.getByRole('button',{name:'Next 50 events',exact:true});
    await next.waitFor();
    await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(e=>e.textContent==='Next 50 events'&&!e.disabled));
    const first=await page.locator('tbody').last().locator('tr td p').first().innerText();
    const response=page.waitForResponse(r=>r.url().includes('/events?after=')&&!r.url().endsWith('after='));
    await next.click();await response;
    await page.waitForFunction(old=>{const bodies=document.querySelectorAll('tbody');const id=bodies[bodies.length-1]?.querySelector('tr td p')?.textContent;return !!id&&id!==old;},first);
    await page.getByRole('button',{name:'First events',exact:true}).click();
    await page.waitForFunction(old=>{const bodies=document.querySelectorAll('tbody');return bodies[bodies.length-1]?.querySelector('tr td p')?.textContent===old;},first);
    checks.push('telemetry pagination');
    await page.goto(origin+'/detect/rules');await page.getByRole('button',{name:'Create rule',exact:true}).click();
    await page.getByRole('dialog').waitFor();await page.getByRole('dialog').getByLabel(/^Name/).fill('Mock migration rule');
    await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});checks.push('detection form');
    await page.goto(origin+'/build/api-sources');await page.getByRole('button',{name:'Add API source',exact:true}).click();
    await page.getByRole('dialog').getByLabel(/Provider label/).fill('Mock provider');
    await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});checks.push('source form');
    await page.goto(origin+'/respond/actions');
    const open=page.getByRole('button',{name:/Review action|View record|View details/}).first();
    await open.waitFor();await open.click();await page.getByRole('dialog').waitFor();
    await page.keyboard.press('Tab');
    if(!await page.getByRole('dialog').evaluate(el=>el.contains(document.activeElement)))throw Error('Drawer focus escaped');
    await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});
    if(!await open.evaluate(el=>el===document.activeElement))throw Error('Drawer focus not restored');checks.push('response drawer');
    // Out-of-order chart requests: hold the older filter until newer data rendered.
    const base=await (await page.request.get(origin+'/api/v1/detection-intelligence?days=7')).json();
    const held=new Promise(resolve=>releaseOld=resolve);let oldStarted;
    const started=new Promise(resolve=>oldStarted=resolve);
    await page.route('**/api/v1/detection-intelligence?**',async r=>{
      const severity=new URL(r.request().url()).searchParams.get('severity');
      if(severity==='high'){oldStarted();await held;}
      const value=severity==='high'?777777:severity==='low'?888888:base.totals.total_alerts;
      await r.fulfill({json:{...base,totals:{...base.totals,total_alerts:value}}});
    });
    await page.goto(origin+'/detect/intelligence');const severity=page.getByLabel('Severity filter');await severity.waitFor();
    await severity.selectOption('high');await started;await severity.selectOption('low');await page.getByText('888,888',{exact:true}).waitFor();
    releaseOld();await page.waitForTimeout(250);
    if(await page.getByText('777,777',{exact:true}).count())throw Error('Stale chart replaced newer result');checks.push('chart out-of-order requests');
    // Session expiration unmounts the queue and stops its 2-second polling.
    let requests=0;
    const observe=r=>{if(r.url().includes('/investigation-queue'))requests++;};page.on('request',observe);
    await page.goto(origin+'/investigations');await page.getByRole('button',{name:'Open case',exact:true}).first().waitFor();
    await page.evaluate(()=>window.dispatchEvent(new Event('aisoc:unauthenticated')));
    await page.getByRole('heading',{name:'Sign in to your workspace'}).waitFor();const before=requests;
    await page.waitForTimeout(2300);page.off('request',observe);
    if(requests!==before||await page.getByRole('button',{name:'Open case',exact:true}).count())throw Error('Queue survives expired session');checks.push('session unmount and polling cleanup');
    if(errors.length)throw Error(errors.join('\n'));
    return {passed:true,checks,errors};
  } finally {releaseOld?.();await page.unrouteAll({behavior:'wait'});page.off('pageerror',error);}
}
