import test from 'node:test';
import assert from 'node:assert/strict';
import {memoryFreshness} from '../../frontend/src/huntMemory.mjs';
test('historical snapshot dates never imply current approval',()=>{
 const now=Date.parse('2026-11-01T12:00:00Z');
 assert.equal(memoryFreshness({},now),'No expiry configured');
 assert.equal(memoryFreshness({valid_until:'2026-11-01T12:00:00Z'},now),'Expired now · historical snapshot');
 assert.equal(memoryFreshness({valid_from:'2026-11-02T00:00:00Z'},now),'Outside current validity window');
 assert.equal(memoryFreshness({valid_until:'2026-11-02T00:00:00Z'},now),'Within configured validity window');
});
