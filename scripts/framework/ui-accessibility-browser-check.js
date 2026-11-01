// Interaction checks without API mutations. Run through Playwright against localhost.
async page => {
 const origin='http://127.0.0.1:8080',checks=[];
 const ensure=(ok,message)=>{if(!ok)throw Error(message);};
 await page.setViewportSize({width:1440,height:1000});await page.goto(origin+'/build');await page.getByRole('link',{name:'Skip to workspace content'}).waitFor({state:'attached'});await page.waitForLoadState('networkidle');
 await page.keyboard.press('Tab');
 ensure(await page.getByRole('link',{name:'Skip to workspace content'}).evaluate(el=>el===document.activeElement),'Skip link is not first');
 await page.keyboard.press('Enter');ensure(await page.getByRole('main').evaluate(el=>el===document.activeElement),'Skip link did not focus main');checks.push('keyboard skip link');
 await page.getByRole('navigation',{name:'Primary navigation'}).getByRole('link',{name:'Detect',exact:true}).click();
 ensure(await page.getByRole('main').evaluate(el=>el===document.activeElement),'Route did not move focus to main');
 ensure((await page.title()).includes('Detect'),'Route title not updated');checks.push('route focus and document title');
 await page.setViewportSize({width:390,height:1000});await page.goto(origin+'/respond/activity');
 const selected=page.getByRole('navigation',{name:'Respond navigation'}).locator('[aria-current="page"]');
 const rect=await selected.boundingBox();ensure(rect.x>=0&&rect.x+rect.width<=390,'Selected mobile submenu is hidden');
 const menu=page.getByRole('button',{name:'Open navigation'});await menu.click();
 await page.getByRole('navigation',{name:'Mobile navigation'}).waitFor();await page.keyboard.press('Escape');
 await page.getByRole('navigation',{name:'Mobile navigation'}).waitFor({state:'hidden'});
 ensure(await menu.evaluate(el=>el===document.activeElement),'Escape did not restore focus');checks.push('mobile selected submenu and drawer Escape focus');
 await page.goto(origin+'/build');await page.getByLabel('Search Build assets').waitFor();
 ensure(await page.getByLabel('Search Build assets').evaluate(el=>getComputedStyle(el).fontSize==='16px'&&el.getBoundingClientRect().height>=44),'Mobile input too small');
 ensure(await page.getByRole('button',{name:'Refresh catalog'}).evaluate(el=>el.getBoundingClientRect().height>=44),'Mobile button too small');checks.push('mobile input and button sizes');
 await page.getByLabel('Search Build assets').focus();
 ensure(await page.getByLabel('Search Build assets').evaluate(el=>getComputedStyle(el).outlineStyle==='solid'),'Missing input focus outline');checks.push('visible keyboard focus');
 await page.emulateMedia({reducedMotion:'reduce'});await page.goto(origin+'/detect/intelligence');
 ensure(await page.locator('.page-enter').evaluate(el=>parseFloat(getComputedStyle(el).animationDuration)<.001),'Reduced motion ignored');checks.push('reduced motion');
 await page.emulateMedia({reducedMotion:'no-preference'});await page.setViewportSize({width:1440,height:1000});
 return {passed:true,checks,mutations:false};
}
