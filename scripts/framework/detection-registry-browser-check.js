// Local read-only regression: minimal sandbox rule must load AND open.
async page => {
  const origin=new URL(page.url()).origin;
  if(!['http://127.0.0.1:8080','http://127.0.0.1:8084'].includes(origin))throw Error('Local only');
  const errors=[];const onError=e=>errors.push(e.message);page.on('pageerror',onError);
  try {
    for(const width of [1440,375]) {
      await page.setViewportSize({width,height:1000});
      const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1/detection-registry');
      await page.goto(origin+'/detect/rules');const result=await response;
      if(result.status()!==200)throw Error(`Registry returned ${result.status()}`);
      const body=await result.json();
      if(!body.items.some(r=>r.id==='mock-stream-login'))throw Error('Sandbox fixture missing');
      await page.getByLabel('Search detection rules').fill('mock-stream-login');
      const rule=page.getByRole('button',{name:'mock-stream-login',exact:true});await rule.waitFor();await rule.click();
      await page.getByRole('heading',{name:'mock-stream-login',exact:true}).waitFor();
      await page.getByText('No techniques mapped.',{exact:true}).waitFor();
      if(await page.getByRole('alert').count())throw Error('Registry/detail shows error');
    }
    if(errors.length)throw Error(errors.join('\n'));
    return {passed:true,checks:['registry API 200','sparse rule search','desktop inspector','mobile detail','no rendering errors'],mutations:false};
  } finally {page.off('pageerror',onError);await page.setViewportSize({width:1440,height:1000});}
}
