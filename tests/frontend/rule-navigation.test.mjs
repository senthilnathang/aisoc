import test from 'node:test';
import assert from 'node:assert/strict';
import {parseRuleLocation,ruleLocation} from '../../frontend/src/ruleNavigation.js';
test('rule workspace round trips selection/tab and retains filters',()=>{
 const q=ruleLocation('?search=encoded&days=7&enabled=false',{rule:'rule / one',tab:'history'});
 const state=parseRuleLocation(q);assert.equal(state.selected,'rule / one');assert.equal(state.tab,'history');assert.equal(state.filters.days,7);assert.equal(state.filters.enabled,'false');
 const closed=parseRuleLocation(ruleLocation(q,{rule:null,tab:null}));assert.equal(closed.selected,null);assert.equal(closed.filters.search,'encoded');
});
test('malformed deep links have bounded safe defaults',()=>{
 const state=parseRuleLocation('?days=0&limit=100000&offset=-1&tab=execute&sort=SQL&enabled=yes');
 assert.equal(state.filters.days,30);assert.equal(state.filters.limit,25);assert.equal(state.filters.offset,0);assert.equal(state.tab,'details');assert.equal(state.filters.sort,'updated_at');assert.equal(state.filters.enabled,'');
});
