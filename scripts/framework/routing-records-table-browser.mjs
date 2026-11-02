// Real read-only API smoke and intercepted writes; never modifies routing/demo records.
import {chromium} from '../../frontend/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
const origin='http://127.0.0.1:8080',out='output/routing-records-table';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:'/opt/google/chrome/chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(15000);
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const report={passed:false,mode:'local/mock',mutations:false,checks:[]};
try{
 await page.goto(origin+'/detect/routing');
 const legacy=eval('('+readFileSync('scripts/framework/detection-routing-browser-check.js','utf8')+')');
 report.existing=await legacy(page);assert(report.existing.passed);
 const response=await page.request.get(origin+'/api/v1/detection-registry?limit=25&offset=0&days=30');assert.equal(response.status(),200);const actual=await response.json();assert(actual.items.length);
 let state={version:1,updated_by:'fixture',updated_at:'2026-11-02T00:00:00Z',config:{lists:[],policies:Array.from({length:41},(_,i)=>({id:'policy-'+(i+1),name:'Policy '+String(i+1).padStart(2,'0'),description:'Local policy fixture',status:'enabled',outcome:'Investigate',source:'',severity:'',rule_id:'',entity_list:'',except_list:''}))}};
 const rules=Array.from({length:57},(_,i)=>({...actual.items[0],id:'route-fixture-'+i,name:'Route fixture '+String(i+1).padStart(2,'0'),routing:'Investigate',version:3}));
 let rejectSave=true,fetchMode='normal';const writes=[];
 await page.route('**/api/v1/detection-routing**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;
  if(path.endsWith('/audit'))return route.fulfill({json:{items:[]}});
  if(path.endsWith('/preview'))return route.fulfill({json:{preview_id:'table-preview',sample_size:1,scope:'Local fixture',impacts:{},events:[]}});
  if(req.method()==='PUT'){const body=req.postDataJSON();writes.push(body);state={...state,version:state.version+1,config:body.config};}
  await route.fulfill({json:state});
 });
 await page.route('**/api/v1/detection-registry?*',async route=>{
  if(fetchMode==='error')return route.fulfill({status:500,json:{error:{message:'Fixture routes unavailable'}}});
  if(fetchMode==='delay')await new Promise(r=>setTimeout(r,500));
  const p=new URL(route.request().url()).searchParams,limit=Number(p.get('limit')||25),offset=Number(p.get('offset')||0);
  await route.fulfill({json:{...actual,items:rules.slice(offset,offset+limit),total:rules.length,limit,offset}});
 });
 await page.route('**/api/v1/detection-rules/*',async route=>{
  if(route.request().method()!=='PATCH')return route.continue();
  const input=route.request().postDataJSON(),id=new URL(route.request().url()).pathname.split('/').at(-1);writes.push({id,...input});
  await new Promise(r=>setTimeout(r,300));
  if(rejectSave)return route.fulfill({status:409,json:{error:{message:'Fixture route version conflict'}}});
  const rule=rules.find(r=>r.id===id);assert.equal(input.expected_version,rule.version);rule.routing=input.routing;rule.version++;
  return route.fulfill({json:rule});
 });
 await page.goto(origin+'/detect/routing');
 const policies=page.getByRole('navigation',{name:'Universal routing policies pagination'});
 await policies.getByText('Showing 1–20 of 41 policies',{exact:true}).waitFor();
 await policies.getByRole('button',{name:'Next',exact:true}).click();await policies.getByText('Showing 21–40 of 41 policies',{exact:true}).waitFor();
 await page.getByLabel('Move Policy 21 up',{exact:true}).click();
 await policies.getByRole('button',{name:'First',exact:true}).click();await page.getByRole('table',{name:'Universal routing policies',exact:true}).getByRole('button',{name:'Policy 21',exact:true}).waitFor();
 await page.getByLabel('Routing status filter',{exact:true}).selectOption('enabled');
 await policies.getByRole('button',{name:'Last',exact:true}).click();await page.getByLabel('Select Policy 41',{exact:true}).focus();await page.getByLabel('Select Policy 41',{exact:true}).press('Space');assert(await page.getByLabel('Select Policy 41',{exact:true}).isChecked());await page.getByRole('button',{name:'Archive',exact:true}).click();
 await policies.getByText('Showing 21–40 of 40 policies',{exact:true}).waitFor();
 await page.getByLabel('Policies per page',{exact:true}).selectOption('10');await policies.getByText('Showing 1–10 of 40 policies',{exact:true}).waitFor();
 await page.getByLabel('Search universal rules',{exact:true}).fill('absent');await page.getByRole('heading',{name:'No universal routing policies',exact:true}).waitFor();
 await page.getByRole('button',{name:'Reset all',exact:true}).click();await policies.getByText('Showing 1–10 of 41 policies',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Preview routing',exact:true}).click();await page.getByRole('button',{name:'Close preview',exact:true}).click();
 await page.getByRole('button',{name:'Save configuration',exact:true}).click();assert.equal(writes.length,0);
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();await page.getByText(/Configuration v2/).waitFor();
 assert.equal(writes[0].preview_id,'table-preview');assert.equal(writes[0].config.policies[19].id,'policy-21');assert.equal(writes[0].config.policies.find(p=>p.id==='policy-41').status,'archived');
 report.checks.push('universal pagination, cross-page priority, archive page clamp, filtering and explicit preview/save');
 await page.getByRole('tab',{name:'Per-Rule Routing',exact:true}).click();
 const routes=page.getByRole('navigation',{name:'Per-rule routing pagination'});
 await routes.getByText('Showing 1–25 of 57 rules',{exact:true}).waitFor();
 const field=page.getByLabel('Route for Route fixture 01',{exact:true});await field.selectOption('Suppress');
 await routes.getByRole('button',{name:'Next',exact:true}).click();await routes.getByText('Showing 26–50 of 57 rules',{exact:true}).waitFor();
 await routes.getByRole('button',{name:'Previous',exact:true}).click();await field.waitFor();assert.equal(await field.inputValue(),'Suppress');
 const row=page.getByRole('row').filter({has:field});await row.getByRole('button',{name:'Save route',exact:true}).click();assert(await routes.getByRole('button',{name:'Next',exact:true}).isDisabled());assert(await field.isDisabled());
 await page.getByRole('alert').filter({hasText:'Fixture route version conflict'}).waitFor();assert.equal(await field.inputValue(),'Suppress');assert(await field.isVisible());
 rejectSave=false;await row.getByRole('button',{name:'Save route',exact:true}).click();await row.getByText('v4',{exact:true}).waitFor();assert.equal(await field.inputValue(),'Suppress');
 assert.equal(writes.at(-1).expected_version,3);assert.equal(writes.at(-1).routing,'Suppress');
 await page.getByLabel('Routes per page',{exact:true}).selectOption('10');await routes.getByText('Showing 1–10 of 57 rules',{exact:true}).waitFor();
 await routes.getByRole('button',{name:'Last',exact:true}).click();await routes.getByText('Showing 51–57 of 57 rules',{exact:true}).waitFor();
 fetchMode='error';await routes.getByRole('button',{name:'First',exact:true}).click();await page.getByRole('alert').filter({hasText:'Fixture routes unavailable'}).waitFor();assert(await routes.getByRole('button',{name:'Next',exact:true}).isDisabled());
 fetchMode='delay';await page.getByRole('button',{name:'Retry',exact:true}).click();await page.getByText('Loading rule routes…',{exact:true}).waitFor();await routes.getByText('Showing 1–10 of 57 rules',{exact:true}).waitFor();fetchMode='normal';
 report.checks.push('server pagination, retained drafts, CAS conflict, save interlock, page size and fetch retry');
 for(const tab of ['Per-Rule Routing','Universal Rule Routing'])for(const width of [1440,390]){
  await page.getByRole('tab',{name:tab,exact:true}).click();await page.getByRole('table').waitFor();await page.setViewportSize({width,height:1000});
  assert(!(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)),'Overflow '+tab);
  await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:out+'/'+tab.replaceAll(' ','-')+'-'+width+'.png',fullPage:true});
 }
 assert.deepEqual(errors,[]);report.checks.push('desktop/mobile both routing tables');report.passed=true;
}finally{writeFileSync(out+'/report.json',JSON.stringify(report,null,2)+'\n');await browser.close();}
console.log('PASS routing records tables: '+out+'/report.json');
