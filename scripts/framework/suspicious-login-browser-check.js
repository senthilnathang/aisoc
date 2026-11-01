// Real local case projection; intercepted approval writes never mutate the database.
async page => {
  const origin = new URL(page.url()).origin;
  if (!['http://127.0.0.1:8080','http://localhost:8080'].includes(origin)) throw Error('Local UI required');
  const url = page.url().split('#')[0];
  const id = new URL(url).pathname.split('/').pop();
  const endpoint = `${origin}/api/v1/investigations/${id}/l1`;
  const actual = await (await page.request.get(endpoint)).json();
  if (!actual.review_required || actual.result?.verdict !== 'INCONCLUSIVE') throw Error('Reviewed mock case required');
  const region = page.getByRole('region', {name:'L1 investigation review',exact:true});
  const approval = `${origin}/api/v1/stream-operations/${actual.review_scope}/approve-mock-note`;
  let approved = false, calls = 0, fail = true;
  const errors = []; const onError = error => errors.push(error.message); page.on('pageerror',onError);
  const comment = 'Browser acceptance: reviewed mock evidence and missing context.';
  try {
    await page.route(endpoint, route => route.fulfill({json:{...actual, sync_state:approved?'synced':'awaiting_review',reviewed_by:approved?'fixture-analyst':undefined,review_comment:approved?comment:undefined,reviewed_at:approved?'2026-11-01T00:00:00Z':undefined}}));
    await page.route(approval, async route => {
      calls++;
      const body=route.request().postDataJSON();
      if(body.job_id!==actual.job_id||body.comment!==comment)throw Error('Wrong approval payload');
      if(fail)return route.fulfill({status:503,json:{error:{message:'Fixture unavailable'}}});
      approved=true;return route.fulfill({json:{state:'approved',mode:'mock-note-only'}});
    });
    for(const width of [1440,375]) {
      await page.setViewportSize({width,height:1000}); await page.goto(url);
      await region.getByRole('button',{name:'Review mock SOAR note',exact:true}).click();
      const submit=region.getByRole('button',{name:'Approve mock note',exact:true});
      if(!await submit.isDisabled())throw Error('Approval enabled before review');
      await region.getByRole('textbox',{name:'Analyst review comment'}).fill(comment);
      if(!await submit.isDisabled())throw Error('Approval enabled without confirmation');
      await region.getByText('I reviewed the evidence and approve this mock note only',{exact:true}).click(); await submit.click();
      await region.getByText('Fixture unavailable',{exact:false}).waitFor();
      if(await region.getByRole('textbox').inputValue()!==comment)throw Error('Failed write lost comment');
      if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw Error('Viewport overflow');
      await page.screenshot({path:`output/playwright/suspicious-login-review-${width}.png`,fullPage:true});
    }
    fail=false;
    await region.getByRole('button',{name:'Approve mock note',exact:true}).click();
    await region.getByText('Mock note approved by fixture-analyst',{exact:false}).waitFor();
    if(calls!==3)throw Error('Unexpected requests '+calls);
    if(errors.length)throw Error(errors.join('\n'));
    return {passed:true,desktop:true,mobile:true,explicit_confirmation:true,failed_write_preserves_comment:true,receipt:true,approval_requests: calls,database_mutations:false};
  } finally {
    await page.unroute(endpoint);await page.unroute(approval);page.off('pageerror',onError);
    await page.setViewportSize({width:1440,height:1000});await page.goto(url);
  }
}
