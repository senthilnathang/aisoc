#!/usr/bin/env python3
"""Create a private release backup and verify it in a disposable PostgreSQL DB."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import time
from urllib.parse import urlsplit, urlunsplit
import urllib.request
import archive_backup
from manage import ROOT, PG, runtime_environment

def backup(state):
    config=json.loads((state/'settings.json').read_text())
    foundation=state==ROOT/'.run/go-dev'
    if foundation:
        config={**config,'pg_port':55435,'api_port':3003,'auth_mode':'local','operators_file':'','release':False}
    url=urlsplit(config['url']);source=url.path.lstrip('/')
    if not source.startswith('aisoc_go_'):raise RuntimeError('Unexpected release database')
    identifier=time.strftime('%Y%m%d-%H%M%S')+'-'+secrets.token_hex(4)
    directory=ROOT/'.run/backups'/identifier;directory.mkdir(parents=True)
    target='aisoc_go_restore_'+secrets.token_hex(6)
    env={**os.environ,'PGHOST':'127.0.0.1','PGPORT':str(config['pg_port']),'PGUSER':'aisoc_admin','PGPASSWORD':config['admin_password'],'PGDATABASE':source}
    created=False;api=None;start=time.monotonic()
    with (directory/'verification.log').open('w') as log:
        def run(command):subprocess.run([str(x) for x in command],env=env,stdout=log,stderr=log,check=True,timeout=300)
        def query(statement):return subprocess.check_output([str(PG/'psql'),'-X','-At','-v','ON_ERROR_STOP=1','-d',target,'-c',statement],env=env,stderr=log,text=True,timeout=30).strip()
        try:
            dump=directory/'postgres.dump'
            run([PG/'pg_dump','--format=custom','--no-owner','--no-acl','--file',dump])
            # Credentials are part of recovery material, kept private with the dump.
            settings=directory/'settings.json';settings.write_text(json.dumps(config))
            operators=config.get('operators_file')
            if operators:(directory/'operators.json').write_bytes(Path(operators).read_bytes())
            for name in ('stream-scopes.json','inference.json'):
                if (state/name).is_file():(directory/name).write_bytes((state/name).read_bytes())
            backup_seconds=time.monotonic()-start
            run([PG/'createdb','-O','aisoc_app',target]);created=True
            restore_start=time.monotonic()
            run([PG/'pg_restore','--exit-on-error','--no-owner','--no-acl','--role','aisoc_app','-d',target,dump])
            if query("SELECT count(*) FROM pg_constraint WHERE connamespace='public'::regnamespace AND NOT convalidated")!='0':raise RuntimeError('Unvalidated restored constraint')
            tables=query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename").splitlines()
            counts={name:int(query('SELECT count(*) FROM "'+name.replace('"','""')+'"')) for name in tables}
            with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
            restored={**config,'url':urlunsplit(url._replace(path='/'+target)),'api_port':port}
            archives=[]
            if query("SELECT to_regclass('public.stream_event_archives') IS NOT NULL")=='t':
                # Build from the same checked-out schema contract as the backup.
                verifier=directory/'archive-verifier'
                subprocess.run(['go','build','-o',str(verifier),'./cmd/stream-archive'],cwd=ROOT/'backend-go',stdout=log,stderr=log,check=True,timeout=120)
                try:
                    archives=archive_backup.capture(query,directory,state/'archives',verifier,runtime_environment(restored),log)
                    subprocess.run([str(verifier),'--verify-database'],env=runtime_environment(restored),stdout=log,stderr=log,check=True,timeout=120)
                finally:verifier.unlink(missing_ok=True)
            api_binary=ROOT/'backend-go/bin/api' if foundation else state/'bin/api'
            api=subprocess.Popen([str(api_binary)],env=runtime_environment(restored),stdout=log,stderr=log)
            for _ in range(100):
                try:
                    with urllib.request.urlopen(f'http://127.0.0.1:{port}/ready',timeout=1) as response:
                        if response.status==200:break
                except OSError:time.sleep(.1)
            else:raise RuntimeError('Restored release schema is not ready')
            manifest={'passed':True,'created_at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'dump_sha256':hashlib.file_digest(dump.open('rb'),'sha256').hexdigest(),'tables':counts,'archives':archives,'archive_restore_verified':True,'backup_seconds':backup_seconds,'restore_seconds':time.monotonic()-restore_start,'private_artifacts':str(directory),'source_database_modified':False,'verification':'pg_restore with errors fatal; constraints validated; copied archive hashes and restored payload resolution; API schema/readiness check'}
            for file in directory.iterdir():
                if file.is_file():
                    with file.open('rb') as saved:os.fsync(saved.fileno())
        finally:
            try:
                if api is not None:
                    api.terminate()
                    try:api.wait(timeout=15)
                    except subprocess.TimeoutExpired:api.kill();api.wait(timeout=5)
            finally:
                if created:run([PG/'dropdb',target])
    (directory/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    return manifest

def write_report(report):
    out=ROOT/'output/migration';out.mkdir(parents=True,exist_ok=True)
    temporary=out/'release-backup.new'
    temporary.write_text(json.dumps(report,indent=2)+'\n')
    temporary.replace(out/'release-backup.json')

def main():
    os.umask(0o077)
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--state',default=str(ROOT/'.run/go-runtime'))
    args=parser.parse_args();state=Path(args.state).resolve()
    if state==ROOT/'.run' or not state.is_relative_to(ROOT/'.run') or not (state/'settings.json').is_file():
        parser.error('Use an initialized private .run release')
    # One backup owns the shared latest report; coordinate with native lifecycle
    # operations so PostgreSQL cannot be stopped mid-verification by manage.py.
    with (ROOT/'.run/backup.lock').open('a') as lock, (state/'control.lock').open('a') as control:
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:parser.exit(1,'Another backup is already running\n')
        fcntl.flock(control,fcntl.LOCK_SH)
        started=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())
        write_report({'passed':False,'status':'running','started_at':started})
        try:manifest=backup(state)
        except BaseException as error:
            # Exception messages may contain connection credentials; keep public
            # status generic. Detailed subprocess output stays in private logs.
            write_report({'passed':False,'status':'failed','started_at':started,'error_type':type(error).__name__})
            parser.exit(1,'Backup failed; inspect private backup verification logs\n')
        write_report({**manifest,'status':'complete'})
        print(json.dumps({'passed':True,'tables':len(manifest['tables']),'backup_seconds':manifest['backup_seconds'],'restore_seconds':manifest['restore_seconds'],'private_artifacts':manifest['private_artifacts']}))

if __name__=='__main__':main()
