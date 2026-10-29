#!/usr/bin/env python3
"""Manage a local Go release with its own PostgreSQL cluster and private settings."""
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
PG=Path('/usr/lib/postgresql/16/bin')

def runtime_environment(config):
    return {**os.environ,'GOMEMLIMIT':'256MiB','GOMAXPROCS':'2','AISOC_GO_RELEASE_MODE':str(config.get('release',False)).lower(),'AISOC_GO_DATABASE_URL':config['url'],'AISOC_GO_ADDR':f"127.0.0.1:{config['api_port']}",'AISOC_GO_CONNECTOR_KEY':config['connector_key'],'AISOC_GO_AUTH_MODE':config['auth_mode'],'AISOC_GO_OPERATORS_FILE':config['operators_file'],'AISOC_GO_ENV':config.get('environment','development'),'AISOC_GO_SECURE_COOKIES':str(config.get('secure_cookies',False)).lower(),'AISOC_GO_SESSION_TTL_MS':'28800000','AISOC_GO_APP_ORIGINS':config.get('origins','http://localhost:8080,http://127.0.0.1:8080'),'AISOC_GO_DEFAULT_TENANT':config.get('default_tenant','demo'),'AISOC_PYTHON_ADDR':'','AISOC_RUST_ADDR':'','AISOC_WORKER_TOKEN':''}

def main():
    os.umask(0o077)
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=['init','start','stop','status','export','database-start'])
    parser.add_argument('--state',default=str(ROOT/'.run/go-runtime'))
    parser.add_argument('--source',help='Consistent SQLite snapshot JSON for initial import')
    parser.add_argument('--output',help='New private JSON path for reverse export')
    parser.add_argument('--api-port',type=int,default=3002)
    parser.add_argument('--pg-port',type=int,default=55436)
    parser.add_argument('--workers',action='store_true',help='Enable the investigation worker when starting')
    args=parser.parse_args()
    state=Path(args.state).resolve()
    if not state.is_relative_to(ROOT/'.run') or state==ROOT/'.run':parser.error('State must be a private child directory of .run')
    state.mkdir(parents=True,exist_ok=True,mode=0o700)
    with (state/'control.lock').open('w') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        config=json.loads((state/'settings.json').read_text()) if (state/'settings.json').exists() else None
        with (state/'control.log').open('a') as log:
            def run(command,env=None,cwd=ROOT):
                subprocess.run([str(x) for x in command],env=env,cwd=cwd,stdout=log,stderr=log,check=True,timeout=600)
            def pg_running():return subprocess.run([str(PG/'pg_ctl'),'-D',str(state/'pg'),'status'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0
            def available(port):
                if not 1024<=port<=65535 or port in (3003,8080,55435) or (port==3002 and state!=ROOT/'.run/go-runtime'):raise RuntimeError('Use an unreserved local port; only the final release may retain port 3002')
                with socket.socket() as sock:
                    sock.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1);sock.bind(('127.0.0.1',port))
            def save():
                temporary=state/'settings.new';temporary.write_text(json.dumps(config,indent=2));temporary.replace(state/'settings.json')
            def environment():
                return runtime_environment(config)
            def owned(name):
                try:
                    pid=int((state/(name+'.pid')).read_text())
                    command=Path(f'/proc/{pid}/cmdline').read_bytes().split(b'\0')
                    environ=Path(f'/proc/{pid}/environ').read_bytes().split(b'\0')
                    if str(state/'bin'/name).encode() in command and ('AISOC_GO_DATABASE_URL='+config['url']).encode() in environ:return pid
                except (FileNotFoundError,ProcessLookupError,PermissionError,ValueError):pass
                return None
            def stop_process(name):
                if pid:=owned(name):
                    os.kill(pid,signal.SIGTERM)
                    for _ in range(150):
                        if not owned(name):break
                        time.sleep(.1)
                    if owned(name):raise RuntimeError(name+' did not shut down; database retained')
            def start_db():
                if not pg_running():
                    available(config['pg_port'])
                    run([PG/'pg_ctl','-D',state/'pg','-l',state/'postgres.log','-o',f"-h 127.0.0.1 -p {config['pg_port']} -k {state}",'-w','start'])
            if args.action=='init':
                if config or (state/'pg').exists():raise RuntimeError('State already initialized; refusing to overwrite')
                if not args.source or not Path(args.source).is_file():parser.error('init requires a consistent snapshot --source')
                available(args.api_port);available(args.pg_port)
                admin_password,app_password=secrets.token_hex(32),secrets.token_hex(32)
                config={'api_port':args.api_port,'pg_port':args.pg_port,'release':state==ROOT/'.run/go-runtime','url':f'postgres://aisoc_app:{app_password}@127.0.0.1:{args.pg_port}/aisoc_go_release?sslmode=disable','admin_password':admin_password,'connector_key':secrets.token_hex(32),'auth_mode':'local','operators_file':'','workers':False,'imported':False}
                # Preserve the login-free local deployment. Token mode can be
                # configured explicitly in the private settings before startup.
                save();(state/'bin').mkdir()
                for name in ('api','investigation-worker','migrate','data-migrate'):
                    run(['go','build','-p','2','-trimpath','-o',state/'bin'/name,'./cmd/'+name],env={**os.environ,'GOMAXPROCS':'2'},cwd=ROOT/'backend-go')
                password_file=state/'init-password';password_file.write_text(admin_password)
                try:run([PG/'initdb','-D',state/'pg','-U','aisoc_admin','--auth-local=trust','--auth-host=scram-sha-256','--pwfile',password_file])
                finally:password_file.unlink(missing_ok=True)
                start_db()
                admin={**os.environ,'PGHOST':'127.0.0.1','PGPORT':str(args.pg_port),'PGUSER':'aisoc_admin','PGPASSWORD':admin_password,'PGDATABASE':'postgres'}
                # Password is generated hexadecimal; send SQL on stdin, never argv/logs.
                subprocess.run([str(PG/'psql'),'-X','-v','ON_ERROR_STOP=1'],input=f"CREATE ROLE aisoc_app LOGIN PASSWORD '{app_password}'; CREATE DATABASE aisoc_go_release OWNER aisoc_app;",text=True,env=admin,stdout=log,stderr=log,check=True)
                run([state/'bin/data-migrate','import',Path(args.source).resolve()],environment())
                config['imported']=True;save()
                print('Initialized private Go release; API/workers remain stopped')
                return
            if not config:raise RuntimeError('Initialize a release before managing it')
            if args.action=='status':
                print(json.dumps({'api_running':bool(owned('api')),'worker_running':bool(owned('investigation-worker')),'postgres_running':pg_running(),'api_port':config['api_port'],'imported':config['imported']}));return
            if args.action=='stop':
                stop_process('api');stop_process('investigation-worker')
                if pg_running():run([PG/'pg_ctl','-D',state/'pg','-m','fast','-w','stop'])
                print('Go release stopped; data retained');return
            if not config['imported']:raise RuntimeError('Initial import did not complete; do not start this release')
            start_db()
            if args.action=='database-start':print('Release PostgreSQL started');return
            if args.action=='export':
                if owned('api') or owned('investigation-worker'):raise RuntimeError('Stop release writers before reverse export')
                if not args.output:parser.error('export requires --output (new file)')
                run([state/'bin/data-migrate','export',Path(args.output).resolve()],environment());print('Private reverse export complete');return
            started=[]
            try:
                names=['api']+(['investigation-worker'] if args.workers or config['workers'] else [])
                for name in names:
                    if owned(name):continue
                    if name=='api':available(config['api_port'])
                    with (state/(name+'.log')).open('a') as service_log:
                        child=subprocess.Popen([str(state/'bin'/name)],cwd=ROOT,env=environment(),stdout=service_log,stderr=service_log,start_new_session=True)
                    (state/(name+'.pid')).write_text(str(child.pid));started.append(name)
                for _ in range(100):
                    try:
                        with urllib.request.urlopen(f"http://127.0.0.1:{config['api_port']}/ready",timeout=1) as response:
                            if response.status==200:break
                    except OSError:time.sleep(.1)
                else:raise RuntimeError('Release API readiness failed')
                if 'investigation-worker' in names and not owned('investigation-worker'):raise RuntimeError('Worker exited')
                config['workers']='investigation-worker' in names;save()
                print(f"Go release ready on 127.0.0.1:{config['api_port']}; workers={config['workers']}")
            except BaseException:
                for name in reversed(started):stop_process(name)
                raise

if __name__=='__main__':main()
