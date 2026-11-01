import test from 'node:test';
import assert from 'node:assert/strict';
import {ownershipLabel,notificationLink} from '../../frontend/src/approvalOwnership.js';
const now=Date.parse('2026-11-01T10:00:00Z');
test('ownership expiry is separate from proposal approval and stale revisions win',()=>{
 assert.equal(ownershipLabel(null,now),'Unassigned');
 assert.equal(ownershipLabel({owner_id:'reviewer',state:'owned',expires_at:'2026-11-01T11:00:00Z'},now),'Owned');
 assert.equal(ownershipLabel({owner_id:'reviewer',state:'owned',expires_at:'2026-11-01T10:00:00Z'},now),'Ownership expired');
 assert.equal(ownershipLabel({owner_id:'reviewer',state:'revision_changed',expires_at:'2026-11-01T11:00:00Z'},now),'Revision changed');
 assert.equal(ownershipLabel({owner_id:'reviewer',expires_at:'invalid'},now),'Ownership expired');
});
test('notification links stay local and preserve composite response identity',()=>{
 const link=notificationLink({kind:'respond',resource_id:'id?/foreign',connector_id:'connector one',source:'mock'});
 const url=new URL(link,'http://localhost:8080');assert.equal(url.pathname,'/respond/inbox');assert.equal(url.searchParams.get('focus'),'id?/foreign');assert.equal(url.searchParams.get('connector'),'connector one');assert.equal(url.origin,'http://localhost:8080');
});
