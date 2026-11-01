import test from 'node:test';
import assert from 'node:assert/strict';
import {parseBulkImport,batchProgress} from '../../frontend/src/bulkImport.js';
const item={key:'login-a',name:'Case A',document:{schema_version:'1',events:[]}};
test('batch file validates the envelope while Go owns per-case evidence validation',()=>{
 assert.equal(parseBulkImport(JSON.stringify({schema_version:'1',cases:[item]})).cases.length,1);
 for(const value of [{schema_version:'2',cases:[item]},{schema_version:'1',cases:[item,item]},{schema_version:'1',cases:[]},{schema_version:'1',cases:[item],scope_id:'spoof'},{schema_version:'1',cases:Array.from({length:11},(_,i)=>({...item,key:String(i)}))}])assert.throws(()=>parseBulkImport(JSON.stringify(value)));
 assert.throws(()=>parseBulkImport('x'.repeat(512*1024+1)));
});
test('batch progress separates accepted intake from completed mock notes',()=>{
 assert.equal(batchProgress({total:3,accepted:1,synced:0,invalid:1,failed:1}),'1 / 3 cases accepted · 0 mock notes synced · 2 need attention');
});
