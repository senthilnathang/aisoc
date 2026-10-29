#!/usr/bin/env python3
"""Ten-minute token/intake soak in a separate release; kills/restarts only its worker."""
import hashlib
import json
import os
from pathlib import Path
import secrets
import signal
import socket
import subprocess
import time

ROOT=Path(__file__).resolve().parents[2]
def port():
    with socket.socket() as sock:sock.bind(('127.0.0.1',0));return sock.getsockname()[1]
def main():
    os.umask(0o077)
    state=ROOT/'.run/soak'/secrets.token_hex(6);state.mkdir(parents=True)
    out=ROOT/'output/backend-performance';out.mkdir(parents=True,exist_ok=True)
    (out/'soak.json').write_text(json.dumps({'passed':False,'status':'running'})+'\n')
    apiport,pgport=port(),port()
    with (out/'soak.log').open('w') as log:
        def run(command):subprocess.run([str(v) for v in command],cwd=ROOT,stdout=log,stderr=log,check=True)
        manage=['python3','scripts/runtime/manage.py']
        runner=None
        try:
            snapshot=state/'source.json'
            run(['python3','scripts/migration/snapshot.py','export','backend/data/sqlite.db',snapshot])
            run([*manage,'init','--state',state,'--source',snapshot,'--api-port',apiport,'--pg-port',pgport])
            operators=state/'operators.json';operators.write_text(json.dumps([{'id':'soak-a','tenant_id':'auth-a','token_hash':hashlib.sha256(('parity_fixture_'+'a'*40).encode()).hexdigest()}]))
            settings=state/'settings.json';config=json.loads(settings.read_text());config.update(auth_mode='token',operators_file=str(operators));settings.write_text(json.dumps(config))
            run([*manage,'start','--state',state,'--workers'])
            runner=subprocess.Popen(['node','tests/backend-performance/soak.mjs','--url',f'http://127.0.0.1:{apiport}','--allow-fixture-writes','--seconds','600'],cwd=ROOT,stdout=log,stderr=log)
            begin=time.monotonic();killed=False
            while runner.poll() is None:
                if not killed and time.monotonic()-begin>=180:
                    pid=int((state/'investigation-worker.pid').read_text())
                    command=Path(f'/proc/{pid}/cmdline').read_bytes().split(b'\0')
                    if str(state/'bin/investigation-worker').encode() not in command:raise RuntimeError('Worker ownership changed')
                    os.kill(pid,signal.SIGKILL);time.sleep(5)
                    run([*manage,'start','--state',state,'--workers']);killed=True
                time.sleep(1)
            if runner.returncode!=0:raise RuntimeError('Soak failed; inspect output/backend-performance/soak.log')
            run([*manage,'stop','--state',state])
            exported=state/'after-soak.json'
            run([*manage,'export','--state',state,'--output',exported])
            restored=state/'rollback.sqlite'
            run(['python3','scripts/migration/snapshot.py','restore',exported,restored])
            run(['python3','scripts/migration/snapshot.py','export',restored,state/'restored.json'])
            run(['python3','scripts/migration/snapshot.py','compare',exported,state/'restored.json'])
            report=out/'soak.json';data=json.loads(report.read_text());data.update(worker_sigkill_recovered=killed,post_soak_reverse_export_reconciled=True,private_artifacts=str(state));report.write_text(json.dumps(data,indent=2)+'\n')
            print('PASS ten-minute token/intake soak, worker crash recovery and post-write reverse export')
        finally:
            if runner is not None and runner.poll() is None:runner.terminate();runner.wait(timeout=10)
            if (state/'settings.json').exists():run([*manage,'stop','--state',state])
if __name__=='__main__':main()
