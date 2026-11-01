// Regression fixtures for cross-workspace review. No database mutations.
async page => {
 const origin='http://127.0.0.1:8080',results=[];
 const ensure=(v,m)=>{if(!v)throw Error(m)};
 async function check(name,fn){try{await fn();results.push({name,passed:true})}catch(e){results.push({name,passed:false,error:e.message})}finally{await page.unrouteAll({behavior:'wait'})}}
 const reply=(route,body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
 await check('overview uses actual empty tenant data',async()=>{
  await page.route('**/api/v1/dashboard',r=>reply(r,{queueItems:0,openInvestigations:0,openRemediations:0,enabledDetectionRules:0,operationalConnectors:0,recentInvestigations:[]}));await page.goto(origin+'/');await page.waitForLoadState('networkidle');
  const body=await page.locator('body').innerText();ensure(!/Cobalt Strike C2|84%|CRXfiltrate|OPERATIONAL|14\s*Escalated/.test(body),'sample operational facts still rendered');
 });
 await check('approvals query server status and support next page',async()=>{
  let statusSeen=false,offsetSeen=false;
  await page.route('**/api/v1/remediations/summary',r=>reply(r,{pending:50,completed:100,cases:1,workflows:0}));
  await page.route('**/api/v1/remediations?*',async r=>{const u=new URL(r.request().url());if(u.pathname.endsWith('/summary'))return reply(r,{pending:50,completed:100,cases:1,workflows:0});statusSeen=u.searchParams.get('status')==='pending';offsetSeen ||= Number(u.searchParams.get('offset'))>0;const size=Number(u.searchParams.get('limit')||100);return reply(r,{items:statusSeen?Array.from({length:size},(_,i)=>({id:'r'+i,title:offsetSeen?'Older pending action '+i:'Pending action '+i,status:'pending',investigation_id:'case-local'})):[]});});
  await page.route('**/api/v1/remediations',r=>reply(r,{items:[]}));await page.goto(origin+'/respond/approvals');await page.waitForLoadState('networkidle');ensure(statusSeen,'pending status not sent to server');await page.getByRole('button',{name:'Next',exact:true}).click();await page.getByRole('button',{name:'Older pending action 0',exact:true}).waitFor();ensure(offsetSeen,'offset not sent');const search=page.getByLabel('Search response records',{exact:true});await search.pressSequentially('identity',{delay:120});ensure(await search.inputValue()==='identity','search lost focus while refreshing');
 });
 await check('source rule selector supports server search',async()=>{
  await page.route('**/api/v1/detection-rules*',r=>{const u=new URL(r.request().url());return reply(r,{items:u.searchParams.get('search')==='older'?[{id:'rule-older',name:'Older rule beyond first page',enabled:true}]:[]});});
  await page.goto(origin+'/build/api-sources');await page.getByRole('button',{name:'Add API source',exact:true}).click();const input=page.getByLabel('Search detection rules',{exact:true});ensure(await input.count()===1,'rule selector has no server search');await input.fill('older');await page.getByRole('option',{name:'Older rule beyond first page',exact:true}).waitFor({state:'attached'});
 });
 await check('connector setup does not promise unsupported live checks',async()=>{
  await page.goto(origin+'/build/connectors/cribl');await page.waitForLoadState('networkidle');const body=await page.locator('body').innerText();ensure(!/heartcheck will run automatically|credentials are accepted/.test(body),'unsupported live validation promised');ensure(/not supported|not available/i.test(body),'missing live capability boundary');
 });
 await check('connector save stores config without provider test',async()=>{
  let saved=false,tested=false;
  await page.route('**/api/v1/connectors*',r=>{if(r.request().method()==='POST'){if(new URL(r.request().url()).pathname.endsWith('/test'))tested=true;else saved=r.request().postDataJSON().type==='cribl';return reply(r,{id:'fixture-connector',status:'unconfigured'},201)}return r.continue()});
  await page.goto(origin+'/build/connectors/cribl');await page.getByLabel(/^Connection name/).fill('Review fixture');await page.getByLabel(/^Cribl Workspace URL/).fill('https://example.invalid');await page.getByLabel(/^Client ID/).fill('fixture-client');await page.getByLabel(/^Client Secret/).fill('fixture-secret');await page.getByRole('button',{name:'Add connector',exact:true}).click();await page.getByRole('heading',{name:'Build around your environment',exact:true}).waitFor();ensure(saved&&!tested,'unexpected provider test or missing save');
 });
 await check('overview read failure is explicit and retry recovers',async()=>{
  let fail=true;await page.route('**/api/v1/dashboard',r=>reply(r,fail?{error:{message:'Fixture unavailable'}}:{queueItems:0,openInvestigations:0,openRemediations:0,enabledDetectionRules:0,operationalConnectors:0,recentInvestigations:[]},fail?503:200));await page.goto(origin+'/');await page.getByRole('alert').filter({hasText:'Overview could not be loaded: Fixture unavailable'}).waitFor();ensure(await page.getByText('Cobalt Strike C2',{exact:true}).count()===0,'sample fallback');fail=false;await page.getByRole('button',{name:'Retry',exact:true}).click();await page.getByText('No investigations recorded for this tenant.',{exact:true}).waitFor();
 });
 await page.goto(origin+'/');return{passed:results.every(r=>r.passed),results};
}
