import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { argumentsFor, target, client, output, root } from "./harness.mjs";

import { probeCoverage } from "./coverage.mjs";
import { extendedScenarios } from "./extended.mjs";

const options=argumentsFor(), server=await target(options), events=[], results=[];
const prefix="parity-"+randomUUID();
async function scenario(name,work) {
  const start=performance.now();
  try { const startIndex=events.length; await work(client(server.url,prefix+"-"+name,events)); for(const event of events.slice(startIndex))event.scenario=name; results.push({name,passed:true,duration_ms:performance.now()-start}); console.log("PASS "+name); }
  catch(error) {results.push({name,passed:false,error:error.message});console.error("FAIL "+name+": "+error.message);}
}
async function finished(req,id) {
  for(let i=0;i<200;i++) {
    const record=await req("GET","/api/v1/investigations/"+id);
    if(record.jobs.every(job=>job.status==="completed"))return record;
    if(record.jobs.some(job=>job.status==="failed"))throw Error("Worker failed");
    await delay(100);
  }
  throw Error("Job did not complete in 20 seconds; match the documented test worker configuration");
}
const caseBody={title:"Parity case",source:"Parity sensor",category:"identity",severity:"high"};
try {
  await scenario("case-lifecycle",async req=>{
    const record=await req("POST","/api/v1/investigations",caseBody,201);
    assert.equal(record.determination,"unknown");
    await req("GET","/api/v1/investigations/"+record.id,undefined,404,{"x-tenant-id":prefix+"-foreign"});
    await req("POST","/api/v1/investigations/"+record.id+"/artifacts",{type:"domain",value:"evidence.example",label:"Evidence"},201);
    await req("POST","/api/v1/investigations/"+record.id+"/feedback",{comment:"Reviewed"},201);
    await req("POST","/api/v1/investigations/"+record.id+"/determination",{determination:"malicious"});
    const detail=await req("GET","/api/v1/investigations/"+record.id);
    assert.equal(detail.feedback.length,1); assert.equal(detail.artifacts.length,1); assert.equal(detail.determination,"malicious");
    assert.ok((await req("GET","/api/v1/investigations/"+record.id+"/history")).items.length>=4);
    const action=await req("POST","/api/v1/remediations",{investigation_id:record.id,action_type:"isolate_device",title:"Local containment",connector:"Parity"},201);
    assert.equal((await req("POST","/api/v1/remediations/"+action.id+"/execute")).status,"completed");
    await req("DELETE","/api/v1/investigations/"+record.id,undefined,204);
    await req("GET","/api/v1/remediations/"+action.id,undefined,404);
  });
  await scenario("response-versions",async req=>{
    const body={kind:"runbook",title:"Recover",description:"Procedure",domain:"Identity",trigger:"Identity incident",steps:[{title:"Approve isolation",instructions:"Check scope",approval_required:true}]};
    const plan=await req("POST","/api/v1/response-plans",body,201);
    const record=await req("POST","/api/v1/investigations",caseBody,201);
    const path="/api/v1/investigations/"+record.id+"/runbooks";
    const attachment=await req("POST",path,{plan_id:plan.id,expected_version:1},201);
    await req("POST",path,{plan_id:plan.id,expected_version:1},409);
    const updated=await req("PATCH","/api/v1/response-plans/"+plan.id,{...body,title:"Recover v2",expected_version:1});
    assert.equal(updated.version,2);
    await req("PATCH","/api/v1/response-plans/"+plan.id,{...body,expected_version:1},409);
    assert.equal((await req("GET",path)).items[0].snapshot.title,"Recover");
    const step={expected_version:1,step_index:0,completed:true,note:"Scope verified",approval_confirmed:false};
    await req("PATCH",path+"/"+attachment.id,step,400);
    assert.equal((await req("PATCH",path+"/"+attachment.id,{...step,approval_confirmed:true})).steps[0].completed,true);
    await req("PATCH",path+"/"+attachment.id,{...step,approval_confirmed:true},409);
    await req("POST","/api/v1/response-plans/"+plan.id+"/state",{expected_version:2,state:"archived"});
    await req("PATCH","/api/v1/response-plans/"+plan.id,{...body,expected_version:3},409);
    const copy=await req("POST","/api/v1/response-plans/"+plan.id+"/duplicate",undefined,201);
    assert.equal(copy.version,1);assert.equal(copy.state,"active");
    assert.equal((await req("GET","/api/v1/response-plans/"+plan.id+"/history")).items.length,3);
    await req("GET",path,undefined,404,{"x-tenant-id":prefix+"-foreign"});
  });
  await scenario("detection-and-intake",async req=>{
    const rule=await req("POST","/api/v1/detection-rules",{name:"Parity rule",severity:"high",enabled:true,routing:"Investigate"},201);
    const source=await req("POST","/api/v1/api-sources",{name:"Parity source",provider:"Parity",rule_id:rule.id},201);
    const headers={authorization:"Bearer "+source.api_key};
    const body={external_id:"event-1",title:"Unexpected process",severity:"high"};
    const received=await req("POST",source.source.intake_path,body,201,headers);
    assert.equal((await req("POST",source.source.intake_path,body,200,headers)).duplicate,true);
    await req("POST",source.source.intake_path,{...body,title:"Changed"},409,headers);
    await req("GET","/api/v1/dashboard",undefined,401,headers);
    const detail=await finished(req,received.alert.investigation_id);
    assert.equal(detail.jobs.length,1);assert.equal(detail.determination,"suspicious");
    const clone=await req("POST","/api/v1/detection-rules/"+rule.id+"/clone",undefined,201);
    assert.equal(clone.enabled,false);
    const ruleDetail=await req("GET","/api/v1/detection-rules/"+rule.id);
    await req("PATCH","/api/v1/detection-rules/"+rule.id,{name:"Changed rule",expected_version:ruleDetail.version});
    await req("PATCH","/api/v1/detection-rules/"+rule.id,{name:"Stale rule",expected_version:ruleDetail.version},409);
    await req("GET","/api/v1/detection-registry?limit=1&sort=name&direction=asc");
    await req("GET","/api/v1/detection-intelligence?days=7");
    const rotated=await req("POST","/api/v1/api-sources/"+source.source.id+"/rotate-key",{});
    await req("POST",source.source.intake_path,body,401,headers);
    await req("POST","/api/v1/api-sources/"+source.source.id+"/revoke");
    await req("POST",source.source.intake_path,body,401,{authorization:"Bearer "+rotated.api_key});
  });
  await scenario("skills-matching-outcomes",async req=>{
    const skill=await req("POST","/api/v1/skills",{name:"Identity guidance",content_markdown:"Check evidence",modules:["investigations","threat_hunting"],alert_categories:["identity"]},201);
    const material=await req("POST","/api/v1/skills/"+skill.id+"/materials",{name:"Checklist",filename:"check.md",content:"Check identity"},201);
    await req("PATCH","/api/v1/skills/"+skill.id+"/materials/"+material.id,{content:"Check identity and device"});
    assert.equal((await req("GET","/api/v1/skills/"+skill.id+"/materials/"+material.id+"/versions")).items.length,2);
    await req("POST","/api/v1/skills/"+skill.id+"/publish");
    const record=await req("POST","/api/v1/investigations",caseBody,201);
    const detail=await req("GET","/api/v1/investigations/"+record.id);
    assert.equal(detail.skill_applications.length,1);
    const application=detail.skill_applications[0];
    assert.equal(application.snapshot.materials[0].content,"Check identity and device");
    await req("PATCH","/api/v1/skills/"+skill.id,{content_markdown:"New instructions"});
    assert.equal((await req("GET","/api/v1/investigations/"+record.id)).skill_applications[0].snapshot.content_markdown,"Check evidence");
    await req("POST","/api/v1/skills/applications/"+application.id+"/feedback",{rating:"helpful",comment:"Useful"},201);
    await req("POST","/api/v1/skills/applications/"+application.id+"/feedback",{rating:"not_helpful"},201);
    await req("PATCH","/api/v1/investigations/"+record.id,{status:"resolved",determination:"malicious"});
    const outcome=(await req("GET","/api/v1/skills/outcomes")).items.find(row=>row.id===skill.id);
    assert.equal(outcome.case_applications,1);assert.equal(outcome.helpful,0);assert.equal(outcome.not_helpful,1);assert.equal(outcome.labeled_closed_cases,1);
    await req("GET","/api/v1/skills/"+skill.id,undefined,404,{"x-tenant-id":prefix+"-foreign"});
    await req("DELETE","/api/v1/skills/"+skill.id+"/materials/"+material.id,undefined,204);
    assert.equal((await req("GET","/api/v1/skills/"+skill.id+"/materials")).items.length,0);
  });
  await scenario("skills-suggestions",async req=>{
    assert.equal((await req("GET","/api/v1/skills/suggestions")).items.length,0);
    const rule=await req("POST","/api/v1/detection-rules",{name:"Suggestion rule",severity:"high",enabled:true,routing:"Investigate"},201);
    for(const source of ["source-a","source-b"]) {
      for(let i=0;i<2;i++) {
        const received=await req("POST","/api/v1/alerts",{source,external_id:source+"-"+i,rule_id:rule.id,title:"Identity case",category:"identity",severity:"high"},201);
        await finished(req,received.alert.investigation_id);
        await req("PATCH","/api/v1/investigations/"+received.alert.investigation_id,{status:"resolved",determination:"malicious"});
      }
    }
    const suggestions=(await req("GET","/api/v1/skills/suggestions")).items;
    assert.equal(suggestions.length,2);
    const accepted=await req("POST","/api/v1/skills/suggestions/"+suggestions[0].id+"/accept",undefined,201);
    assert.equal(accepted.skill.state,"draft");
    assert.equal((await req("POST","/api/v1/skills/suggestions/"+suggestions[0].id+"/accept",undefined,201)).skill.id,accepted.skill.id);
    await req("POST","/api/v1/skills/suggestions/"+suggestions[1].id+"/dismiss");
    await req("POST","/api/v1/skills/suggestions/"+suggestions[1].id+"/accept",undefined,409);
    assert.equal((await req("GET","/api/v1/skills/suggestions")).items.length,0);
  });
  await scenario("other-domains",async req=>{
    const hunt=await req("POST","/api/v1/hunts",{name:"Parity hunt",query:"source:test"},201);
    await req("POST","/api/v1/hunts/"+hunt.id+"/run"); await req("GET","/api/v1/hunts/"+hunt.id);
    const connector=await req("POST","/api/v1/connectors",{type:"crowdstrike",name:"Parity connector",secret:"test-only"},201);
    assert.equal(connector.secret,undefined);assert.equal(connector.secret_ciphertext,undefined);
    assert.equal((await req("POST","/api/v1/connectors/"+connector.id+"/test")).status,"untested");
    const report=await req("POST","/api/v1/threat-intel-reports",{title:"Parity report",severity:"high"},201);
    await req("POST","/api/v1/threat-indicators",{report_id:report.id,indicator_type:"domain",value:"indicator.example"},201);
    assert.equal((await req("GET","/api/v1/threat-intel-reports/"+report.id)).indicators.length,1);
    await req("POST","/api/v1/threat-intel-reports/"+report.id+"/launch-hunt");
    await req("GET","/api/v1/threat-intel/dashboard");
    await req("GET","/api/v1/dashboard");await req("GET","/api/v1/investigation-queue");
  });
  await extendedScenarios(scenario, finished);
  const inventory=JSON.parse(await readFile(root+"/contracts/current-backend.json","utf8"));
  const coverage=probeCoverage(inventory.routes,events);
  await output(options.output || "output/backend-parity/node-report.json",{backend:options.label || (server.owned?"node-isolated":"external"),timestamp:new Date().toISOString(),transport:"real HTTP",worker_interval_ms:server.worker_interval_ms ?? "external configuration",results,request_count:events.length,endpoint_probe_coverage:coverage,requests:events});
  if(results.some(result=>!result.passed))process.exitCode=1;
} finally { await server.close(); }
