"""Run-owned fixtures, loopback frontend, browser and backup integration."""
import json
import subprocess
import time
from pathlib import Path


def check_release(run_id,acceptance,http,sql,env,temp,log,spawn,port,wait_port,pg,root):
    out=root/'output/release-gate'/run_id
    if not out.is_dir() or (out/'browser.json').exists():raise RuntimeError('Release directory must be fresh and wrapper-owned')
    frontend=json.loads((out/'frontend.json').read_text())
    if frontend.get('run_id')!=run_id or frontend.get('passed') is not True:raise RuntimeError('Missing frontend evidence')
    def api(path,body=None,**kw):return http(path,body,root='/api/v1',**kw)
    fixtures=out/'fixtures';fixtures.mkdir()
    name='Release '+run_id[:12]
    login=api('/build/integrations/example?scope_id=login-context-suspicious')
    (fixtures/'login.json').write_text(json.dumps(login,indent=2)+'\n')
    memory_input=dict(id='EI-release-'+run_id,artifact=name+' memory',kind='user',content='Synthetic release context; independent approval required.')
    skill_input=dict(name=name+' skill',content_markdown='Synthetic release instructions. Escalate missing evidence.')
    memory=api('/enterprise-insights',memory_input)
    skill=api('/skills',skill_input,expected=201)
    notice='release-notice-'+run_id
    # Only this runner's disposable DB is passed here. Age is required to test retention.
    sql("INSERT INTO approval_notifications(tenant_id,id,recipient_id,kind,resource_id,title,event_type,actor_id,owner_id,assignment_version,work_token,created_at,read_at) VALUES('auth-a','"+notice+"','fixture-a','memory','"+memory['id']+"','"+notice+"','claim','fixture-a','fixture-a',1,'fixture-token',now()-interval '90 days',now()-interval '60 days')")
    # Fresh normal telemetry creates no finding, so it can test payload archiving.
    page=http('/release-archive/mock-example')
    event=page['events'][0]
    event.update(event_id='release-normal-'+run_id,source_event_id='release-normal-'+run_id,event_type='authentication.succeeded',evidence_ref='mock-siem:release-normal-'+run_id)
    event['projection']['principal_ref']='release-normal-user'
    page.update(events=[event],next_cursor='release-'+run_id)
    (fixtures/'telemetry.json').write_text(json.dumps(page,indent=2)+'\n')
    http('/release-archive/mock-import',page,expected=202)
    for _ in range(300):
        if sql("SELECT count(*) FROM stream_inbox WHERE tenant_id='auth-a' AND connector_id='release-archive'")=='1':break
        time.sleep(.1)
    else:raise RuntimeError('Normal telemetry fixture did not complete')
    from release_workflow_fixtures import create
    workflows=create(api,run_id,name)
    (fixtures/'workflows.json').write_text(json.dumps(workflows,indent=2)+'\n')
    manifest=dict(workflows=workflows,run_id=run_id,mode='local/mock',name=name,memory=memory,skill=skill,notice_id=notice,scope='login-context-suspicious',details=dict(case_id=acceptance['stages']['build_response']['case_id'],rule_id=acceptance['stages']['detect_feedback']['rule_id'],hunt_id=acceptance['stages']['intel_hunt']['hunt_id'],report_id=acceptance['stages']['intel_hunt']['report_id']))
    (fixtures/'inputs.json').write_text(json.dumps(dict(memory=memory_input,skill=skill_input,notification=dict(id=notice,recipient='fixture-a',age_days=60)),indent=2)+'\n')
    web_port=int(env['AISOC_RELEASE_WEB_PORT']);env['AISOC_API_PROXY_TARGET']='http://'+env['AISOC_GO_ADDR']
    web=spawn(['node',root/'frontend/node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port',str(web_port),'--strictPort'],root/'frontend')
    wait_port(web_port);manifest['origin']=f'http://127.0.0.1:{web_port}'
    (fixtures/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    effect_queries={
        'response_notes':"SELECT count(*) FROM mock_soar_response_notes WHERE tenant_id='auth-a'",
        'response_audits':"SELECT count(*) FROM audit_events WHERE tenant_id='auth-a' AND action='sandbox_response_execute'",
        'rule_applies':"SELECT count(*) FROM audit_events WHERE tenant_id='auth-a' AND action='recommendation_apply'",
    }
    before={key:int(sql(query)) for key,query in effect_queries.items()}
    try:
        subprocess.run(['node',str(root/'scripts/release/browser.mjs'),str(fixtures/'manifest.json')],cwd=root,env={k:v for k,v in env.items() if k in ('PATH','HOME','TMPDIR','LANG','AISOC_RELEASE_CHROMIUM')},stdout=log,stderr=log,check=True,timeout=600)
    finally:
        web.terminate()
        try:web.wait(timeout=10)
        except subprocess.TimeoutExpired:web.kill();web.wait(timeout=5)
    effects={key:int(sql(query))-before[key] for key,query in effect_queries.items()}
    if any(count!=1 for count in effects.values()):raise RuntimeError('Browser workflow effects were missing or duplicated: '+str(effects))
    browser=json.loads((out/'browser.json').read_text())
    browser['durable_effect_deltas']=effects
    (out/'browser.json').write_text(json.dumps(browser,indent=2)+'\n')
    from release_backup import verify_backup
    verify_backup(run_id,env,temp,log,pg,root,out)
