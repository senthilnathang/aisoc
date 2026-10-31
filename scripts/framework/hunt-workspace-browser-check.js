// Local browser checks. Domain reads/writes use intercepted fixtures, never demo mutations.
async page=>{
 const origin=new URL(page.url()).origin;if(!/^http:\/\/(localhost|127\.0\.0\.1):8080$/.test(origin))throw new Error('Open the local app first');
 const ensure=(v,m)=>{if(!v)throw new Error(m)};const at='2026-11-01T00:00:00.000Z';
 let hunt={id:'HUNT-browser',name:'Suspicious login evidence hunt',query:'192.0.2.42',source:'ad_hoc',created_at:at,updated_at:at};let notes=[],runs=[],created=[],report={id:'TI-browser',title:'Identity infrastructure advisory',summary:'Analyst-provided report',source:'Local JSON',severity:'high',published_at:at};
 const findings=[{record_id:'artifact-a',case_id:'case-a',kind:'artifact',label:'Login address',excerpt:'192.0.2.42',entity:'192.0.2.42',source:'Stored case artifact'}];
 const handler=async route=>{const req=route.request(),u=new URL(req.url()),p=u.pathname.replace('/api/v1',''),m=req.method();const reply=(v,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(v)});
 if(p==='/hunts'&&m==='GET')return reply({items:[hunt]});
 if(p==='/hunts'&&m==='POST'){hunt={...hunt,...req.postDataJSON()};created.push(p);return reply(hunt,201)}
 if(p==='/threat-intel/registry')return reply({items:[{...report,indicator_count_actual:0,linked_hunts:0}],total:1,sources:1});
 if(p===`/threat-intel-reports/${report.id}/workspace`)return reply({report,indicator_count:0,hunts:[]});
 if(p==='/threat-indicators')return reply({items:[]});
 if(p==='/threat-intel-reports'&&m==='GET')return reply({items:[report]});
 if(p==='/threat-intel-reports'&&m==='POST'){created.push(p);report={...report,...req.postDataJSON()};return reply(report,201)}
 if(p===`/hunts/${hunt.id}/workspace`)return reply({hunt,runs,notes,scope:'Local literal search: latest 500 cases and 500 artifacts; no provider actions.'});
 if(p===`/hunts/${hunt.id}/search`){const b=req.postDataJSON();ensure(b.expected_updated_at===at&&b.id,'Missing version/idempotency token');const r={id:b.id,query:hunt.query,actor:'fixture analyst',created_at:at,verdict:'review_required',findings,scope:'Local search',truncated:false};runs=[r,...runs];return reply(r)}
 if(p===`/hunts/${hunt.id}/notes`){const b=req.postDataJSON();ensure(b.id&&b.body,'Missing note identity');notes.push({id:b.id,body:b.body,actor:'fixture analyst',created_at:at});return reply({saved:true})}
 if(p.startsWith('/navigation/'))return reply({label:hunt.name});
 if(p.endsWith('/run'))throw new Error('Legacy simulated run must not be used');return route.continue();};
 await page.route('**/api/v1/**',handler);const reports=[];
 try{
 await page.setViewportSize({width:1440,height:1000});await page.goto(origin+'/hunt/threat-hunting');await page.getByRole('button',{name:'Open hunt →'}).waitFor();await page.getByRole('button',{name:'Add threat hunt',exact:true}).click();await page.getByRole('textbox',{name:'Title',exact:true}).fill('Suspicious login evidence hunt');await page.getByRole('textbox',{name:'Literal search phrase'}).fill('192.0.2.42');await page.getByRole('button',{name:'Create',exact:true}).click();await page.getByRole('button',{name:'Run local search'}).click();await page.getByText('Searched phrase: 192.0.2.42',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Entities (1)',exact:true}).click();await page.getByText('RECORDED ENTITY / ARTIFACT VALUE',{exact:true}).waitFor();await page.screenshot({path:'/opt/aisoc/output/playwright/hunt-entities.png',fullPage:true});await page.getByRole('button',{name:'Findings (1)',exact:true}).click();await page.getByRole('button',{name:'Open evidence case →'}).waitFor();await page.screenshot({path:'/opt/aisoc/output/playwright/hunt-findings.png',fullPage:true});
 await page.getByRole('textbox',{name:'Analyst note'}).fill('<script>not executable</script> Review provenance.');await page.getByRole('button',{name:'Add note',exact:true}).click();await page.getByText('<script>not executable</script> Review provenance.',{exact:true}).waitFor();
 hunt={...hunt,query:'new phrase'};await page.reload();await page.getByText('Searched phrase: 192.0.2.42',{exact:true}).waitFor();await page.getByRole('button',{name:'Run local search'}).click();await page.getByText('Searched phrase: new phrase',{exact:true}).waitFor();await page.getByRole('combobox',{name:'Search history'}).selectOption(runs[1].id);await page.getByText('Searched phrase: 192.0.2.42',{exact:true}).waitFor();
 for(const width of [1440,390]){await page.setViewportSize({width,height:1000});ensure(!(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)),'Detail overflow '+width);reports.push({screen:'detail',width,passed:true})}
 await page.getByRole('button',{name:'Open evidence case →'}).click();ensure(page.url().endsWith('/investigations/case-a'),'Evidence link target');
 await page.goto(origin+'/hunt/threat-intelligence');await page.getByRole('button',{name:'Ingest TI report'}).click();await page.getByRole('textbox',{name:'Title',exact:true}).fill('Uploaded local report');await page.getByRole('textbox',{name:'Report text'}).fill('Evidence for manual review.');await page.getByRole('button',{name:'Save report',exact:true}).click();await page.getByRole('heading',{name:'Uploaded local report',exact:true}).waitFor();await page.goto(origin+'/hunt/threat-intelligence');await page.getByRole('button',{name:'Uploaded local report',exact:true}).waitFor();await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:'/opt/aisoc/output/playwright/hunt-intel.png',fullPage:true});
 for(const width of [1440,390])for(const path of ['/hunt/threat-hunting','/hunt/threat-intelligence']){await page.setViewportSize({width,height:1000});await page.goto(origin+path);await page.getByRole('table').waitFor();ensure(!(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)),'Registry overflow '+path);reports.push({screen:path,width,passed:true})}
 ensure(created.length===2,'Creation paths not exercised');return{passed:true,reports,checks:['create hunt','real search endpoint','entities/findings','notes as text','historical query attribution','evidence link','report ingestion']};
 }finally{await page.unroute('**/api/v1/**',handler);await page.setViewportSize({width:1440,height:1000});await page.goto(origin+'/hunt/threat-hunting')}
}
