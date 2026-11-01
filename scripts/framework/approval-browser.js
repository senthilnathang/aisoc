// Local anonymous drafting/denial smoke test. No operator credentials are read or transferred.
async page => {
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://localhost:8080/memory');
  await page.getByRole('button',{name:'Add an Insight',exact:true}).click();
  const name='approval-browser-'+Date.now();
  await page.getByLabel('Artifact',{exact:false}).fill(name);
  await page.getByLabel('Enterprise context',{exact:false}).fill('Synthetic JSON/demo context awaiting independent approval.');
  await page.getByRole('button',{name:'Save for independent approval',exact:true}).click();
  const row=page.getByRole('row').filter({hasText:name});
  await row.getByText('Pending approval',{exact:true}).waitFor();
  if(!await row.getByRole('button',{name:'Approve Memory proposal',exact:true}).isDisabled())throw Error('Author can approve in UI');
  const result=await page.evaluate(async name=>{
    const call=async(path,body)=>{const r=await fetch('/api/v1'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','X-Role':'approver'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};};
    const item=(await call('/enterprise-insights?search='+name)).data.items[0];
    const denied=await call('/enterprise-insights/'+item.id+'/lifecycle',{operation:'approve',expected_version:item.version,confirm:true,rationale:'Spoofed role must not authorize approval.'});
    const current=(await call('/enterprise-insights/'+item.id+'/lifecycle')).data;
    const skill=(await call('/skills',{name,content_markdown:'Synthetic saved skill awaiting independent approval.'})).data;
    const publication=await call('/skills/'+skill.id+'/publish',{expected_version:skill.version});
    return {memory_id:item.id,skill_id:skill.id,denied:denied.status,publication:publication.status,pending:current.approval_state==='pending',unchanged:current.version===item.version};
  },name);
  if(result.denied!==403||result.publication!==403||!result.pending||!result.unchanged)throw Error('Approval boundary failed');
  await page.screenshot({path:'/opt/aisoc/output/playwright/independent-approval-memory.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw Error('Mobile viewport overflow');
  await page.setViewportSize({width:1440,height:1000});
  await page.getByRole('button',{name:'Sign in as operator',exact:true}).click();
  if(!await page.getByRole('button',{name:'Sign in',exact:true}).isDisabled())throw Error('Empty credential submit enabled');
  await page.getByLabel('Operator access token').fill('invalid_fixture_credential_0000000000000000');
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.getByText('A valid credential is required.',{exact:true}).waitFor();
  await page.goto('http://localhost:8080/memory');
  return {passed:true,...result,invalid_login_denied:true,page_errors:errors};
}
