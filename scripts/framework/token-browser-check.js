// Playwright CLI snippet: run-code --filename scripts/framework/token-browser-check.js
// Requires token-preview.py --ttl-ms 10000 and a freshly inspected sign-in page.
async page => {
  if (new URL(page.url()).origin !== 'http://127.0.0.1:8082') throw new Error('Use the isolated token preview');
  const checks = [];
  const ensure = (condition, message) => { if (!condition) throw new Error(message); };
  const token = key => 'parity_fixture_' + key.repeat(40); // PUBLIC TEST credential.
  const login = async key => {
    await page.getByRole('textbox', {name:'Operator access token'}).fill(token(key));
    await page.getByRole('button', {name:'Sign in', exact:true}).click();
    await page.getByRole('button', {name:'Sign out', exact:true}).waitFor();
    await page.waitForLoadState('networkidle');
  };
  const api = (method, path, body, headers={}) => page.evaluate(async ({method,path,body,headers}) => {
    const response = await fetch('/api/v1'+path,{method,headers:{...(body===undefined?{}:{'content-type':'application/json'}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const text = await response.text();
    return {status:response.status,body:text?JSON.parse(text):null};
  }, {method,path,body,headers});
  await page.getByRole('textbox', {name:'Operator access token'}).fill('invalid_fixture');
  await page.getByRole('button', {name:'Sign in', exact:true}).click();
  await page.getByRole('alert').waitFor();
  ensure(await page.getByRole('textbox', {name:'Operator access token'}).inputValue()==='', 'Failed login retained credential');
  checks.push('invalid login feedback and credential clearing');
  await login('a');
  let session = await api('GET','/auth/session');
  ensure(session.body.tenant_id==='browser-auth-a', 'Wrong session tenant');
  const cookie = (await page.context().cookies()).find(c=>c.httpOnly);
  ensure(cookie && cookie.sameSite==='Strict' && cookie.path==='/api', 'Cookie flags missing');
  ensure(!(await page.evaluate(()=>document.cookie)).includes(cookie.name+'='), 'Session cookie accessible to JavaScript');
  checks.push('operator login and HttpOnly/SameSite cookie');
  await page.setViewportSize({width:1440,height:900});
  await page.screenshot({path:'output/playwright/go-token-desktop.png',fullPage:true});
  const draft={kind:'runbook',title:'Token browser fixture',description:'Temporary test',domain:'Identity',trigger:'Review',steps:[{title:'Verify',instructions:'Confirm scope',approval_required:true}]};
  ensure((await api('POST','/response-plans',draft)).status===403,'CSRF-less mutation accepted');
  ensure((await api('POST','/response-plans',draft,{'x-csrf-token':'wrong'})).status===403,'Wrong CSRF accepted');
  ensure((await api('GET','/response-plans',undefined,{'x-tenant-id':'browser-auth-b'})).status===403,'Tenant override accepted');
  const originDenied=await page.request.post('http://127.0.0.1:8082/api/v1/response-plans',{headers:{origin:'https://untrusted.example','x-csrf-token':session.body.csrf_token},data:draft});
  ensure(originDenied.status()===403,'Foreign origin accepted');
  const created=await api('POST','/response-plans',draft,{'x-csrf-token':session.body.csrf_token});
  ensure(created.status===201,'Valid session mutation rejected');
  const id=created.body.id;
  const history=await api('GET','/response-plans/'+id+'/history');
  ensure(history.body.items[0].actor==='browser-a','Wrong audit actor');
  checks.push('CSRF, origin and tenant rejection; valid cookie mutation and actor');
  // A rotated cookie invalidates the old session, and the UI reload retrieves fresh CSRF.
  const rotated=await page.request.post('http://127.0.0.1:8082/api/v1/auth/login',{headers:{authorization:'Bearer '+token('a')}});
  ensure(rotated.status()===200,'Session rotation failed');
  const oldSession=await page.request.get('http://127.0.0.1:8082/api/v1/response-plans',{headers:{cookie:cookie.name+'='+cookie.value}});
  ensure(oldSession.status()===401,'Old rotated session still accepted');
  ensure((await api('POST','/response-plans',draft,{'x-csrf-token':session.body.csrf_token})).status===403,'Old CSRF accepted after rotation');
  await page.reload();await page.getByRole('button',{name:'Sign out',exact:true}).waitFor();
  session=await api('GET','/auth/session');
  ensure((await api('POST','/response-plans/'+id+'/state',{expected_version:1,state:'archived'},{'x-csrf-token':session.body.csrf_token})).status===200,'Reload did not recover session');
  await page.getByRole('button',{name:'Sign out',exact:true}).click();
  await page.getByRole('textbox',{name:'Operator access token'}).waitFor();
  ensure((await api('GET','/response-plans')).status===401,'Logout retained access');
  checks.push('session rotation, stale cookie/CSRF rejection, reload recovery and UI logout');
  await login('a');
  await page.waitForTimeout(11000);
  await page.getByRole('button',{name:'Refresh',exact:true}).click();
  await page.getByRole('textbox',{name:'Operator access token'}).waitFor();
  await page.getByText('Your session ended. Sign in again.').waitFor();
  checks.push('expired API request returns UI to sign-in');
  await page.setViewportSize({width:390,height:844});
  await login('b');
  ensure((await api('GET','/response-plans/'+id)).status===404,'Other operator read foreign plan');
  await page.screenshot({path:'output/playwright/go-token-mobile.png',fullPage:true});
  await page.getByRole('button',{name:'Sign out',exact:true}).click();
  await page.getByRole('textbox',{name:'Operator access token'}).waitFor();
  checks.push('mobile login/logout and cross-operator isolation');
  await page.evaluate(report=>localStorage.setItem('go-token-review',JSON.stringify(report)),{passed:true,checks});
}
