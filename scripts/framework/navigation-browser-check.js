// Read-only menu checks against the local app. No API writes.
async page => {
 const origin=new URL(page.url()).origin;
 if(!['http://127.0.0.1:8080','http://127.0.0.1:8084'].includes(origin))throw Error('Local frontend required');
 const errors=[];const error=e=>errors.push(e.message);page.on('pageerror',error);
 const current=async (nav,name)=>{const links=page.getByRole('navigation',{name:nav,exact:true}).locator('[aria-current]');await links.filter({hasText:name}).waitFor();if(await links.count()!==1||await links.innerText()!==name)throw Error(`Wrong selection: ${nav} / ${name}`);};
 try {
  await page.setViewportSize({width:1440,height:1000});await page.goto(origin+'/');
  await page.getByRole('navigation',{name:'Primary navigation'}).waitFor();await current('Primary navigation','Detect');await current('Detect navigation','Overview');
  await page.getByRole('navigation',{name:'Primary navigation'}).getByRole('link',{name:'Respond',exact:true}).click();
  await current('Primary navigation','Respond');await current('Respond navigation','Overview');
  const response=page.getByRole('navigation',{name:'Respond navigation'});
  if(await response.getByRole('link').count()!==7)throw Error('Response submenu missing');
  await response.getByRole('link',{name:'Approvals',exact:true}).click();
  if(!page.url().endsWith('/respond/approvals'))throw Error('Approvals URL wrong');await current('Respond navigation','Approvals');
  await page.reload();await page.getByRole('navigation',{name:'Respond navigation'}).waitFor();await current('Respond navigation','Approvals');
  await page.goBack();await current('Respond navigation','Overview');
  await page.goto(origin+'/detect/rules/mock-stream-login');await page.getByRole('navigation',{name:'Detect navigation'}).waitFor();await current('Primary navigation','Detect');await current('Detect navigation','Rule registry');
  await page.screenshot({path:'output/playwright/navigation-desktop.png',fullPage:false});
  await page.setViewportSize({width:375,height:900});await page.goto(origin+'/');
  const menu=page.getByRole('button',{name:'Open navigation',exact:true});await menu.click();
  const mobile=page.getByRole('navigation',{name:'Mobile navigation'});await mobile.waitFor();await current('Mobile navigation','Overview');
  for(const name of ['Rule registry','Investigations','Approvals','Stream operations','Connectors'])if(!await mobile.getByRole('link',{name,exact:true}).count())throw Error(`Missing mobile route ${name}`);
  await page.waitForFunction(()=>{const r=document.querySelector('[role=dialog]')?.getBoundingClientRect();return r&&r.x>=-1&&r.right<=innerWidth&&r.width>=300;});
  await page.screenshot({path:'output/playwright/navigation-mobile.png',fullPage:false});
  await page.keyboard.press('Escape');await mobile.waitFor({state:'hidden'});
  if(!await menu.evaluate(el=>el===document.activeElement))throw Error('Menu focus not restored');
  await menu.click();await mobile.getByRole('link',{name:'Stream operations',exact:true}).click();await mobile.waitFor({state:'hidden'});
  await current('Build navigation','Stream operations');if(!page.url().endsWith('/build/stream-operations'))throw Error('Build URL wrong');
  const header=await page.locator('.app-header').boundingBox();if(header.x<0||header.width>375)throw Error('Mobile menu overflow');
  await page.goto(origin+'/investigations/INV-70b7b77a-78df-4c84-8705-6f30fe460fb8');await page.getByRole('navigation',{name:'Investigate navigation'}).waitFor();await current('Investigate navigation','Investigations');
  if(errors.length)throw Error(errors.join('\n'));
  return {passed:true,checks:['home ownership','response submenu','deep link and reload','back navigation','detail selection','mobile all sections','Escape and focus restoration','mobile navigation and bounds'],mutations:false};
 }finally{page.off('pageerror',error);await page.setViewportSize({width:1440,height:1000});}
}
