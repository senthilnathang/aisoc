import test from 'node:test';
import assert from 'node:assert/strict';
import {radarPoint,radarPoints,stateLabel} from '../../frontend/src/coverageModel.js';
test('radar positions use bounded percentages and preserve missing-state labels',()=>{
 for(let i=0;i<14;i++)for(const value of [-10,0,50,100,200]){const p=radarPoint(i,14,230,value);assert.ok(Math.hypot(p.x-400,p.y-350)<=230.00001);}
 assert.deepEqual(radarPoint(0,14,230,0),{x:400,y:350});
 assert.equal(radarPoints(Array(14).fill({coverage_percent:50}),230,'coverage_percent').split(' ').length,14);
 assert.equal(stateLabel('accepted_risk'),'Accepted risk');assert.equal(stateLabel('stale'),'Rule changed / stale');
});
