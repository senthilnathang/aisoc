import test from 'node:test';
import assert from 'node:assert/strict';
import { sections, sectionForView, activeItem, pathForView } from '../../frontend/src/navigation.js';

test('home belongs to Detect and response has its own reachable submenu',()=>{
 assert.equal(sectionForView('queue').label,'Detect');
 assert.equal(pathForView.queue,'/');
 assert.equal(sectionForView('queue').items[0].label,'Overview');
 assert.equal(sectionForView('respond').label,'Respond');
 assert.deepEqual(sectionForView('respond').items.map(i=>i.view),['respond','responseCases','responsePolicies','responseActions','responseApprovals','responseWorkflows','responseRunbooks','responseActivity']);
});
test('detail routes retain parent section and submenu selection',()=>{
 for(const [view,label,item] of [['investigationDetail','Investigate','investigations'],['detectionRuleDetail','Detect','detect'],['skillDetail','Skills','skills'],['skillCreate','Skills','skills'],['threatIntelDetail','Threat Intel','threatIntel'],['streamOperations','Build','streamOperations']]){
  assert.equal(sectionForView(view).label,label);assert.equal(activeItem(view),item);
 }
});
test('each menu target has a unique navigable route',()=>{
 const views=sections.flatMap(s=>s.items.map(i=>i.view));assert.equal(new Set(views).size,views.length);
 for(const view of views)assert.ok(pathForView[view]?.startsWith('/'),view);
});

test('Build workspace is the entrypoint and preserves integration tools',()=>{
 const build=sectionForView('build');assert.equal(build.label,'Build');assert.equal(build.items[0].path,'/build');assert.equal(pathForView.apiSources,'/build/api-sources');assert.equal(pathForView.streamOperations,'/build/stream-operations');
});
