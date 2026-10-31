import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../../frontend/src/investigationNavigation.js',import.meta.url),'utf8');
const pure=source.slice(source.indexOf('export const caseTabs'),source.indexOf('const subscribe'));
const {parseCaseTab}=await import('data:text/javascript,'+encodeURIComponent(pure));
test('case tabs preserve explicit deep links and default safely',()=>{
 for(const name of ['Summary','Report','Remediation','Artifacts','Review','Runbooks','Transcript','I/O','History','Feedback'])assert.equal(parseCaseTab('?tab='+encodeURIComponent(name.toLowerCase())),name);
 assert.equal(parseCaseTab('?tab=unknown'),'Summary');assert.equal(parseCaseTab(''),'Summary');
});
