"""HTTP acceptance paths, invoked only inside check.py's disposable environment."""
from datetime import datetime, timedelta, timezone
import time


def check_platform_acceptance(http, sql, case_id, record):
    def api(path, body=None, **kw):
        return http(path, body, root='/api/v1', **kw)

    case_path = '/investigations/' + case_id
    for _ in range(300):
        current = api(case_path)
        if all(j['status'] == 'completed' for j in current.get('jobs', [])):
            break
        if any(j['status'] == 'failed' for j in current.get('jobs', [])):
            raise AssertionError('Build investigation job failed')
        time.sleep(.1)
    else:
        raise AssertionError('Build investigation did not finish before analyst review')
    # Continue the very same Build-imported, reviewed, mock-response case.
    artifact = api(case_path + '/artifacts', dict(type='domain', value='acceptance.example.test', label='Synthetic local observation'), expected=201)
    api(case_path, dict(status='resolved', determination='suspicious', primary_entity='acceptance-user'), method='PATCH')
    source = api(case_path)
    learning = dict(expected_updated_at=source['updated_at'], evidence_ids=[artifact['id']], confirm=True,
                    rationale='Reviewed synthetic source evidence and outcome for scoped local reuse.',
                    create_skill=True, name='Acceptance identity review', guidance='Review current MFA and endpoint evidence; escalate missing context.',
                    create_memory=True, memory_kind='user', context='Synthetic training identity; prior outcome does not determine future verdicts.',
                    valid_until=(datetime.now(timezone.utc)+timedelta(days=1)).isoformat(timespec='seconds'))
    api(case_path+'/learning', {**learning, 'confirm':False}, expected=400)
    api(case_path+'/learning', learning, actor='b', expected=404)
    receipt = api(case_path+'/learning', learning)
    assert api(case_path+'/learning', learning)['skill_id'] == receipt['skill_id']
    api(case_path+'/learning', {**learning, 'guidance':'Conflicting replay of approved guidance.'}, expected=409)
    sid, mid = receipt['skill_id'], receipt['insight_id']
    api('/skills/'+sid, actor='b', expected=404)
    assert api('/enterprise-insights/'+mid+'/uses', actor='b')['items'] == []
    api('/skills/'+sid+'/publish',dict(expected_version=1),expected=403)
    api('/skills/'+sid+'/publish',dict(expected_version=1),actor='c')
    proposal=dict(operation='approve',expected_version=1,confirm=True,rationale='Independent review of the saved Memory context.')
    api('/enterprise-insights/'+mid+'/lifecycle',proposal,expected=403)
    api('/enterprise-insights/'+mid+'/lifecycle',proposal,actor='c')
    follow = api('/investigations', dict(title='Acceptance follow-up', source=source['source'], category=source['category'], summary='Synthetic follow-up', severity='medium', status='open', determination='unknown', primary_entity='acceptance-user', insight_refs=[]), expected=201)
    assert follow['determination'] == 'unknown'
    foreign = api('/investigations', dict(title='Foreign acceptance case', source=source['source'], category=source['category'], summary='Synthetic tenant isolation fixture', severity='medium', status='open', determination='unknown', primary_entity='acceptance-user', insight_refs=[]), actor='b', expected=201)
    api('/investigations/'+foreign['id']+'/artifacts', dict(type='domain', value='acceptance.example.test', label='Foreign identical IOC'), actor='b', expected=201)
    assert sql("SELECT count(*) FROM skill_applications WHERE tenant_id='auth-b' AND target_id='"+foreign['id']+"'") == '0'
    assert sql("SELECT count(*) FROM enterprise_insight_applications WHERE tenant_id='auth-b' AND investigation_id='"+foreign['id']+"'") == '0'
    def count(table, condition):
        return int(sql("SELECT count(*) FROM "+table+" WHERE tenant_id='auth-a' AND "+condition))
    assert count('skill_applications', "target_id='"+follow['id']+"' AND skill_id='"+sid+"'") == 1
    assert count('enterprise_insight_applications', "investigation_id='"+follow['id']+"' AND insight_id='"+mid+"'") == 1
    assert count('case_learning', "investigation_id='"+case_id+"'") == 1
    memory_hunt=api('/hunts',dict(name='Approved Memory acceptance',query='acceptance-user'),expected=201)
    mh='/hunts/'+memory_hunt['id']
    def memory_search(key, **kw):
        return api(mh+'/search',dict(id=key,expected_updated_at=memory_hunt['updated_at']),**kw)
    memory_run=memory_search('approved-memory')
    assert len(memory_run['memory'])==1 and memory_run['memory'][0]['id']==mid
    assert memory_run['memory'][0]['learning_origin']['approved_by']
    memory_search('foreign-memory',actor='b',expected=404)
    assert api('/enterprise-insights/'+mid+'/uses',actor='b')['hunt_items']==[]
    assert len(api('/enterprise-insights/'+mid+'/uses')['hunt_items'])==1
    # Lifecycle hardening: edits cannot replace a published release without review.
    original=api('/skills/'+sid)['content_markdown']
    staged=api('/skills/'+sid+'/workspace',dict(expected_version=2,content_markdown='New reviewed local lifecycle guidance.'),method='PATCH')
    assert staged['content_markdown']==original and staged['staged_edit']['content_markdown']!=original
    api(case_path,dict(determination='benign'),method='PATCH')
    assert memory_search('stale-memory')['memory']==[]
    assert memory_search('approved-memory')['memory']==memory_run['memory']
    for kind,identity in [('skills',sid),('enterprise-insights',mid)]:
        state=api('/'+kind+'/'+identity+'/lifecycle')
        assert not state['current']
        request=dict(operation='reapprove',expected_version=state['version'],expected_source_version=state['source']['updated_at'],confirm=True,rationale='Reviewed changed source outcome and scoped reuse.')
        api('/'+kind+'/'+identity+'/lifecycle',request,actor='b',expected=404)
        api('/'+kind+'/'+identity+'/lifecycle',{**request,'confirm':False},expected=400)
        api('/'+kind+'/'+identity+'/lifecycle',request,actor='c')
        api('/'+kind+'/'+identity+'/lifecycle',request,actor='c',expected=409)
    reapproved_memory=memory_search('reapproved-memory')['memory']
    assert len(reapproved_memory)==1 and reapproved_memory[0]['version']>memory_run['memory'][0]['version']
    state=api('/skills/'+sid+'/lifecycle')
    api('/skills/'+sid+'/lifecycle',dict(operation='publish-staged',expected_version=state['version'],confirm=True,rationale='Explicitly approve saved staged instructions.'),actor='c')
    assert api('/skills/'+sid)['content_markdown']=='New reviewed local lifecycle guidance.'
    for kind,identity in [('skills',sid),('enterprise-insights',mid)]:
        state=api('/'+kind+'/'+identity+'/lifecycle')
        api('/'+kind+'/'+identity+'/lifecycle',dict(operation='archive',expected_version=state['version'],confirm=True,rationale='Explicitly retire this disposable fixture guidance.'))
        assert api('/'+kind+'/'+identity+'/lifecycle')['archived']
    assert memory_search('archived-memory')['memory']==[]
    assert memory_search('approved-memory')['memory']==memory_run['memory']
    selected=memory_run['findings'][0]
    promotion=dict(run_id=memory_run['id'],record_id=selected['record_id'],kind=selected['kind'],comment='Reviewed local evidence; historical Memory retained as advisory context.',confirm=True)
    memory_promoted=api(mh+'/promote',promotion)
    assert memory_promoted['memory']==memory_run['memory']
    assert api(mh+'/promote',promotion)['investigation_id']==memory_promoted['investigation_id']
    assert api('/investigations/'+memory_promoted['investigation_id'])['determination']=='unknown'
    record('skills_memory', dict(source_case=case_id, followup_case=follow['id'], skill_id=sid, insight_id=mid, approval_replay=True, snapshots=True, foreign_reads_writes_denied=True, staged_publication=True, source_change_detection=True, explicit_reapproval=True, explicit_archive=True,memory_hunt=dict(hunt_id=memory_hunt['id'],promoted_case=memory_promoted['investigation_id'],approved_snapshot=True,stale_excluded=True,reapproval=True,archive_excluded=True,immutable_replay=True,tenant_isolation=True)))

    document = dict(schema_version='1', source='local-acceptance', external_id='acceptance-feed', title='Synthetic domain report', summary='Local fixture only', severity='medium', published_at=datetime.now(timezone.utc).isoformat(timespec='seconds'), indicators=[dict(type='domain', value='Acceptance.Example.Test.'), dict(type='domain', value='acceptance.example.test')])
    preview=api('/threat-intel/import/preview',document)
    assert preview['unique']==1 and preview['duplicates']==1
    imported=api('/threat-intel/import',document)
    assert api('/threat-intel/import',document)['report_id']==imported['report_id']
    api('/threat-intel/import',{**document,'title':'Conflicting source revision'},expected=409)
    rid=imported['report_id']
    indicators=api('/threat-indicators?report_id='+rid)
    indicator=indicators['items'][0]
    link_body=dict(id='acceptance-hunt-link',indicator_id=indicator['id'])
    link=api('/threat-intel-reports/'+rid+'/local-hunt',link_body)
    assert api('/threat-intel-reports/'+rid+'/local-hunt',link_body)['hunt_id']==link['hunt_id']
    api('/threat-intel-reports/'+rid+'/local-hunt',link_body,actor='b',expected=404)
    hp='/hunts/'+link['hunt_id']
    workspace=api(hp+'/workspace')
    search=dict(id='acceptance-hunt-run',expected_updated_at=workspace['hunt']['updated_at'])
    run=api(hp+'/search',search)
    assert api(hp+'/search',search)['id']==run['id']
    assert all(f['case_id'] != foreign['id'] for f in run['findings'])
    finding=next(f for f in run['findings'] if f['case_id']==case_id)
    promote=dict(run_id=run['id'],kind=finding['kind'],record_id=finding['record_id'],comment='Reviewed synthetic evidence match; local investigation required.',confirm=True)
    api(hp+'/promote',{**promote,'confirm':False},expected=400)
    api(hp+'/promote',promote,actor='b',expected=404)
    promoted=api(hp+'/promote',promote)
    assert api(hp+'/promote',promote)['investigation_id']==promoted['investigation_id']
    api('/investigations/'+promoted['investigation_id'],actor='b',expected=404)
    record('intel_hunt',dict(source_case=case_id,report_id=rid,hunt_id=link['hunt_id'],promoted_case=promoted['investigation_id'],ioc_dedup=True,import_link_run_promotion_replay=True,foreign_access_denied=True))

    rule=api('/detection-rules',dict(name='Acceptance local rule',severity='high',enabled=True,routing='Escalate',query='local baseline'),expected=201)
    rp='/detection-rules/'+rule['id']
    alerts=[]
    for label, entity in [('false_positive','scanner'),('true_positive','host'),('unreviewed','unknown')]:
        body=dict(source='local-acceptance:'+entity,external_id='acceptance-'+entity,rule_id=rule['id'],title='Synthetic '+entity,summary='Local source-alert evidence',severity='high',primary_entity=entity)
        result=api('/alerts',body,expected=201)
        replay=api('/alerts',body)
        assert replay['duplicate'] and replay['alert']['id']==result['alert']['id']
        alert=result['alert'];alerts.append(alert)
        cp='/investigations/'+alert['investigation_id']+'/detection-feedback'
        api(cp,actor='b',expected=404)
        assert api(cp)['total']==1
        if label!='unreviewed':
            review=dict(label=label,rationale='Explicit analyst review of synthetic source evidence.',expected_version=0,confirm=True)
            api(cp+'/'+alert['id'],review,actor='b',method='PUT',expected=404)
            api(cp+'/'+alert['id'],{**review,'confirm':False},method='PUT',expected=400)
            assert api(cp+'/'+alert['id'],review,method='PUT')['version']==1
            api(cp+'/'+alert['id'],review,method='PUT',expected=409)
    current=api(rp)
    api(rp,dict(enabled=False,expected_version=current['version']),method='PATCH')
    version=api(rp)['version']
    recs=rp+'/recommendations'
    api(recs+'/generate',dict(days=30,expected_version=version))
    rec=api(recs+'?days=30')['items'][0]
    action=recs+'/'+rec['id']
    api(action+'/apply',{},expected=409)
    api(action+'/test',{},actor='b',expected=404)
    api(action+'/validate',{})
    replay=api(action+'/test',{})['test_result']
    assert replay['passed'] and replay['false_positives_removed']==1 and replay['true_positives_removed']==0 and replay['unreviewed_removed']==0
    fp=alerts[0]
    label_path='/investigations/'+fp['investigation_id']+'/detection-feedback/'+fp['id']
    api(label_path,dict(label='false_positive',rationale='Rechecked synthetic evidence after replay; regenerate receipt.',expected_version=1,confirm=True),method='PUT')
    api(action+'/apply',{},expected=409)
    api(recs+'/generate',dict(days=30,expected_version=version))
    fresh=next(r for r in api(recs+'?days=30')['items'] if r['id']!=rec['id'] and r['title']==rec['title'] and r['status']=='pending')
    action=recs+'/'+fresh['id']
    api(action+'/validate',{})
    assert api(action+'/test',{})['test_result']['passed']
    api(action+'/apply',{})
    api(action+'/apply',{})
    final=api(rp)
    assert final['enabled'] is False and final['version']==version+1
    assert count('audit_events',"resource_id='"+rule['id']+"' AND action='recommendation_apply'")==1
    # Finding admission already creates a genuine source alert for the Build case.
    # Exercise that existing linkage too; never assign a manufactured rule/case ID.
    feedback=api(case_path+'/detection-feedback')
    assert feedback['total'] >= 1
    source_alert=feedback['items'][0]
    before=api(case_path)['determination']
    api(case_path+'/detection-feedback/'+source_alert['id'],dict(label='true_positive',rationale='Explicit review of the Build-imported suspicious-login finding.',expected_version=source_alert['label_version'],confirm=True),method='PUT')
    assert api(case_path)['determination']==before
    record('detect_feedback',dict(rule_id=rule['id'],intake_replay=True,label_conflict=True,foreign_access_denied=True,replay=replay,apply_replay=True,changed_labels_invalidate_replay=True,rule_disabled=True,build_source=dict(case_id=case_id,alert_id=source_alert['id'],rule_id=source_alert['rule_id'],explicit_label=True,determination_unchanged=True)))
