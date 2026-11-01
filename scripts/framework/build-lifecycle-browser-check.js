// Real local APIs. Retains one archived draft clone; never imports or enables responses.
async page => {
 const origin='http://127.0.0.1:8080',base=origin+'/api/v1/build/integrations';
 const catalog=await (await page.request.get(base)).json();
 const source=catalog.items.find(p=>p.name==='Build local IAM/EDR showcase');
 if(!source||catalog.items.length>=20)throw Error('A local showcase and a free retained-profile slot are required');
 const errors=[];const capture=e=>errors.push(e.message);page.on('pageerror',capture);
 try {
  await page.setViewportSize({width:1440,height:1000});
  await page.goto(origin+'/build/integrations');
  await page.getByRole('button',{name:/Build local IAM\/EDR showcase/}).click();
  await page.getByRole('button',{name:'Clone as draft',exact:true}).click();
  await page.getByText('Draft clone saved with a new connector. Review its evidence before explicitly importing.',{exact:true}).waitFor();
  const name='Build lifecycle browser '+Date.now();
  await page.getByLabel('Profile name',{exact:true}).fill(name);
  const document=JSON.parse(JSON.stringify(source.document));
  const extra={...document.events.find(e=>e.event_type==='authentication.failed'),event_id:'browser-extra-failure',source_event_id:'browser-extra-failure',evidence_ref:'mock:browser-extra-failure'};
  document.events.push(extra);
  await page.getByLabel('Import login events JSON',{exact:true}).setInputFiles({name:'bundle.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(document))});
  await page.getByRole('button',{name:'Validate & preview',exact:true}).click();
  await page.getByText('5 login events',{exact:true}).waitFor();
  await page.getByText('4 finding evidence references',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Save draft',exact:true}).click();
  await page.getByText('Draft saved · revision 2',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Refresh pipeline status',exact:true}).click();
  await page.getByText('Draft · not imported',{exact:true}).waitFor();
  await page.getByRole('heading',{name:'Revision history',exact:true}).waitFor();
  await page.screenshot({path:'output/playwright/build-lifecycle-draft.png',fullPage:true});
  await page.evaluate(()=>{window.confirm=()=>true});
  await page.getByRole('button',{name:'Archive profile',exact:true}).click();
  await page.getByText('Profile archived. Evidence and investigations are retained.',{exact:true}).waitFor();
  await page.getByText('Archived · retained evidence',{exact:true}).waitFor();
  if(!await page.getByRole('button',{name:'Import saved JSON',exact:true}).isDisabled())throw Error('Archived import enabled');
  if(await page.getByLabel('Profile name',{exact:true}).getAttribute('readonly')===null)throw Error('Archived name editable');
  const latest=await (await page.request.get(base)).json();
  const cloned=latest.items.find(p=>p.name===name);
  if(!cloned||cloned.state!=='archived'||cloned.version!==3||cloned.cloned_from!==source.id)throw Error('Durable lifecycle mismatch');
  const detail=await (await page.request.get(base+'/'+cloned.id)).json();
  if(detail.revisions.length!==3||detail.intake.accepted_events!==0||detail.cases.length)throw Error('Clone imported unexpectedly or missing history');
  await page.reload();await page.getByRole('button',{name:new RegExp(name)}).click();
  await page.getByText('Archived · retained evidence',{exact:true}).waitFor();
  await page.screenshot({path:'output/playwright/build-lifecycle-archived.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  if(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1))throw Error('Mobile horizontal overflow');
  await page.screenshot({path:'output/playwright/build-lifecycle-mobile.png',fullPage:true});
  if(errors.length)throw Error(errors.join('\n'));
  return {passed:true,clone_id:cloned.id,version:3,bundle_import:true,extended_preview:true,archive:true,history:true,reload:true,mobile:true,console_errors:errors,imported:false};
 }finally {page.off('pageerror',capture);await page.setViewportSize({width:1440,height:1000})}
}
