// Read-only Go smoke plus intercepted report fixtures/actions. No demo mutations.
import {chromium} from '../../frontend/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
const origin='http://127.0.0.1:8080',out='output/threat-reports-table';mkdirSync(out,{recursive:true});mkdirSync('output/playwright',{recursive:true});
const browser=await chromium.launch({executablePath:'/opt/google/chrome/chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(15000);
const errors=[];page.on('pageerror',e=>errors.push(e.message));const report={passed:false,mode:'local/mock',mutations:false,checks:[]};
try{
 await page.goto(origin+'/threat-intel');
 const real=await page.request.get(origin+'/api/v1/threat-intel/registry?limit=50&offset=0');assert.equal(real.status(),200);const data=await real.json();assert(Array.isArray(data.items)&&Number.isInteger(data.total));
 const foreign=await page.request.get(origin+'/api/v1/threat-intel/registry',{headers:{'X-Tenant-Id':'table-test-foreign'}});assert.equal(foreign.status(),200);assert.equal((await foreign.json()).total,0);
 report.checks.push('real Go registry and tenant isolation');
 report.existing=await eval('('+readFileSync('scripts/framework/threat-intel-browser-check.js','utf8')+')')(page);assert(report.existing.passed);
 const at='2026-11-02T00:00:00Z';
 const rows=Array.from({length:123},(_,i)=>({id:'TI-table-'+i,title:'Report '+String(i+1).padStart(3,'0'),summary:'Synthetic report evidence',source:'Source '+(i%2),severity:'medium',threat_actor:'Actor '+(i%4),targeted_industry:'Finance',targeted_region:'EU',published_at:at,created_at:at,updated_at:at,status:['new','reviewing','actionable'][i%3],relevant:i%2===0,indicator_count_actual:i%7,linked_hunts:i%3}));
 let mode='normal';const requests=[],writes=[];
 await page.route('**/api/v1/**',async route=>{
  const req=route.request(),u=new URL(req.url()),p=u.pathname.replace('/api/v1','');
  if(p==='/threat-intel/registry'){
   requests.push(Object.fromEntries(u.searchParams));
   if(mode==='error')return route.fulfill({status:500,json:{error:{message:'Fixture intelligence unavailable'}}});
   const search=u.searchParams.get('search')||'',status=u.searchParams.get('status')||'',relevant=u.searchParams.get('relevant')==='true';
   if(mode==='delay'||search==='slow')await new Promise(r=>setTimeout(r,650));
   const filtered=mode==='empty'?[]:rows.filter(r=>(!status||r.status===status)&&(!relevant||r.relevant)&&`${r.title} ${r.threat_actor} ${r.targeted_region}`.toLowerCase().includes(search.toLowerCase()));
   const limit=Number(u.searchParams.get('limit')||50),offset=Number(u.searchParams.get('offset')||0);
   return route.fulfill({json:{items:filtered.slice(offset,offset+limit),total:filtered.length,sources:new Set(filtered.map(r=>r.source)).size}});
  }
  if(p==='/threat-intel/import/preview'){const body=req.postDataJSON();writes.push(p);return route.fulfill({json:{received:1,unique:1,duplicates:0,document:body}});}
  if(p==='/threat-intel/import'){writes.push(p);return route.fulfill({json:{report_id:rows[0].id}});}
  if(p.startsWith('/threat-intel-reports/')&&p.endsWith('/workspace')){const r=rows.find(r=>p.includes('/'+r.id+'/'));return route.fulfill({json:{report:r,indicator_count:r.indicator_count_actual,hunts:[],imports:[]}});}
  if(p==='/threat-indicators')return route.fulfill({json:{items:[]}});
  if(p.startsWith('/navigation/'))return route.fulfill({json:{label:'Report fixture'}});
  if(req.method()!=='GET')throw Error('Unexpected non-fixture mutation '+p);
  return route.continue();
 });
 await page.goto(origin+'/threat-intel');const nav=page.getByRole('navigation',{name:'Threat intelligence reports pagination'});
 await nav.getByText('Showing 1–50 of 123 reports',{exact:true}).waitFor();
 await nav.getByRole('button',{name:'Next',exact:true}).click();await nav.getByText('Showing 51–100 of 123 reports',{exact:true}).waitFor();
 await nav.getByRole('button',{name:'Last',exact:true}).click();await nav.getByText('Showing 101–123 of 123 reports',{exact:true}).waitFor();assert(await nav.getByRole('button',{name:'Next',exact:true}).isDisabled());
 await nav.getByRole('button',{name:'Previous',exact:true}).click();await nav.getByText('Showing 51–100 of 123 reports',{exact:true}).waitFor();
 await page.getByLabel('Reports per page',{exact:true}).selectOption('25');await nav.getByText('Showing 1–25 of 123 reports',{exact:true}).waitFor();
 await nav.getByRole('button',{name:'Next',exact:true}).click();await nav.getByText('Showing 26–50 of 123 reports',{exact:true}).waitFor();
 await page.getByLabel('Report status filter',{exact:true}).selectOption('actionable');await nav.getByText('Showing 1–25 of 41 reports',{exact:true}).waitFor();
 const relevant=page.getByRole('checkbox',{name:'Relevant reports only',exact:true});await relevant.focus();await relevant.press('Space');await nav.getByText('Showing 1–21 of 21 reports',{exact:true}).waitFor();
 await page.getByLabel('Search intelligence',{exact:true}).fill('Report 123');await nav.getByText('Showing 1–1 of 1 reports',{exact:true}).waitFor();
 assert(requests.some(r=>r.status==='actionable'&&r.relevant==='true'&&r.search==='Report 123'&&r.offset==='0'));
 await page.getByRole('button',{name:'Report 123',exact:true}).click();await page.getByRole('heading',{name:'Report 123',exact:true}).waitFor();
 report.checks.push('server pagination, combined filters, offset resets and report navigation');
 await page.goto(origin+'/threat-intel');await nav.getByText('Showing 1–50 of 123 reports',{exact:true}).waitFor();
 const slow=page.waitForRequest(r=>new URL(r.url()).pathname==='/api/v1/threat-intel/registry'&&new URL(r.url()).searchParams.get('search')==='slow');
 await page.getByLabel('Search intelligence',{exact:true}).fill('slow');await slow;await page.getByLabel('Search intelligence',{exact:true}).fill('Report 123');await nav.getByText('Showing 1–1 of 1 reports',{exact:true}).waitFor();await new Promise(r=>setTimeout(r,800));await page.getByRole('button',{name:'Report 123',exact:true}).waitFor();
 report.checks.push('late filter response cannot replace current records');
 await page.getByLabel('Search intelligence',{exact:true}).fill('');await nav.getByText('Showing 1–50 of 123 reports',{exact:true}).waitFor();await nav.getByRole('button',{name:'Last',exact:true}).click();await nav.getByText('Showing 101–123 of 123 reports',{exact:true}).waitFor();
 mode='empty';await page.getByRole('button',{name:'Refresh',exact:true}).click();await nav.getByText('0 reports',{exact:true}).waitFor();assert(await nav.getByRole('button',{name:'Previous',exact:true}).isDisabled());assert.equal(requests.at(-1).offset,'0');
 mode='error';await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.getByRole('alert').filter({hasText:'Fixture intelligence unavailable'}).waitFor();assert(await nav.getByRole('button',{name:'Last',exact:true}).isDisabled());
 mode='delay';await page.getByRole('button',{name:'Retry',exact:true}).click();await page.getByText('Loading intelligence reports…',{exact:true}).waitFor();assert(await nav.getByRole('button',{name:'Next',exact:true}).isDisabled());await nav.getByText('Showing 1–50 of 123 reports',{exact:true}).waitFor();mode='normal';
 report.checks.push('empty page recovery, loading and fetch retry');
 await page.getByRole('button',{name:'Ingest TI report',exact:true}).click();await page.getByRole('dialog').getByRole('textbox',{name:'Title',exact:true}).waitFor();await page.getByRole('dialog').getByRole('button',{name:'Cancel',exact:true}).click();
 await page.getByRole('button',{name:'Import JSON',exact:true}).click();const dialog=page.getByRole('dialog');assert(await dialog.getByRole('button',{name:'Import validated JSON',exact:true}).isDisabled());
 const input={schema_version:'1',source:'local-table-fixture',external_id:'table-import',title:'Report 001',indicators:[{type:'ip',value:'192.0.2.42',severity:'medium'}]};
 await dialog.getByLabel('JSON file',{exact:true}).setInputFiles({name:'intel-table.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(input))});await dialog.getByRole('button',{name:'Validate JSON',exact:true}).click();await dialog.getByRole('heading',{name:'Validation passed',exact:true}).waitFor();await dialog.getByRole('button',{name:'Import validated JSON',exact:true}).click();await page.getByRole('heading',{name:'Report 001',exact:true}).waitFor();assert.deepEqual(writes,['/threat-intel/import/preview','/threat-intel/import']);
 report.checks.push('ingest dialog and JSON validation/import action wiring');
 for(const path of ['/threat-intel','/hunt/threat-intelligence'])for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000});await page.goto(origin+path);await nav.getByText('Showing 1–50 of 123 reports',{exact:true}).waitFor();
  await page.getByLabel('Reports per page',{exact:true}).selectOption('10');await nav.getByText('Showing 1–10 of 123 reports',{exact:true}).waitFor();
  const region=page.getByRole('region',{name:'Threat intelligence reports table'});await region.focus();assert(await region.evaluate(e=>e===document.activeElement));await region.evaluate(e=>e.blur());await page.evaluate(()=>window.scrollTo(0,0));
  assert(!(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)),'Page overflow');await page.screenshot({path:out+'/'+(path.startsWith('/hunt')?'hunt-intel':'reports')+'-'+width+'.png',fullPage:true});
 }
 assert.deepEqual(errors,[]);report.checks.push('both entry points, desktop/mobile and keyboard table access');report.passed=true;
}finally{writeFileSync(out+'/report.json',JSON.stringify(report,null,2)+'\n');await browser.close();}
console.log('PASS Threat Intel shared table: '+out+'/report.json');
