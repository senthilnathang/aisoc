// Run with the Playwright tool on the local production preview (8084).
// Mutations are intercepted. Timings measure browser interaction, not backend EPS.
async page => {
  const origin = new URL(page.url()).origin;
  if (!['http://127.0.0.1:8084','http://127.0.0.1:8080'].includes(origin)) throw Error('Local preview required');
  const errors = [], checks = [], timings = [];
  const error = e => errors.push(e.message);
  const consoleError = m => { if (m.type() === 'error' && !m.text().includes('Failed to load resource')) errors.push(m.text()); };
  page.on('pageerror', error); page.on('console', consoleError);
  const blockWrites = route => route.request().method() === 'GET' ? route.continue() : route.fulfill({status:503,json:{error:{message:'Mock mutation rejected'}}});
  await page.route('**/api/**', blockWrites);
  const navigate = async path => { await page.goto(origin+path); await page.getByRole('status').filter({hasText:'Checking workspace'}).waitFor({state:'hidden'}); };
  try {
    for (const width of [1440,375]) {
      await page.setViewportSize({width,height:1000}); await navigate('/investigations');
      const trigger = page.getByRole('button',{name:'Submit alert',exact:true});
      await trigger.waitFor(); await trigger.click();
      const dialog = page.getByRole('dialog'); await dialog.waitFor();
      await page.keyboard.press('Tab');
      if (!await dialog.evaluate(el => el.contains(document.activeElement))) throw Error('Focus escaped dialog');
      await page.keyboard.press('Escape'); await dialog.waitFor({state:'hidden'});
      if (!await trigger.evaluate(el=>el===document.activeElement)) throw Error('Focus not restored');
      checks.push({width,dialog_focus:true});
      const search = page.getByRole('textbox',{name:'Search investigations and alerts'});
      await search.fill('no-matching-migration-fixture'); await page.getByText('No matching records.',{exact:true}).waitFor();
      await search.fill(''); await page.getByRole('button',{name:'Open case',exact:true}).first().waitFor();
      checks.push({width,filter:true});
      await page.screenshot({path:`output/react19/queue-${width}.png`,fullPage:true});
    }
    await page.setViewportSize({width:1440,height:1000});
    // Freeze the queue GET responses for comparable rendering samples.
    const cache = new Map();
    const freeze = async route => {
      const url=route.request().url();
      if (!cache.has(url)) { const response=await route.fetch(); cache.set(url,{status:response.status(),body:await response.text(),contentType:'application/json'}); }
      await route.fulfill(cache.get(url));
    };
    await page.route('**/api/v1/investigation-queue**',freeze);
    await navigate('/investigations');
    const search=page.getByRole('textbox',{name:'Search investigations and alerts'});
    await page.getByRole('button',{name:'Open case',exact:true}).first().waitFor();
    await page.evaluate(()=>{ if(window.__AISOC_REACT_PROFILE__)window.__AISOC_REACT_PROFILE__=[]; });
    for(let i=0;i<35;i++) {
      const start=Date.now(); await search.fill('no-matching-migration-fixture');
      await page.getByText('No matching records.',{exact:true}).waitFor();
      await search.fill(''); await page.getByRole('button',{name:'Open case',exact:true}).first().waitFor();
      if(i>=5)timings.push(Date.now()-start);
    }
    const profile = await page.evaluate(()=>window.__AISOC_REACT_PROFILE__ || []);
    const durations=profile.filter(p=>p.phase!=='mount').map(p=>p.actualDuration).sort((a,b)=>a-b);
    const profiling=durations.length?{commits:durations.length,median_ms:durations[Math.floor(durations.length/2)],p95_ms:durations[Math.floor(durations.length*.95)]}:null;
    await page.unroute('**/api/v1/investigation-queue**',freeze);
    let writes=0;
    await page.route('**/api/v1/alerts',async route=>{
      if(route.request().method()==='GET')return route.fallback();
      writes++; await new Promise(resolve=>setTimeout(resolve,400));
      await route.fulfill({status:503,json:{error:{message:'Mock mutation rejected'}}});
    });
    await page.getByRole('button',{name:'Submit alert',exact:true}).click();
    await page.getByLabel(/Alert title/).fill('Migration fixture');
    const rule = page.getByLabel(/Detection rule/);
    await rule.selectOption(await rule.locator('option[value]').evaluateAll(es=>es.find(e=>e.value)?.value));
    await page.getByRole('button',{name:'Ingest alert',exact:true}).evaluate(el=>{el.click();el.click();});
    await page.getByText('Mock mutation rejected',{exact:true}).waitFor();
    if(writes!==1)throw Error(`Double submission: ${writes} requests`);
    checks.push({single_submit:true});
    await page.keyboard.press('Escape');
    for(const [path,text] of [['/build/api-sources','API Sources'],['/build-operations','Retained telemetry'],['/detect/rules','Detection Rules'],['/detect/intelligence','Detection Intelligence'],['/respond/actions','Actions']]) {
      await navigate(path); await page.getByRole('heading',{name:new RegExp('^'+text+'$','i')}).first().waitFor();
      checks.push({route:path,loaded:true});
    }
    await navigate('/skills/new');
    const skillName=page.getByLabel('Skill name',{exact:true});
    await skillName.pressSequentially('Migration typing');
    if(await skillName.inputValue()!=='Migration typing' || !await skillName.evaluate(el=>el===document.activeElement))throw Error('Skill field remounted while typing');
    checks.push({skill_typing_focus:true});
    await page.route('**/api/v1/auth/session',r=>r.fulfill({json:{mode:'token',authenticated:false}}));
    await navigate('/investigations'); await page.getByRole('heading',{name:'Sign in to your workspace'}).waitFor();
    if(await page.getByRole('button',{name:'Open case',exact:true}).count())throw Error('Session exposes cases');
    await page.getByLabel('Operator access token').fill('mock-invalid');
    await page.getByRole('button',{name:'Sign in',exact:true}).click();
    await page.getByText('Mock mutation rejected',{exact:true}).waitFor();
    checks.push({unauthenticated_hidden:true,login_error:true});
    if(errors.length)throw Error(errors.join('\n'));
    timings.sort((a,b)=>a-b);
    return {passed:true,checks,interaction:{samples:30,warmups:5,median_ms:timings[15],p95_ms:timings[28]},profiling,errors,mutations:'intercepted'};
  } finally {
    await page.unrouteAll({behavior:'wait'}); page.off('pageerror',error);page.off('console',consoleError);
  }
}
