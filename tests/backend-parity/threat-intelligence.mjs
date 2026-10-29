import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {argumentsFor,target,client,output} from './harness.mjs';
process.env.AISOC_TEST_WORKER='false';
const options=argumentsFor(),server=await target(options),events=[],tenant='threat-'+randomUUID(),req=client(server.url,tenant,events);
const reports='/api/v1/threat-intel-reports',indicators='/api/v1/threat-indicators',dashboard='/api/v1/threat-intel/dashboard';
try {
 const empty={totalReports:0,totalIndicators:0,indicatorsWithHits:0,activeHunts:0,findingsTotal:0,reportsBySource:{},recentReports:[]};assert.deepEqual(await req('GET',dashboard),empty);
 const report=await req('POST',reports,{title:'Observed campaign',severity:'high',tags:['example','T1059'],ignored:true,status:'archived'},201),path=reports+'/'+report.id;
 assert.match(report.id,/^TIR-/);assert.equal(report.status,'archived');assert.equal(report.source,'AISOC');assert.equal(report.report_type,'threat_report');assert.equal(report.hunt_status,'not_started');assert.equal(report.ioc_count,0);assert.equal(report.hunts_launched,0);assert.equal(report.findings_count,0);assert.equal(report.summary,'');assert.deepEqual(report.tags,['example','T1059']);assert.equal(report.ignored,undefined);assert.ok(!('ordinal' in report));
 assert.deepEqual(await req('GET',path),{...report,indicators:[]});
 const second=await req('POST',reports,{title:'Other advisory',summary:'Campaign notes',severity:'low',source:'Feed',report_type:'advisory',published_at:'2025-01-02T03:04:05.000Z'},201);
 const ioc=await req('POST',indicators,{report_id:report.id,indicator_type:'ip',value:'192.0.2.7',hits:2},201),ip=indicators+'/'+ioc.id;
 assert.equal(ioc.severity,'medium');assert.equal(ioc.status,'active');assert.equal(ioc.last_seen_at,null);assert.equal(ioc.hits,2);assert.ok(!('ordinal' in ioc));assert.deepEqual((await req('GET',path)).indicators,[ioc]);
 assert.equal((await req('GET',path)).ioc_count,0,'legacy report counter is independent of authored indicators');
 await req('PATCH',path,{status:'actionable',ioc_count:4,findings_count:3});
 let launched=await req('POST',path+'/launch-hunt');assert.equal(launched.hunt_status,'hunting');assert.equal(launched.hunts_launched,1);
 launched=await req('POST',path+'/launch-hunt');assert.equal(launched.hunts_launched,2);
 const before=await req('GET',ip);assert.deepEqual(await req('PATCH',ip,{ignored:'ignored',id:'override',tenant_id:'override'}),before);
 const moved=await req('PATCH',ip,{report_id:second.id,status:'mitigated',last_seen_at:'2025-02-03T00:00:00.000Z',hits:8});assert.equal(moved.report_id,second.id);assert.equal(moved.hits,8);
 assert.deepEqual((await req('GET',path)).indicators,[]);assert.deepEqual((await req('GET',reports+'/'+second.id)).indicators,[moved]);
 assert.deepEqual((await req('GET',indicators+'?reportId='+report.id)).items,[]);assert.deepEqual((await req('GET',indicators+'?reportId='+second.id+'&status=mitigated&severity=medium&search=192.0')).items,[moved]);
 assert.equal((await req('GET',reports+'?search=CAMPAIGN')).items.length,2);assert.equal((await req('GET',reports+'?search=%25')).items.length,2);assert.equal((await req('GET',reports+'?status=actionable&severity=high')).items.length,1);assert.equal((await req('GET',reports+'?limit=1&offset=1')).items.length,1);
 const summary=await req('GET',dashboard);assert.equal(summary.totalReports,2);assert.equal(summary.totalIndicators,1);assert.equal(summary.indicatorsWithHits,1);assert.equal(summary.activeHunts,1);assert.equal(summary.findingsTotal,3);assert.deepEqual(summary.reportsBySource,{AISOC:1,Feed:1});assert.equal(summary.recentReports.length,2);
 const foreign={'x-tenant-id':tenant+'-foreign'};
 assert.deepEqual(await req('GET',dashboard,undefined,200,foreign),empty);
 for(const p of [path,ip]){await req('GET',p,undefined,404,foreign);await req('PATCH',p,{},404,foreign);await req('DELETE',p,undefined,404,foreign)}
 await req('POST',path+'/launch-hunt',undefined,404,foreign);
 for(const [p,body]of [[reports,{severity:'high'}],[reports,{title:'',severity:'high'}],[reports,{title:'Invalid',severity:'invalid'}],[reports,{title:'Invalid',severity:'high',ioc_count:-1}],[indicators,{report_id:report.id,indicator_type:'ip',value:''}],[indicators,{report_id:report.id,indicator_type:'ip',value:'x',hits:-1}]])assert.equal((await req('POST',p,body,400)).error.code,'VALIDATION_ERROR');
 for(const p of [reports,indicators])for(const q of ['limit=0','limit=501','offset=-1','limit=1.5','limit=2&limit=3'])await req('GET',p+'?'+q,undefined,400);
 await req('DELETE',reports+'/'+second.id,undefined,204);await req('GET',ip,undefined,404);assert.equal((await req('GET',dashboard)).totalIndicators,0);
 const disposable=await req('POST',indicators,{report_id:report.id,indicator_type:'domain',value:'example.test'},201);await req('DELETE',indicators+'/'+disposable.id,undefined,204);await req('DELETE',indicators+'/'+disposable.id,undefined,404);
 // GET report detail caps embedded indicators at 100; dashboard caps each collection at 500.
 for(let n=0;n<101;n++)await req('POST',indicators,{report_id:report.id,indicator_type:'domain',value:'host-'+n+'.test'},201);
 assert.equal((await req('GET',path)).indicators.length,100);assert.equal((await req('GET',indicators+'?limit=500')).items.length,101);assert.equal((await req('GET',dashboard)).totalIndicators,101);
 await output(options.output||'output/backend-parity/threat-intelligence.json',{passed:true,backend:options.label||(server.owned?'node':'external'),request_count:events.length,persistence_fixture:{tenant,report_id:report.id},checks:['report and indicator CRUD','defaults and field allowlists','independent counters','hunt status increments','indicator reassignment and cascade','filters and pagination','tenant isolation','detail cap','validation'],scope:'Shared valid lifecycle; PostgreSQL additionally enforces timestamps/int32, validates constrained enums and returns 404 for missing indicator parents.'});
 console.log('PASS threat intelligence');
}finally{await server.close();}
