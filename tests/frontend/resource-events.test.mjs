import test from 'node:test';
import assert from 'node:assert/strict';
import { changedResource } from '../../frontend/src/resourceEvents.js';
test('mutation paths map to breadcrumb resources, including threat report API',()=>{
 for(const [path,resource] of [['/skills/id','skills'],['/detection-rules/id','detection-rules'],['/investigations/id','investigations'],['/threat-intel-reports/id','threat-intel']]) {
  for(const method of ['PATCH','PUT','DELETE'])assert.deepEqual(changedResource(path,method),{resource,id:'id'});
 }
 assert.equal(changedResource('/skills/id','GET'),null);
 assert.equal(changedResource('/skills/id/materials','PATCH'),null);
 assert.deepEqual(changedResource('/skills/a%20b','PATCH'),{resource:'skills',id:'a b'});
});
