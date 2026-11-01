import test from 'node:test';
import assert from 'node:assert/strict';
import {expiryState,handoff,inboxKey} from '../../frontend/src/approvalInbox.js';
const now=Date.parse('2026-11-01T10:00:00Z');
const response={kind:'respond',id:'same',stage:'execution',expires_at:'2026-11-01T10:30:00Z',document:{created_by:'author',approved_by:'reviewer',connector_id:'one',source:'mock'}};
test('expiry changes executor handoff to independent reapproval at exact expiry',()=>{
 assert.equal(expiryState(response,now).label,'Expires within 1 hour');
 assert.equal(handoff(response,{operator_id:'executor',roles:['executor']},now).eligible,true);
 assert.equal(handoff(response,{operator_id:'executor',roles:['executor']},now+1800000).role,'approver');
 assert.equal(handoff(response,{operator_id:'executor',roles:['executor']},now+1800000).eligible,false);
});
test('response authors and approvers cannot act as the independent executor',()=>{
 for(const operator_id of ['author','reviewer'])assert.equal(handoff(response,{operator_id,roles:['executor']},now).eligible,false);
 assert.equal(handoff(response,null,now).eligible,false);
 assert.notEqual(inboxKey(response),inboxKey({...response,document:{...response.document,connector_id:'two'}}));
});
test('guidance contributors remain excluded and expired Memory needs author correction',()=>{
 const item={kind:'memory',document:{created_by:'author',proposal_authors:['editor']}};
 assert.equal(handoff(item,{operator_id:'editor',roles:['approver']},now).eligible,false);
 assert.equal(handoff(item,{operator_id:'reviewer',roles:['approver']},now).eligible,true);
 assert.equal(handoff({...item,document:{}},{operator_id:'reviewer',roles:['approver']},now).eligible,false);
 assert.equal(handoff({...item,expires_at:'2026-11-01T09:00:00Z'},{operator_id:'author',roles:['proposer']},now).role,'proposer');
 assert.equal(expiryState(item,now).expired,false);
 assert.equal(expiryState({...item,expires_at:'bad-date'},now).expired,true);
});
