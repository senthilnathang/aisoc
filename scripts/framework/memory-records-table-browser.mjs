// Real reads and intercepted local workflow fixtures; no demo mutations.
import {chromium} from '../../frontend/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
const origin='http://localhost:8080',out='output/playwright/memory-records-table';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:'/opt/google/chrome/chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(30000);page.setDefaultNavigationTimeout(60000);
const errors=[];page.on('pageerror',e=>errors.push(e.message));const report={passed:false,mode:'local/mock',mutations:false,checks:[]};
try{
 await page.goto(origin+'/memory');
 for(const tenant of ['demo','table-test-foreign']){const r=await page.request.get(origin+'/api/v1/enterprise-insights?tab=active&limit=25',{headers:{'X-Tenant-Id':tenant}});assert.equal(r.status(),200);const d=await r.json();assert(Number.isInteger(d.total));if(tenant!=='demo')assert.equal(d.total,0);}
 report.checks.push('real Go totals and tenant isolation');
 report.existing=await eval('('+readFileSync('scripts/framework/enterprise-insights-browser-check.js','utf8')+')')(page);assert(report.existing.passed);
 const at='2026-11-02T00:00:00Z';let rows=Array.from({length:57},(_,i)=>({id:'EI-table-'+i,artifact_key:'artifact-'+i,artifact:'Asset '+String(i+1).padStart(3,'0'),content:'Verified local context '+i,kind:'user',hint:'none',version:1,origin:'analyst',created_by:'Fixture author',created_at:at,valid_from:at,valid_until:null,active_now:true,uses_30d:2,last_used:at,cases:4,first_seen:at,last_seen:at,benign:2,suspicious:1,malicious:1,resource_id:'EI-table-'+i,action:'created',details:{actor:'Fixture author'},case_ids:[]}));
 let mode='normal';const requests=[];
 await page.route('**/api/v1/**',async route=>{
  const req=route.request(),u=new URL(req.url()),p=u.pathname.replace('/api/v1','');
  if(p==='/enterprise-insights'&&req.method()==='GET'){
   requests.push(Object.fromEntries(u.searchParams));if(mode==='error')return route.fulfill({status:503,json:{error:{message:'Fixture memory unavailable'}}});
   const search=u.searchParams.get('search')||'',tab=u.searchParams.get('tab');if(mode==='delay'||search==='slow')await new Promise(r=>setTimeout(r,800));
   const filtered=mode==='empty'||tab==='ai'?[]:rows.filter(r=>search==='slow'||r.artifact.toLowerCase().includes(search.toLowerCase()));
   const n=Number(u.searchParams.get('limit')),o=Number(u.searchParams.get('offset'));return route.fulfill({json:{items:filtered.slice(o,o+n),total:filtered.length,summary:{total:57,types:[{kind:'user',count:57}],investigations_30d:2,daily:[]}}});
  }
  if(p.endsWith('/lifecycle'))return route.fulfill({json:{version:1,current:true,archived:false}});
  if(p.endsWith('/archive')){assert.equal(req.postDataJSON().expected_version,1);rows=[];return route.fulfill({json:{archived:true}});}
  if(req.method()!=='GET')throw Error('Unexpected write '+p);return route.continue();
 });
 await page.goto(origin+'/memory');
 for(const [tab,caption] of [['Active Insights','Memory insights'],['Prevalence Suggestions','Memory prevalence'],['Audit Log','Memory audit']]){
  await page.getByRole('button',{name:tab,exact:true}).click();const nav=page.getByRole('navigation',{name:caption+' pagination'}),show=async t=>nav.getByText(t,{exact:true}).waitFor();
  await page.getByLabel('Memory records per page').selectOption('25');await show('Showing 1–25 of 57 records');await nav.getByRole('button',{name:'Next',exact:true}).click();await show('Showing 26–50 of 57 records');await nav.getByRole('button',{name:'Last',exact:true}).click();await show('Showing 51–57 of 57 records');assert(await nav.getByRole('button',{name:'Next',exact:true}).isDisabled());await nav.getByRole('button',{name:'Previous',exact:true}).click();await show('Showing 26–50 of 57 records');await nav.getByRole('button',{name:'First',exact:true}).click();await show('Showing 1–25 of 57 records');
  await page.getByLabel('Search insights').fill('Asset 05');await show('Showing 1–8 of 8 records');await page.getByLabel('Memory records per page').selectOption('10');await show('Showing 1–8 of 8 records');assert.equal(requests.at(-1).search,'Asset 05');await page.getByLabel('Search insights').fill('');await show('Showing 1–10 of 57 records');
  for(const width of [1440,390]){await page.setViewportSize({width,height:1000});const region=page.getByRole('region',{name:caption+' table',exact:true});await region.focus();assert(await region.evaluate(el=>el===document.activeElement));assert(!(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)));await region.evaluate(el=>el.blur());await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:`${out}/${caption.replaceAll(' ','-')}-${width}.png`,fullPage:true});}
 }
 report.checks.push('all three tables: paging, page sizes, search preservation/reset, desktop/mobile and keyboard access');
 await page.getByRole('button',{name:'Active Insights',exact:true}).click();const nav=page.getByRole('navigation',{name:'Memory insights pagination'}),show=async t=>nav.getByText(t,{exact:true}).waitFor();await show('Showing 1–10 of 57 records');
 const slow=page.waitForRequest(r=>new URL(r.url()).searchParams.get('search')==='slow');await page.getByLabel('Search insights').fill('slow');await slow;await page.getByLabel('Search insights').fill('Asset 057');await show('Showing 1–1 of 1 records');await new Promise(r=>setTimeout(r,1000));await page.getByText('Verified local context 56',{exact:true}).waitFor();
 await page.getByLabel('Search insights').fill('');await show('Showing 1–10 of 57 records');await nav.getByRole('button',{name:'Last',exact:true}).click();await show('Showing 51–57 of 57 records');await page.getByRole('button',{name:'Archive',exact:true}).first().click();await page.getByRole('button',{name:'Confirm archive',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});await show('0 records');assert.equal(requests.at(-1).offset,'0');assert(await nav.getByRole('button',{name:'Previous',exact:true}).isDisabled());
 mode='error';await page.getByLabel('Search insights').fill('error');await page.getByRole('alert').filter({hasText:'Fixture memory unavailable'}).waitFor();assert(await nav.getByRole('button',{name:'Next',exact:true}).isDisabled());mode='delay';await page.getByRole('button',{name:'Retry',exact:true}).click();await page.getByText('Loading enterprise context…',{exact:true}).waitFor();assert(await nav.getByRole('button',{name:'Last',exact:true}).isDisabled());await show('0 records');
 report.checks.push('stale responses, archive empty-page recovery, fetch error/retry/loading');assert.deepEqual(errors,[]);report.passed=true;console.log('PASS Memory records table: '+out+'/report.json');
}catch(e){report.error=e.stack;await page.screenshot({path:out+'/failure.png',fullPage:true,timeout:5000}).catch(()=>{});throw e;}
finally{writeFileSync(out+'/report.json',JSON.stringify(report,null,2));await browser.close();}
