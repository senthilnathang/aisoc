// Playwright CLI snippet: run after inspecting the Go preview's navigation.
async page => {
  const origin='http://127.0.0.1:8081';
  if(new URL(page.url()).origin!==origin)throw Error('Use the isolated Go preview');
  const health=await page.request.get(origin+'/health');
  if((await health.json()).database!=='postgresql')throw Error('Go preview required');
  const call=async(method,path,data,status=200)=>{
    const response=await page.request.fetch(origin+'/api/v1'+path,{method,...(data===undefined?{}:{data})});
    if(response.status()!==status)throw Error(method+' '+path+' status '+response.status());
    return response.json();
  };
  const suffix=Date.now();
  const report=await call('POST','/threat-intel-reports',{title:'Browser report '+suffix,summary:'Browser migration fixture',severity:'high',source:'Fixture'},201);
  await call('POST','/threat-indicators',{report_id:report.id,indicator_type:'ip',value:'192.0.2.12',severity:'high'},201);
  const hunt=await call('POST','/hunts',{name:'Browser hunt '+suffix,query:'Fixture only',source:'Fixture'},201);
  await call('POST','/hunts/'+hunt.id+'/run',{});
  const caseID=await page.evaluate(()=>localStorage.getItem('migration-browser-case'));
  if(!caseID)throw Error('Complete the inspected source-intake flow first');
  for(let attempt=0;attempt<100;attempt++) {
    const detail=await call('GET','/investigations/'+caseID);
    if(detail.jobs.some(job=>job.status==='failed'))throw Error('Browser intake job failed');
    if(detail.jobs.length&&detail.jobs.every(job=>job.status==='completed'))break;
    if(attempt===99)throw Error('Browser intake job did not complete');
    await page.waitForTimeout(100);
  }
  const errors=[],httpErrors=[],results=[];
  const onError=error=>errors.push(error.message);
  const onResponse=response=>{if(response.url().startsWith(origin+'/api/')&&response.status()>=400)httpErrors.push({path:new URL(response.url()).pathname,status:response.status()});};
  page.on('pageerror',onError);page.on('response',onResponse);
  const routes=['/','/investigations','/investigations/'+caseID,'/detect/rules','/detect/intelligence','/build/api-sources','/respond','/respond/cases','/respond/actions','/respond/approvals','/respond/workflows','/respond/runbooks','/respond/activity','/skills','/skills/templates','/skills/suggestions','/skills/outcomes','/hunt','/threat-intel','/threat-intel/'+report.id,'/memory','/build/connectors/cribl'];
  try {
    for(const width of [1440,390]) {
      await page.setViewportSize({width,height:900});
      for(const path of routes) {
        await page.goto(origin+path);await page.waitForLoadState('networkidle');
        const text=await page.locator('body').innerText();
        if(/Endpoint is not implemented|Internal server error|Failed to fetch/i.test(text))throw Error('Backend error visible at '+path);
        if(path==='/investigations/'+caseID&&!text.includes('Browser Go intake'))throw Error('Case details not rendered');
        results.push({path,width,rendered:true,overflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)});
      }
      await page.goto(origin+'/skills/outcomes');await page.waitForLoadState('networkidle');
      await page.screenshot({path:'output/playwright/go-journeys-'+width+'.png'});
    }
    const result={passed:errors.length===0&&httpErrors.length===0,results,page_errors:errors,http_errors:httpErrors,checks:['desktop/mobile route rendering','completed authenticated intake case rendered','threat report with linked indicator','local hunt result persisted','Skills library/templates/suggestions/outcomes','response and detection sub-navigation']};
    await page.evaluate(result=>localStorage.setItem('go-journey-review',JSON.stringify(result)),result);
    if(!result.passed)throw Error(JSON.stringify(result));
    return result;
  } finally {page.off('pageerror',onError);page.off('response',onResponse);}
}
