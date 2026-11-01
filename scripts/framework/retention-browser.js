// Requires one aged, synthetic retention-browser-* read notification for the local user.
async page=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewportSize({width:1440,height:1000});
 await page.goto('http://localhost:8080/build/retention');await page.getByRole('heading',{name:'Retention & recovery',exact:true}).waitFor();
 const initial=await page.evaluate(async()=>{const r=await fetch('/api/v1/build/retention?kind=notification');if(!r.ok)throw Error(await r.text());return r.json()});
 const fixture=initial.items.find(r=>r.title.startsWith('retention-browser-'));if(!fixture)throw Error('Seed aged synthetic notification first');
 await page.getByLabel('Retention reason').fill('Browser validation of local archive and recovery.');
 const enabled=page.getByRole('checkbox',{name:'Enable explicit archiving',exact:true});if(!await enabled.isChecked())await page.getByText('Enable explicit archiving',{exact:true}).click();
 await page.getByLabel('Minimum age in days').fill('30');await page.getByRole('button',{name:'Save archive policy',exact:true}).click();
 await page.getByText('Archive policy saved. No records were changed or scheduled for deletion.',{exact:true}).waitFor();
 const choose=async()=>{await page.getByRole('button',{name:'Preview retention '+fixture.title,exact:true}).click();await page.getByText('I reviewed the selected record and its retention scope',{exact:true}).click()};
 await choose();await page.getByRole('button',{name:'Archive snapshot',exact:true}).click();await page.getByText('Archive snapshot saved. Source records and evidence remain available.',{exact:true}).waitFor();
 await choose();await page.getByRole('button',{name:'Clean up read notification',exact:true}).click();await page.getByText('Read notification removed; its verified archive is retained.',{exact:true}).waitFor();
 if(await page.getByRole('button',{name:'Preview retention '+fixture.title,exact:true}).count())throw Error('Cleaned notice remains');
 await page.getByRole('button',{name:'Inspect archive '+fixture.title,exact:true}).click();await page.getByRole('heading',{name:'Verified archive: '+fixture.title,exact:true}).waitFor();
 await page.getByText('I reviewed the selected record and its retention scope',{exact:true}).click();await page.getByRole('button',{name:'Restore read notification',exact:true}).click();await page.getByText('Notification restored. Approval and ownership state were not changed.',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Preview retention '+fixture.title,exact:true}).waitFor();
 // Restore the operator's previous policy, retaining audited fixture evidence.
 if(await enabled.isChecked()!==initial.policy.enabled)await page.getByText('Enable explicit archiving',{exact:true}).click();
 await page.getByLabel('Minimum age in days').fill(String(initial.policy.age_days));await page.getByRole('button',{name:'Save archive policy',exact:true}).click();await page.getByText('Archive policy saved. No records were changed or scheduled for deletion.',{exact:true}).waitFor();
 await page.getByLabel('Record category').selectOption('investigation');await page.getByText('No archive snapshots on this page.',{exact:true}).waitFor();
 await page.screenshot({path:'/opt/aisoc/output/playwright/retention-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>window.scrollTo(0,0));
 if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw Error('Mobile overflow');
 await page.screenshot({path:'/opt/aisoc/output/playwright/retention-mobile.png',fullPage:true});
 if(errors.length)throw Error(JSON.stringify(errors));return {passed:true,archive_cleanup_restore:true,explicit_confirmation:true,policy_restored:true,mobile:true,page_errors:errors,fixture:fixture.id};
}
