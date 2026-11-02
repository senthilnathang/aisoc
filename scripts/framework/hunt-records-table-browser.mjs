// Local API reads and intercepted workflows only; no demo mutations.
import {chromium} from '../../frontend/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
const origin='http://127.0.0.1:8080',out='output/playwright/hunt-records-table';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:'/opt/google/chrome/chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(30000);page.setDefaultNavigationTimeout(60000);
const errors=[];page.on('pageerror',e=>errors.push(e.message));const report={passed:false,mode:'local/mock',mutations:false,checks:[]};
try{
 await page.goto(origin+'/hunt/threat-hunting');
 const real=await page.request.get(origin+'/api/v1/hunts?limit=10&offset=0',{headers:{'X-Tenant-Id':'demo'}});assert.equal(real.status(),200);const data=await real.json();assert(Array.isArray(data.items)&&Number.isInteger(data.total));
 const foreign=await page.request.get(origin+'/api/v1/hunts',{headers:{'X-Tenant-Id':'table-test-foreign'}});assert.equal(foreign.status(),200);assert.equal((await foreign.json()).total,0);
 report.checks.push('real Go pagination and tenant isolation');
 report.existing=await eval('('+readFileSync('scripts/framework/hunt-workspace-browser-check.js','utf8')+')')(page);assert(report.existing.passed);
 const at='2026-11-02T00:00:00Z',rows=Array.from({length:123},(_,i)=>({id:'HUNT-table-'+i,name:'Hunt '+String(i+1).padStart(3,'0'),query:'192.0.2.'+(i%255),source:i%2?'ad_hoc':'threat_report:local',created_at:at,updated_at:at}));
 let mode='normal';const requests=[];
 await page.route('**/api/v1/**',async route=>{
  const req=route.request(),u=new URL(req.url()),p=u.pathname.replace('/api/v1','');
  if(p==='/hunts'&&req.method()==='GET'){
   requests.push(Object.fromEntries(u.searchParams));
   if(mode==='error')return route.fulfill({status:500,json:{error:{message:'Fixture hunts unavailable'}}});
   const search=u.searchParams.get('search')||'';
   if(mode==='delay'||search==='slow')await new Promise(r=>setTimeout(r,700));
   const filtered=mode==='empty'?[]:rows.filter(h=>search==='slow'||(h.name+' '+h.query).toLowerCase().includes(search.toLowerCase()));
   const offset=Number(u.searchParams.get('offset')),limit=Number(u.searchParams.get('limit'));
   return route.fulfill({json:{items:filtered.slice(offset,offset+limit),total:filtered.length}});
  }
  const hunt=rows.find(h=>p===`/hunts/${h.id}/workspace`);if(hunt)return route.fulfill({json:{hunt,runs:[],notes:[],executions:[],scope:'Local fixture search'}});
  if(req.method()!=='GET')throw Error('Unexpected write '+p);
  return route.continue();
 });
 await page.goto(origin+'/hunt/threat-hunting');const nav=page.getByRole('navigation',{name:'Threat hunts pagination'});
 const showing=async(text)=>nav.getByText(text,{exact:true}).waitFor();
 await showing('Showing 1–50 of 123 hunts');await nav.getByRole('button',{name:'Next',exact:true}).click();await showing('Showing 51–100 of 123 hunts');
 await nav.getByRole('button',{name:'Last',exact:true}).click();await showing('Showing 101–123 of 123 hunts');assert(await nav.getByRole('button',{name:'Next',exact:true}).isDisabled());
 await nav.getByRole('button',{name:'Previous',exact:true}).click();await showing('Showing 51–100 of 123 hunts');
 await nav.getByRole('button',{name:'First',exact:true}).click();await showing('Showing 1–50 of 123 hunts');
 await page.getByLabel('Hunts per page',{exact:true}).selectOption('25');await showing('Showing 1–25 of 123 hunts');
 await nav.getByRole('button',{name:'Next',exact:true}).click();await showing('Showing 26–50 of 123 hunts');
 await page.getByLabel('Search hunts or reports',{exact:true}).fill('Hunt 12');await showing('Showing 1–4 of 4 hunts');assert.equal(requests.at(-1).offset,'0');
 await page.getByLabel('Hunts per page',{exact:true}).selectOption('10');await showing('Showing 1–4 of 4 hunts');assert.equal(requests.at(-1).search,'Hunt 12');
 await page.getByRole('button',{name:'Hunt 120',exact:true}).click();await page.getByRole('heading',{name:'Hunt 120',exact:true}).waitFor();
 await page.getByRole('button',{name:'All hunts',exact:true}).click();await showing('Showing 1–50 of 123 hunts');
 await page.getByRole('button',{name:'Open hunt →',exact:true}).first().click();await page.getByRole('heading',{name:'Hunt 001',exact:true}).waitFor();
 report.checks.push('page sizes, first/last/previous/next, search reset/preservation, title and action navigation');
 await page.goto(origin+'/hunt/threat-hunting');await showing('Showing 1–50 of 123 hunts');
 const slow=page.waitForRequest(r=>new URL(r.url()).pathname==='/api/v1/hunts'&&new URL(r.url()).searchParams.get('search')==='slow');
 await page.getByLabel('Search hunts or reports').fill('slow');await slow;await page.getByLabel('Search hunts or reports').fill('Hunt 123');await showing('Showing 1–1 of 1 hunts');await new Promise(r=>setTimeout(r,800));await page.getByRole('button',{name:'Hunt 123',exact:true}).waitFor();
 await page.getByLabel('Search hunts or reports').fill('');await showing('Showing 1–50 of 123 hunts');await nav.getByRole('button',{name:'Last',exact:true}).click();await showing('Showing 101–123 of 123 hunts');
 const reset=page.waitForRequest(r=>new URL(r.url()).pathname==='/api/v1/hunts'&&new URL(r.url()).searchParams.get('offset')==='0');
 mode='empty';await page.getByRole('button',{name:'Refresh',exact:true}).click();await reset;await showing('0 hunts');assert(await nav.getByRole('button',{name:'Previous',exact:true}).isDisabled());assert.equal(requests.at(-1).offset,'0');
 mode='error';await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.getByRole('alert').filter({hasText:'Fixture hunts unavailable'}).waitFor();assert(await nav.getByRole('button',{name:'Next',exact:true}).isDisabled());
 mode='delay';await page.getByRole('button',{name:'Retry',exact:true}).click();await page.getByText('Loading hunts…',{exact:true}).waitFor();assert(await nav.getByRole('button',{name:'Next',exact:true}).isDisabled());await showing('Showing 1–50 of 123 hunts');mode='normal';
 report.checks.push('late-response protection, empty page reset, loading, error and retry');
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000});await page.getByLabel('Hunts per page').selectOption('10');await showing('Showing 1–10 of 123 hunts');
  const region=page.getByRole('region',{name:'Threat hunts table',exact:true});await region.focus();assert(await region.evaluate(el=>el===document.activeElement));assert(!(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)));
  await region.evaluate(el=>el.blur());await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:`${out}/hunts-${width}.png`,fullPage:true});
 }
 report.checks.push('desktop/mobile layout and keyboard scroll access');assert.deepEqual(errors,[]);report.passed=true;
 console.log('PASS Hunt records table: '+out+'/report.json');
}catch(e){report.error=e.stack;await page.screenshot({path:out+'/failure.png',fullPage:true,timeout:5000}).catch(()=>{});throw e;}
finally{writeFileSync(out+'/report.json',JSON.stringify(report,null,2));await browser.close();}
