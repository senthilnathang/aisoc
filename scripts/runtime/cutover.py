#!/usr/bin/env python3
"""Gated local cutover, preserving all Go-era writes if automatic rollback is needed."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import time
import urllib.request
from manage import ROOT
from release_gate import evaluate, source_digest

def main():
    os.umask(0o077)
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--execute',action='store_true');args=parser.parse_args()
    evidence=evaluate()
    if not evidence['passed']:raise RuntimeError('Release gates failed: '+', '.join(evidence['failures']))
    if not args.execute:print(json.dumps({'ready':True,'checks':len(evidence['checks']),'action':'Use --execute for the authorized maintenance window'}));return
    run_dir=ROOT/'.run';state=run_dir/'go-runtime'
    if (state/'settings.json').exists():raise RuntimeError('A release already exists; refusing to overwrite it')
    mode=run_dir/'backend-mode'
    if mode.exists() and mode.read_text().strip()!='node':raise RuntimeError('Expected the active Node launcher mode')
    for service in ('backend','frontend'):
        pid=int((run_dir/(service+'.pid')).read_text())
        if Path(f'/proc/{pid}/cwd').resolve()!=ROOT/service:raise RuntimeError('Active '+service+' is not owned by this launcher')
    pid=int((run_dir/'backend.pid').read_text())
    original={part.split(b'=',1)[0].decode():part.split(b'=',1)[1].decode() for part in Path(f'/proc/{pid}/environ').read_bytes().split(b'\0') if b'=' in part}
    source=Path(original.get('DATABASE_PATH',str(ROOT/'backend/data/sqlite.db')))
    if not source.is_absolute():source=ROOT/'backend'/source
    if not source.is_file():raise RuntimeError('Active SQLite database is unavailable')
    backup=run_dir/'cutover'/time.strftime('%Y%m%d-%H%M%S');backup.mkdir(parents=True)
    auth_keys=('AUTH_MODE','AUTH_OPERATORS_FILE','APP_ORIGINS','DEFAULT_TENANT_ID','NODE_ENV')
    rollback_env={**{key:value for key,value in os.environ.items() if key not in auth_keys},**{key:original[key] for key in auth_keys if key in original}}
    frozen=False;initialized=False;start=time.monotonic()
    manage=['python3','scripts/runtime/manage.py']
    with (backup/'cutover.log').open('w') as log:
        def run(command,env=None):subprocess.run([str(x) for x in command],cwd=ROOT,env=env,stdout=log,stderr=log,check=True,timeout=900)
        def set_mode(value):
            temporary=run_dir/'backend-mode.new';temporary.write_text(value+'\n');temporary.replace(mode)
        def health():
            with urllib.request.urlopen('http://127.0.0.1:8080/health',timeout=5) as response:return json.load(response)
        try:
            run(['./run.sh','stop','frontend']);frozen=True
            run(['./run.sh','stop','backend'])
            snapshot=backup/'final-sqlite.json'
            run(['python3','scripts/migration/snapshot.py','export',source,snapshot])
            run([*manage,'init','--source',snapshot]);initialized=True
            config_path=state/'settings.json';config=json.loads(config_path.read_text())
            config.update(auth_mode=original.get('AUTH_MODE') or 'local',default_tenant=original.get('DEFAULT_TENANT_ID') or 'demo',origins=original.get('APP_ORIGINS') or 'http://localhost:8080,http://127.0.0.1:8080',environment='production' if original.get('NODE_ENV')=='production' else 'development',secure_cookies=original.get('NODE_ENV')=='production')
            operator_path=original.get('AUTH_OPERATORS_FILE')
            if operator_path:
                operator_source=Path(operator_path)
                if not operator_source.is_absolute():operator_source=ROOT/'backend'/operator_source
                shutil.copyfile(operator_source,state/'operators.json');(state/'operators.json').chmod(0o600);config['operators_file']=str(state/'operators.json')
            config_path.write_text(json.dumps(config,indent=2))
            exported=backup/'import-reconciliation.json';run([*manage,'export','--output',exported])
            run(['python3','scripts/migration/snapshot.py','compare',snapshot,exported])
            if source_digest()!=evidence['source_digest']:raise RuntimeError('Release source changed after gate evaluation')
            run([*manage,'start','--workers'])
            set_mode('go')
            run(['./run.sh','start','frontend'])
            if health().get('database')!='postgresql':raise RuntimeError('Active frontend is not routing to PostgreSQL-backed Go')
            reopened=time.monotonic()-start
            # Observe actual active routing and queue progress before retirement.
            run(['python3','scripts/runtime/monitor.py','--seconds','600'])
            run(['python3','scripts/runtime/backup.py'])
            if health().get('database')!='postgresql':raise RuntimeError('Active routing changed during observation')
            report={'passed':True,'active_backend':'go','api':'http://127.0.0.1:3002','frontend':'http://127.0.0.1:8080','database':'aisoc_go_release','maintenance_seconds':reopened,'observation_seconds':600,'node_in_active_request_path':False,'node_worker_running':False,'rollback_window_days':7,'private_recovery_artifacts':str(backup),'source_digest':evidence['source_digest']}
            out=ROOT/'output/migration';out.mkdir(parents=True,exist_ok=True);(out/'cutover.json').write_text(json.dumps(report,indent=2)+'\n')
            print(json.dumps(report))
        except BaseException:
            # Never return to the stale source DB after Go could have accepted a
            # write. Failure to export leaves maintenance in place, not data loss.
            if frozen:
                run(['./run.sh','stop','frontend'])
                if initialized:
                    run([*manage,'stop'])
                    post=backup/'rollback-go-state.json';run([*manage,'export','--output',post])
                    restored=backup/'rollback.sqlite';run(['python3','scripts/migration/snapshot.py','restore',post,restored])
                    check=backup/'rollback-check.json';run(['python3','scripts/migration/snapshot.py','export',restored,check]);run(['python3','scripts/migration/snapshot.py','compare',post,check])
                    (run_dir/'node-database-path').write_text(str(restored)+'\n')
                    run([*manage,'stop'])
                set_mode('node')
                run(['./run.sh','start'],rollback_env)
            raise

if __name__=='__main__':main()
