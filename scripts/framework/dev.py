#!/usr/bin/env python3
"""Manage only AISOC's isolated local Go/PostgreSQL development processes."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import secrets
import signal
import socket
import subprocess
import time
import urllib.request

ROOT=Path(__file__).resolve().parents[2]
STATE=ROOT/'.run/go-dev'
PG=Path(os.environ.get('AISOC_DEV_PG_BIN','/usr/lib/postgresql/16/bin'))
API=ROOT/'backend-go/bin/api'
INVESTIGATION_WORKER=ROOT/'backend-go/bin/investigation-worker'
SPECIALIST_WORKER=ROOT/'backend-go/bin/worker'
PYTHON=ROOT/'services/python-worker/.venv/bin/python'
PYTHON_SERVICE=ROOT/'services/python-worker/worker.py'


def settings():
    return json.loads((STATE/'settings.json').read_text())


def api_pid(config, name='api'):
    try:
        pid=int((STATE/(name+'.pid')).read_text())
        command=Path(f'/proc/{pid}/cmdline').read_bytes().split(b'\0')
        environment=Path(f'/proc/{pid}/environ').read_bytes().split(b'\0')
        if name=='python-worker':
            if str(PYTHON_SERVICE).encode() in command and ('AISOC_WORKER_TOKEN='+config.get('worker_token','')).encode() in environment:
                return pid
            return None
        binary={'api':API,'investigation-worker':INVESTIGATION_WORKER,'specialist-worker':SPECIALIST_WORKER}[name]
        if str(binary).encode() in command and ('AISOC_GO_DATABASE_URL='+config['url']).encode() in environment and b'AISOC_GO_ADDR=127.0.0.1:3003' in environment:
            return pid
    except (FileNotFoundError,ProcessLookupError,PermissionError,ValueError): pass
    return None


def dev_env(config):
    return {**os.environ,'AISOC_GO_ADDR':'127.0.0.1:3003','AISOC_GO_DATABASE_URL':config['url'],
            'AISOC_GO_CONNECTOR_KEY':config.get('connector_key',''),'AISOC_GO_AUTH_MODE':'local','AISOC_GO_OPERATORS_FILE':'','AISOC_GO_DEFAULT_TENANT':'demo',
            'AISOC_GO_ENV':'development','AISOC_GO_SECURE_COOKIES':'false','AISOC_GO_SESSION_TTL_MS':'28800000',
            'AISOC_PYTHON_ADDR':'127.0.0.1:50051' if config.get('python_worker_enabled') else '',
            'AISOC_RUST_ADDR':'','AISOC_WORKER_TOKEN':config.get('worker_token','') if config.get('python_worker_enabled') else ''}


def start_python_worker(config):
    if not config.get('python_worker_enabled'): return
    if not PYTHON.exists(): raise RuntimeError('Install services/python-worker/requirements.txt into its .venv first')
    # The Python service receives neither database nor connector credentials.
    if not api_pid(config,'python-worker'):
        available(50051);available(8001)
        env={key:value for key,value in os.environ.items() if key in ('PATH','LANG')}
        env.update(AISOC_WORKER_TOKEN=config['worker_token'],AISOC_PYTHON_ADDR='127.0.0.1:50051',AISOC_PYTHON_HTTP_ADDR='127.0.0.1:8001')
        with (STATE/'python-worker.log').open('a') as log:
            process=subprocess.Popen([str(PYTHON),str(PYTHON_SERVICE)],env=env,cwd=ROOT,stdout=log,stderr=log,start_new_session=True)
        (STATE/'python-worker.pid').write_text(str(process.pid))
        try:
            for _ in range(100):
                if process.poll() is not None: raise RuntimeError('Python service exited; see .run/go-dev/python-worker.log')
                try:
                    with urllib.request.urlopen('http://127.0.0.1:8001/ready',timeout=1) as response:
                        if response.status==200: break
                except OSError: pass
                time.sleep(.1)
            else: raise RuntimeError('Python gRPC readiness timed out')
        except BaseException:
            if process.poll() is None: process.terminate();process.wait(timeout=15)
            raise
    if not api_pid(config,'specialist-worker'):
        subprocess.run(['go','build','-o','bin/worker','./cmd/worker'],cwd=ROOT/'backend-go',check=True)
        with (STATE/'specialist-worker.log').open('a') as log:
            process=subprocess.Popen([str(SPECIALIST_WORKER)],env=dev_env(config),cwd=ROOT,stdout=log,stderr=log,start_new_session=True)
        (STATE/'specialist-worker.pid').write_text(str(process.pid))
        time.sleep(.2)
        if process.poll() is not None: raise RuntimeError('Go specialist dispatcher exited; see its development log')
    print('Python FastAPI: http://127.0.0.1:8001; gRPC: 127.0.0.1:50051; Go dispatcher enabled')


def start_investigation_worker(config):
    if api_pid(config,'investigation-worker'): return
    subprocess.run(['go','build','-o','bin/investigation-worker','./cmd/investigation-worker'],cwd=ROOT/'backend-go',check=True)
    with (STATE/'investigation-worker.log').open('a') as log:
        process=subprocess.Popen([str(INVESTIGATION_WORKER)],env=dev_env(config),cwd=ROOT,stdout=log,stderr=log,start_new_session=True)
    (STATE/'investigation-worker.pid').write_text(str(process.pid))
    time.sleep(.2)
    if process.poll() is not None: raise RuntimeError('Investigation worker exited; see .run/go-dev/investigation-worker.log')
    config['investigation_worker_enabled']=True
    state=STATE/'settings.json';state.write_text(json.dumps(config));state.chmod(0o600)
    print('Local investigation worker started (no external tools or Skills execution)')


def pg_running():
    return subprocess.run([str(PG/'pg_ctl'),'-D',str(STATE/'pg'),'status'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0


def available(port):
    with socket.socket() as sock:
        # Match Go's listener behavior: TIME_WAIT connections from our stopped
        # API should not prevent restart, but an active listener still must.
        sock.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
        try: sock.bind(('127.0.0.1',port))
        except OSError: raise RuntimeError(f'Port {port} is occupied; no existing service was changed')


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=['start','stop','status'])
    parser.add_argument('--investigation-worker',action='store_true',help='Start the local three-phase investigation worker with the Go API')
    parser.add_argument('--python-worker',action='store_true',help='Enable independent Python FastAPI/gRPC service and Go specialist dispatcher')
    args=parser.parse_args()
    action=args.action
    if not (PG/'pg_ctl').exists(): raise RuntimeError('Set AISOC_DEV_PG_BIN to PostgreSQL binaries')
    STATE.mkdir(parents=True,exist_ok=True,mode=0o700)
    with (STATE/'lock').open('w') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        config=settings() if (STATE/'settings.json').exists() else None
        if action=='status':
            print('Go API: '+('running on http://127.0.0.1:3003' if config and api_pid(config) else 'stopped'))
            print('Investigation worker: '+('running' if config and api_pid(config,'investigation-worker') else 'stopped'))
            print('Python FastAPI/gRPC: '+('running on 8001/50051' if config and api_pid(config,'python-worker') else 'stopped'))
            print('Go specialist dispatcher: '+('running' if config and api_pid(config,'specialist-worker') else 'stopped'))
            print('PostgreSQL: '+('running on 127.0.0.1:55435 (aisoc_go_dev)' if pg_running() else 'stopped'))
            return
        if action=='stop':
            for name in ('specialist-worker','python-worker'):
                if config and (pid:=api_pid(config,name)):
                    os.kill(pid,signal.SIGTERM)
                    for _ in range(150):
                        if not api_pid(config,name): break
                        time.sleep(.1)
                    if api_pid(config,name): raise RuntimeError(name+' did not exit; remaining services left running')
            if config and (pid:=api_pid(config,'investigation-worker')):
                os.kill(pid,signal.SIGTERM)
                for _ in range(100):
                    if not api_pid(config,'investigation-worker'): break
                    time.sleep(.1)
                if api_pid(config,'investigation-worker'): raise RuntimeError('Investigation worker did not exit; database left running')
            if config and (pid:=api_pid(config)):
                os.kill(pid,signal.SIGTERM)
                for _ in range(100):
                    if not api_pid(config): break
                    time.sleep(.1)
                if api_pid(config): raise RuntimeError('Go API did not exit; PostgreSQL left running')
            if pg_running(): subprocess.run([str(PG/'pg_ctl'),'-D',str(STATE/'pg'),'-m','fast','-w','stop'],check=True)
            print('Isolated development services stopped; PostgreSQL data retained')
            return
        if config and api_pid(config):
            if args.python_worker and not config.get('python_worker_enabled'):
                raise RuntimeError('Stop development services, then start with --python-worker to change their configuration')
            if args.investigation_worker or config.get('investigation_worker_enabled'): start_investigation_worker(config)
            start_python_worker(config)
            print('Go API already running on http://127.0.0.1:3003');return
        available(3003)
        if not pg_running(): available(55435)
        subprocess.run(['go','build','-o','bin/api','./cmd/api'],cwd=ROOT/'backend-go',check=True)
        subprocess.run(['go','build','-o','bin/migrate','./cmd/migrate'],cwd=ROOT/'backend-go',check=True)
        with (STATE/'postgres-control.log').open('a') as log:
            def run(args,env=None,input=None):
                subprocess.run([str(a) for a in args],env=env,input=input,text=True,stdout=log,stderr=log,check=True,timeout=60)
            fresh=config is None
            if fresh:
                if (STATE/'pg').exists(): raise RuntimeError('Existing PostgreSQL data without settings; refusing to overwrite')
                config={'password':secrets.token_hex(24),'admin_password':secrets.token_hex(24)}
                config['url']='postgres://aisoc_app:'+config['password']+'@127.0.0.1:55435/aisoc_go_dev?sslmode=disable'
                secret=STATE/'init-password';secret.write_text(config['admin_password']);secret.chmod(0o600)
                try: run([PG/'initdb','-D',STATE/'pg','-U','aisoc_admin','--auth-local=trust','--auth-host=scram-sha-256','--pwfile',secret])
                finally: secret.unlink(missing_ok=True)
                state=STATE/'settings.json';state.write_text(json.dumps(config));state.chmod(0o600)
            if not pg_running(): run([PG/'pg_ctl','-D',STATE/'pg','-l',STATE/'postgres.log','-o',f'-h 127.0.0.1 -p 55435 -k {STATE}','-w','start'])
            if not config.get('database_initialized'):
                env={**os.environ,'PGHOST':'127.0.0.1','PGPORT':'55435','PGUSER':'aisoc_admin','PGPASSWORD':config['admin_password'],'PGDATABASE':'postgres'}
                # Generated passwords contain only hexadecimal characters; no user input enters SQL.
                run([PG/'psql','-X','-v','ON_ERROR_STOP=1'],env=env,input="SELECT 'CREATE ROLE aisoc_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD ''"+config['password']+"''' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname='aisoc_app')\n\\gexec\nSELECT 'CREATE DATABASE aisoc_go_dev OWNER aisoc_app' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname='aisoc_go_dev')\n\\gexec\n")
                config['database_initialized']=True
                state=STATE/'settings.json';state.write_text(json.dumps(config));state.chmod(0o600)
        if not config.get('connector_key'):
            config['connector_key']=secrets.token_hex(32)
            state=STATE/'settings.json';state.write_text(json.dumps(config));state.chmod(0o600)
        if args.python_worker:
            config['python_worker_enabled']=True
            config.setdefault('worker_token',secrets.token_hex(32))
            state=STATE/'settings.json';state.write_text(json.dumps(config));state.chmod(0o600)
        env=dev_env(config)
        subprocess.run([str(ROOT/'backend-go/bin/migrate')],env=env,check=True)
        with (STATE/'api.log').open('a') as log:
            process=subprocess.Popen([str(API)],env=env,cwd=ROOT,stdout=log,stderr=log,start_new_session=True)
        (STATE/'api.pid').write_text(str(process.pid))
        for _ in range(100):
            if process.poll() is not None: raise RuntimeError('Go API exited; see .run/go-dev/api.log')
            try:
                with urllib.request.urlopen('http://127.0.0.1:3003/ready',timeout=.5) as response:
                    if response.status==200: break
            except (OSError,TimeoutError): pass
            time.sleep(.1)
        else:
            process.terminate();process.wait(timeout=10)
            raise RuntimeError('Go readiness timed out; PostgreSQL retained for diagnosis')
        print('Go API ready: http://127.0.0.1:3003 (local development auth)')
        if args.investigation_worker or config.get('investigation_worker_enabled'): start_investigation_worker(config)
        start_python_worker(config)
        print('PostgreSQL ready: 127.0.0.1:55435 / aisoc_go_dev (dedicated non-superuser role)')
        print('State and private credentials: .run/go-dev/; active Node services unchanged')


if __name__=='__main__': main()
