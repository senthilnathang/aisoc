"""Disposable HTTP/DB regression for case-linked mock revocation. No live providers."""
import concurrent.futures
import time


def check_case_response(http, sql, case_id):
    root = '/api/v1/investigations'
    path = '/' + case_id + '/sandbox-responses'
    for _ in range(300):
        review = http('/' + case_id + '/l1', root=root)
        if review['sync_state'] == 'synced':
            break
        time.sleep(.1)
    else:
        raise AssertionError('Mock note did not sync before response review')
    target = http(path, root=root)
    assert any(s['id'] == 'mock-siem' for s in target['scopes'])
    http(path, root=root, actor='b', expected=404)
    request = dict(operation='propose', id='case-response-test', scope_id='mock-siem', session_id='case-session-test', principal_ref='json-user', ticket='REVIEW-RESPONSE-1', reason='Analyst reviewed local login evidence; sandbox response only.', evidence_refs=[review['evidence'][0]['reference']])
    def op(operation, expected=200, **extra):
        actor='c' if operation in ('approve','policy') else 'd' if operation in ('execute','dry_run') else 'a'
        scope=request['scope_id']+('-'+actor if actor in ('c','d') else '')
        return http(path, {**request, 'operation': operation, 'scope_id':scope, **extra}, root=root, expected=expected,actor=actor)
    http(path, request, root=root, actor='b', expected=403)
    op('propose', 403, scope_id='mock-review')
    op('propose', 400, evidence_refs=['fabricated'])
    assert op('propose')['state'] == 'proposed'
    http(path,{**request,'operation':'approve','confirm':True,'comment':'Self approval must be denied'},root=root,actor='a',expected=403)
    assert op('propose')['replayed']
    op('propose', 409, session_id='different-session')
    assert len(http(path, root=root)['items']) == 1
    op('execute',400,confirm=False)
    op('execute',403,confirm=True)
    op('approve',400,confirm=False,comment='Reviewed evidence and target')
    assert op('approve',confirm=True,comment='Reviewed evidence and target')['state']=='approved'
    op('execute',403,confirm=True)  # Kill switch remains stopped.
    # Legacy stream endpoint must not bypass case receipt/note transaction.
    http('/mock-siem/sandbox-session', dict(operation='execute',id=request['id'],ticket=request['ticket']), expected=403)
    op('policy',confirm=True,stopped=False)
    assert op('dry_run')['would_execute']
    sql("UPDATE sandbox_session_actions SET approval_expires_at=now()-interval '1 second' WHERE tenant_id='auth-a' AND id='case-response-test'")
    op('execute',403,confirm=True)
    assert not op('dry_run')['would_execute']
    assert op('approve',confirm=True,comment='Renewed explicit evidence review')['state']=='approved'
    # A changed source revision blocks the entire operation, without overwriting it.
    source = sql("SELECT c.version FROM mock_soar_cases c JOIN l1_escalations e USING(tenant_id,connector_id,external_id) WHERE e.tenant_id='auth-a' AND e.investigation_id='"+case_id+"'")
    sql("UPDATE mock_soar_cases SET version='conflicting-source-revision' WHERE tenant_id='auth-a' AND external_id=(SELECT external_id FROM l1_escalations WHERE tenant_id='auth-a' AND investigation_id='"+case_id+"')")
    op('execute',409,confirm=True)
    sql("UPDATE mock_soar_cases SET version='"+source+"' WHERE tenant_id='auth-a' AND external_id=(SELECT external_id FROM l1_escalations WHERE tenant_id='auth-a' AND investigation_id='"+case_id+"')")
    sql("CREATE FUNCTION case_response_audit_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='sandbox_response_execute' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER case_response_audit_fail BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION case_response_audit_fail()")
    op('execute',500,confirm=True)
    assert sql("SELECT revoked FROM sandbox_sessions WHERE tenant_id='auth-a' AND id='case-session-test'")=='f'
    assert sql("SELECT count(*) FROM mock_soar_response_notes WHERE tenant_id='auth-a' AND investigation_id='"+case_id+"'")=='0'
    sql('DROP TRIGGER case_response_audit_fail ON audit_events; DROP FUNCTION case_response_audit_fail()')
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        receipts=list(executor.map(lambda _:op('execute',confirm=True), range(4)))
    assert sum(not r.get('replayed',False) for r in receipts)==1
    assert len({r['receipt']['note_id'] for r in receipts})==1
    row=http(path,root=root)['items'][0]
    assert row['state']=='executed' and row['receipt']['external_calls']==0
    assert row['approval_comment']=='Renewed explicit evidence review'
    assert sql("SELECT version FROM sandbox_sessions WHERE tenant_id='auth-a' AND id='case-session-test'")=='2'
    assert sql("SELECT count(*) FROM mock_soar_response_notes WHERE tenant_id='auth-a' AND investigation_id='"+case_id+"'")=='1'
    assert sql("SELECT count(*) FROM audit_events WHERE tenant_id='auth-a' AND action='sandbox_response_execute'")=='1'
    assert sql("SELECT status FROM investigations WHERE tenant_id='auth-a' AND id='"+case_id+"'")!='closed'
    all_rows=http('',root='/api/v1/sandbox-responses')['items']
    assert any(r['id']==request['id'] for r in all_rows)
    assert http('',root='/api/v1/sandbox-responses',actor='b')['items']==[]
    op('policy',confirm=True,stopped=True)
    return dict(passed=True,case_id=case_id,tenant_isolation=True,approval_required=True,kill_switch=True,expired_approval=True,legacy_bypass_denied=True,source_conflict=True,audit_rollback=True,concurrent_replay=True,notes=1,external_calls=0)
