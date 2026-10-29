import assert from 'node:assert/strict';

// Fresh tenants and public HTTP only: usable against either backend.
export async function extendedScenarios(scenario, finished) {
  await scenario('resource-lifecycles', async req => {
    assert.equal((await req('GET', '/health')).status, 'ok');
    const investigation = await req('POST', '/api/v1/investigations', {title:'Lifecycle',source:'Fixture',severity:'high'}, 201);
    assert.equal((await req('POST', `/api/v1/investigations/${investigation.id}/reinvestigate`)).replay_count, 1);
    const report = await req('POST', '/api/v1/threat-intel-reports', {title:'Lifecycle report',severity:'high'}, 201);
    const fixtures = [
      ['connectors', {name:'Lifecycle connector',type:'custom',secret:'fixture-secret'}, {name:'Updated connector'}, 'name'],
      ['hunts', {name:'Lifecycle hunt',query:'fixture'}, {name:'Updated hunt'}, 'name'],
      ['remediations', {title:'Lifecycle action',investigation_id:investigation.id,action_type:'isolate_device'}, {title:'Updated action'}, 'title'],
      ['threat-indicators', {report_id:report.id,indicator_type:'domain',value:'fixture.example'}, {value:'updated.example'}, 'value'],
      ['detection-rules', {name:'Lifecycle rule',severity:'high'}, {name:'Updated rule'}, 'name'],
    ];
    for (const [resource, body, patch, field] of fixtures) {
      const path = '/api/v1/'+resource;
      const record = await req('POST', path, body, 201);
      assert.equal((await req('GET', path+'/'+record.id)).id, record.id);
      assert.ok((await req('GET', path+'?limit=1&offset=0')).items.some(row => row.id === record.id));
      await req('GET', path+'/'+record.id, undefined, 404, {'x-tenant-id':'foreign-lifecycle'});
      await req('PATCH', path+'/'+record.id, patch, 404, {'x-tenant-id':'foreign-lifecycle'});
      assert.equal((await req('PATCH', path+'/'+record.id, patch))[field], patch[field]);
      const fetched = await req('GET', path+'/'+record.id);
      assert.equal(fetched[field], patch[field]);
      if (resource === 'connectors') {
        assert.equal(fetched.secret, undefined); assert.equal(fetched.secret_ciphertext, undefined);
      }
      if (resource === 'detection-rules') {
        assert.equal((await req('POST', path+'/'+record.id+'/toggle')).enabled, !fetched.enabled);
        assert.ok((await req('GET', path+'/'+record.id+'/history')).items.length >= 2);
      }
      await req('DELETE', path+'/'+record.id, undefined, 404, {'x-tenant-id':'foreign-lifecycle'});
      await req('DELETE', path+'/'+record.id, undefined, 204);
      await req('GET', path+'/'+record.id, undefined, 404);
    }
    assert.equal((await req('PATCH', '/api/v1/threat-intel-reports/'+report.id, {title:'Updated report'})).title, 'Updated report');
    assert.ok((await req('GET', '/api/v1/threat-intel-reports')).items.some(row => row.id === report.id));
    await req('DELETE', '/api/v1/threat-intel-reports/'+report.id, undefined, 204);
    await req('GET', '/api/v1/threat-intel-reports/'+report.id, undefined, 404);
    assert.ok((await req('GET', '/api/v1/investigations')).items.some(row => row.id === investigation.id));
  });
  await scenario('native-event-mapping', async req => {
    const rule = await req('POST', '/api/v1/detection-rules', {name:'Native rule',severity:'high',enabled:true,routing:'Investigate'}, 201);
    const {source, api_key} = await req('POST', '/api/v1/api-sources', {name:'Native source',provider:'Custom EDR',rule_id:rule.id}, 201);
    const path = '/api/v1/api-sources/'+source.id;
    const headers = {authorization:'Bearer '+api_key};
    const mapping = {fields:{external_id:'event.id',title:'event.name',severity:'event.risk',evidence:'event.indicators'},severity_map:{sev1:'critical'}};
    const sample = {event:{id:'native-1',name:'Suspicious process',risk:'Sev1',indicators:[{type:'file',value:'bad.exe',label:'Image'}]}};
    const preview = await req('POST', path+'/mapping/preview', {mapping,sample});
    assert.equal(preview.valid, true);
    assert.equal(preview.normalized_alert.severity, 'critical');
    assert.equal(preview.normalized_alert.source, 'api-source:'+source.id);
    assert.equal(preview.normalized_alert.rule_id, rule.id);
    assert.equal(preview.normalized_alert.evidence[0].value, 'bad.exe');
    assert.deepEqual((await req('GET', path)).mapping, {fields:{}});
    assert.ok((await req('GET', '/api/v1/api-sources')).items.some(row => row.id === source.id));
    const invalid = await req('POST', path+'/mapping/preview', {mapping,sample:{event:{id:'incomplete',name:'Missing risk'}}});
    assert.equal(invalid.valid, false); assert.ok(invalid.errors.some(error => error.includes('severity')));
    assert.equal((await req('PATCH', path+'/mapping', {mapping:{fields:{external_id:'__proto__.id'}}}, 400)).error.code, 'INVALID_EVENT_MAPPING');
    assert.deepEqual((await req('PATCH', path+'/mapping', {mapping})).mapping, mapping);
    const received = await req('POST', source.native_intake_path, sample, 201, headers);
    assert.equal(received.alert.external_id, 'native-1');
    assert.equal(received.alert.payload.evidence[0].value, 'bad.exe');
    assert.equal((await req('POST', source.native_intake_path, sample, 200, headers)).duplicate, true);
    await req('POST', source.native_intake_path, {event:{...sample.event,name:'Changed'}}, 409, headers);
    assert.equal((await req('POST', source.native_intake_path, {}, 400, headers)).error.code, 'NATIVE_EVENT_INVALID');
    assert.equal((await req('GET', '/api/v1/alerts/'+received.alert.id)).id, received.alert.id);
    assert.equal((await req('GET', '/api/v1/alerts?limit=1')).items.length, 1);
    await req('GET', '/api/v1/alerts/'+received.alert.id, undefined, 404, {'x-tenant-id':'foreign-mapping'});
    await finished(req, received.alert.investigation_id);
    await req('POST', source.intake_path, {external_id:'normalized-1',title:'Normalized',severity:'medium'}, 201, headers);
  });
  await scenario('registry-pagination-validation', async req => {
    for (const [name,severity,enabled] of [['Alpha','high',true],['Beta','low',false],['Gamma','high',true]]) {
      await req('POST', '/api/v1/detection-rules', {name,severity,enabled}, 201);
    }
    const path = '/api/v1/detection-registry';
    const first = await req('GET', path+'?sort=name&direction=asc&limit=1');
    assert.equal(first.total, 3); assert.equal(first.items[0].name, 'Alpha');
    assert.equal((await req('GET', path+'?sort=name&direction=asc&limit=1&offset=1')).items[0].name, 'Beta');
    assert.equal((await req('GET', path+'?severity=high&enabled=true')).total, 2);
    assert.equal((await req('GET', path+'?search=BETA')).total, 1);
    assert.equal((await req('GET', path+'?search=%25')).total, 0);
    const beyond = await req('GET', path+'?offset=999');
    assert.equal(beyond.total, 3); assert.deepEqual(beyond.items, []);
    for (const query of ['sort=invalid','limit=0','offset=-1']) {
      assert.equal((await req('GET', path+'?'+query, undefined, 400)).error.code, 'VALIDATION_ERROR');
    }
    await req('POST', '/api/v1/api-sources', {name:'Private sensor',provider:'private-provider',rule_id:first.items[0].id}, 201);
    assert.equal((await req('GET', path+'?source=private-provider')).total, 1);
    const foreign = await req('GET', path, undefined, 200, {'x-tenant-id':'foreign-registry'});
    assert.equal(foreign.total, 0); assert.deepEqual(foreign.sources, []);
    for (const resource of ['investigations','detection-rules','hunts','connectors','remediations','threat-intel-reports','threat-indicators']) {
      assert.equal((await req('POST', '/api/v1/'+resource, {}, 400)).error.code, 'VALIDATION_ERROR');
      await req('GET', '/api/v1/'+resource+'?limit=501', undefined, 400);
    }
  });
  await scenario('skills-authoring-lifecycle', async req => {
    const skill = await req('POST', '/api/v1/skills', {name:'Authoring fixture',content_markdown:'Review evidence',modules:['investigations']}, 201);
    const path = '/api/v1/skills/'+skill.id;
    assert.ok((await req('GET', '/api/v1/skills?state=draft&search=Authoring')).items.some(row => row.id === skill.id));
    const material = await req('POST', path+'/materials', {name:'Checklist',filename:'check.md',content:'Review'}, 201);
    assert.equal((await req('GET', path+'/materials/'+material.id)).content, 'Review');
    await req('POST', path+'/publish');
    const before = await req('GET', path);
    assert.equal((await req('POST', path+'/toggle')).enabled, !before.enabled);
    assert.ok((await req('GET', path+'/history')).items.length > 0);
    await req('DELETE', path, undefined, 204);
    await req('GET', path, undefined, 404);
  });
  await scenario('response-restore', async req => {
    const plan = await req('POST', '/api/v1/response-plans', {kind:'runbook',title:'Restore fixture',description:'Procedure',domain:'Identity',trigger:'Incident',steps:[{title:'Review',instructions:'Review evidence',approval_required:false}]}, 201);
    const path = '/api/v1/response-plans/'+plan.id;
    assert.equal((await req('GET', path)).version, 1);
    assert.ok((await req('GET', '/api/v1/response-plans')).items.some(row => row.id === plan.id));
    const archived = await req('POST', path+'/state', {expected_version:1,state:'archived'});
    const restored = await req('POST', path+'/state', {expected_version:archived.version,state:'active'});
    assert.equal(restored.state, 'active'); assert.equal(restored.version, 3);
    await req('POST', path+'/state', {expected_version:1,state:'archived'}, 409);
    assert.equal((await req('GET', path)).state, 'active');
    assert.equal((await req('GET', path+'/history')).items.length, 3);
  });
}
