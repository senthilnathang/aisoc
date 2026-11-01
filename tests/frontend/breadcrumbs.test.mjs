import test from 'node:test';
import assert from 'node:assert/strict';
import { breadcrumbModel } from '../../frontend/src/breadcrumbs.js';
test('breadcrumbs follow section hierarchy and root ownership',()=>{
 assert.deepEqual(breadcrumbModel('queue',{}).items.map(i=>i.label),['Detect','Overview']);
 assert.deepEqual(breadcrumbModel('detectionRouting',{}).items.map(i=>i.label),['Detect','Routing']);
 assert.deepEqual(breadcrumbModel('streamOperations',{}).items.map(i=>i.label),['Build','Stream operations']);
 assert.deepEqual(breadcrumbModel('skillCreate',{}).items.map(i=>i.label),['Skills','Library','Create skill']);
});
test('detail labels use allowlisted tenant-scoped resource lookup',()=>{
 const m=breadcrumbModel('detectionRuleDetail',{ruleId:'rule / special'});
 assert.deepEqual(m.items.map(i=>i.label),['Detect','Rule registry','Rule']);
 assert.deepEqual(m.lookup,{resource:'detection-rules',id:'rule / special'});
 assert.equal(m.items[1].view,'detect');
 assert.equal(breadcrumbModel('queue',{}).lookup,null);
});
test('hunt details remain in Hunt with tenant-scoped labels',()=>{
 const m=breadcrumbModel('huntDetail',{huntId:'HUNT-test'});
 assert.deepEqual(m.items.map(x=>x.label),['Hunt','Threat hunting','Hunt']);
 assert.deepEqual(m.lookup,{resource:'hunts',id:'HUNT-test'});
});

test('local integration breadcrumb stays under Build',()=>{assert.deepEqual(breadcrumbModel('localIntegrations',{}).items.map(x=>x.label),['Build','Local integrations'])});
