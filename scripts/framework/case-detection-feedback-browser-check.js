// Local-only UI regression. All label writes are intercepted; existing data is preserved.
async page => {
 const origin=new URL(page.url()).origin;
 if(!['http://127.0.0.1:8080','http://localhost:8080'].includes(origin))throw Error('Local app only');
 const cases=await (await page.request.get(origin+'/api/v1/investigations?limit=100')).json();
 const list=Array.isArray(cases)?cases:cases.items;
 if(!list?.length)throw Error('A local demo investigation is required');
 const id=list[0].id,path='/api/v1/investigations/'+id+'/detection-feedback';
 const item={id:'fixture-alert',rule_id:'mock-stream-login',rule_name:'Local fixture',rule_version:1,rule_enabled:false,title:'Synthetic source evidence',source:'local-json',created_at:new Date().toISOString(),severity:'high',summary:'Synthetic browser fixture',label:'unreviewed',label_version:0};
 const checks=[],writes=[],errors=[];const onError=e=>errors.push(e.message);page.on('pageerror',onError);
 let failure=503;
 try {
 await page.route('**'+path+'**',route=>{
  const req=route.request();if(req.method()==='PUT'){writes.push(req.postDataJSON());return route.fulfill({status:failure,json:{error:{message:failure===409?'Label changed; refresh before retrying':'Fixture service unavailable'}}});}
  const offset=Number(new URL(req.url()).searchParams.get('offset')||0);
  return route.fulfill({json:{case:{id},total:26,limit:25,offset,items:[{...item,title:offset?'Second source page':item.title}]}});
 });
 await page.goto(origin+'/investigations/'+id+'?tab=review');
 await page.getByRole('button',{name:'Review source alert label',exact:true}).click();
 const d=page.getByRole('dialog');await d.getByLabel('Analyst label').selectOption('false_positive');await d.getByLabel('Evidence rationale').fill('Retain this explicit analyst draft');
 if(!await d.getByRole('button',{name:'Save label',exact:true}).isDisabled())throw Error('Confirmation bypass');
 await d.getByRole('checkbox').focus();await page.keyboard.press('Space');
 for(const status of [503,409]){failure=status;await d.getByRole('button',{name:'Save label',exact:true}).click();await d.getByText(status===409?'Label changed; refresh before retrying':'Fixture service unavailable',{exact:true}).waitFor();if(await d.getByLabel('Evidence rationale').inputValue()!=='Retain this explicit analyst draft')throw Error('Draft lost');}
 if(writes.length!==2||writes.some(w=>w.confirm!==true||w.expected_version!==0||w.tenant_id||w.rule_id))throw Error('Invalid scoped write');
 checks.push('explicit confirmation, scoped versioned write, 503/409 preserve draft without auto-retry');
 await d.getByRole('button',{name:'Cancel',exact:true}).click();
 await page.getByRole('button',{name:'Next source alerts'}).click();await page.getByText('Second source page',{exact:true}).waitFor();checks.push('source alert pagination');
 for(const width of [1440,390]){await page.setViewportSize({width,height:1000});if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw Error('Overflow '+width);}
 checks.push('desktop and mobile overflow checks');
 if(errors.length)throw Error(errors.join('\n'));return {passed:true,checks};
 }finally{await page.unrouteAll({behavior:'wait'});page.off('pageerror',onError);await page.setViewportSize({width:1440,height:1000});}
}
