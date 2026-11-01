// Real local/mock APIs; retains one Memory record, source case, hunt and promoted case.
async page => {
 const origin='http://127.0.0.1:8080',base=origin+'/api/v1';
 const canonical=v=>JSON.stringify(v,(_,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))):value);
 const request=async(path,data,method='POST')=>{const r=await page.request.fetch(base+path,{method,data});if(!r.ok())throw Error(`${path}: ${r.status()} ${await r.text()}`);return r.json()};
 const key='memory-browser-'+Date.now(),content='Approved local context: review current MFA; do not assume benign activity.';
 const memory={id:'EI-'+key,artifact:key,kind:'user',content,hint:'benign',valid_until:new Date(Date.now()+3600000).toISOString()};
 await request('/enterprise-insights',memory);
 await request('/investigations',{title:'Memory browser evidence '+key,summary:'Synthetic local login observation.',source:'local-json',category:'identity',severity:'medium',status:'open',determination:'unknown',primary_entity:key,insight_refs:[]});
 const hunt=await request('/hunts',{name:'Memory snapshot showcase '+key,query:key});
 const path='/hunt/threat-hunting/'+hunt.id;
 const errors=[];const capture=e=>errors.push(e.message);page.on('pageerror',capture);
 try {
  await page.setViewportSize({width:1440,height:1000});await page.goto(origin+path);
  await page.getByRole('button',{name:'Run local search',exact:true}).click();
  await page.getByText(content,{exact:true}).waitFor();
  const state=await request('/hunts/'+hunt.id+'/workspace',undefined,'GET'),run=state.runs[0];
  if(run.memory.length!==1||run.memory[0].id!==memory.id||run.verdict!=='review_required')throw Error('Snapshot/independent verdict mismatch');
  await page.screenshot({path:'output/playwright/memory-hunt-current.png',fullPage:true});
  const {id,...fields}=memory;
  await request('/enterprise-insights/'+id,{...fields,content:'Changed context must not replace historical snapshots.',valid_until:new Date(Date.now()-60000).toISOString(),expected_version:1},'PUT');
  await page.getByRole('button',{name:'Run local search',exact:true}).click();
  await page.getByText('No eligible Memory matched this run. Missing context does not establish safety.',{exact:true}).waitFor();
  await page.getByLabel('Search history',{exact:true}).selectOption(run.id);
  await page.getByText(content,{exact:true}).waitFor();
  await page.getByText('Within configured validity window',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Promote to investigation',exact:true}).first().click();
  await page.getByLabel('Promotion review comment').fill('Reviewed this synthetic finding; keep historical Memory advisory.');
  await page.getByRole('checkbox',{name:'I reviewed this saved finding and want to investigate it.'}).focus();await page.keyboard.press('Space');
  await page.getByRole('button',{name:'Confirm promotion',exact:true}).click();
  await page.getByRole('button',{name:'Open promoted investigation →',exact:true}).first().click();
  await page.getByText(content,{exact:true}).waitFor();
  await page.getByText('Within configured validity window',{exact:true}).waitFor();
  await page.screenshot({path:'output/playwright/memory-hunt-promoted.png',fullPage:true});
  const promoted=(await request('/hunts/'+hunt.id+'/workspace',undefined,'GET')).promotions[0];
  const investigation=await request('/investigations/'+promoted.investigation_id,undefined,'GET');
  if(investigation.determination!=='unknown'||canonical(promoted.memory)!==canonical(run.memory))throw Error('Historical promotion or determination mismatch');
  await page.goto(origin+'/memory');
  await page.getByRole('textbox',{name:/search/i}).fill(key);
  await page.getByRole('button',{name:'View hunt uses',exact:true}).click();
  await page.getByRole('heading',{name:'Hunt applications',exact:true}).waitFor();
  await page.getByRole('button',{name:hunt.name,exact:true}).click();
  await page.getByLabel('Search history',{exact:true}).selectOption(run.id);
  await page.setViewportSize({width:390,height:844});
  await page.getByText(content,{exact:true}).waitFor();
  if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw Error('Horizontal overflow');
  await page.screenshot({path:'output/playwright/memory-hunt-mobile.png',fullPage:true});
  if(errors.length)throw Error(errors.join('\n'));
  return {passed:true,hunt_id:hunt.id,memory_id:id,promoted_case:promoted.investigation_id,expired_excluded:true,immutable_history:true,promotion:true,usage_navigation:true,mobile:true,console_errors:errors};
 }finally {page.off('pageerror',capture);await page.setViewportSize({width:1440,height:1000})}
}
