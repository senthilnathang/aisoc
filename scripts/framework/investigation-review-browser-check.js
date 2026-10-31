// Run through the Playwright browser tool against the local foundation.
// Only GET requests and browser-local response fixtures; no case mutations.
async page => {
  const origin='http://127.0.0.1:8080';
  if(new URL(page.url()).origin!==origin)throw Error('Local foundation required');
  const caseURL=page.url().split('#')[0];
  const caseID=decodeURIComponent(new URL(caseURL).pathname.split('/').pop());
  const apiURL=origin+'/api/v1/investigations/'+encodeURIComponent(caseID)+'/l1';
  const response=await page.request.get(apiURL);
  if(response.status()!==200)throw Error('Review API unavailable');
  const actual=await response.json();
  if(actual.mode!=='mock-v1'||actual.result?.verdict!=='INCONCLUSIVE')throw Error('Use a completed mock showcase case');
  const errors=[];const onError=e=>errors.push(e.message);page.on('pageerror',onError);
  const region=page.getByRole('region',{name:'L1 investigation review',exact:true});
  const checks=[];
  try {
    for(const width of [1440,375]) {
      await page.setViewportSize({width,height:1000});await page.goto(caseURL);
      await region.getByRole('heading',{name:'inconclusive',exact:true}).waitFor();
      if(!await region.getByText('Mock inference',{exact:true}).isVisible())throw Error('Mock label missing');
      const box=await region.boundingBox();
      if(box.x<0||box.x+box.width>width+1)throw Error('Review panel overflows viewport');
      const overflow=await region.evaluate(el=>el.scrollWidth>el.clientWidth+1);
      if(overflow)throw Error('Review content overflows panel');
      if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw Error('Case page overflows viewport');
      await region.getByRole('link',{name:actual.evidence[0].reference,exact:true}).first().click();
      if(!page.url().endsWith('#l1-evidence-0'))throw Error('Citation did not navigate');
      await page.goto(caseURL);await region.getByRole('heading',{name:'inconclusive',exact:true}).waitFor();
      await page.screenshot({path:`output/playwright/investigation-review-${width}.png`,fullPage:true});
      checks.push({width,real_data:true,citation:true,no_panel_overflow:true});
    }
    const scenarios=[
      ['queued',{...actual,state:'queued',result:undefined,result_status:'not_available',sync_state:'not_started'},'Awaiting a valid result'],
      ['failed',{...actual,state:'failed',error_code:'ATTEMPTS_EXHAUSTED',result:undefined,result_status:'not_available'},'Worker failed'],
      ['invalid',{...actual,result:undefined,result_status:'invalid'},'Result withheld: Go contract checks failed'],
      ['empty',{state:'not_requested',evidence:[],result_status:'not_available'},'No specialist review has been requested'],
      ['safe-text',{...actual,result:{...actual.result,model_version:'<img src=x onerror=alert(1)>'}},'<img src=x onerror=alert(1)>'],
    ];
    for(const [name,body,text] of scenarios){
      await page.route(apiURL,route=>route.fulfill({json:body}));
      await page.goto(caseURL);await region.getByText(text,{exact:false}).first().waitFor();
      if(await region.locator('img').count())throw Error('Untrusted HTML rendered');
      checks.push({scenario:name,passed:true});await page.unroute(apiURL);
    }
    let calls=0;
    await page.route(apiURL,route=>++calls===1?route.fulfill({json:{...actual,sync_state:'draft'}}):route.fulfill({status:503,json:{error:{message:'Fixture refresh unavailable'}}}));
    await page.goto(caseURL);await region.getByRole('heading',{name:'inconclusive',exact:true}).waitFor();
    await region.getByText('Displayed review may be stale.',{exact:false}).waitFor({timeout:10000});
    if(!await region.getByRole('heading',{name:'inconclusive',exact:true}).isVisible())throw Error('Stale result disappeared');
    checks.push({scenario:'stale refresh warning',passed:true});
    if(errors.length)throw Error(errors.join('\n'));
    return {passed:true,checks,mutations:false};
  } finally {
    await page.unroute(apiURL);page.off('pageerror',onError);
    await page.setViewportSize({width:1440,height:1000});await page.goto(caseURL);
  }
}
