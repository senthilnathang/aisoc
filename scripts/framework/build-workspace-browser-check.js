// Read-only catalog fixtures; no database writes.
async page => {
 const origin='http://localhost:8080',ensure=(ok,msg)=>{if(!ok)throw Error(msg)};
 const asset={id:'SK-fixture',kind:'skill',name:'Identity investigation guide',description:'Review identity evidence',state:'published',updated_at:'2026-11-01T00:00:00Z',details:{version:2,enabled:true,modules:['investigations'],origin:'user'}};
 let fail=false,empty=false,requests=[],slow=false,release;
 const handler=async route=>{
  const u=new URL(route.request().url());if(u.pathname!='/api/v1/build/catalog')return route.continue();
  requests.push(u.searchParams.toString());ensure(route.request().method()==='GET','Catalog wrote state');
  const kind=u.searchParams.get('kind');let items=kind==='connector'?[{...asset,id:'other',kind:'connector',name:'Saved Cribl connector',details:{provider:'cribl'}}]:[asset];
  if(u.searchParams.get('offset')==='25')items=[{...asset,name:'Next page guide'}];
  if(empty||u.searchParams.get('search')==='missing')items=[];
  if(slow&&u.searchParams.get('search')==='slow')await new Promise(r=>release=r);
  return route.fulfill({status:fail?503:200,contentType:'application/json',body:JSON.stringify(fail?{error:{message:'Catalog unavailable'}}:{items,total:items.length?27:0,counts:{skill:26,connector:1}})});
 };
 await page.route('**/api/v1/**',handler);
 const checks=[];
 try{
  await page.setViewportSize({width:1440,height:1000});await page.goto(origin+'/build');
  await page.getByRole('button',{name:asset.name,exact:true}).waitFor();
  await page.getByText('27 matching assets',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Next',exact:true}).click();await page.getByRole('button',{name:'Next page guide',exact:true}).waitFor();
  await page.getByRole('button',{name:'Previous',exact:true}).click();await page.getByRole('button',{name:asset.name,exact:true}).click();await page.getByRole('dialog').waitFor();await page.getByText('investigations',{exact:true}).waitFor();
  await page.screenshot({path:'/opt/aisoc/output/playwright/build-inspector.png',fullPage:true});await page.getByRole('button',{name:'Close',exact:true}).click();checks.push('server pagination and metadata inspector');
  await page.getByRole('button',{name:'Connectors 1',exact:true}).click();await page.getByRole('button',{name:'Inspect',exact:true}).click();await page.getByText('Provider-specific editing is not available in this workspace.',{exact:true}).waitFor();await page.getByRole('button',{name:'Close',exact:true}).click();checks.push('saved Cribl connector stays read-only');
  await page.getByRole('button',{name:'All assets',exact:true}).click();
  await page.getByLabel('Search Build assets').fill('missing');await page.getByText('No assets match this view',{exact:true}).waitFor();await page.getByLabel('Search Build assets').fill('');await page.getByRole('button',{name:asset.name,exact:true}).waitFor();checks.push('search and empty state');
  slow=true;await page.getByLabel('Search Build assets').fill('slow');while(!release)await new Promise(r=>setTimeout(r,10));await page.getByLabel('Search Build assets').fill('missing');await page.getByText('No assets match this view',{exact:true}).waitFor();release();await page.waitForTimeout(150);ensure(await page.getByText('No assets match this view',{exact:true}).isVisible(),'stale request overwrote results');slow=false;checks.push('stale response ignored');
  await page.getByLabel('Search Build assets').fill('');await page.getByRole('button',{name:asset.name,exact:true}).waitFor();
  for(const width of [1440,390]){await page.setViewportSize({width,height:1000});ensure(!await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),'horizontal overflow '+width);await page.screenshot({path:'/opt/aisoc/output/playwright/build-'+width+'.png',fullPage:true});}checks.push('desktop/mobile layout');
  fail=true;await page.getByRole('button',{name:'Refresh catalog',exact:true}).click();await page.getByRole('alert').filter({hasText:'Catalog unavailable'}).waitFor();ensure(await page.getByText('No assets match this view',{exact:true}).count()===0,'error shown as empty');fail=false;await page.getByRole('button',{name:'Retry',exact:true}).click();await page.getByRole('button',{name:asset.name,exact:true}).waitFor();checks.push('error and retry');
  await page.getByRole('button',{name:'Manage local integrations',exact:true}).click();ensure(new URL(page.url()).pathname==='/build/integrations','wrong local integration manager');checks.push('existing manager navigation');
  return {passed:true,checks,requests:requests.length};
 } finally {release?.();await page.unroute('**/api/v1/**',handler);await page.setViewportSize({width:1440,height:1000});await page.goto(origin+'/build');}
}
