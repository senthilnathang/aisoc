import test from 'node:test';
import assert from 'node:assert/strict';
import {parseIntegrationImport, processingLabel} from '../../frontend/src/localIntegrationImport.mjs';
test('imports arrays and complete bundles without losing context or accepting metadata',()=>{
 const events=[{event_id:'example'}];
 assert.deepEqual(parseIntegrationImport(JSON.stringify(events)),{events});
 assert.deepEqual(parseIntegrationImport(JSON.stringify({schema_version:'1',events,context:{iam:[]}})),{events,context:{iam:[]}});
 for(const bad of [{schema_version:'2',events},{schema_version:'1',events,url:'https://vendor'},null,{}, {schema_version:'1',events:{}}]) assert.throws(()=>parseIntegrationImport(JSON.stringify(bad)));
});
test('processing labels never treat worker heartbeat as successful completion',()=>{
 assert.equal(processingLabel({profile:{state:'archived'}}),'Archived · retained evidence');
 assert.equal(processingLabel({profile:{state:'draft'}}),'Draft · not imported');
 assert.equal(processingLabel({profile:{state:'sealed'},intake:{accepted_events:0}}),'Import incomplete · retry import');
 assert.equal(processingLabel({profile:{state:'sealed'},intake:{accepted_events:4,processed_events:4},worker:{status:'running'},cases:[]}),'Processing · awaiting investigation');
 assert.equal(processingLabel({profile:{state:'sealed'},cases:[{state:'awaiting_review'}]}),'Analyst approval required');
 assert.equal(processingLabel({profile:{state:'sealed'},cases:[{state:'synced'}]}),'Complete · mock write-back recorded');
});
test('phishing bundle preserves message provenance and never accepts provider configuration',async()=>{
 const {readFileSync}=await import('node:fs');
 const document=JSON.parse(readFileSync(new URL('../../examples/scenarios/phishing/document.json',import.meta.url),'utf8'));
 const parsed=parseIntegrationImport(JSON.stringify(document));
 assert.equal(parsed.events.length,4);assert(parsed.events.every(e=>e.projection.message_ref==='mock-message-1'));
 assert.deepEqual(new Set(parsed.events.map(e=>e.event_type)),new Set(['email.delivered','email.authentication_failed','email.link_clicked','email.credential_submitted']));
 assert.throws(()=>parseIntegrationImport(JSON.stringify({...document,provider_url:'http://localhost'})));
});
