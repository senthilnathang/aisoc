// Local-only: real read-only API smoke plus intercepted registry pagination fixtures.
import {chromium} from '../../frontend/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
const origin=process.env.AISOC_TABLE_ORIGIN||'http://127.0.0.1:8080';
assert(['http://127.0.0.1:8080','http://localhost:8080'].includes(origin));
const out='output/records-table';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:'/opt/google/chrome/chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(15000);
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const report={passed:false,mode:'local/mock',mutations:false,checks:[]};
try{
 await page.goto(origin+'/detect/rules');
 const nav=page.getByRole('navigation',{name:'Detection rules pagination'});
 await nav.getByText(/^Showing /).waitFor();
 const response=await page.request.get(origin+'/api/v1/detection-registry?limit=25&offset=0&days=30');assert.equal(response.status(),200);
 const actual=await response.json();assert(actual.items.length);
 await page.getByRole('table',{name:'Detection rules',exact:true}).getByRole('button',{name:actual.items[0].name,exact:true}).click();
 await page.getByRole('heading',{name:actual.items[0].name,exact:true}).waitFor();
 await page.getByRole('button',{name:'Close',exact:true}).click();
 report.checks.push('real Go registry and rule inspector');
 const rows=Array.from({length:57},(_,i)=>({...actual.items[0],id:'table-fixture-'+i,name:'Table fixture '+String(i+1).padStart(2,'0')}));
 let mode='normal';const requests=[];
 await page.route('**/api/v1/detection-registry?*',async route=>{
  const p=new URL(route.request().url()).searchParams;requests.push(Object.fromEntries(p));
  if(mode==='error'){await route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:{message:'Fixture registry unavailable'}})});return;}
  if(mode==='delay')await new Promise(r=>setTimeout(r,700));
  const limit=Number(p.get('limit')||25),offset=Number(p.get('offset')||0);
  const matching=mode==='empty'?[]:rows.filter(r=>r.name.toLowerCase().includes((p.get('search')||'').toLowerCase()));
  await route.fulfill({contentType:'application/json',body:JSON.stringify({...actual,items:matching.slice(offset,offset+limit),total:matching.length,limit,offset})});
 });
 await page.goto(origin+'/detect/rules');await nav.getByText('Showing 1–25 of 57 Detection Rules',{exact:true}).waitFor();
 assert(await nav.getByRole('button',{name:'First',exact:true}).isDisabled());
 await nav.getByRole('button',{name:'Next',exact:true}).click();await nav.getByText('Showing 26–50 of 57 Detection Rules',{exact:true}).waitFor();assert.equal(new URL(page.url()).searchParams.get('offset'),'25');
 await nav.getByRole('button',{name:'Last',exact:true}).click();await nav.getByText('Showing 51–57 of 57 Detection Rules',{exact:true}).waitFor();assert(await nav.getByRole('button',{name:'Next',exact:true}).isDisabled());
 await page.reload();await nav.getByText('Showing 51–57 of 57 Detection Rules',{exact:true}).waitFor();
 await page.goBack();await nav.getByText('Showing 26–50 of 57 Detection Rules',{exact:true}).waitFor();
 await nav.getByRole('button',{name:'Previous',exact:true}).click();await nav.getByText('Showing 1–25 of 57 Detection Rules',{exact:true}).waitFor();
 await page.getByLabel('Rules per page',{exact:true}).selectOption('10');await nav.getByText('Showing 1–10 of 57 Detection Rules',{exact:true}).waitFor();
 await nav.getByRole('button',{name:'Next',exact:true}).click();await nav.getByText('Showing 11–20 of 57 Detection Rules',{exact:true}).waitFor();
 await page.getByLabel('Search detection rules',{exact:true}).fill('Table fixture 57');await nav.getByText('Showing 1–1 of 1 Detection Rules',{exact:true}).waitFor();assert.equal(new URL(page.url()).searchParams.get('offset'),'0');
 report.checks.push('first/previous/next/last, page size, reload/back, filter reset');
 await page.goto(origin+'/detect/rules?limit=7');await nav.getByText('Showing 1–7 of 57 Detection Rules',{exact:true}).waitFor();assert.equal(await page.getByLabel('Rules per page',{exact:true}).inputValue(),'7');
 report.checks.push('custom URL page size');
 mode='empty';await page.goto(origin+'/detect/rules?offset=50');await page.getByRole('heading',{name:'No matching rules',exact:true}).waitFor();assert.equal(new URL(page.url()).searchParams.get('offset'),'0');assert(await nav.getByRole('button',{name:'Next',exact:true}).isDisabled());
 mode='error';await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.getByRole('alert').filter({hasText:'Fixture registry unavailable'}).waitFor();assert(await nav.getByRole('button',{name:'Last',exact:true}).isDisabled());await nav.getByText('Results unavailable',{exact:true}).waitFor();
 mode='delay';await page.getByRole('button',{name:'Retry',exact:true}).click();await page.getByText('Loading registry…',{exact:true}).waitFor();assert(await nav.getByRole('button',{name:'Next',exact:true}).isDisabled());await nav.getByText('Showing 1–25 of 57 Detection Rules',{exact:true}).waitFor();
 report.checks.push('empty page recovery, error/retry, loading controls');mode='normal';
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000});
  assert(!(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)),'Page overflow');
  const region=page.getByRole('region',{name:'Detection rules table'});await region.focus();assert(await region.evaluate(e=>e===document.activeElement));
  await region.evaluate(e=>e.blur());await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:out+'/rules-'+width+'.png',fullPage:true});
 }
 assert(requests.some(r=>r.offset==='50'));assert.deepEqual(errors,[]);
 report.checks.push('desktop/mobile layout and keyboard-focusable table');report.passed=true;
}finally{writeFileSync(out+'/report.json',JSON.stringify(report,null,2)+'\n');await browser.close();}
console.log('PASS reusable records table: '+out+'/report.json');
