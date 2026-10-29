import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {argumentsFor,target,client,output} from './harness.mjs';
const options=argumentsFor(),server=await target(options),events=[];
const tenant='activity-'+randomUUID(),req=client(server.url,tenant,events);
try {
 const record=await req('POST','/api/v1/investigations',{title:'Evidence case',source:'Fixture',severity:'high'},201);
 const path='/api/v1/investigations/'+record.id;
 const evidence=await req('POST',path+'/artifacts',{type:'domain',value:'example.test',metadata:{nested:{confidence:0.8},tags:['test']}},201);
 assert.equal(evidence.label,'');assert.equal(evidence.investigation_id,record.id);
 const feedback=await req('POST',path+'/feedback',{comment:'Analyst reviewed evidence'},201);
 const determined=await req('POST',path+'/determination',{determination:'malicious'});
 assert.equal(determined.determination,'malicious');
 const replay=await req('POST',path+'/reinvestigate');
 assert.equal(replay.status,'investigating');assert.equal(replay.determination,'unknown');assert.equal(replay.replay_count,1);
 const detail=await req('GET',path);
 assert.deepEqual(detail.artifacts,[evidence]);assert.deepEqual(detail.feedback,[feedback]);
 assert.deepEqual(detail.jobs,[]);
 assert.deepEqual(detail.history.map(e=>e.action),['reinvestigated','updated','feedback_added','evidence_added','created']);
 assert.deepEqual(detail.history[0].details,{queued:false});assert.deepEqual(detail.history[1].details,{fields:['determination']});
 assert.equal(detail.history[2].details.record_id,feedback.id);assert.equal(detail.history[3].details.record_id,evidence.id);
 for(const [suffix,body] of [['artifacts',{type:'domain',value:'example.test'}],['feedback',{comment:'test'}],['determination',{determination:'benign'}],['reinvestigate',undefined]]){
  await req('POST',path+'/'+suffix,body,404,{'x-tenant-id':tenant+'-foreign'});
  await req('POST','/api/v1/investigations/missing/'+suffix,body,404);
 }
 for(const [suffix,body] of [['feedback',{comment:' '}],['feedback',{comment:'x'.repeat(4001)}],['artifacts',{type:'unknown',value:'x'}],['artifacts',{type:'ip',value:' '}],['artifacts',{type:'domain',value:'x',metadata:[]}],['determination',{determination:'invalid'}]])await req('POST',path+'/'+suffix,body,400);
 const concurrent=await Promise.all(Array.from({length:5},()=>req('POST',path+'/reinvestigate')));
 assert.deepEqual(concurrent.map(r=>r.replay_count).sort((a,b)=>a-b),[2,3,4,5,6]);
 await req('DELETE',path,undefined,204);await req('GET',path,undefined,404);
 const saved=await req('POST','/api/v1/investigations',{title:'Persist activity',source:'Fixture',severity:'low'},201);
 await req('POST','/api/v1/investigations/'+saved.id+'/feedback',{comment:'Survives restart'},201);
 await req('POST','/api/v1/investigations/'+saved.id+'/artifacts',{type:'ip',value:'192.0.2.1'},201);
 await output(options.output||'output/backend-parity/case-activity.json',{passed:true,request_count:events.length,persistence_fixture:{tenant,case_id:saved.id},checks:['evidence and feedback persistence','manual determination and replay','audit linkage','validation','tenant isolation','concurrent replay'],backend:options.label||(server.owned?'node':'external')});
 console.log('PASS manual case activity');
}finally{await server.close();}
