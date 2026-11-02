// Read-only real API checks and intercepted API source fixtures; no domain mutations.
import {chromium} from '../../frontend/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
const origin='http://localhost:8080',out='output/playwright/api-sources-records-table';mkdirSync(out,{recursive:true});
// CHROME_PATH overrides Playwright's bundled Chromium; unset uses the bundled browser.
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||undefined,headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(30000);page.setDefaultNavigationTimeout(60000);
const errors=[];page.on('pageerror',e=>errors.push(e.message));const report={passed:false,mode:'local/mock',mutations:false,checks:[]};
try{
 // Real read-only API: filtered totals must be integers and tenant-scoped.
 for(const tenant of ['demo','table-test-foreign']){const r=await page.request.get(origin+'/api/v1/api-sources?limit=25&offset=0',{headers:{'X-Tenant-Id':tenant}});assert.equal(r.status(),200);const d=await r.json();assert(Number.isInteger(d.total));assert(Array.isArray(d.items));if(tenant!=='demo')assert.equal(d.total,0);}
 report.checks.push('real totals and tenant isolation');
 const rows=Array.from({length:57},(_,i)=>({id:'src-'+String(i+1).padStart(3,'0'),name:'Source '+String(i+1).padStart(3,'0'),provider:'custom',rule_id:'rule-fixture',status:'active',mapping:{fields:{}},expires_at:'2027-01-01T00:00:00Z'}));
 let mode='normal';const requests=[],writes=[];
 await page.route('**/api/v1/**',async route=>{const request=route.request();const u=new URL(request.url());if(u.pathname!=='/api/v1/api-sources')return route.continue();if(request.method()!=='GET'){writes.push(request.method()+' '+u.pathname);return route.fulfill({status:405,json:{error:{message:'Fixture blocks writes'}}});}requests.push(Object.fromEntries(u.searchParams));if(mode==='error')return route.fulfill({status:503,json:{error:{message:'Fixture sources unavailable'}}});if(mode==='delay')await new Promise(r=>setTimeout(r,800));const data=mode==='shrink'?rows.slice(0,10):mode==='empty'?[]:rows;const o=Number(u.searchParams.get('offset')),n=Number(u.searchParams.get('limit'));return route.fulfill({json:{items:data.slice(o,o+n),total:data.length}});});
 await page.goto(origin+'/build/api-sources');
 const nav=page.getByRole('navigation',{name:'API sources pagination'}),show=async t=>nav.getByText(t,{exact:true}).waitFor();
 const region=page.getByRole('region',{name:'API sources table',exact:true});
 // Paging, page sizes and first/last/previous/next.
 await show('Showing 1–25 of 57 sources');assert.equal(await region.locator('tbody tr').count(),25);
 await nav.getByRole('button',{name:'Next',exact:true}).click();await show('Showing 26–50 of 57 sources');
 await nav.getByRole('button',{name:'Last',exact:true}).click();await show('Showing 51–57 of 57 sources');assert(await nav.getByRole('button',{name:'Next',exact:true}).isDisabled());
 await nav.getByRole('button',{name:'Previous',exact:true}).click();await show('Showing 26–50 of 57 sources');
 await nav.getByRole('button',{name:'First',exact:true}).click();await show('Showing 1–25 of 57 sources');
 await page.getByLabel('API sources per page').selectOption('10');await show('Showing 1–10 of 57 sources');assert.equal(await region.locator('tbody tr').count(),10);assert.equal(requests.at(-1).limit,'10');assert.equal(requests.at(-1).offset,'0');
 report.checks.push('paging, first/last/previous/next and page-size changes');
 // Row actions open their dialogs without issuing a write.
 await region.locator('tbody tr').first().getByRole('button',{name:'Map events',exact:true}).click();await page.getByRole('heading',{name:'Source 001',exact:true}).waitFor();await page.getByRole('button',{name:'Close',exact:true}).click();
 await region.locator('tbody tr').first().getByRole('button',{name:'Rotate key',exact:true}).click();await page.getByRole('dialog').getByText('Rotate ingestion key?',{exact:true}).waitFor();await page.getByRole('button',{name:'Cancel',exact:true}).click();
 report.checks.push('row actions open mapping and key dialogs without writes');
 // Loading state while a page is in flight; navigation is disabled meanwhile.
 await nav.getByRole('button',{name:'Last',exact:true}).click();await show('Showing 51–57 of 57 sources');
 mode='delay';await nav.getByRole('button',{name:'First',exact:true}).click();await page.getByText('Loading records…',{exact:true}).waitFor();assert(await nav.getByRole('button',{name:'Next',exact:true}).isDisabled());await show('Showing 1–10 of 57 sources');
 await nav.getByRole('button',{name:'Last',exact:true}).click();await show('Showing 51–57 of 57 sources');mode='normal';
 // Error with retry; the retry finds the source count shrunk, so the stale offset recovers to the first page.
 mode='error';await nav.getByRole('button',{name:'Previous',exact:true}).click();await page.getByRole('alert').filter({hasText:'Fixture sources unavailable'}).waitFor();assert(await nav.getByRole('button',{name:'Next',exact:true}).isDisabled());
 mode='shrink';await page.getByRole('button',{name:'Retry',exact:true}).click();await show('Showing 1–10 of 10 sources');assert.equal(await region.locator('tbody tr').count(),10);assert.equal(requests.at(-1).offset,'0');
 report.checks.push('loading, error, retry and out-of-range recovery');
 // Empty source list: the shared empty state explains it and paging stays at zero.
 mode='empty';await page.reload();await page.getByRole('status').filter({hasText:'No API sources yet'}).waitFor();await show('0 sources');assert(await nav.getByRole('button',{name:'Next',exact:true}).isDisabled());
 report.checks.push('empty state');
 // Keyboard access and responsive layout with the full list.
 mode='normal';await page.reload();await show('Showing 1–25 of 57 sources');
 for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.getByLabel('API sources per page').selectOption('10');await show('Showing 1–10 of 57 sources');const scroll=page.getByRole('region',{name:'API sources table',exact:true});await scroll.focus();assert(await scroll.evaluate(el=>el===document.activeElement));assert(!(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)));await scroll.evaluate(el=>el.blur());await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:`${out}/api-sources-${width}.png`,fullPage:true});}
 report.checks.push('keyboard scroll region and desktop/mobile layout');
 assert.deepEqual(writes,[]);report.writesAttempted=writes;
 assert.deepEqual(errors,[]);report.passed=true;console.log('PASS API sources records table: '+out+'/report.json');
}catch(e){report.error=e.stack;await page.screenshot({path:out+'/failure.png',fullPage:true,timeout:5000}).catch(()=>{});throw e;}finally{writeFileSync(out+'/report.json',JSON.stringify(report,null,2));await browser.close();}
