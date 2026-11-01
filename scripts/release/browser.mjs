// Plain Playwright runner; writes only to a run-owned disposable local API.
import {chromium} from '../../frontend/node_modules/playwright/index.mjs';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import assert from 'node:assert/strict';
import {criticalWorkflows} from './workflows.mjs';
import {sections} from '../../frontend/src/navigation.js';
const executablePath=process.env.AISOC_RELEASE_CHROMIUM;
if(!executablePath)throw Error('Set AISOC_RELEASE_CHROMIUM to an installed browser');
const browser=await chromium.launch({executablePath,headless:true});
if(process.argv.includes('--preflight')){await browser.close();console.log('PASS browser launch');process.exit(0);}
const manifestPath=resolve(process.argv[2]),fixture=JSON.parse(readFileSync(manifestPath,'utf8')),origin=fixture.origin;
assert.match(fixture.run_id,/^[a-f0-9]{32}$/);assert.equal(fixture.mode,'local/mock');assert.equal(new URL(origin).hostname,'127.0.0.1');assert.equal(new URL(origin).protocol,'http:');
const output=dirname(dirname(manifestPath)),screenshots=join(output,'screenshots');mkdirSync(screenshots,{recursive:true});
const report={browser_version:browser.version(),run_id:fixture.run_id,mode:'local/mock',passed:false,stages:{},page_errors:[],http_errors:[],external_requests:[],route_checks:0};
const save=()=>writeFileSync(join(output,'browser.json'),JSON.stringify(report,null,2)+'\n');save();
const contexts=[];
const waitFor=async(fn,message)=>{const end=Date.now()+30000;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,150));}throw Error(message);};
const step=async(name,fn)=>{report.current_stage=name;save();const value=await fn();report.stages[name]={passed:true,...value};save();};
const exact=(page,name)=>page.getByRole('button',{name,exact:true});
async function login(actor){
 const context=await browser.newContext({viewport:{width:1440,height:1000}});contexts.push(context);
 await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin===origin)return route.continue();report.external_requests.push(url.origin+url.pathname);return route.abort();});
 const page=await context.newPage();page.setDefaultTimeout(15000);
 page.on('pageerror',e=>report.page_errors.push({path:new URL(page.url()).pathname,message:e.message}));
 page.on('requestfailed',r=>{const u=new URL(r.url());if(!report.passed&&u.pathname.startsWith('/api/v1/')&&r.failure()?.errorText!=='net::ERR_ABORTED')report.http_errors.push({path:u.pathname,error:r.failure()?.errorText});});
 page.on('response',r=>{const u=new URL(r.url());if(u.pathname.startsWith('/api/v1/')&&r.status()>=400&&!(u.pathname==='/api/v1/auth/session'&&r.status()===401))report.http_errors.push({path:u.pathname,status:r.status()});});
 await page.goto(origin+'/respond/inbox');await page.getByLabel('Operator access token').fill('parity_fixture_'+actor.repeat(40));await exact(page,'Sign in').click();await exact(page,'Sign out').waitFor();
 return page;
}
async function get(page,path,expected=200){const r=await page.request.get(origin+'/api/v1'+path);assert.equal(r.status(),expected,path);return r.json();}
async function preview(page,id,title){await page.goto(origin+'/respond/inbox');await page.getByLabel('Search proposals').fill(id);await exact(page,'Preview '+title).click();}
let main;
try{
 main=await login('a');
 await step('build_import',async()=>{
  await main.goto(origin+'/build/integrations');await exact(main,'＋ New local integration').click();
  await main.getByLabel('Profile name',{exact:true}).fill(fixture.name+' login');await main.getByLabel('Authorized mock source',{exact:true}).selectOption(fixture.scope);
  await main.getByLabel('Import login events JSON',{exact:true}).setInputFiles(join(dirname(manifestPath),'login.json'));
  await exact(main,'Validate & preview').click();await main.getByRole('heading',{name:'Normalized evidence preview',exact:true}).waitFor();
  await exact(main,'Save draft').click();await main.getByText('Draft saved · revision 1',{exact:true}).waitFor();
  assert(await exact(main,'Import saved JSON').isDisabled(),'Import must require confirmation');
  await main.getByText('I confirm local import and freezing this evidence snapshot',{exact:true}).click();await exact(main,'Import saved JSON').click();
  await exact(main,'Replay local import').waitFor();
  const catalog=await get(main,'/build/integrations');const profile=catalog.items.find(x=>x.name===fixture.name+' login');assert(profile);
  let current;await waitFor(async()=>{current=await get(main,'/build/integrations/'+profile.id);return current.intake?.processed_events===4&&current.cases?.length>0},'Imported JSON did not reach investigation');
  await exact(main,'Refresh pipeline status').click();await exact(main,'Open investigation').click();await main.waitForURL('**/investigations/'+current.cases[0].investigation_id);
  await main.getByRole('heading').first().waitFor();await main.waitForLoadState('networkidle');
  await main.screenshot({path:join(screenshots,'build-investigation.png'),fullPage:true});
  return {profile_id:profile.id,case_id:current.cases[0].investigation_id,events:current.intake.processed_events,json_upload:true,explicit_import:true};
 });
 const reviewer=await login('c');
 await step('approval_handoff',async()=>{
  await preview(main,fixture.memory.id,fixture.memory.artifact);
  assert(await exact(main,'Approve Memory proposal').isDisabled(),'Author self-approval enabled');
  await main.getByLabel('Ownership reason').fill('Release gate independent review handoff.');
  assert(await exact(main,'Claim for me').isDisabled(),'Author self-claim enabled');
  await main.getByLabel('Eligible next operator').selectOption('fixture-c');await exact(main,'Assign review').click();
  await preview(reviewer,fixture.memory.id,fixture.memory.artifact);await reviewer.getByLabel('Ownership reason').fill('Claim assigned independent review for release verification.');await exact(reviewer,'Claim for me').click();
  await preview(reviewer,fixture.memory.id,fixture.memory.artifact);
  await exact(reviewer,'Approve Memory proposal').click();await reviewer.getByLabel('Review rationale').fill('Independently reviewed the synthetic release context.');
  await reviewer.getByText('I reviewed this guidance and explicitly approve this operation.',{exact:true}).click();await exact(reviewer,'Confirm approve memory proposal').click();
  await waitFor(async()=>{const d=await get(reviewer,'/enterprise-insights/'+fixture.memory.id+'/lifecycle');return d.approval_state!=='pending'&&d.current},'Independent Memory approval not persisted');
  await main.goto(origin+'/skills/'+fixture.skill.id);await main.getByRole('heading').first().waitFor();
  return {memory_id:fixture.memory.id,skill_id:fixture.skill.id,self_approval_blocked:true,self_claim_blocked:true,independent_claim_and_approval:true};
 });
 await step('notifications',async()=>{
  await reviewer.getByRole('button',{name:/^Notifications,/}).click();const dialog=reviewer.getByRole('dialog');await dialog.getByText(fixture.memory.artifact,{exact:true}).first().waitFor();
  await dialog.getByRole('button',{name:'Mark as read',exact:true}).first().click();
  await dialog.getByRole('link',{name:'Open current review',exact:true}).first().click();await reviewer.waitForURL('**/respond/inbox?**');
  return {recipient:'fixture-c',read_and_handoff_link:true};
 });
 await step('retention_recovery',async()=>{
  await main.goto(origin+'/build/retention');await main.getByLabel('Retention reason').fill('Release gate archive and recovery validation.');
  await main.getByRole('button',{name:'Preview retention '+fixture.notice_id,exact:true}).click();await main.getByText('I reviewed the selected record and its retention scope',{exact:true}).click();await exact(main,'Archive snapshot').click();await main.getByText('Archive snapshot saved. Source records and evidence remain available.',{exact:true}).waitFor();
  await exact(main,'Preview retention '+fixture.notice_id).click();await main.getByText('I reviewed the selected record and its retention scope',{exact:true}).click();await exact(main,'Clean up read notification').click();await main.getByText('Read notification removed; its verified archive is retained.',{exact:true}).waitFor();
  await exact(main,'Inspect archive '+fixture.notice_id).click();await main.getByRole('heading',{name:'Verified archive: '+fixture.notice_id,exact:true}).waitFor();await main.getByText('I reviewed the selected record and its retention scope',{exact:true}).click();await exact(main,'Restore read notification').click();await main.getByText('Notification restored. Approval and ownership state were not changed.',{exact:true}).waitFor();
  return {notice_id:fixture.notice_id,archive_cleanup_restore:true};
 });
 await criticalWorkflows({main,reviewer,login,fixture,origin,step,get,waitFor,screenshots});
 await step('tenant_isolation',async()=>{
  const foreign=await login('b');await get(foreign,'/investigations/'+fixture.details.case_id,404);await get(foreign,'/skills/'+fixture.skill.id,404);
  const inbox=await get(foreign,'/approvals?search='+fixture.memory.id);assert.equal(inbox.total,0);
  const policy=await get(foreign,'/build/retention?kind=notification');assert.equal(policy.items.length,0);assert.equal(policy.snapshots.length,0);
  return {session_tenant_bound:true,foreign_case_and_skill_denied:true,foreign_inbox_and_archives_empty:true};
 });
 await step('route_sweep',async()=>{
  const routes=[...sections.flatMap(s=>s.items.map(i=>i.path)),'/investigations/'+fixture.details.case_id,'/detect/rules/'+fixture.details.rule_id,'/hunt/threat-hunting/'+fixture.details.hunt_id,'/threat-intel/'+fixture.details.report_id,'/skills/'+fixture.skill.id,'/skills/new'];
  const results=[];
  for(const width of [1440,390]){
   await main.setViewportSize({width,height:1000});
   for(const [index,path] of routes.entries()){
    await main.goto(origin+path);await main.waitForLoadState('networkidle',{timeout:15000});
    const body=await main.locator('body').innerText();assert(!/Internal server error|Something went wrong|Refresh to retry/i.test(body),path);
    assert((await main.getByRole('heading').count())>0,'Missing workspace heading: '+path);
    assert(!(await main.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)),'Horizontal overflow: '+path);
    results.push({path,width,passed:true});report.route_checks++;save();
    if(index===0||path==='/build/retention'||path==='/respond/inbox'||path==='/threat-intel/'+fixture.details.report_id)await main.screenshot({path:join(screenshots,`route-${index}-${width}.png`),fullPage:true});
   }
  }
  return {routes:routes.length,checks:results};
 });
 assert.deepEqual(report.external_requests,[]);assert.deepEqual(report.page_errors,[]);assert.deepEqual(report.http_errors,[]);
 report.passed=true;delete report.current_stage;save();console.log('PASS fresh local browser release workflows');
}catch(e){report.failure={stage:report.current_stage||'setup',message:e.message.replace(/parity_fixture_[a-d]{40}/g,'[test credential]')};if(main&&!main.isClosed()&&await exact(main,'Sign out').isVisible().catch(()=>false)){await main.screenshot({path:join(screenshots,'failure.png'),fullPage:true}).catch(()=>{});}save();throw Error('Browser gate failed at '+report.failure.stage+'; see browser.json');}
finally{for(const c of contexts)await c.close();await browser.close();}
