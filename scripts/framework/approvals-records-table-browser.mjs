// Read-only real API checks and intercepted approval inbox fixtures; no domain mutations.
import {chromium} from '../../frontend/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
const origin='http://localhost:8080',out='output/playwright/approvals-records-table';mkdirSync(out,{recursive:true});
// CHROME_PATH overrides Playwright's bundled Chromium; unset uses the bundled browser.
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||undefined,headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(30000);page.setDefaultNavigationTimeout(60000);
const errors=[];page.on('pageerror',e=>errors.push(e.message));const report={passed:false,mode:'local/mock',mutations:false,checks:[]};
try{
 // Real read-only API: filtered totals must be integers and tenant-scoped.
 for(const tenant of ['demo','table-test-foreign']){const r=await page.request.get(origin+'/api/v1/approvals?limit=25&offset=0',{headers:{'X-Tenant-Id':tenant}});assert.equal(r.status(),200);const d=await r.json();assert(Number.isInteger(d.total));assert(Array.isArray(d.items));if(tenant!=='demo')assert.equal(d.total,0);}
 report.checks.push('real totals and tenant isolation');
 const rows=Array.from({length:57},(_,i)=>({kind:'respond',id:'APR-'+String(i+1).padStart(3,'0'),title:'Proposal '+String(i+1).padStart(3,'0'),stage:'review',source_changed:false,assignment:null,expires_at:'2030-01-01T00:00:00Z',document:{version:1,case_id:'INV-'+(i+1),connector_id:'fixture',source:'fixture',created_by:'Analyst'}}));
 let mode='normal';const requests=[],writes=[];
 await page.route('**/api/v1/**',async route=>{const request=route.request();const u=new URL(request.url());if(u.pathname!=='/api/v1/approvals')return route.continue();if(request.method()!=='GET'){writes.push(request.method()+' '+u.pathname);return route.fulfill({status:405,json:{error:{message:'Fixture blocks writes'}}});}requests.push(Object.fromEntries(u.searchParams));if(mode==='error')return route.fulfill({status:503,json:{error:{message:'Fixture approvals unavailable'}}});if(mode==='delay')await new Promise(r=>setTimeout(r,800));const data=mode==='shrink'?rows.slice(0,10):mode==='empty'?[]:rows;const o=Number(u.searchParams.get('offset')),n=Number(u.searchParams.get('limit'));return route.fulfill({json:{as_of:'2026-11-02T00:00:00Z',counts:{review:data.length,execution:0},items:data.slice(o,o+n),total:data.length}});});
 await page.goto(origin+'/respond/inbox');
 const nav=page.getByRole('navigation',{name:'Approval inbox pagination'}),show=async t=>nav.getByText(t,{exact:true}).waitFor();
 const region=page.getByRole('region',{name:'Approval inbox table',exact:true});
 // Paging, page sizes limited to the API maximum of 50, and first/last/previous/next.
 await show('Showing 1–25 of 57 proposals');assert.equal(await region.locator('tbody tr').count(),25);
 assert.deepEqual(await page.getByLabel('Proposals per page').locator('option').evaluateAll(opts=>opts.map(o=>o.value)),['10','25','50']);
 await nav.getByRole('button',{name:'Next',exact:true}).click();await show('Showing 26–50 of 57 proposals');
 await nav.getByRole('button',{name:'Last',exact:true}).click();await show('Showing 51–57 of 57 proposals');assert(await nav.getByRole('button',{name:'Next',exact:true}).isDisabled());
 await nav.getByRole('button',{name:'Previous',exact:true}).click();await show('Showing 26–50 of 57 proposals');
 await nav.getByRole('button',{name:'First',exact:true}).click();await show('Showing 1–25 of 57 proposals');
 await page.getByLabel('Proposals per page').selectOption('10');await show('Showing 1–10 of 57 proposals');assert.equal(await region.locator('tbody tr').count(),10);assert.equal(requests.at(-1).limit,'10');assert.equal(requests.at(-1).offset,'0');
 report.checks.push('paging, first/last/previous/next and page-size choices capped at the API maximum');
 // Preview opens the saved-revision panel without a write.
 await region.locator('tbody tr').first().getByRole('button',{name:'Preview Proposal 001',exact:true}).click();await page.getByLabel('Approval preview').waitFor();await page.getByRole('heading',{name:'Proposal 001',exact:true}).waitFor();
 report.checks.push('preview opens without writes');
 // Loading, error and retry; the retry finds the list shrunk, so the stale offset recovers to the first page.
 await nav.getByRole('button',{name:'Last',exact:true}).click();await show('Showing 51–57 of 57 proposals');
 mode='delay';await nav.getByRole('button',{name:'First',exact:true}).click();await page.getByText('Loading pending reviews…',{exact:true}).waitFor();await show('Showing 1–10 of 57 proposals');
 await nav.getByRole('button',{name:'Last',exact:true}).click();await show('Showing 51–57 of 57 proposals');mode='normal';
 mode='error';await nav.getByRole('button',{name:'Previous',exact:true}).click();await page.getByRole('alert').filter({hasText:'Fixture approvals unavailable'}).waitFor();assert(await nav.getByRole('button',{name:'Next',exact:true}).isDisabled());
 mode='shrink';await page.getByRole('button',{name:'Retry',exact:true}).click();await show('Showing 1–10 of 10 proposals');assert.equal(requests.at(-1).offset,'0');
 report.checks.push('loading, error, retry and out-of-range recovery');
 // Empty result: the shared empty state explains it.
 mode='empty';await page.reload();await page.getByRole('status').filter({hasText:'No pending proposals match these filters.'}).waitFor();await show('0 proposals');
 report.checks.push('empty state');
 // Keyboard access and responsive layout with the full list.
 mode='normal';await page.reload();await show('Showing 1–25 of 57 proposals');
 for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.getByLabel('Proposals per page').selectOption('10');await show('Showing 1–10 of 57 proposals');const scroll=page.getByRole('region',{name:'Approval inbox table',exact:true});await scroll.focus();assert(await scroll.evaluate(el=>el===document.activeElement));assert(!(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)));await scroll.evaluate(el=>el.blur());await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:`${out}/approvals-${width}.png`,fullPage:true});}
 report.checks.push('keyboard scroll region and desktop/mobile layout');
 assert.deepEqual(writes,[]);report.writesAttempted=writes;
 assert.deepEqual(errors,[]);report.passed=true;console.log('PASS Approval inbox records table: '+out+'/report.json');
}catch(e){report.error=e.stack;await page.screenshot({path:out+'/failure.png',fullPage:true,timeout:5000}).catch(()=>{});throw e;}finally{writeFileSync(out+'/report.json',JSON.stringify(report,null,2));await browser.close();}
