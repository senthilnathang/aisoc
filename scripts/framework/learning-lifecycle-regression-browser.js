// Intercept lifecycle writes only; preserve all stored guidance.
async page => {
 const origin='http://127.0.0.1:8080';await page.goto(origin+'/skills');
 const list=await (await page.request.get(origin+'/api/v1/skills?limit=1')).json();if(!list.items.length)throw Error('Requires one local Skill');
 const id=list.items[0].id,path='/api/v1/skills/'+id+'/lifecycle';let failure=503;const writes=[];
 const state={version:7,current:false,archived:false,source_eligible:true,source:{id:'case-fixture',status:'resolved',determination:'suspicious',updated_at:'2026-11-01T00:00:00.000Z'},approved_source:{id:'case-fixture',status:'resolved',determination:'benign'},staged_edit:{content_markdown:'Saved staged fixture'}};
 await page.route('**'+path,route=>{if(route.request().method()==='GET')return route.fulfill({json:state});writes.push(route.request().postDataJSON());return route.fulfill({status:failure,json:{error:{message:failure===503?'Fixture unavailable':'Fixture stale revision'}}});});
 try {
 await page.goto(origin+'/skills/'+id);await page.getByText('Source review required',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Reapprove guidance',exact:true}).click();
 await page.getByLabel('Review rationale',{exact:true}).fill('Keep this analyst review draft on failures.');
 const confirm=page.getByRole('checkbox',{name:'I reviewed this guidance and explicitly approve this operation.',exact:true});await confirm.focus();await page.keyboard.press('Space');
 for(const status of [503,409]){failure=status;await page.getByRole('button',{name:'Confirm reapprove guidance',exact:true}).click();await page.getByText(status===503?'Fixture unavailable':'Fixture stale revision',{exact:true}).waitFor();if(await page.getByLabel('Review rationale',{exact:true}).inputValue()!=='Keep this analyst review draft on failures.')throw Error('Lost draft');}
 if(writes.length!==2||writes.some(w=>w.expected_version!==7||!w.confirm||w.tenant_id||w.actor))throw Error('Unsafe mutation contract');
 state.source.updated_at='2026-11-01T01:00:00.000Z';await page.getByRole('button',{name:'Refresh lifecycle',exact:true}).click();await page.getByText(/2026-11-01T01:00:00.000Z/).waitFor();
 if(await confirm.isChecked())throw Error('Refresh retained consent for changed source');
 if(!await page.getByRole('button',{name:'Confirm reapprove guidance',exact:true}).isDisabled())throw Error('Missing renewed consent');
 await page.setViewportSize({width:390,height:1000});if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw Error('Mobile overflow');
 return {passed:true,checks:['503/409 preserve rationale','no automatic write retries','tenant/actor excluded from body','source refresh requires renewed confirmation','mobile review layout']};
 }finally{await page.unrouteAll({behavior:'wait'});await page.setViewportSize({width:1440,height:1000});}
}
