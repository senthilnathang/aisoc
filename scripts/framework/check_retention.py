"""Authenticated local retention/archive/restore contract acceptance."""
def check_retention(http, sql):
    root='/api/v1/build/retention'
    def call(path='',body=None,**kw):return http(path,body,root=root,**kw)
    sql("INSERT INTO approval_notifications(tenant_id,id,recipient_id,kind,resource_id,title,event_type,actor_id,owner_id,assignment_version,work_token,created_at,read_at) VALUES('auth-a','retention-api-notice','fixture-a','skill','fixture-skill','Retention API fixture','claim','fixture-a','fixture-a',1,'fixture-token',now()-interval '60 days',now()-interval '45 days')")
    p=call('?kind=notification')['policy']
    config=dict(kind='notification',enabled=True,age_days=30,expected_version=p['version'],reason='Verify authenticated local retention')
    call('/policy',config,actor='c',expected=403)
    p=call('/policy',config)
    call('/policy',config,expected=409)
    row=next(x for x in call('?kind=notification')['items'] if x['id']=='retention-api-notice')
    assert row['eligible']
    request=dict(kind='notification',id=row['id'],digest=row['digest'],policy_version=p['version'],operation='archive',confirm=True,reason='Archive fixture before safe cleanup')
    call('/actions',{**request,'confirm':False},expected=400)
    call('/actions',request,actor='b',expected=409)
    call('/actions',request,actor='c',expected=403)
    saved=call('/actions',request)['archive']
    assert call('/actions',request)['replayed']
    call('/archives/'+saved['id'],actor='b',expected=404)
    call('/archives/'+saved['id'],actor='c',expected=404)
    call('/actions',{**request,'operation':'cleanup'})
    assert call('/actions',{**request,'operation':'cleanup'})['replayed']
    assert not any(x['id']==row['id'] for x in call('?kind=notification')['items'])
    restore={**request,'id':saved['id'],'operation':'restore'}
    assert call('/actions',restore)['restored']
    assert call('/actions',restore)['replayed']
    assert any(x['id']==row['id'] for x in call('?kind=notification')['items'])
    for kind in ('detection','investigation','response','hunt','intel','skill','memory','integration','import_batch'):
        result=call('?kind='+kind)
        assert result['mode']=='local/mock' and result['policy']['kind']==kind
    return dict(passed=True,recipient_isolation=True,tenant_isolation=True,role_gate=True,archive_replay=True,cleanup_restore=True,all_area_previews=True)
