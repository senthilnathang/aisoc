// Read-only checks against retained local JSON scenario cases.
async page => {
 const origin='http://127.0.0.1:8080';
 const checks=[];const errors=[];const onError=e=>errors.push(e.message);page.on('pageerror',onError);
 try {
  for(const name of ['corroborating','suspicious','missing','conflicting','stale']){
   const state=await (await page.request.get(`${origin}/api/v1/stream-operations/login-context-${name}`)).json();
   if(state.cases?.length!==1)throw Error('Missing unique scenario '+name);
   const id=state.cases[0].investigation_id;
   const endpoint=`${origin}/api/v1/investigations/${id}/l1`;
   const review=await (await page.request.get(endpoint)).json();
   if(review.result_status!=='verified'||review.result.verdict!=='INCONCLUSIVE')throw Error('Unverified context result');
   for(const width of [1440,375]){
    await page.setViewportSize({width,height:1000});await page.goto(`${origin}/investigations/${id}`);
    const region=page.getByRole('region',{name:'L1 investigation review',exact:true});
    await region.getByRole('heading',{name:'inconclusive',exact:true}).waitFor();
    await region.getByText('Local JSON context · mock-iam',{exact:false}).first().waitFor();
    if(name!=='missing')await region.getByText('Local JSON context · mock-edr',{exact:false}).waitFor();
    if(name==='stale'){
     await region.getByText('Not assessed (stale, unavailable or incomplete context)',{exact:true}).first().waitFor();
     if(review.result.hypotheses.some(h=>h.neutral_refs?.length!==2))throw Error('Stale context used as support');
    }
    if(name==='conflicting')await region.getByText('Conflicting source observations',{exact:true}).waitFor();
    if(name==='missing')await region.getByText('Endpoint process tree',{exact:true}).waitFor();
    if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw Error(`Overflow: ${name} at ${width}`);
    if(name==='suspicious'||name==='stale')await page.screenshot({path:`output/playwright/login-context-${name}-${width}.png`,fullPage:true});
    checks.push({scenario:name,width,passed:true});
   }
  }
  if(errors.length)throw Error(errors.join('\n'));
  return {passed:true,checks,mutations:false};
 } finally{page.off('pageerror',onError);await page.setViewportSize({width:1440,height:1000})}
}
