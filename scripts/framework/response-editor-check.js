// Playwright CLI snippet, after inspecting the response library/editor snapshot.
// run-code --filename scripts/framework/response-editor-check.js
async page => {
  const origin='http://127.0.0.1:8081';
  if(new URL(page.url()).origin!==origin) throw new Error('Use the isolated Go preview');
  const health=await page.request.get(origin+'/health');
  if((await health.json()).database!=='postgresql') throw new Error('Go preview required');
  const ensure=(ok,message)=>{if(!ok)throw new Error(message);};
  const call=async(method,path,data,status=200)=>{
    const response=await page.request.fetch(origin+'/api/v1'+path,{method,...(data===undefined?{}:{data})});
    ensure(response.status()===status,method+' '+path+' returned '+response.status());
    return response.json();
  };
  const reports=[];
  await page.evaluate(()=>localStorage.setItem('go-editor-review',JSON.stringify({running:true})));
  try {
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:900});
    const input={kind:'runbook',title:'Editor review '+width+' '+Date.now(),description:'Disposable browser fixture',domain:'Identity',trigger:'Review',steps:[{title:'Confirm scope',instructions:'Review evidence',approval_required:true}]};
    const plan=await call('POST','/response-plans',input,201),path='/response-plans/'+plan.id;
    await page.goto(origin+'/respond/runbooks');
    await page.getByRole('textbox',{name:'Search response plans'}).fill(plan.title);
    await page.getByRole('button',{name:'Open runbook →',exact:true}).click();
    await page.getByRole('button',{name:'Edit runbook',exact:true}).click();
    const title=page.getByRole('textbox',{name:'Title',exact:true});
    await title.fill('Unsaved analyst draft');
    await call('PATCH',path,{...input,title:plan.title+' newer',expected_version:1});
    await page.getByRole('button',{name:'Save runbook',exact:true}).click();
    await page.getByRole('alert').filter({hasText:'This record changed. Reload it before saving your changes.'}).waitFor();
    ensure(await title.inputValue()==='Unsaved analyst draft','Conflict discarded unsaved draft');
    ensure((await call('GET',path+'/history')).items.length===2,'Rejected save created history');
    await page.screenshot({path:'output/playwright/go-editor-conflict-'+width+'.png',fullPage:true});
    page.once('dialog',d=>d.dismiss());
    await page.getByRole('button',{name:'Reload saved version',exact:true}).click();
    ensure(await title.inputValue()==='Unsaved analyst draft','Cancelled reload discarded edits');
    page.once('dialog',d=>d.accept());
    await page.getByRole('button',{name:'Reload saved version',exact:true}).click();
    await page.waitForFunction(expected=>document.querySelector('#response-plan-form input')?.value===expected,plan.title+' newer');
    await title.fill(plan.title+' saved');
    await page.getByRole('button',{name:'Save runbook',exact:true}).click();
    await page.getByText('Saved to the response library.',{exact:true}).waitFor();
    ensure((await call('GET',path)).version===3,'Recovered save did not advance version');
    await page.getByRole('button',{name:'Edit runbook',exact:true}).click();
    await title.fill('Draft before external archive');
    await call('POST',path+'/state',{expected_version:3,state:'archived'});
    await page.getByRole('button',{name:'Save runbook',exact:true}).click();
    await page.getByRole('alert').filter({hasText:'This record changed. Reload it before saving your changes.'}).waitFor();
    page.once('dialog',d=>d.accept());
    await page.getByRole('button',{name:'Reload saved version',exact:true}).click();
    // Reloading an externally archived plan must leave the edit form and expose Restore.
    await page.getByRole('button',{name:'Restore',exact:true}).waitFor({timeout:5000});
    ensure(await page.getByRole('button',{name:'Save runbook',exact:true}).count()===0,'Archived plan remains editable');
    page.once('dialog',d=>d.accept());
    await page.getByRole('button',{name:'Restore',exact:true}).click();
    await page.getByText('Plan restored.',{exact:true}).waitFor();
    ensure((await call('GET',path)).version===5,'Restore did not persist');
    await page.getByRole('button',{name:'Duplicate',exact:true}).click();
    await page.getByText('Copy created. Edit it to customize the procedure.',{exact:true}).waitFor();
    const copies=(await call('GET','/response-plans')).items.filter(p=>p.title===plan.title+' saved (copy)');
    ensure(copies.length===1 && copies[0].version===1 && copies[0].id!==plan.id,'Duplicate not independent');
    page.once('dialog',d=>d.accept());
    await page.getByRole('button',{name:'Archive',exact:true}).click();
    await page.getByText('Plan archived.',{exact:true}).waitFor();
    ensure((await call('GET','/response-plans/'+copies[0].id)).state==='archived','Archive not persisted');
    await page.screenshot({path:'output/playwright/go-editor-archived-'+width+'.png',fullPage:true});
    // Keep only archived fixture plans in the library after verification.
    await call('POST',path+'/state',{expected_version:5,state:'archived'});
    reports.push({width,passed:true,checks:['stale save retains draft','cancelled reload retains draft','confirmed reload and retry','external archive recovery','restore','independent duplicate','archive']});
  }
  await page.evaluate(report=>localStorage.setItem('go-editor-review',JSON.stringify(report)),{passed:true,reports});
  } catch(error) {
    await page.evaluate(report=>localStorage.setItem('go-editor-review',JSON.stringify(report)),{passed:false,reports,error:error.message});
    throw error;
  }
}
