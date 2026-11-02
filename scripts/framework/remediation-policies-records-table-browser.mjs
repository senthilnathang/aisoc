// Read-only real API checks and intercepted remediation policy fixtures; no domain mutations.
import {chromium} from '../../frontend/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
const origin='http://localhost:8080',out='output/playwright/remediation-policies-records-table';mkdirSync(out,{recursive:true});
// CHROME_PATH overrides Playwright's bundled Chromium; unset uses the bundled browser.
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||undefined,headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(30000);page.setDefaultNavigationTimeout(60000);
const errors=[];page.on('pageerror',e=>errors.push(e.message));const report={passed:false,mode:'local/mock',mutations:false,checks:[]};
try{
 // Real read-only API: the saved library and policy configs must load for the demo tenant and stay tenant-scoped.
 for(const tenant of ['demo','table-test-foreign']){const plans=await page.request.get(origin+'/api/v1/response-plans',{headers:{'X-Tenant-Id':tenant}});assert.equal(plans.status(),200);const p=await plans.json();assert(Array.isArray(p.items));const cfg=await page.request.get(origin+'/api/v1/response-workflow-policies',{headers:{'X-Tenant-Id':tenant}});assert.equal(cfg.status(),200);assert(Array.isArray((await cfg.json()).items));if(tenant!=='demo')assert.equal(p.items.length,0);}
 report.checks.push('real library and policy reads, tenant isolation');
 const plans=Array.from({length:57},(_,i)=>({id:'wf-'+String(i+1).padStart(3,'0'),kind:'workflow',title:'Workflow '+String(i+1).padStart(3,'0'),description:'Fixture workflow '+(i+1),state:'active',version:1}));
 let mode='normal';const requests=[],writes=[];
 await page.route('**/api/v1/**',async route=>{const request=route.request();const u=new URL(request.url());if(request.method()!=='GET'&&/\/response-plans\//.test(u.pathname)){writes.push(request.method()+' '+u.pathname);return route.fulfill({status:405,json:{error:{message:'Fixture blocks writes'}}});}
  if(u.pathname==='/api/v1/response-workflow-policies'&&request.method()==='GET')return route.fulfill({json:{items:[]}});
  if(u.pathname!=='/api/v1/response-plans')return route.continue();if(request.method()!=='GET'){writes.push(request.method()+' '+u.pathname);return route.fulfill({status:405,json:{error:{message:'Fixture blocks writes'}}});}
  requests.push(Object.fromEntries(u.searchParams));if(mode==='error')return route.fulfill({status:503,json:{error:{message:'Fixture plans unavailable'}}});if(mode==='delay')await new Promise(r=>setTimeout(r,800));const data=mode==='shrink'?plans.slice(0,10):mode==='empty'?[]:plans;return route.fulfill({json:{items:data}});});
 await page.goto(origin+'/respond/remediation-actions');
 const nav=page.getByRole('navigation',{name:'Remediation policies pagination'}),show=async t=>nav.getByText(t,{exact:true}).waitFor();
 const region=page.getByRole('region',{name:'Remediation policies table',exact:true});
 // Paging, page sizes, first/last/previous/next and local slicing of the saved library.
 await show('Showing 1–25 of 57 workflows');assert.equal(await region.locator('tbody tr').count(),25);
 await nav.getByRole('button',{name:'Next',exact:true}).click();await show('Showing 26–50 of 57 workflows');
 await nav.getByRole('button',{name:'Last',exact:true}).click();await show('Showing 51–57 of 57 workflows');assert(await nav.getByRole('button',{name:'Next',exact:true}).isDisabled());
 await nav.getByRole('button',{name:'Previous',exact:true}).click();await show('Showing 26–50 of 57 workflows');
 await nav.getByRole('button',{name:'First',exact:true}).click();await show('Showing 1–25 of 57 workflows');
 await page.getByLabel('Workflows per page').selectOption('10');await show('Showing 1–10 of 57 workflows');assert.equal(await region.locator('tbody tr').count(),10);
 report.checks.push('paging, first/last/previous/next and page-size changes');
 // Search filters the library locally and resets to the first page.
 await nav.getByRole('button',{name:'Last',exact:true}).click();await show('Showing 51–57 of 57 workflows');
 await page.getByLabel('Search remediation policies').fill('Workflow 05');await show('Showing 1–8 of 8 workflows');assert.equal(await region.locator('tbody tr').count(),8);
 await page.getByLabel('Search remediation policies').fill('');await show('Showing 1–10 of 57 workflows');
 report.checks.push('local search filters the library and resets paging');
 // Loading state while the library is in flight.
 mode='delay';await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.getByText('Loading remediation policies…',{exact:true}).waitFor();await show('Showing 1–10 of 57 workflows');mode='normal';
 // Error on refresh keeps the table visible; retry after the library shrinks recovers an out-of-range page.
 await nav.getByRole('button',{name:'Last',exact:true}).click();await show('Showing 51–57 of 57 workflows');
 mode='error';await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.getByRole('alert').filter({hasText:'Fixture plans unavailable'}).waitFor();
 mode='shrink';await page.getByRole('button',{name:'Refresh',exact:true}).click();await show('Showing 1–10 of 10 workflows');assert.equal(await region.locator('tbody tr').count(),10);
 report.checks.push('loading, error, refresh and out-of-range recovery');
 // Empty library: the shared empty state explains it.
 mode='empty';await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.getByRole('status').filter({hasText:'No matching workflows.'}).waitFor();await show('0 workflows');
 report.checks.push('empty state');
 // Keyboard access and responsive layout with the full library.
 mode='normal';await page.reload();await show('Showing 1–25 of 57 workflows');
 for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.getByLabel('Workflows per page').selectOption('10');await show('Showing 1–10 of 57 workflows');const scroll=page.getByRole('region',{name:'Remediation policies table',exact:true});await scroll.focus();assert(await scroll.evaluate(el=>el===document.activeElement));assert(!(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)));await scroll.evaluate(el=>el.blur());await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:`${out}/remediation-policies-${width}.png`,fullPage:true});}
 report.checks.push('keyboard scroll region and desktop/mobile layout');
 assert.deepEqual(writes,[]);report.writesAttempted=writes;
 assert.deepEqual(errors,[]);report.passed=true;console.log('PASS Remediation policies records table: '+out+'/report.json');
}catch(e){report.error=e.stack;await page.screenshot({path:out+'/failure.png',fullPage:true,timeout:5000}).catch(()=>{});throw e;}finally{writeFileSync(out+'/report.json',JSON.stringify(report,null,2));await browser.close();}
