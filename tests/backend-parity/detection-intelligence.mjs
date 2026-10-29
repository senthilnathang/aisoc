import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {argumentsFor,target,client,output} from './harness.mjs';
process.env.AISOC_TEST_WORKER='false';
const options=argumentsFor(),server=await target(options),events=[],tenant='intelligence-'+randomUUID(),req=client(server.url,tenant,events),path='/api/v1/detection-intelligence';
const empty={days:7,totals:{total_alerts:0,investigated:0,suppressed:0,not_sampled:0,pending_review:0},by_source:[],by_severity:[],by_routing:[],by_disposition:[],outcomes:[],daily:[],recent:[],sources:[]};
try{
 assert.deepEqual(await req('GET',path),empty);
 const rules={};for(const routing of ['Investigate','Escalate','Suppress','Sample (10%)'])rules[routing]=await req('POST','/api/v1/detection-rules',{name:routing+' rule',severity:'high',routing},201);
 const source=await req('POST','/api/v1/api-sources',{name:'Bound source',provider:'Provider A',rule_id:rules.Investigate.id},201);
 await req('POST','/api/v1/api-sources',{name:'Unused source',provider:'Unused provider',rule_id:rules.Suppress.id},201);
 const alerts=[];let counter=0;
 const add=async(routing,severity,sourceName='Custom sensor',external)=>{const result=await req('POST','/api/v1/alerts',{source:sourceName,external_id:external??'event-'+counter++,rule_id:rules[routing].id,title:'Observed '+severity,severity},201);alerts.push(result.alert);return result.alert};
 await add('Investigate','high');await add('Escalate','critical');await add('Suppress','low');await add('Suppress','medium','Other sensor');
 for(const want of [true,false]){let external;for(let i=0;i<200;i++){const candidate='sample-'+i;const sampled=createHash('sha256').update(JSON.stringify([tenant,'Custom sensor',candidate])).digest().readUInt32BE(0)%10===0;if(sampled===want){external=candidate;break}}assert.ok(external);await add('Sample (10%)','medium','Custom sensor',external)}
 const bound=await req('POST','/api/v1/intake/'+source.source.id+'/alerts',{external_id:'bound',title:'Bound event',severity:'low'},201,{authorization:'Bearer '+source.api_key});alerts.push(bound.alert);
 await add('Suppress','low','api-source:missing-binding');
 for(let i=0;i<52;i++)await add('Suppress',i%2?'high':'low');
 const provider=s=>s===source.source.source?'Provider A':s;
 const choices=['Custom sensor','Other sensor','Provider A','Unused provider'];
 function grouped(rows,field){const counts=new Map();for(const a of rows){const name=field==='source'?provider(a.source):a[field];counts.set(name,(counts.get(name)||0)+1)}return [...counts].map(([name,count])=>({name,count})).sort((a,b)=>b.count-a.count||(a.name<b.name?-1:a.name>b.name?1:0))}
 function verify(result,rows,days=7){
  assert.equal(result.days,days);const cases=new Set(rows.map(a=>a.investigation_id).filter(Boolean));assert.deepEqual(result.totals,{total_alerts:rows.length,investigated:cases.size,suppressed:rows.filter(a=>a.disposition==='suppressed').length,not_sampled:rows.filter(a=>a.disposition==='not_sampled').length,pending_review:cases.size});
  for(const field of ['source','severity','routing','disposition'])assert.deepEqual(result['by_'+field],grouped(rows,field));assert.deepEqual(result.outcomes,cases.size?[{name:'unknown',count:cases.size}]:[]);assert.deepEqual(result.sources,choices);
  const daily=new Map();for(const a of rows){const date=a.created_at.slice(0,10);if(!daily.has(date))daily.set(date,{date,critical:0,high:0,medium:0,low:0,total:0});daily.get(date)[a.severity]++;daily.get(date).total++}assert.deepEqual(result.daily,[...daily.values()].sort((a,b)=>a.date.localeCompare(b.date)));
  assert.equal(result.recent.length,Math.min(50,rows.length));const byId=new Map(rows.map(a=>[a.id,a]));let previous='9999';const cutoff=[...rows].sort((a,b)=>b.created_at.localeCompare(a.created_at))[Math.min(49,rows.length-1)]?.created_at;
  for(const r of result.recent){const a=byId.get(r.id);assert.ok(a);assert.ok(r.created_at<=previous);assert.ok(r.created_at>=cutoff);previous=r.created_at;const rule=Object.values(rules).find(rule=>rule.id===a.rule_id);assert.deepEqual(r,{id:a.id,title:a.title,source:a.source,severity:a.severity,disposition:a.disposition,routing:a.routing,rule_id:a.rule_id,investigation_id:a.investigation_id,created_at:a.created_at,rule_name:rule.name,source_provider:a.source===source.source.source?'Provider A':null,determination:a.investigation_id?'unknown':null})}
 }
 verify(await req('GET',path),alerts);verify(await req('GET',path+'?days=1&severity=high'),alerts.filter(a=>a.severity==='high'),1);
 verify(await req('GET',path+'?source=Provider%20A'),alerts.filter(a=>a.source===source.source.source));verify(await req('GET',path+'?source='+encodeURIComponent(source.source.source)),alerts.filter(a=>a.source===source.source.source));
 verify(await req('GET',path+'?source=Custom%20sensor&severity=medium&days=90'),alerts.filter(a=>a.source==='Custom sensor'&&a.severity==='medium'),90);
 verify(await req('GET',path+'?source=no-match'),[]);verify(await req('GET',path+'?source=Unused%20provider'),[]);
 await req('POST','/api/v1/api-sources/'+source.source.id+'/revoke');verify(await req('GET',path+'?source=Provider%20A'),alerts.filter(a=>a.source===source.source.source));
 for(const query of ['days=0','days=91','days=1.5','days=invalid','severity=invalid','source='+('x'.repeat(201)),'days=1&days=2']){const bad=await req('GET',path+'?'+query,undefined,400);assert.equal(bad.error.code,'VALIDATION_ERROR');assert.ok(bad.error.details.length)}
 assert.deepEqual(await req('GET',path,undefined,200,{'x-tenant-id':tenant+'-foreign'}),empty);await req('GET',path,undefined,401,{authorization:'Bearer '+source.api_key});
 await output(options.output||'output/backend-parity/detection-intelligence.json',{passed:true,backend:options.label||(server.owned?'node':'external'),request_count:events.length,persistence_fixture:{tenant},checks:['totals and distinct investigations','source/provider and severity filters','routing/disposition groups','UTC daily totals','recent 50 cap with uncapped totals','unfiltered source choices','revoked source history','query validation','tenant isolation'],scope:'Shared fixtures; PostgreSQL integration tests cover old alerts, UTC boundaries and foreign provider spoofing'});
 console.log('PASS detection intelligence');
}finally{await server.close();}
