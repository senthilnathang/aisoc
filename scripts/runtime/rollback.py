#!/usr/bin/env python3
"""Explicit post-write rollback to Node using a fresh export, never a stale snapshot."""
import argparse
import json
import os
import subprocess
import time
import urllib.request
from manage import ROOT

def main():
    os.umask(0o077)
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--execute',action='store_true');args=parser.parse_args()
    run_dir=ROOT/'.run';state=run_dir/'go-runtime';config=json.loads((state/'settings.json').read_text())
    if (run_dir/'backend-mode').read_text().strip()!='go':raise RuntimeError('Go is not the selected active backend')
    if not args.execute:print('Rollback will pause writes, export current Go data, reconcile a new SQLite copy, then start only Node. Use --execute when authorized.');return
    directory=run_dir/'rollback'/time.strftime('%Y%m%d-%H%M%S');directory.mkdir(parents=True)
    env={**os.environ,'AUTH_MODE':config['auth_mode'],'AUTH_OPERATORS_FILE':config['operators_file'],'APP_ORIGINS':config.get('origins','http://localhost:8080,http://127.0.0.1:8080'),'DEFAULT_TENANT_ID':config.get('default_tenant','demo'),'NODE_ENV':'production' if config.get('environment')=='production' else 'development'}
    with (directory/'rollback.log').open('w') as log:
        node_may_have_writes=False
        def run(command,environment=None):subprocess.run([str(x) for x in command],cwd=ROOT,env=environment,stdout=log,stderr=log,check=True,timeout=900)
        def mode(value):
            temporary=run_dir/'backend-mode.new';temporary.write_text(value+'\n');temporary.replace(run_dir/'backend-mode')
        run(['./run.sh','stop','frontend'])
        try:
            run(['python3','scripts/runtime/manage.py','stop'])
            exported=directory/'current-go.json';restored=directory/'rollback.sqlite'
            run(['python3','scripts/runtime/manage.py','export','--output',exported])
            run(['python3','scripts/migration/snapshot.py','restore',exported,restored])
            run(['python3','scripts/migration/snapshot.py','export',restored,directory/'restored.json'])
            run(['python3','scripts/migration/snapshot.py','compare',exported,directory/'restored.json'])
            run(['python3','scripts/runtime/manage.py','stop'])
            (run_dir/'node-database-path').write_text(str(restored)+'\n');mode('node')
            node_may_have_writes=True
            run(['./run.sh','start'],env)
            with urllib.request.urlopen('http://127.0.0.1:8080/health',timeout=5) as response:
                if json.load(response).get('database')=='postgresql':raise RuntimeError('Rollback proxy still points to Go')
            print(json.dumps({'rolled_back':True,'active_backend':'node','acknowledged_go_writes_preserved':True,'private_artifacts':str(directory)}))
        except BaseException:
            if node_may_have_writes:
                # Node may already have acknowledged new writes. Its recovered
                # SQLite file is now authoritative; resuming the older Go copy
                # would lose them. Keep that copy and pause browser access.
                run(['./run.sh','stop','frontend'])
                raise RuntimeError('Node startup was attempted; recovered SQLite may contain new writes. Repair Node using the retained recovery database before reopening traffic; do not resume the older Go database.') from None
            # If recovery conversion fails, resume the intact Go database rather
            # than use stale Node data. If Go itself cannot start, stay stopped.
            mode('node');run(['./run.sh','stop','backend'])
            mode('go');run(['python3','scripts/runtime/manage.py','start','--workers']);run(['./run.sh','start','frontend'])
            raise

if __name__=='__main__':main()
