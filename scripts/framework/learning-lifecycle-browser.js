// Local retained demo: synthetic case/Skill/Memory only; no provider execution.
async page => {
 const origin='http://127.0.0.1:8080',tag=Date.now(),entity='lifecycle-demo-'+tag;
 await page.goto(origin+'/');
 const req=async(path,body,method='POST',status=200)=>{const r=await page.request.fetch(origin+'/api/v1'+path,{method,...(body?{data:body}:{})});if(r.status()!==status)throw Error(path+' '+r.status()+' '+await r.text());return r.json();};
 const source=await req('/investigations',{title:'Lifecycle reviewed fixture '+tag,source:'local-json:lifecycle',severity:'medium',status:'resolved',determination:'benign',primary_entity:entity},'POST',201);
 const artifact=await req('/investigations/'+source.id+'/artifacts',{type:'entity',value:entity,label:'Synthetic reviewed identity'},'POST',201);
 const receipt=await req('/investigations/'+source.id+'/learning',{expected_updated_at:source.updated_at,evidence_ids:[artifact.id],confirm:true,rationale:'Explicit review of synthetic local lifecycle fixture.',create_skill:true,name:'Lifecycle skill '+tag,guidance:'Original reviewed instructions.',create_memory:true,memory_kind:'user',context:'Synthetic scoped context; investigate future evidence independently.',valid_until:new Date(Date.now()+86400000).toISOString()});
 const sid=receipt.skill_id,mid=receipt.insight_id;
 await req('/skills/'+sid+'/workspace',{expected_version:1,publish:true},'PATCH');
 await page.goto(origin+'/skills/'+sid);
 await page.getByLabel('Skill instructions',{exact:true}).fill('Staged reviewed instructions for future cases.');
 await page.getByRole('button',{name:'Save staged edits',exact:true}).click();
 await page.getByRole('button',{name:'Publish saved staged edits',exact:true}).waitFor();
 let skill=await req('/skills/'+sid,null,'GET');if(skill.content_markdown!=='Original reviewed instructions.')throw Error('Draft leaked into published guidance');
 await req('/investigations/'+source.id,{determination:'suspicious'},'PATCH');
 await page.getByRole('button',{name:'Refresh lifecycle',exact:true}).click();await page.getByText('Source review required',{exact:true}).waitFor();
 if(!await page.getByRole('button',{name:'Publish saved staged edits',exact:true}).isDisabled())throw Error('Stale source publication allowed');
 await page.screenshot({path:'/opt/aisoc/output/playwright/lifecycle-source-review.png',fullPage:true});
 const approve=async(scope,action)=>{
  await scope.getByRole('button',{name:action,exact:true}).click();
  await scope.getByLabel('Review rationale',{exact:true}).fill('Analyst explicitly reviewed this saved guidance and current source.');
  const button=scope.getByRole('button',{name:'Confirm '+action.toLowerCase(),exact:true});if(!await button.isDisabled())throw Error('Missing approval guard');
  await scope.getByRole('checkbox',{name:'I reviewed this guidance and explicitly approve this operation.',exact:true}).focus();await page.keyboard.press('Space');await button.click();await button.waitFor({state:'hidden'});
 };
 await approve(page,'Reapprove guidance');await page.getByText('Source current',{exact:true}).waitFor();
 await approve(page,'Publish saved staged edits');
 skill=await req('/skills/'+sid,null,'GET');if(skill.content_markdown!=='Staged reviewed instructions for future cases.'||skill.staged_edit)throw Error('Publication failed');
 await page.goto(origin+'/memory');
 const row=page.getByRole('row').filter({hasText:entity});await row.getByText('Source review required',{exact:true}).waitFor();
 await approve(row,'Reapprove guidance');await row.getByText('Source current',{exact:true}).waitFor();
 await approve(row,'Archive guidance');await row.waitFor({state:'hidden'});
 if(!(await req('/enterprise-insights/'+mid+'/lifecycle',null,'GET')).archived)throw Error('Memory not archived');
 await page.goto(origin+'/skills/'+sid);await page.getByText('Source current',{exact:true}).waitFor();await approve(page,'Archive guidance');await page.getByText('Archived',{exact:true}).waitFor();
 for(const width of [1440,390]){await page.setViewportSize({width,height:1000});if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw Error('Overflow '+width);}
 await page.setViewportSize({width:1440,height:1000});
 return {passed:true,source_case:source.id,skill_id:sid,insight_id:mid,checks:['staged instructions preserved published release','source change blocks publication','explicit reapproval and staged publication','explicit Skill and Memory archive','desktop/mobile overflow']};
}
