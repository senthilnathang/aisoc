import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {argumentsFor,target,client,output} from './harness.mjs';
const options=argumentsFor(),server=await target(options),events=[];
const tenant='scalars-'+randomUUID(),req=client(server.url,tenant,events);
try {
 const c=await req('POST','/api/v1/investigations',{title:'Scalar fixture',source:'Fixture',severity:'high'},201);
 const path='/api/v1/investigations/'+c.id;
 const patch={summary:123,owner:0,primary_entity:42,risk_score:'37',replay_count:'2'};
 const result=await req('PATCH',path,patch);
 assert.equal(result.summary,'123.0');assert.equal(result.owner,'0.0');assert.equal(result.primary_entity,'42.0');
 assert.equal(result.risk_score,37);assert.equal(result.replay_count,2);
 const decimal=await req('PATCH',path,{summary:1.25,risk_score:'3.0'});
 assert.equal(decimal.summary,'1.25');assert.equal(decimal.risk_score,3);
 const rem=await req('POST','/api/v1/remediations',{investigation_id:c.id,action_type:'test',title:'Scalar simulation'},201);
 const changed=await req('PATCH','/api/v1/remediations/'+rem.id,{title:123,description:1.25,connector:0});
 assert.equal(changed.title,'123.0');assert.equal(changed.description,'1.25');assert.equal(changed.connector,'0.0');
 const before=await req('GET',path+'/history');
 await req('PATCH',path,{summary:'must roll back',risk_score:true},options.label==='go'?400:500);
 assert.deepEqual((await req('GET',path+'/history')).items,before.items);
 assert.equal((await req('GET',path)).summary,'1.25');
 await req('DELETE',path,undefined,204);
 await output(options.output||'output/backend-parity/case-scalars.json',{passed:true,request_count:events.length,checks:['numeric text affinity','numeric-string integers','remediation scalar text','invalid boolean rollback'],known_difference:'Go returns 400 for a boolean integer; Node returns a generic 500',backend:options.label||(server.owned?'node':'external')});
 console.log('PASS case scalar compatibility');
}finally{await server.close();}
