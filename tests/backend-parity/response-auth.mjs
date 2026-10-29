import assert from 'node:assert/strict';
import {argumentsFor,target,output} from './harness.mjs';
const options=argumentsFor(),server=await target({...options,auth:'token'});
const token='parity_fixture_'+'a'.repeat(40),other='parity_fixture_'+'b'.repeat(40);
let count=0;
async function call(method,path,status,headers={},body){const response=await fetch(server.url+path,{method,headers:{...(body===undefined?{}:{'content-type':'application/json'}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(10000)});const text=await response.text(),data=text?JSON.parse(text):null;assert.equal(response.status,status,method+' '+path+' '+text);count++;return {response,data,text};}
try{
  const path='/api/v1/response-plans';
  assert.equal((await call('GET','/api/v1/auth/session',200)).data.authenticated,false);
  await call('GET',path,401);await call('GET',path,401,{authorization:'Basic invalid'});
  await call('GET',path,403,{authorization:'Bearer '+token,'x-tenant-id':'auth-b'});
  await call('POST','/api/v1/auth/login',403,{authorization:'Bearer '+token,origin:'https://untrusted.example'});
  const created=await call('POST',path,201,{authorization:'Bearer '+token},{kind:'runbook',title:'Authenticated',description:'Test',domain:'Identity',trigger:'Incident',steps:[{title:'Check',instructions:'Review',approval_required:false}]});
  await call('GET',path+'/'+created.data.id,404,{authorization:'Bearer '+other});
  await call('POST',path+'/'+created.data.id+'/state',404,{authorization:'Bearer '+other},{expected_version:1,state:'archived'});
  const login=await call('POST','/api/v1/auth/login',200,{authorization:'Bearer '+token,origin:'http://localhost:8080'});
  assert.ok(!login.text.includes(token));const setCookie=login.response.headers.get('set-cookie');assert.match(setCookie,/HttpOnly/);assert.match(setCookie,/SameSite=Strict/);assert.match(setCookie,/Path=\/api/);
  const cookie=setCookie.split(';')[0],csrf=login.data.csrf_token;
  const session=await call('GET','/api/v1/auth/session',200,{cookie});assert.equal(session.data.tenant_id,'auth-a');assert.equal(session.response.headers.get('cache-control'),'no-store');
  await call('GET',path,200,{cookie});await call('GET',path,403,{cookie,'x-tenant-id':'auth-b'});
  await call('GET',path,401,{cookie:cookie+'; '+cookie});
  await call('POST',path+'/'+created.data.id+'/state',403,{cookie},{expected_version:1,state:'archived'});
  await call('POST',path+'/'+created.data.id+'/state',403,{cookie,'x-csrf-token':'wrong'},{expected_version:1,state:'archived'});
  await call('POST',path+'/'+created.data.id+'/state',403,{cookie,'x-csrf-token':csrf,origin:'https://untrusted.example'},{expected_version:1,state:'archived'});
  await call('POST',path+'/'+created.data.id+'/state',200,{cookie,'x-csrf-token':csrf},{expected_version:1,state:'archived'});
  const history=await call('GET',path+'/'+created.data.id+'/history',200,{cookie});assert.equal(history.data.items[0].actor,'fixture-a');
  const replacement=await call('POST','/api/v1/auth/login',200,{authorization:'Bearer '+token,cookie});
  await call('GET',path,401,{cookie});
  const nextCookie=replacement.response.headers.get('set-cookie').split(';')[0];
  await call('POST','/api/v1/auth/logout',403,{cookie:nextCookie});
  await call('POST','/api/v1/auth/logout',204,{cookie:nextCookie,'x-csrf-token':replacement.data.csrf_token});
  await call('GET',path,401,{cookie:nextCookie});
  assert.equal((await call('GET','/api/v1/auth/session',200,{cookie:nextCookie})).data.authenticated,false);
  if(options['with-cases']){
    const operator={authorization:'Bearer '+token},foreign={authorization:'Bearer '+other};
    const investigation=await call('POST','/api/v1/investigations',201,operator,{title:'Authenticated runbook case',source:'Fixture',severity:'high'});
    const casePath='/api/v1/investigations/'+investigation.data.id;
    await call('GET','/api/v1/investigation-queue',401);
    await call('GET','/api/v1/investigation-queue',403,{...operator,'x-tenant-id':'auth-b'});
    const queue=await call('GET','/api/v1/investigation-queue',200,operator);assert.ok(queue.data.items.some(item=>item.id===investigation.data.id));
    const otherQueue=await call('GET','/api/v1/investigation-queue',200,foreign);assert.ok(!otherQueue.data.items.some(item=>item.id===investigation.data.id));
    await call('POST',path+'/'+created.data.id+'/state',200,operator,{expected_version:2,state:'active'});
    await call('GET',casePath,401);await call('GET',casePath,404,foreign);
    await call('POST',casePath+'/runbooks',404,foreign,{plan_id:created.data.id,expected_version:3});
    const attached=await call('POST',casePath+'/runbooks',201,operator,{plan_id:created.data.id,expected_version:3});
    await call('PATCH',casePath+'/runbooks/'+attached.data.id,404,foreign,{expected_version:1,step_index:0,completed:true,note:'Test',approval_confirmed:false});
    const fresh=await call('POST','/api/v1/auth/login',200,operator);const authCookie=fresh.response.headers.get('set-cookie').split(';')[0];
    await call('PATCH',casePath+'/runbooks/'+attached.data.id,403,{cookie:authCookie},{expected_version:1,step_index:0,completed:true,note:'Test',approval_confirmed:false});
    await call('PATCH',casePath+'/runbooks/'+attached.data.id,200,{cookie:authCookie,'x-csrf-token':fresh.data.csrf_token},{expected_version:1,step_index:0,completed:true,note:'Test',approval_confirmed:false});
    const runbooks=await call('GET',casePath+'/runbooks',200,operator);assert.equal(runbooks.data.items[0].history[0].actor,'fixture-a');
    const events=await call('GET',casePath+'/history',200,operator);assert.equal(events.data.items[0].details.actor,'fixture-a');
    for(const [suffix,body,status] of [['artifacts',{type:'ip',value:'192.0.2.1'},201],['feedback',{comment:'Reviewed'},201],['determination',{determination:'benign'},200],['reinvestigate',undefined,200]]){
      await call('POST',casePath+'/'+suffix,403,{cookie:authCookie},body);
      await call('POST',casePath+'/'+suffix,404,foreign,body);
      await call('POST',casePath+'/'+suffix,status,{cookie:authCookie,'x-csrf-token':fresh.data.csrf_token},body);
    }
    await call('PATCH',casePath,403,{cookie:authCookie},{summary:'Denied'});
    await call('PATCH',casePath,404,foreign,{summary:'Denied'});
    await call('PATCH',casePath,200,{cookie:authCookie,'x-csrf-token':fresh.data.csrf_token},{summary:'Authenticated edit'});
    const simulation={investigation_id:investigation.data.id,action_type:'test',title:'Simulation'};
    await call('POST','/api/v1/remediations',403,{cookie:authCookie},simulation);
    const remediation=await call('POST','/api/v1/remediations',201,operator,simulation);
    const remediationPath='/api/v1/remediations/'+remediation.data.id;
    for(const [method,suffix,body,status] of [['PATCH','',{description:'Edited'},200],['POST','/execute',undefined,200],['DELETE','',undefined,204]]){
      await call(method,remediationPath+suffix,403,{cookie:authCookie},body);
      await call(method,remediationPath+suffix,404,foreign,body);
      await call(method,remediationPath+suffix,status,{cookie:authCookie,'x-csrf-token':fresh.data.csrf_token},body);
    }
    await call('DELETE',casePath,404,foreign);await call('DELETE',casePath,204,operator);
    const rule=await call('POST','/api/v1/detection-rules',201,operator,{name:'Authenticated rule',severity:'high'});
    const rulePath='/api/v1/detection-rules/'+rule.data.id;
    await call('GET','/api/v1/detection-registry',401);
    await call('GET','/api/v1/detection-registry',403,{...operator,'x-tenant-id':'auth-b'});
    const registry=await call('GET','/api/v1/detection-registry',200,{cookie:authCookie});assert.ok(registry.data.items.some(r=>r.id===rule.data.id));
    const foreignRegistry=await call('GET','/api/v1/detection-registry',200,foreign);assert.ok(!foreignRegistry.data.items.some(r=>r.id===rule.data.id));
    await call('GET',rulePath,401);await call('GET',rulePath,404,foreign);
    for(const [method,suffix,body,status] of [['PATCH','',{description:'Reviewed'},200],['POST','/toggle',undefined,200],['POST','/clone',undefined,201]]){
      await call(method,rulePath+suffix,403,{cookie:authCookie},body);
      await call(method,rulePath+suffix,404,foreign,body);
      await call(method,rulePath+suffix,status,{cookie:authCookie,'x-csrf-token':fresh.data.csrf_token},body);
    }
    const ruleHistory=await call('GET',rulePath+'/history',200,operator);assert.equal(ruleHistory.data.items[0].action,'updated');
    const sourceInput={name:'Authenticated source',provider:'Auth provider',rule_id:rule.data.id};
    await call('POST','/api/v1/api-sources',403,{cookie:authCookie},sourceInput);
    const source=await call('POST','/api/v1/api-sources',201,operator,sourceInput);const sourcePath='/api/v1/api-sources/'+source.data.source.id;
    await call('PATCH',rulePath,200,operator,{enabled:true,routing:'Suppress'});
    const directBody={source:'Operator sensor',external_id:'direct',rule_id:rule.data.id,title:'Direct event',severity:'low'};
    await call('POST','/api/v1/alerts',401,{},directBody);
    await call('POST','/api/v1/alerts',403,{cookie:authCookie},directBody);
    await call('POST','/api/v1/alerts',403,{cookie:authCookie,'x-csrf-token':fresh.data.csrf_token,origin:'https://untrusted.example'},directBody);
    await call('POST','/api/v1/alerts',403,{...operator,'x-tenant-id':'auth-b'},directBody);
    await call('POST','/api/v1/alerts',404,foreign,directBody);
    await call('POST','/api/v1/alerts',201,{cookie:authCookie,'x-csrf-token':fresh.data.csrf_token},directBody);
    await call('POST','/api/v1/alerts',200,operator,directBody);
    await call('GET','/api/v1/detection-intelligence',401);
    await call('GET','/api/v1/detection-intelligence',403,{...operator,'x-tenant-id':'auth-b'});
    const intel=await call('GET','/api/v1/detection-intelligence?source=Operator%20sensor',200,{cookie:authCookie});assert.equal(intel.data.totals.total_alerts,1);
    const foreignIntel=await call('GET','/api/v1/detection-intelligence',200,foreign);assert.equal(foreignIntel.data.totals.total_alerts,0);assert.deepEqual(foreignIntel.data.sources,[]);
    await call('GET','/api/v1/dashboard',401);await call('GET','/api/v1/dashboard',401,{authorization:'Bearer '+source.data.api_key});await call('GET','/api/v1/dashboard',403,{...operator,'x-tenant-id':'auth-b'});
    const dashboard=await call('GET','/api/v1/dashboard',200,{cookie:authCookie});assert.deepEqual(dashboard.data.recentInvestigations,[]);assert.equal(dashboard.data.queueItems,0);assert.equal(dashboard.data.openInvestigations,0);
    const foreignDashboard=await call('GET','/api/v1/dashboard',200,foreign);assert.ok(foreignDashboard.data.recentInvestigations.every(i=>i.tenant_id==='auth-b'));
    const skillRoot='/api/v1/skills',skillBody={name:'Authenticated skill'};
    await call('GET',skillRoot,401);await call('POST',skillRoot,403,{cookie:authCookie},skillBody);await call('GET',skillRoot,401,{authorization:'Bearer '+source.data.api_key});
    const skill=await call('POST',skillRoot,201,operator,skillBody),skillPath=skillRoot+'/'+skill.data.id;assert.equal(skill.data.created_by,'fixture-a');
    for(const [method,suffix,body]of [['GET',''],['PATCH','',{}],['DELETE',''],['POST','/publish'],['POST','/toggle']])await call(method,skillPath+suffix,404,foreign,body);
    await call('PATCH',skillPath,403,{cookie:authCookie},{});await call('POST',skillPath+'/publish',200,{cookie:authCookie,'x-csrf-token':fresh.data.csrf_token});
    const materialBody={name:'Guide.txt',content:'Review evidence'};await call('POST',skillPath+'/materials',403,{cookie:authCookie},materialBody);const material=await call('POST',skillPath+'/materials',201,operator,materialBody),materialPath=skillPath+'/materials/'+material.data.id;
    await call('GET',materialPath,404,foreign);await call('GET',materialPath+'/versions',404,foreign);await call('PATCH',materialPath,403,{cookie:authCookie},{content:'Edit'});await call('DELETE',materialPath,403,{cookie:authCookie});
    await call('PATCH',materialPath,200,operator,{content:'Edited'});assert.equal((await call('GET',skillPath+'/history',200,operator)).data.items[0].details.actor,'fixture-a');
    await call('DELETE',materialPath,204,operator);await call('DELETE',skillPath,204,operator);
    const connectorRoot='/api/v1/connectors',connectorBody={type:'crowdstrike',name:'Authenticated connector',secret:'auth-fixture-secret'};
    await call('GET',connectorRoot,401);await call('POST',connectorRoot,401,{},connectorBody);await call('POST',connectorRoot,403,{cookie:authCookie},connectorBody);
    const connector=await call('POST',connectorRoot,201,{cookie:authCookie,'x-csrf-token':fresh.data.csrf_token},connectorBody),connectorPath=connectorRoot+'/'+connector.data.id;
    assert.equal(connector.data.secret,undefined);assert.equal(connector.data.secret_ciphertext,undefined);
    await call('GET',connectorRoot,401,{authorization:'Bearer '+source.data.api_key});await call('GET',connectorRoot,403,{...operator,'x-tenant-id':'auth-b'});
    assert.deepEqual((await call('GET',connectorRoot,200,foreign)).data.items,[]);
    for(const [method,suffix,body]of [['GET',''],['PATCH','',{secret:'foreign'}],['DELETE',''],['POST','/test']])await call(method,connectorPath+suffix,404,foreign,body);
    for(const [method,suffix,body]of [['PATCH','',{secret:'rotated'}],['DELETE',''],['POST','/test']])await call(method,connectorPath+suffix,403,{cookie:authCookie},body);
    await call('PATCH',connectorPath,200,operator,{secret:'auth-fixture-rotated'});assert.equal((await call('POST',connectorPath+'/test',200,operator)).data.test_result.status,'not_configured');
    await call('DELETE',connectorPath,204,{cookie:authCookie,'x-csrf-token':fresh.data.csrf_token});
    const huntRoot='/api/v1/hunts',huntBody={name:'Authenticated hunt',query:'opaque query'};
    await call('GET',huntRoot,401);await call('POST',huntRoot,401,{},huntBody);await call('POST',huntRoot,403,{cookie:authCookie},huntBody);
    const hunt=await call('POST',huntRoot,201,{cookie:authCookie,'x-csrf-token':fresh.data.csrf_token},huntBody),huntPath=huntRoot+'/'+hunt.data.id;
    await call('GET',huntRoot,401,{authorization:'Bearer '+source.data.api_key});await call('GET',huntRoot,403,{...operator,'x-tenant-id':'auth-b'});
    assert.deepEqual((await call('GET',huntRoot,200,foreign)).data.items,[]);await call('GET',huntPath,200,{cookie:authCookie});
    for(const [method,suffix,body]of [['GET',''],['PATCH','',{}],['DELETE',''],['POST','/run']])await call(method,huntPath+suffix,404,foreign,body);
    for(const [method,suffix,body]of [['PATCH','',{}],['DELETE',''],['POST','/run']])await call(method,huntPath+suffix,403,{cookie:authCookie},body);
    await call('PATCH',huntPath,200,operator,{name:'Edited hunt'});assert.equal((await call('POST',huntPath+'/run',200,operator)).data.status,'completed');
    await call('DELETE',huntPath,204,{cookie:authCookie,'x-csrf-token':fresh.data.csrf_token});
    const reportBody={title:'Authenticated report',severity:'high'},reportRoot='/api/v1/threat-intel-reports',indicatorRoot='/api/v1/threat-indicators';
    await call('POST',reportRoot,401,{},reportBody);await call('POST',reportRoot,403,{cookie:authCookie},reportBody);
    const report=await call('POST',reportRoot,201,{cookie:authCookie,'x-csrf-token':fresh.data.csrf_token},reportBody),reportPath=reportRoot+'/'+report.data.id;
    const indicator=await call('POST',indicatorRoot,201,operator,{report_id:report.data.id,indicator_type:'ip',value:'192.0.2.3'}),indicatorPath=indicatorRoot+'/'+indicator.data.id;
    for(const root of [reportRoot,indicatorRoot,'/api/v1/threat-intel/dashboard']){
      await call('GET',root,401);await call('GET',root,401,{authorization:'Bearer '+source.data.api_key});await call('GET',root,403,{...operator,'x-tenant-id':'auth-b'});
    }
    for(const path of [reportPath,indicatorPath]){
      await call('GET',path,404,foreign);await call('PATCH',path,404,foreign,{});await call('DELETE',path,404,foreign);
      await call('PATCH',path,403,{cookie:authCookie},{});await call('DELETE',path,403,{cookie:authCookie});
      await call('GET',path,200,{cookie:authCookie});
    }
    await call('POST',reportPath+'/launch-hunt',403,{cookie:authCookie});await call('POST',reportPath+'/launch-hunt',404,foreign);await call('POST',reportPath+'/launch-hunt',200,operator);
    assert.equal((await call('GET','/api/v1/threat-intel/dashboard',200,foreign)).data.totalReports,0);
    const intakePath='/api/v1/intake/'+source.data.source.id+'/alerts',intakeBody={external_id:'auth-intake',title:'Authenticated event',severity:'low'},sourceCredential={authorization:'Bearer '+source.data.api_key};
    await call('POST',intakePath,401,operator,intakeBody);await call('POST',intakePath,401,{cookie:authCookie},intakeBody);
    await call('POST',intakePath,403,{...sourceCredential,'x-tenant-id':'auth-b'},intakeBody);
    await call('POST',intakePath,201,sourceCredential,intakeBody);await call('POST',intakePath,200,sourceCredential,intakeBody);
    await call('GET','/api/v1/alerts',401,sourceCredential);
    await call('GET',sourcePath,401);await call('GET',sourcePath,404,foreign);
    const mappingBody={mapping:{fields:{external_id:'id',title:'title',severity:'severity'}},sample:{id:'auth',title:'Auth',severity:'low'}};
    for(const [method,suffix]of [['PATCH','/mapping'],['POST','/mapping/preview']]){
      await call(method,sourcePath+suffix,403,{cookie:authCookie},mappingBody);
      await call(method,sourcePath+suffix,404,foreign,mappingBody);
      await call(method,sourcePath+suffix,200,{cookie:authCookie,'x-csrf-token':fresh.data.csrf_token},mappingBody);
    }
    await call('GET','/api/v1/api-sources',403,{...operator,'x-tenant-id':'auth-b'});
    const foreignSources=await call('GET','/api/v1/api-sources',200,foreign);assert.ok(!foreignSources.data.items.some(s=>s.id===source.data.source.id));
    for(const suffix of ['/rotate-key','/revoke']){
      await call('POST',sourcePath+suffix,403,{cookie:authCookie},{});
      await call('POST',sourcePath+suffix,404,foreign,{});
      await call('POST',sourcePath+suffix,200,{cookie:authCookie,'x-csrf-token':fresh.data.csrf_token},{});
    }
    await call('DELETE',rulePath,403,{cookie:authCookie});await call('DELETE',rulePath,404,foreign);await call('DELETE',rulePath,409,operator);
  }
  await output(options.output||'output/backend-parity/response-auth.json',{passed:true,backend:options.label||(server.owned?'node':'external'),check_count:count,checks:['operator credentials','tenant read/write binding','cookie flags','CSRF and origin rejection','actor attribution','duplicate cookie rejection','session rotation and logout']});
  console.log('PASS response authentication and tenant isolation');
}finally{await server.close();}
