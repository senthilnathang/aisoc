// Intercepted writes: validation/editor/error/immutability regression, no DB changes.
async page => {
 const origin='http://127.0.0.1:8080',base=origin+'/api/v1/build/integrations';
 const actual=await (await page.request.get(base)).json();
 const source=actual.items.find(p=>p.name==='Build local IAM/EDR showcase');
 if(!source)throw Error('Run the local showcase first');
 const previewResponse=await page.request.post(base+'/preview',{data:{scope_id:source.scope_id,id:source.id,document:source.document}});
 const preview=await previewResponse.json();if(!previewResponse.ok())throw Error('Actual preview failed');
 let profiles=[],puts=[],saveFails=true,importFails=true;
 const route=async route=>{
  const req=route.request(),url=new URL(req.url()),path=url.pathname,body=req.postData()?req.postDataJSON():null;
  const reply=(json,status=200)=>route.fulfill({status,json});
  if(path.endsWith('/example'))return reply(source.document);
  if(path.endsWith('/preview'))return reply(preview);
  if(path==='/api/v1/build/integrations')return reply({items:profiles,scopes:[{id:source.scope_id,source:'qradar-siem'}],limit:20});
  const id=path.split('/')[4];
  if(req.method()==='PUT'){
   puts.push({id,body});if(saveFails)return reply({error:{message:'Fixture revision conflict'}},409);
   profiles=[{...source,id,name:body.name,scope_id:body.scope_id,state:'draft',version:1,document:body.document}];return reply(profiles[0]);
  }
  if(path.endsWith('/import')){
   profiles[0]={...profiles[0],state:'sealed'};
   if(importFails)return reply({error:{message:'Fixture uncertain import; refresh and retry'}},503);
   return reply({accepted:{Inserted:0},state:'sealed'},202);
  }
  return reply({profile:profiles[0],worker:{status:'running'},cases:[]});
 };
 await page.route(base+'**',route);
 try{
  await page.goto(origin+'/build/integrations');
  await page.getByRole('button',{name:'＋ New local integration',exact:true}).click();
  await page.getByLabel('Profile name',{exact:true}).fill('Browser draft');
  await page.getByRole('button',{name:'Load local example (replaces JSON)',exact:true}).click();
  await page.getByRole('textbox',{name:'Login events JSON',exact:true}).fill('{');
  await page.getByRole('button',{name:'Validate & preview',exact:true}).click();
  await page.getByText('Login events must be valid JSON.',{exact:true}).waitFor();
  await page.getByLabel('Import login events JSON',{exact:true}).setInputFiles({name:'events.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(source.document.events))});
  await page.getByRole('button',{name:'Validate & preview',exact:true}).click();
  await page.getByRole('heading',{name:'Normalized evidence preview',exact:true}).waitFor();
  await page.getByRole('button',{name:'Save draft',exact:true}).click();
  await page.getByText('Fixture revision conflict',{exact:true}).waitFor();
  if(await page.getByLabel('Profile name',{exact:true}).inputValue()!=='Browser draft')throw Error('Failed save lost draft');
  saveFails=false;await page.getByRole('button',{name:'Save draft',exact:true}).click();
  await page.getByText('Draft saved · revision 1',{exact:true}).waitFor();
  if(puts.length!==2||puts[0].id!==puts[1].id)throw Error('Create retry changed identity');
  if(!await page.getByRole('button',{name:'Import saved JSON',exact:true}).isDisabled())throw Error('Missing explicit import confirmation');
  await page.getByText('I confirm local import and freezing this evidence snapshot',{exact:true}).click();
  await page.getByRole('button',{name:'Import saved JSON',exact:true}).click();
  await page.getByText('Fixture uncertain import; refresh and retry',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Refresh pipeline status',exact:true}).click();
  await page.getByRole('button',{name:'Replay local import',exact:true}).waitFor();
  if(await page.getByRole('textbox',{name:'Login events JSON',exact:true}).isEditable())throw Error('Sealed evidence editable');
  importFails=false;
  // Status refresh preserves the existing explicit confirmation after an uncertain result.
  const check=page.getByRole('checkbox');if(!await check.isChecked())await page.getByText('I confirm local import and freezing this evidence snapshot',{exact:true}).click();
  await page.getByRole('button',{name:'Replay local import',exact:true}).click();
  await page.getByText('Local import accepted: 0 new events.',{exact:false}).waitFor();
  for(const width of [1440,375]){await page.setViewportSize({width,height:1000});if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw Error('Overflow')}
  return {passed:true,file_import:true,invalid_json:true,conflict_preserves_draft:true,stable_create_id:true,explicit_confirmation:true,uncertain_import_recovery:true,sealed_read_only:true,mutations:false};
 }finally{await page.unroute(base+'**',route);await page.setViewportSize({width:1440,height:1000});await page.goto(origin+'/build/integrations')}
}
