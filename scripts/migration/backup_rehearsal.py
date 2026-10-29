#!/usr/bin/env python3
"""Back up Go development data and verify a disposable PostgreSQL restore."""
import hashlib
import json
import os
from pathlib import Path
import secrets
import subprocess
import time

ROOT=Path(__file__).resolve().parents[2]
PG=Path('/usr/lib/postgresql/16/bin')

def main():
    os.umask(0o077)
    config=json.loads((ROOT/'.run/go-dev/settings.json').read_text())
    identifier=secrets.token_hex(6);target='aisoc_go_restore_'+identifier
    directory=ROOT/'.run/backups'/identifier;directory.mkdir(parents=True)
    env={**os.environ,'PGHOST':'127.0.0.1','PGPORT':'55435','PGUSER':'aisoc_admin','PGPASSWORD':config['admin_password'],'PGDATABASE':'aisoc_go_dev'}
    created=False
    with (directory/'commands.log').open('w') as log:
        def run(args):subprocess.run([str(v) for v in args],env=env,stdout=log,stderr=log,check=True,timeout=180)
        def query(database,sql):return subprocess.check_output([str(PG/'psql'),'-X','-At','-v','ON_ERROR_STOP=1','-d',database,'-c',sql],env=env,stderr=log,text=True,timeout=30).strip()
        def fingerprints(database):
            tables=query(database,"SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename").splitlines()
            result={}
            for table in tables:
                quoted='"'+table.replace('"','""')+'"'
                # Canonical JSONB rows sorted independently of physical layout.
                raw=query(database,f'SELECT to_jsonb(t)::text FROM {quoted} t ORDER BY to_jsonb(t)::text')
                result[table]={'rows':int(query(database,f'SELECT count(*) FROM {quoted}')),'sha256':hashlib.sha256(raw.encode()).hexdigest()}
            return result
        try:
            before=fingerprints('aisoc_go_dev')
            start=time.monotonic()
            run([PG/'pg_dump','--format=custom','--no-owner','--no-acl','--file',directory/'postgres.dump'])
            backup_seconds=time.monotonic()-start
            # Recovery of encrypted credentials needs this key as well as the DB.
            (directory/'connector-key.json').write_text(json.dumps({'connector_key':config['connector_key']}))
            run([PG/'createdb','-O','aisoc_app',target]);created=True
            start=time.monotonic()
            run([PG/'pg_restore','--exit-on-error','--no-owner','--no-acl','--role','aisoc_app','-d',target,directory/'postgres.dump'])
            restore_seconds=time.monotonic()-start
            after=fingerprints(target)
            if before!=fingerprints('aisoc_go_dev'):raise RuntimeError('Source changed during rehearsal; rerun while development writers are idle')
            if before!=after:raise RuntimeError('Restored table fingerprints differ')
            invalid=query(target,"SELECT count(*) FROM pg_constraint WHERE connamespace='public'::regnamespace AND NOT convalidated")
            if invalid!='0':raise RuntimeError('Restored constraints are not validated')
            report={'passed':True,'source_database_modified':False,'tables':after,'backup_seconds':backup_seconds,'restore_seconds':restore_seconds,'private_artifacts':str(directory),'scope':'Development PostgreSQL dump/restore, validated constraints and canonical rows; not a production-size RTO guarantee.'}
            out=ROOT/'output/migration';out.mkdir(parents=True,exist_ok=True)
            (out/'postgres-restore.json').write_text(json.dumps(report,indent=2)+'\n')
            print(json.dumps({'passed':True,'tables':len(after),'backup_seconds':backup_seconds,'restore_seconds':restore_seconds,'report':'output/migration/postgres-restore.json'}))
        finally:
            if created:run([PG/'dropdb',target])

if __name__=='__main__':main()
