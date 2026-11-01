// Read-only against the running local frontend/Go API. No provider or database writes.
// Run in batches via ?uiBatch=0..3; screenshots and reports stay in output/playwright.
async page => {
 const origin='http://127.0.0.1:8080';
 const batch=Number(new URL(page.url()).searchParams.get('uiBatch')||0);
 const routes=['/','/detect/rules','/detect/intelligence','/detect/coverage','/detect/routing','/investigations','/respond','/respond/cases','/respond/remediation-actions','/respond/actions','/respond/approvals','/respond/workflows','/respond/runbooks','/respond/activity','/hunt/threat-hunting','/hunt/threat-intelligence','/threat-intel','/skills','/skills/templates','/skills/suggestions','/skills/outcomes','/memory','/build','/build/integrations','/build/api-sources','/build/stream-operations','/build/connectors/cribl','/skills/new'];
 const results=[],errors=[],httpErrors=[];
 const onError=e=>errors.push(e.message);
 const onResponse=r=>{if(r.url().includes('/api/v1/')&&r.status()>=400)httpErrors.push({url:r.url(),status:r.status()});};
 page.on('pageerror',onError);page.on('response',onResponse);
 try {
  for(const width of [1440,768,390])for(const path of routes.slice(batch*7,batch*7+7)){
   await page.setViewportSize({width,height:1000});await page.goto(origin+path);await page.waitForLoadState('networkidle');
   const state=await page.evaluate(()=>{
    const main=document.querySelector('main');const header=main?.querySelector('.workspace-header');const h1=main?.querySelector('h1');
    const bar=document.querySelector('.section-subnav');const selected=bar?.querySelector('[aria-current="page"]');const rect=selected?.getBoundingClientRect();
    return {mainCount:document.querySelectorAll('main').length,h1Count:main?.querySelectorAll('h1').length,titleSize:h1?getComputedStyle(h1).fontSize:null,header:!!header,overflow:document.documentElement.scrollWidth>innerWidth,selectedVisible:!!rect&&rect.left>=0&&rect.right<=innerWidth,title:document.title,failed:/Internal server error|Refresh to retry|Something went wrong/i.test(main?.innerText||'')};
   });
   results.push({path,width,...state});
   if(width!==768)await page.screenshot({path:`/opt/aisoc/output/playwright/ui-${path.replaceAll('/','_')||'home'}-${width}.png`,fullPage:true});
  }
  return {passed:!errors.length&&!httpErrors.length&&results.every(x=>x.mainCount===1&&x.h1Count===1&&x.header&&x.titleSize===(x.width<768?"24px":"28px")&&!x.overflow&&!x.failed&&x.selectedVisible),batch,checks:results.length,errors,httpErrors,results};
 }finally{page.off('pageerror',onError);page.off('response',onResponse);}
}
