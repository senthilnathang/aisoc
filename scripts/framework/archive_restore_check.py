#!/usr/bin/env python3
"""Rehearse archive-backed recovery in two disposable clones of the local demo."""
import importlib.util
import json
import os
from pathlib import Path
import secrets
import subprocess
import tempfile
from urllib.parse import urlsplit,urlunsplit
import dev


def main():
    os.umask(0o077)
    out=dev.ROOT/'output/backend-framework/archive-restore.json'
    out.parent.mkdir(parents=True,exist_ok=True)
    out.write_text(json.dumps({'passed':False,'status':'running','source_database_modified':False})+'\n')
    config=dev.settings()
    source=urlsplit(config['url'])
    env={**os.environ,'PGHOST':'127.0.0.1','PGPORT':'55435','PGUSER':'aisoc_admin',
         'PGPASSWORD':config['admin_password'],'PGDATABASE':source.path.lstrip('/')}
    spec=importlib.util.spec_from_file_location('archive_backup',dev.ROOT/'scripts/runtime/archive_backup.py')
    helper=importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)
    names=['aisoc_go_archive_test_'+secrets.token_hex(6) for _ in range(2)]
    created=[]
    with tempfile.TemporaryDirectory(prefix='aisoc-archive-restore-') as temporary:
        root=Path(temporary); saved=root/'backup';saved.mkdir();archives=root/'archives';archives.mkdir()
        with (root/'verification.log').open('w') as log:
            def run(args,environment=env):
                subprocess.run([str(a) for a in args],env=environment,stdout=log,stderr=log,check=True,timeout=180)
            def query(statement,database=names[1]):
                return subprocess.check_output([str(dev.PG/'psql'),'-X','-At','-v','ON_ERROR_STOP=1','-d',database,'-c',statement],env=env,stderr=log,text=True,timeout=30).strip()
            try:
                subprocess.run(['go','build','-o',str(root/'verifier'),'./cmd/stream-archive'],cwd=dev.ROOT/'backend-go',stdout=log,stderr=log,check=True,timeout=120)
                subprocess.run(['go','build','-o',str(root/'migrate'),'./cmd/migrate'],cwd=dev.ROOT/'backend-go',stdout=log,stderr=log,check=True,timeout=120)
                run([dev.PG/'pg_dump','-Fc','--no-owner','--no-acl','-f',root/'source.dump'])
                for name in names:
                    run([dev.PG/'createdb','-O','aisoc_app',name]);created.append(name)
                run([dev.PG/'pg_restore','--exit-on-error','--no-owner','--no-acl','--role','aisoc_app','-d',names[0],root/'source.dump'])
                first={**dev.dev_env(config),'AISOC_GO_DATABASE_URL':urlunsplit(source._replace(path='/'+names[0]))}
                run([root/'migrate'],first)
                # Age only disposable clone data, never the showcase database.
                query("UPDATE stream_events SET created_at=now()-interval '10 days' WHERE connector_id='demo-showcase-01'; UPDATE stream_inbox SET processed_at=now()-interval '10 days' WHERE connector_id='demo-showcase-01'; UPDATE stream_consumer_work SET updated_at=now()-interval '10 days' WHERE connector_id='demo-showcase-01'",names[0])
                result=subprocess.check_output([str(root/'verifier'),'--scope','demo-showcase-01','--directory',str(archives),'--min-age-days','7'],env=first,stderr=log,text=True,timeout=45)
                receipt=json.loads(result)
                if receipt['events']<1:raise RuntimeError('No eligible archive fixture')
                run([dev.PG/'pg_dump','-d',names[0],'-Fc','--no-owner','--no-acl','-f',saved/'postgres.dump'])
                run([dev.PG/'pg_restore','--exit-on-error','--no-owner','--no-acl','--role','aisoc_app','-d',names[1],saved/'postgres.dump'])
                restored={**first,'AISOC_GO_DATABASE_URL':urlunsplit(source._replace(path='/'+names[1]))}
                manifests=helper.capture(query,saved,archives,root/'verifier',restored,log)
                for path in archives.iterdir():path.unlink() # Owned temporary fixture only.
                run([root/'verifier','--verify-database'],restored)
                # Corruption must be detected even after a previously good restore.
                damaged=saved/manifests[0]['file'];damaged.write_bytes(b'corrupted fixture')
                failed=subprocess.run([str(root/'verifier'),'--verify-database'],env=restored,stdout=log,stderr=log,timeout=45)
                if failed.returncode==0:raise RuntimeError('Corrupted archive accepted')
                report={'passed':True,'archived_events':receipt['events'],'copied_files':len(manifests),
                        'original_archives_removed_before_verification':True,'corruption_rejected':True,
                        'source_database_modified':False,'scope':'local disposable restore; not off-host failover'}
                out.write_text(json.dumps(report,indent=2)+'\n')
                print(json.dumps(report))
            finally:
                for name in reversed(created):run([dev.PG/'dropdb',name])


if __name__=='__main__':main()
