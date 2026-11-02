#!/usr/bin/env python3
"""One local/mock release gate: fresh API environment, browser workflows and recovery."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time
import uuid

ROOT=Path(__file__).resolve().parents[2]
STAGES={'frontend','api','browser','backup','identity'}
WORKFLOW_EVIDENCE={
    'durable_hunt':('queued','progress','explicit_retry','cancellation_persisted','enqueue_replay','lost_response_replay'),
    'phishing':('json_upload','cited_review','explicit_note_approval','import_replay','response_and_feedback_visible'),
    'respond_replay':('independent_approval','kill_switch','explicit_execution','same_receipt_replay','external_calls_zero'),
    'skills_lifecycle':('published_unchanged_while_staged','source_change_blocked','independent_reapproval','staged_publication','archived'),
    'memory_hunt':('approved_provenance','stale_excluded','immutable_history','promotion','unknown_determination'),
    'detect_feedback':('explicit_labels','determination_unchanged','replay_passed','guarded_apply','rule_remains_disabled'),
}

def validate_stage(name,report,run_id):
    if not isinstance(report,dict):raise ValueError('Invalid '+name+' report')
    if report.get('passed') is not True or report.get('run_id')!=run_id or report.get('mode')!='local/mock':
        raise ValueError('Failed, stale or wrong-mode '+name+' report')
    if name=='frontend' and (not isinstance(report.get('checks'),list) or set(report['checks'])!={'lint','production build','frontend regression tests','Chromium launch'}):raise ValueError('Missing frontend checks')
    if name=='api':
        if not isinstance(report.get('stages'),dict):raise ValueError('Invalid API stages')
        from acceptance import validate_report
        validate_report(report)
    if name=='browser':
        required={'build_import','approval_handoff','notifications','retention_recovery','tenant_isolation','route_sweep'} | set(WORKFLOW_EVIDENCE)
        if not isinstance(report.get('stages'),dict) or set(report.get('stages',{}))!=required or any(not isinstance(v,dict) or v.get('passed') is not True for v in report['stages'].values()):
            raise ValueError('Missing browser coverage')
        effects=report.get('durable_effect_deltas')
        if not isinstance(effects,dict) or any(type(effects.get(k)) is not int or effects[k]!=1 for k in ('response_notes','response_audits','rule_applies')):raise ValueError('Missing or duplicate durable workflow effects')
        for stage,keys in WORKFLOW_EVIDENCE.items():
            if any(report['stages'][stage].get(key) is not True for key in keys):raise ValueError('Missing workflow evidence: '+stage)
        if report.get('external_requests') or report.get('page_errors') or report.get('http_errors'):
            raise ValueError('Unexpected browser errors or external requests')
        entries=report['stages']['route_sweep'].get('checks',[])
        routes={(e.get('path'),e.get('width')) for e in entries if isinstance(e,dict) and e.get('passed') is True}
        expected={(p,w) for p in ('/','/investigations','/respond','/hunt/threat-hunting','/threat-intel','/skills','/memory','/build','/respond/inbox','/build/retention') for w in (1440,390)}
        if not expected.issubset(routes) or len(routes)<60 or report.get('route_checks')!=len(routes):raise ValueError('Incomplete responsive route sweep')
    if name=='identity':
        required={'trusted_mapping','tenant_isolation','independent_approval','logout_all','role_change_revokes','disabled_identity_denied','mapping_failure_closed','browser_redirect'}
        checks=report.get('checks')
        if not isinstance(checks,dict) or set(checks)!=required or any(v is not True for v in checks.values()) or report.get('external_requests') or report.get('page_errors'):raise ValueError('Incomplete identity evidence')
    if name=='backup':
        for key in ('table_fingerprints_match','archive_resolution_verified','corruption_rejected','snapshot_corruption_rejected','source_database_modified'):
            expected=key!='source_database_modified'
            if report.get(key) is not expected:raise ValueError('Missing backup evidence: '+key)
        if any(type(report.get(k)) is not int or report[k]<1 for k in ('archived_events','snapshots_verified')):raise ValueError('Empty backup fixtures')

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--chromium-executable',default=shutil.which('google-chrome') or shutil.which('chromium'))
    args=parser.parse_args()
    def interrupt(signum,frame):raise KeyboardInterrupt
    signal.signal(signal.SIGTERM,interrupt)
    if not __debug__:parser.error('Assertions must be enabled')
    if not args.chromium_executable or not Path(args.chromium_executable).is_file():parser.error('Provide an installed Chrome/Chromium with --chromium-executable')
    root=ROOT/'output/release-gate';root.mkdir(parents=True,exist_ok=True)
    with (root/'.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        run_id=uuid.uuid4().hex;out=root/run_id;out.mkdir()
        report={'run_id':run_id,'mode':'local/mock','passed':False,'status':'running','revision':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'dirty':bool(subprocess.check_output(['git','status','--porcelain'],cwd=ROOT,text=True)),'stages':{}}
        def save():
            (out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
            temporary=root/'latest.new';temporary.write_text(json.dumps(report|{'directory':str(out)},indent=2)+'\n');temporary.replace(root/'latest.json')
        save();started=time.monotonic();env={k:v for k,v in os.environ.items() if not k.startswith(('AISOC_','VITE_'))};env['AISOC_RELEASE_CHROMIUM']=str(Path(args.chromium_executable).resolve())
        try:
            with (out/'runner.log').open('w') as log:
                def run(cmd):
                    process=subprocess.Popen(cmd,cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
                    try:
                        code=process.wait(timeout=1800)
                        if code:raise subprocess.CalledProcessError(code,cmd)
                    except (subprocess.TimeoutExpired,KeyboardInterrupt):
                        # check.py handles TERM by unwinding its owned service cleanup.
                        process.terminate()
                        try:process.wait(timeout=60)
                        except subprocess.TimeoutExpired:os.killpg(process.pid,signal.SIGKILL);process.wait()
                        raise
                run(['node','scripts/release/browser.mjs','--preflight'])
                run(['npm','--prefix','frontend','run','lint'])
                run(['npm','--prefix','frontend','run','build'])
                run(['node','--test',*map(str,sorted((ROOT/'tests/frontend').glob('*.test.mjs')))])
                frontend={'run_id':run_id,'mode':'local/mock','passed':True,'checks':['lint','production build','frontend regression tests','Chromium launch']}
                (out/'frontend.json').write_text(json.dumps(frontend,indent=2)+'\n')
                report['stages']['frontend']=frontend;save()
                run([sys.executable,'scripts/framework/check.py','--with-streams','--platform-acceptance','--browser-release-id',run_id])
            for stage in sorted(STAGES):
                value=json.loads((out/(stage+'.json')).read_text());validate_stage(stage,value,run_id);report['stages'][stage]=value
            report.update(passed=True,status='complete')
        except (OSError,ValueError,subprocess.SubprocessError,KeyboardInterrupt) as error:
            report.update(status='failed',error_type=type(error).__name__)
            # Preserve individual progress without treating missing evidence as success.
            for stage in STAGES:
                path=out/(stage+'.json')
                if path.exists():
                    try:report['stages'][stage]=json.loads(path.read_text())
                    except ValueError:pass
        finally:
            report['seconds']=round(time.monotonic()-started,2);save()
        print(('PASS' if report['passed'] else 'FAIL')+' local release gate: '+str(out/'report.json'),flush=True)
        if not report['passed']:raise SystemExit(1)

if __name__=='__main__':main()
