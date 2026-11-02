"""Disposable local jobs fault injection; never use against the active demo."""
import time
import uuid


def check_durable_hunts(http, sql):
    def api(path, body=None, **kw): return http(path, body, root='/api/v1', **kw)
    h=api('/hunts',dict(name='Durable local evidence',query='mock-user'),expected=201)
    path='/hunts/'+h['id'];version=h['updated_at'];key='queue-'+uuid.uuid4().hex
    blockers=[str(uuid.uuid4()) for _ in range(4)]
    for job in blockers:
        sql("INSERT INTO jobs(tenant_id,id,plugin_id,plugin_version,input,state,attempts,lease_until) VALUES('auth-a','"+job+"','python.normalize','1','{}','running',1,now()+interval '5 minutes')")
    try:
        queued=api(path+'/executions',dict(id=key,expected_updated_at=version),expected=202)
        assert queued['state']=='queued'
        assert api(path+'/executions',dict(id=key,expected_updated_at=version),expected=202)['job_id']==queued['job_id']
        api(path+'/executions',dict(id='foreign',expected_updated_at=version),actor='b',expected=404)
        api(path+'/search',dict(id=key,expected_updated_at=version),expected=409)
        api(path+'/executions',dict(id='parallel',expected_updated_at=version),expected=409)
        control=path+'/executions/'+key+'/control'
        assert api(control,dict(operation='cancel',attempts=0))['state']=='cancelled'
        assert api(control,dict(operation='cancel',attempts=0))['state']=='cancelled'
        assert not api(path+'/workspace')['runs']
        api(control,dict(operation='retry',attempts=0),expected=409)
        key='recover-'+uuid.uuid4().hex
        job=api(path+'/executions',dict(id=key,expected_updated_at=version),expected=202)
        # Simulate a process that died after leasing: the live worker must reclaim it.
        sql("UPDATE jobs SET state='running',attempts=1,attempt_id='"+str(uuid.uuid4())+"',lease_until=now()-interval '1 second' WHERE tenant_id='auth-a' AND id='"+job['job_id']+"'")
    finally:
        for blocked in blockers: sql("DELETE FROM jobs WHERE tenant_id='auth-a' AND id='"+blocked+"'")
    for _ in range(300):
        w=api(path+'/workspace');r=next((r for r in w['runs'] if r['id']==key),None)
        if r: break
        time.sleep(.1)
    else:raise AssertionError('Abandoned Hunt lease was not recovered')
    j=next(j for j in w['executions'] if j['id']==key)
    assert j['state']=='completed' and j['attempts']==2 and r['findings']
    assert api(path+'/executions',dict(id=key,expected_updated_at=version),expected=202)['job_id']==job['job_id']
    finding=r['findings'][0]
    body=dict(run_id=key,record_id=finding['record_id'],kind=finding['kind'],comment='Reviewed durable mock search evidence for investigation.',confirm=True)
    p=api(path+'/promote',body)
    assert api(path+'/promote',body)['investigation_id']==p['investigation_id']
    assert api('/investigations/'+p['investigation_id'])['determination']=='unknown'
    api(path+'/executions/'+key+'/control',dict(operation='cancel',attempts=0),expected=409)
    api(path+'/executions/'+key+'/control',dict(operation='cancel',attempts=0),actor='b',expected=404)
    return dict(hunt_id=h['id'],run_id=key,queued=True,cancellation=True,recovery=True,promotion_replay=True,tenant_isolation=True)
