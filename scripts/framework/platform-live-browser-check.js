// Live read-only smoke test for every navigation route and available detail type.
// No fixtures, writes, provider tests or external actions. Run on the local app.
async page => {
 const origin='http://127.0.0.1:8080',results=[],errors=[],httpErrors=[];
 const batch=Number(new URL(page.url()).searchParams.get('reviewBatch')||0);
 let routes=['/','/detect/rules','/detect/intelligence','/detect/coverage','/detect/routing','/investigations','/respond','/respond/cases','/respond/remediation-actions','/respond/actions','/respond/approvals','/respond/workflows','/respond/runbooks','/respond/activity','/hunt/threat-hunting','/hunt/threat-intelligence','/threat-intel','/skills','/skills/templates','/skills/suggestions','/skills/outcomes','/memory','/build','/build/api-sources','/build/stream-operations','/build/connectors/cribl','/skills/new'];
 const detailSources=[['/investigations','/investigations/'],['/detection-rules','/detect/rules/'],['/hunts','/hunt/threat-hunting/'],['/threat-intel-reports','/threat-intel/'],['/skills','/skills/']];
 for(const [api,prefix] of detailSources){const r=await page.request.get(origin+'/api/v1'+api+'?limit=1');if(r.status()!==200)throw Error(api+' status '+r.status());const b=await r.json();if(b.items?.[0])routes.push(prefix+encodeURIComponent(b.items[0].id));}
 const routeCount=routes.length;routes=routes.slice(batch*8,batch*8+8);
 const onError=e=>errors.push({path:new URL(page.url()).pathname,error:e.message});
 const onResponse=r=>{if(r.url().includes('/api/v1/')&&r.status()>=400)httpErrors.push({page:new URL(page.url()).pathname,path:new URL(r.url()).pathname,status:r.status()});};
 page.on('pageerror',onError);page.on('response',onResponse);
 try{
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000});
   for(const path of routes){
    await page.goto(origin+path);await page.waitForLoadState('networkidle',{timeout:15000});
    const body=await page.locator('body').innerText();
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
    const failed=/Internal server error|Something went wrong|Refresh to retry/i.test(body);
    results.push({path,width,overflow,failed,headings:await page.getByRole('heading').allTextContents()});
   }
  }
  return {passed:!errors.length&&!httpErrors.length&&!results.some(r=>r.overflow||r.failed),batch,routeCount,checkedRoutes:routes.length,checks:results.length,errors,httpErrors,results};
 }finally{page.off('pageerror',onError);page.off('response',onResponse);await page.setViewportSize({width:1440,height:1000});await page.goto(origin+'/');}
}
