// Real read-only API checks; domain writes are intercepted fixtures.
import {chromium} from '../../frontend/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
const origin='http://localhost:8080',out='output/playwright/skills-records-table';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:'/opt/google/chrome/chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(30000);page.setDefaultNavigationTimeout(60000);
const errors=[];page.on('pageerror',e=>errors.push(e.message));const report={passed:false,mode:'local/mock',mutations:false,checks:[]};
try {
 await page.goto(origin+'/skills');
 const real=await page.request.get(origin+'/api/v1/skills/library?origin=custom&limit=25',{headers:{'X-Tenant-Id':'demo'}});assert.equal(real.status(),200);assert(Number.isInteger((await real.json()).total));
 const foreign=await page.request.get(origin+'/api/v1/skills/library',{headers:{'X-Tenant-Id':'table-test-foreign'}});assert.equal(foreign.status(),200);assert.equal((await foreign.json()).total,0);
 report.checks.push('real library totals and tenant isolation');
 report.existing=await eval('('+readFileSync('scripts/framework/skills-workspace-browser-check.js','utf8')+')')(page);assert(report.existing.passed);
 const rows=Array.from({length:123},(_,i)=>({id:'SK-table-'+i,name:'Skill '+String(i+1).padStart(3,'0'),origin:i<100?'user':'environment_generated',created_by:'Fixture analyst',state:i%2?'draft':'published',enabled:true,version:3,skill_type:'strategy',modules:[i%3?'investigations':'hunting'],updated_at:'2026-11-02T00:00:00Z',learning_archived:i===2,learning_current:i!==4,staged_edit:i===6?{}:null}));
 let mode='normal',toggleMode='normal';const requests=[],writes=[];
 await page.route('**/api/v1/**',async route=>{
  const req=route.request(),u=new URL(req.url()),p=u.pathname.replace('/api/v1','');
  if(p==='/skills/library'){
   requests.push(Object.fromEntries(u.searchParams));
   if(mode==='error')return route.fulfill({status:500,json:{error:{message:'Fixture library unavailable'}}});
   const search=u.searchParams.get('search')||'',state=u.searchParams.get('state'),module=u.searchParams.get('module'),origin=u.searchParams.get('origin');
   if(mode==='delay'||search==='slow')await new Promise(r=>setTimeout(r,800));
   const filtered=mode==='empty'?[]:rows.filter(s=>(origin==='augmented'?s.origin==='environment_generated':s.origin!=='environment_generated')&&(!state||s.state===state)&&(!module||s.modules.includes(module))&&(!search||search==='slow'||s.name.toLowerCase().includes(search.toLowerCase())));
   const offset=Number(u.searchParams.get('offset')),limit=Number(u.searchParams.get('limit'));
   return route.fulfill({json:{items:filtered.slice(offset,offset+limit),total:filtered.length,published:filtered.filter(s=>s.state==='published').length,drafts:filtered.filter(s=>s.state==='draft').length}});
  }
  if(p.endsWith('/enabled')){
   const b=req.postDataJSON();assert.deepEqual(b,{expected_version:3,enabled:false});writes.push(b);
   if(toggleMode==='delay')await new Promise(r=>setTimeout(r,1000));
   return route.fulfill({status:409,json:{error:{message:'Fixture revision conflict'}}});
  }
  if(req.method()!=='GET')throw Error('Unexpected write '+p);
  return route.continue();
 });
 await page.goto(origin+'/skills');const nav=page.getByRole('navigation',{name:'Skills library pagination'}),show=async t=>nav.getByText(t,{exact:true}).waitFor();
 await show('Showing 1–25 of 100 skills');await nav.getByRole('button',{name:'Next',exact:true}).click();await show('Showing 26–50 of 100 skills');
 await nav.getByRole('button',{name:'Last',exact:true}).click();await show('Showing 76–100 of 100 skills');assert(await nav.getByRole('button',{name:'Next',exact:true}).isDisabled());
 await nav.getByRole('button',{name:'Previous',exact:true}).click();await show('Showing 51–75 of 100 skills');await nav.getByRole('button',{name:'First',exact:true}).click();await show('Showing 1–25 of 100 skills');
 await page.getByLabel('Skills per page').selectOption('10');await show('Showing 1–10 of 100 skills');
 await page.getByLabel('Skill state',{exact:true}).selectOption('published');await page.getByLabel('Skill module',{exact:true}).selectOption('hunting');await page.getByLabel('Search skills',{exact:true}).fill('Skill 0');await show('Showing 1–10 of 17 skills');
 await nav.getByRole('button',{name:'Next',exact:true}).click();await show('Showing 11–17 of 17 skills');await page.getByLabel('Skills per page').selectOption('50');await show('Showing 1–17 of 17 skills');assert.equal(requests.at(-1).search,'Skill 0');assert.equal(requests.at(-1).module,'hunting');assert.equal(requests.at(-1).state,'published');
 await page.getByRole('button',{name:'My Augmented Skills',exact:true}).click();await show('0 skills');await page.getByRole('button',{name:'Review suggestions',exact:true}).waitFor();
 await page.goto(origin+'/skills');await show('Showing 1–25 of 100 skills');
 assert(await page.getByLabel('Enable Skill 003',{exact:true}).isDisabled());assert(await page.getByLabel('Enable Skill 005',{exact:true}).isDisabled());await page.getByText('Staged edits',{exact:true}).waitFor();
 toggleMode='delay';await page.getByLabel('Enable Skill 001',{exact:true}).focus();await page.keyboard.press('Space');assert(await nav.getByRole('button',{name:'Next',exact:true}).isDisabled());assert(await page.getByLabel('Skills per page').isDisabled());await page.getByRole('alert').filter({hasText:'Fixture revision conflict'}).waitFor();await page.getByRole('button',{name:'Skill 001',exact:true}).waitFor();assert.equal(writes.length,1);
 await page.getByRole('button',{name:'Reload library',exact:true}).click();await show('Showing 1–25 of 100 skills');
 report.checks.push('paging, combined filters, origin empty actions, lifecycle badges and toggle conflict/busy guards');
 const slow=page.waitForRequest(r=>new URL(r.url()).searchParams.get('search')==='slow');await page.getByLabel('Search skills').fill('slow');await slow;await page.getByLabel('Search skills').fill('Skill 099');await show('Showing 1–1 of 1 skills');await new Promise(r=>setTimeout(r,1000));await page.getByRole('button',{name:'Skill 099',exact:true}).waitFor();
 await page.getByLabel('Search skills').fill('');await show('Showing 1–25 of 100 skills');await nav.getByRole('button',{name:'Last',exact:true}).click();await show('Showing 76–100 of 100 skills');
 mode='empty';await page.getByLabel('Skill state').selectOption('published');await show('0 skills');
 mode='error';await page.getByLabel('Skill state').selectOption('');await page.getByRole('alert').filter({hasText:'Fixture library unavailable'}).waitFor();assert(await nav.getByRole('button',{name:'Next',exact:true}).isDisabled());
 mode='delay';await page.getByRole('button',{name:'Retry',exact:true}).click();await page.getByText('Loading skills…',{exact:true}).waitFor();assert(await nav.getByRole('button',{name:'Last',exact:true}).isDisabled());await show('Showing 1–25 of 100 skills');mode='normal';
 await page.getByLabel('Upload skill file').setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from('{}')});await page.getByRole('alert').filter({hasText:'Choose a Markdown or TXT file'}).waitFor();await page.getByRole('button',{name:'Skill 001',exact:true}).waitFor();await page.getByRole('button',{name:'Reload library',exact:true}).click();await show('Showing 1–25 of 100 skills');
 report.checks.push('late responses, loading/retry, empty results and upload validation without hiding rows');
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000});await page.getByLabel('Skills per page').selectOption('10');await show('Showing 1–10 of 100 skills');const region=page.getByRole('region',{name:'Skills library table',exact:true});await region.focus();assert(await region.evaluate(el=>el===document.activeElement));assert(!(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)));await region.evaluate(el=>el.blur());await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:`${out}/skills-${width}.png`,fullPage:true});
 }
 assert.deepEqual(errors,[]);report.checks.push('desktop/mobile layout and keyboard scroll access');report.passed=true;console.log('PASS Skills records table: '+out+'/report.json');
}catch(e){report.error=e.stack;await page.screenshot({path:out+'/failure.png',fullPage:true,timeout:5000}).catch(()=>{});throw e;}
finally{writeFileSync(out+'/report.json',JSON.stringify(report,null,2));await browser.close();}
