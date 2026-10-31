import test from 'node:test';
import assert from 'node:assert/strict';
import { treemap, coverage, dailySeries } from '../../frontend/src/detectionIntelligenceModel.js';
test('treemap conserves area with skew and never overlaps', () => {
 const rows = Array.from({length:200},(_,i)=>({count:i===0?10000:i+1}));
 const tiles=treemap(rows), total=rows.reduce((n,r)=>n+r.count,0);
 tiles.forEach((tile,i)=>{
  assert.ok(Math.abs(tile.width*tile.height/10000-tile.count/total)<1e-10);
  assert.ok(tile.x>=0&&tile.y>=0&&tile.x+tile.width<=100.000001&&tile.y+tile.height<=100.000001);
  tiles.slice(i+1).forEach(other=>assert.ok(Math.min(tile.x+tile.width,other.x+other.width)-Math.max(tile.x,other.x)<1e-8||Math.min(tile.y+tile.height,other.y+other.height)-Math.max(tile.y,other.y)<1e-8));
 });
 assert.deepEqual(treemap([{count:0}]),[]);
});
test('coverage is linked alert proportion, not verdict',()=>{
 assert.equal(coverage({count:10,linked:10}),'Full');
 assert.equal(coverage({count:10,linked:5}),'Majority');
 assert.equal(coverage({count:10,linked:1}),'Partial');
 assert.equal(coverage({count:10,linked:0}),'None');
});
test('rolling windows keep both partial UTC boundary dates',()=>{
 const rows=dailySeries({window_start:'2026-10-24T12:00:00Z',as_of:'2026-10-31T12:00:00Z',daily:[{date:'2026-10-24',total:5}]});
 assert.equal(rows.length,8);assert.equal(rows[0].total,5);assert.equal(rows.at(-1).date,'2026-10-31');assert.equal(rows.at(-1).total,0);
});
