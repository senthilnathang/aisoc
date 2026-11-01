// Local JSON only. No operator tokens are read or transferred.
async page=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://localhost:8080/build/import-batches');
 await page.getByRole('heading',{name:'Bulk JSON imports',exact:true}).waitFor();
 await page.getByRole('button',{name:'Load two-case local example',exact:true}).click();
 const editor=page.getByLabel('Batch JSON',{exact:true});
 await page.waitForFunction(()=>document.querySelector('textarea')?.value.includes('login-a'));
 const fixture=JSON.parse(await editor.inputValue());const valid=fixture.cases[1].document;
 fixture.cases[1].document={schema_version:'1',events:[]};
 await page.getByLabel('Batch JSON file · maximum 512 KiB',{exact:true}).setInputFiles({name:'local-batch.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture))});
 const name='bulk-browser-'+Date.now();
 await page.getByLabel('Batch name',{exact:true}).fill(name);
 await page.getByRole('button',{name:'Validate all cases',exact:true}).click();
 await page.getByText('Invalid',{exact:true}).waitFor();
 await page.getByText('Valid',{exact:true}).waitFor();
 await page.getByText('Preview evidence for login-a',{exact:true}).click();
 await page.getByRole('button',{name:'Save batch manifest',exact:true}).click();
 await page.getByText('Batch saved. Invalid cases can be repaired independently.',{exact:true}).waitFor();
 const confirm=()=>page.getByText('I confirm importing valid cases and freezing their evidence',{exact:true}).click();
 // Another save after preview must invalidate this import confirmation.
 await page.evaluate(async ({name,document})=>{
  const list=await (await fetch('/api/v1/build/import-batches')).json();const batch=list.items.find(x=>x.name===name);
  const r=await fetch('/api/v1/build/import-batches/'+batch.id+'/cases/login-a',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({expected_version:1,case:{key:'login-a',name:'Revised first login',document}})});
  if(!r.ok)throw Error(await r.text());
 },{name,document:fixture.cases[0].document});
 await confirm();await page.getByRole('button',{name:'Import / retry unfinished cases',exact:true}).click();
 await page.getByRole('alert').filter({hasText:'The draft changed'}).waitFor();
 await page.getByRole('button',{name:'Refresh batch progress',exact:true}).click();
 await page.getByRole('button',{name:'Inspect login-a',exact:true}).waitFor();
 await confirm();
 await page.getByRole('button',{name:'Import / retry unfinished cases',exact:true}).click();
 await page.getByText(/1 \/ 2 cases accepted/).waitFor();
 await page.getByRole('button',{name:'Inspect login-b',exact:true}).click();
 await page.getByLabel('Case document JSON',{exact:true}).fill(JSON.stringify(valid));
 await page.getByRole('button',{name:'Validate and save case repair',exact:true}).click();
 await page.getByText('Validated repair saved. Confirm import to retry this case.',{exact:true}).waitFor();
 await confirm();await page.getByRole('button',{name:'Import / retry unfinished cases',exact:true}).click();
 await page.getByText(/2 \/ 2 cases accepted/).waitFor();
 const state=await page.evaluate(async name=>{const list=await (await fetch('/api/v1/build/import-batches')).json();const batch=list.items.find(x=>x.name===name);return (await fetch('/api/v1/build/import-batches/'+batch.id)).json();},name);
 if(state.counts.accepted!==2||new Set(state.items.map(x=>x.profile_id)).size!==2)throw Error('Partial recovery failed');
 await confirm();await page.getByRole('button',{name:'Import / retry unfinished cases',exact:true}).click();
 await page.getByText('Import checkpoint refreshed. Accepted cases were skipped; unfinished cases were retried. Investigation and note approval run separately.',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Inspect login-a',exact:true}).click();
 if(!await page.getByLabel('Case document JSON',{exact:true}).getAttribute('readonly')&& !await page.getByLabel('Case document JSON',{exact:true}).evaluate(el=>el.readOnly))throw Error('Accepted evidence editable');
 await page.screenshot({path:'/opt/aisoc/output/playwright/bulk-import-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});
 if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw Error('Mobile overflow');
 await page.screenshot({path:'/opt/aisoc/output/playwright/bulk-import-mobile.png',fullPage:true});
 await page.setViewportSize({width:1440,height:1000});
 await page.reload();await page.getByRole('button',{name,exact:true}).click();
 await page.getByText(/2 \/ 2 cases accepted/).waitFor();
 const replay=await page.evaluate(async id=>(await fetch('/api/v1/build/import-batches/'+id)).json(),state.id);
 if(!replay.items.every(x=>x.attempts===1&&x.progress.accepted_events===4))throw Error('Replay duplicated intake');
 if(errors.length)throw Error(JSON.stringify(errors));
 return {passed:true,batch_id:state.id,file_upload:true,per_case_validation:true,evidence_preview:true,partial_import:true,stale_confirmation_denied:true,repair:true,replay:true,refresh_persistence:true,mobile:true,page_errors:errors};
}
