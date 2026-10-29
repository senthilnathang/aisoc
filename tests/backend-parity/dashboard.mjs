import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {argumentsFor,target,client,output} from './harness.mjs';
process.env.AISOC_TEST_WORKER='false';
const options=argumentsFor(),server=await target(options),events=[],tenant='dashboard-'+randomUUID(),req=client(server.url,tenant,events),path='/api/v1/dashboard';
const empty={queueItems:0,openInvestigations:0,openRemediations:0,enabledDetectionRules:0,operationalConnectors:0,recentInvestigations:[]};
try{
 assert.deepEqual(await req('GET',path),empty);
 const cases=[];
 for(const status of ['open','investigating','contained','resolved','closed','open'])cases.push(await req('POST','/api/v1/investigations',{title:'Dashboard '+status,source:'Fixture',severity:'high',status,insight_refs:['ref-1']},201));
 const rem=await req('POST','/api/v1/remediations',{investigation_id:cases[0].id,title:'Pending action',action_type:'isolate'},201);
 const executed=await req('POST','/api/v1/remediations',{investigation_id:cases[0].id,title:'Done action',action_type:'isolate'},201);await req('POST','/api/v1/remediations/'+executed.id+'/execute');
 const enabled=await req('POST','/api/v1/detection-rules',{name:'Enabled',severity:'high'},201);await req('POST','/api/v1/detection-rules',{name:'Disabled',severity:'low',enabled:false},201);
 const connector=await req('POST','/api/v1/connectors',{name:'Configured',type:'crowdstrike',status:'operational'},201);await req('POST','/api/v1/connectors',{name:'Untested',type:'other'},201);
 async function verify(counts){const result=await req('GET',path);const {recentInvestigations,...actual}=result;assert.deepEqual(actual,counts);const all=(await req('GET','/api/v1/investigations?limit=500')).items;assert.equal(recentInvestigations.length,Math.min(5,all.length));let previous='9999';const byId=new Map(all.map(i=>[i.id,i]));const cutoff=all[Math.min(4,all.length-1)]?.updated_at;for(const row of recentInvestigations){assert.deepEqual(row,byId.get(row.id));assert.ok(row.updated_at<=previous);assert.ok(row.updated_at>=cutoff);previous=row.updated_at;assert.equal(row.jobs,undefined);assert.equal(row.ordinal,undefined)}return result}
 const counts={queueItems:4,openInvestigations:3,openRemediations:1,enabledDetectionRules:1,operationalConnectors:1};await verify(counts);
 await req('PATCH','/api/v1/investigations/'+cases[3].id,{status:'open'});counts.queueItems++;counts.openInvestigations++;await verify(counts);
 await req('POST','/api/v1/remediations/'+rem.id+'/execute');counts.openRemediations=0;
 await req('POST','/api/v1/detection-rules/'+enabled.id+'/toggle');counts.enabledDetectionRules=0;
 await req('POST','/api/v1/connectors/'+connector.id+'/test');counts.operationalConnectors=0;await verify(counts);
 // Whole-tenant counts exceed both the dashboard's five rows and the default resource page.
 for(let i=0;i<101;i++)await req('POST','/api/v1/investigations',{title:'Extra '+i,source:'Fixture',severity:'low'},201);
 counts.queueItems+=101;counts.openInvestigations+=101;await verify(counts);
 await req('DELETE','/api/v1/investigations/'+cases[0].id,undefined,204);counts.queueItems--;counts.openInvestigations--;await verify(counts);
 assert.deepEqual(await req('GET',path,undefined,200,{'x-tenant-id':tenant+'-foreign'}),empty);
 // Dashboard has no filter contract; query parameters must not silently scope totals.
 assert.deepEqual(await req('GET',path+'?status=closed&limit=1'),await req('GET',path));
 await output(options.output||'output/backend-parity/dashboard.json',{passed:true,backend:options.label||(server.owned?'node':'external'),request_count:events.length,persistence_fixture:{tenant},checks:['all five aggregates','distinct case status semantics','recent five resource shape','mutations and deletion','uncapped counts','tenant isolation'],scope:'Counts reflect stored status, including manually set operational connector status; no live provider health is inferred.'});
 console.log('PASS main dashboard');
}finally{await server.close();}
