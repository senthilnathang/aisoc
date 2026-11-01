// Only runner-created test mappings may be edited; no application admin bypass.
import {chromium} from '../../frontend/node_modules/playwright/index.mjs';
import {readFileSync,writeFileSync,renameSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import assert from 'node:assert/strict';
const input=resolve(process.argv[2]),f=JSON.parse(readFileSync(input,'utf8')),out=dirname(dirname(input));
assert.equal(f.mode,'local/mock');assert.match(f.run_id,/^[a-f0-9]{32}$/);
for(const url of [f.origin,f.issuer]){assert.equal(new URL(url).hostname,'127.0.0.1');assert.equal(new URL(url).protocol,'http:');}
const path=process.env.AISOC_TEST_IDENTITY_MAPPINGS;assert(path&&path.startsWith('/tmp/aisoc-go-check-'),'Only disposable mappings may be edited');
const original=readFileSync(path,'utf8');const mappings=JSON.parse(original);
const update=()=>{writeFileSync(path+'.new',JSON.stringify(mappings),{mode:0o600});renameSync(path+'.new',path);};
const browser=await chromium.launch({executablePath:process.env.AISOC_RELEASE_CHROMIUM,headless:true});const contexts=[];
const report={run_id:f.run_id,mode:'local/mock',passed:false,browser_version:browser.version(),checks:{},external_requests:[],page_errors:[]};
const save=()=>writeFileSync(join(out,'identity.json'),JSON.stringify(report,null,2)+'\n');save();
const button=(p,name)=>p.getByRole('button',{name,exact:true});
async function login(subject){
 const c=await browser.newContext({viewport:{width:1440,height:1000}});contexts.push(c);
 await c.route('**/*',route=>{const u=new URL(route.request().url());if([f.origin,f.issuer].includes(u.origin))return route.continue();report.external_requests.push(u.origin+u.pathname);return route.abort();});
 const p=await c.newPage();p.on('pageerror',e=>report.page_errors.push(e.message));p.setDefaultTimeout(15000);
 await p.goto(f.origin+'/skills');await p.getByRole('link',{name:'Sign in with SSO',exact:true}).click();
 await p.getByRole('heading',{name:'Local mock identity provider',exact:true}).waitFor();await p.getByLabel('Test identity').selectOption(subject);
 await button(p,'Continue as test identity').click();await button(p,'Sign out').waitFor();return p;
}
async function info(p){return (await p.request.get(f.origin+'/api/v1/auth/session')).json();}
async function get(p,path,status=200){const r=await p.request.get(f.origin+'/api/v1'+path);assert.equal(r.status(),status);return r.json();}
async function publish(p,id,status){const s=await info(p),skill=await get(p,'/skills/'+id);const r=await p.request.post(f.origin+'/api/v1/skills/'+id+'/publish',{headers:{'X-CSRF-Token':s.csrf_token},data:{expected_version:skill.version}});assert.equal(r.status(),status);}
try{
 const a=await login('alice'),a2=await login('alice'),review=await login('reviewer'),foreign=await login('foreign');
 const s=await info(a);assert.equal(s.tenant_id,'auth-a');assert.equal(s.operator_id,'fixture-a');assert.deepEqual(s.roles,['proposer']);assert.equal(s.mode,'oidc');report.checks.trusted_mapping=true;
 await a.goto(f.origin+'/skills/'+f.skills[0].id);await a.waitForLoadState('networkidle');assert(await button(a,'Approve saved draft').isDisabled());await publish(a,f.skills[0].id,403);
 await get(foreign,'/skills/'+f.skills[0].id,404);const spoof=await a.request.get(f.origin+'/api/v1/skills/'+f.skills[0].id,{headers:{'X-Tenant-Id':'auth-b'}});assert.equal(spoof.status(),403);report.checks.tenant_isolation=true;
 await review.goto(f.origin+'/skills/'+f.skills[0].id);await review.waitForLoadState('networkidle');await button(review,'Approve saved draft').click();
 await review.getByText('Skill published',{exact:true}).waitFor();assert.equal((await get(review,'/skills/'+f.skills[0].id)).state,'published');report.checks.independent_approval=true;
 const noCSRF=await a.request.post(f.origin+'/api/v1/auth/logout-all');assert.equal(noCSRF.status(),403);
 await button(a,'Sign out all sessions').click();await a.getByRole('link',{name:'Sign in with SSO',exact:true}).waitFor();assert.equal((await info(a2)).authenticated,false);assert.equal((await info(review)).authenticated,true);
 await get(a2,'/skills',401);await a2.reload();await a2.getByRole('link',{name:'Sign in with SSO',exact:true}).waitFor();report.checks.logout_all=true;
 const authorMapping=mappings.find(x=>x.subject==='alice');authorMapping.roles=['proposer','approver'];authorMapping.generation++;update();
 const author=await login('alice');await author.goto(f.origin+'/skills/'+f.skills[1].id);await author.waitForLoadState('networkidle');assert(await button(author,'Approve saved draft').isDisabled());await publish(author,f.skills[1].id,403);report.self_approval_with_role_denied=true;
 authorMapping.roles=['proposer'];authorMapping.generation++;update();
 const mapping=mappings.find(x=>x.subject==='reviewer');mapping.roles=['proposer'];mapping.generation++;update();
 await get(review,'/skills',401);await review.reload();await review.getByRole('link',{name:'Sign in with SSO',exact:true}).waitFor();
 const changed=await login('reviewer');assert.deepEqual((await info(changed)).roles,['proposer']);await changed.goto(f.origin+'/skills/'+f.skills[1].id);await changed.waitForLoadState('networkidle');assert(await button(changed,'Approve saved draft').isDisabled());await publish(changed,f.skills[1].id,403);report.checks.role_change_revokes=true;
 mapping.disabled=true;mapping.generation++;update();assert.equal((await info(changed)).authenticated,false);await get(changed,'/skills',401);
 await changed.reload();await changed.getByRole('link',{name:'Sign in with SSO',exact:true}).click();await changed.getByLabel('Test identity').selectOption('reviewer');
 const denied=changed.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1/auth/oidc/callback');await button(changed,'Continue as test identity').click();assert.equal((await denied).status(),403);report.checks.disabled_identity_denied=true;
 const active=await login('alice');writeFileSync(path,'malformed',{mode:0o600});assert.equal((await info(active)).authenticated,false);await get(active,'/skills',401);report.checks.mapping_failure_closed=true;
 writeFileSync(path,original,{mode:0o600});await active.goto(f.origin+'/');await active.getByRole('link',{name:'Sign in with SSO',exact:true}).waitFor();
 for(const width of [1440,390]){await active.setViewportSize({width,height:1000});assert(!await active.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1));await active.screenshot({path:join(out,'screenshots','sso-signin-'+width+'.png'),fullPage:true});}
 assert.deepEqual(report.page_errors,[]);assert.deepEqual(report.external_requests,[]);report.checks.browser_redirect=true;report.passed=true;save();console.log('PASS local mock OIDC browser/API checks');
}catch(e){report.error=e.message;save();throw Error('OIDC release checks failed; see identity.json');}
finally{writeFileSync(path,original,{mode:0o600});for(const c of contexts)await c.close();await browser.close();}
