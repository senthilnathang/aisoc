import test from 'node:test';
import assert from 'node:assert/strict';
import {hasRole,independentReviewer} from '../../frontend/src/permissions.js';
test('approval presentation fails closed for absent roles and unknown authorship',()=>{
 assert.equal(hasRole(null,'approver'),false);
 assert.equal(hasRole({roles:['proposer']},'approver'),false);
 assert.equal(independentReviewer({operator_id:'reviewer'},{}),false);
 assert.equal(independentReviewer(null,{created_by:'author'}),false);
});
test('all contributors remain ineligible even with multiple roles',()=>{
 const item={created_by:'creator',proposal_authors:['first-editor','last-editor']};
 for(const id of ['creator','first-editor','last-editor'])assert.equal(independentReviewer({operator_id:id,roles:['proposer','approver']},item),false);
 const reviewer={operator_id:'reviewer',roles:['approver']};
 assert.equal(hasRole(reviewer,'approver'),true);
 assert.equal(hasRole(reviewer,'executor'),false);
 assert.equal(independentReviewer(reviewer,item),true);
});
