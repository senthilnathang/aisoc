"""Disposable multi-case Build acceptance; JSON fixtures and explicit mock-note review only."""
import copy
import time
import uuid


def check_bulk_import(http, sql):
    def api(path, body=None, **kw):
        if path.endswith('/process') and body is not None and 'expected_versions' not in body and kw.get('actor')!='b':
            current=http(path.removesuffix('/process'),root='/api/v1')
            body={**body,'expected_versions':{x['key']:x['version'] for x in current['items']}}
        return http(path, body, root='/api/v1', **kw)
    base='/build/import-batches'
    document=api('/build/integrations/example?scope_id=login-context-suspicious')
    body=dict(schema_version='1',id='batch-'+str(uuid.uuid4()),scope_id='login-context-suspicious',name='Bulk acceptance',cases=[dict(key='first',name='First login',document=document),dict(key='repair',name='Repair login',document=dict(schema_version='1',events=[]))])
    preview=api(base+'/preview',body)
    assert [x['valid'] for x in preview['items']]==[True,False]
    assert len(preview['items'][0]['evidence']['events'])==4
    api(base,body,actor='b',expected=403)
    saved=api(base,body)
    assert saved['counts']['pending']==1 and saved['counts']['invalid']==1
    assert api(base,body)['replayed'] is True
    api(base,{**body,'name':'Conflicting replay'},expected=409)
    path=base+'/'+body['id']
    api(path,actor='b',expected=404)
    api(path+'/process',dict(confirm=True),actor='b',expected=404)
    api(path+'/process',dict(confirm=False),expected=400)
    api(path+'/process',dict(confirm=True,expected_versions={'first':99,'repair':1}),expected=409)
    first=api(path+'/process',dict(confirm=True),expected=202)
    assert first['counts']['accepted']==1 and first['counts']['invalid']==1
    repair=dict(expected_version=1,case=dict(key='repair',name='Repaired login',document=document))
    api(path+'/cases/repair',repair,method='PUT',actor='b',expected=404)
    fixed=api(path+'/cases/repair',repair,method='PUT')
    assert fixed['counts']['pending']==1
    assert api(path+'/cases/repair',repair,method='PUT')['counts']['pending']==1
    second=api(path+'/process',dict(confirm=True),expected=202)
    assert second['counts']['accepted']==2
    api(path+'/cases/first',repair,method='PUT',expected=409)
    for _ in range(400):
        status=api(path)
        if all(x['progress']['cases'] and x['progress']['cases'][0]['state']=='awaiting_review' for x in status['items']):
            break
        time.sleep(.1)
    else:
        raise AssertionError('Batch cases did not reach independent mock-note review')
    for item in status['items']:
        assert item['progress']['accepted_events']==4 and item['progress']['processed_events']==4
        profile=api('/build/integrations/'+item['profile_id'])
        case=profile['cases'][0]
        http('/'+item['profile_id']+'/approve-mock-note',dict(job_id=case['job_id'],comment='Explicit local batch acceptance note approval.'))
    for _ in range(400):
        status=api(path)
        if status['counts']['synced']==2:
            break
        time.sleep(.1)
    else:
        raise AssertionError('Batch mock-note sync incomplete')
    replay=api(path+'/process',dict(confirm=True),expected=202)
    assert replay['counts']['accepted']==2 and replay['counts']['synced']==2
    assert all(x['attempts']==1 for x in replay['items'])
    assert all(x['progress']['accepted_events']==4 for x in replay['items'])
    assert len({x['profile_id'] for x in replay['items']})==2
    # Simulate intake committed just before the batch checkpoint was interrupted.
    sql("UPDATE local_import_batch_items SET state='running',lease_until=now()-interval '1 second' WHERE tenant_id='auth-a' AND batch_id='"+body['id']+"' AND case_key='first'")
    recovered=api(path+'/process',dict(confirm=True),expected=202)
    first=next(x for x in recovered['items'] if x['key']=='first')
    assert first['inserted']==0 and first['progress']['accepted_events']==4 and recovered['counts']['synced']==2
    return dict(batch_id=body['id'],per_case_validation=True,partial_import=True,repair=True,tenant_isolation=True,independent_profiles=True,notes_synced=2,crash_replay_inserted=0)
