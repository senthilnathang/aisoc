"""Recover the gate dataset using only its disposable PostgreSQL cluster."""
import importlib.util
import json
import subprocess
from urllib.parse import urlsplit,urlunsplit


def verify_backup(run_id,env,temp,log,pg,root,out):
    spec=importlib.util.spec_from_file_location('release_archive_backup',root/'scripts/runtime/archive_backup.py')
    helper=importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)
    result=dict(run_id=run_id,mode='local/mock',passed=False,source_database_modified=False)
    report=out/'backup.json';report.write_text(json.dumps(result)+'\n')
    first='aisoc_go_release_source';second='aisoc_go_release_restored';created=[]
    archive_root=temp/'release-archives';archive_root.mkdir();saved=temp/'release-backup';saved.mkdir()
    def run(args,environment=env):subprocess.run(list(map(str,args)),env=environment,stdout=log,stderr=log,check=True,timeout=120)
    def query(statement,database=second):return subprocess.check_output([str(pg/'psql'),'-X','-At','-v','ON_ERROR_STOP=1','-d',database,'-c',statement],env=env,stderr=log,text=True,timeout=30).strip()
    source=urlsplit(env['AISOC_GO_DATABASE_URL'])
    try:
        run([pg/'pg_dump','-Fc','--no-owner','--no-acl','-f',saved/'source.dump'])
        for database in (first,second):run([pg/'createdb',database]);created.append(database)
        run([pg/'pg_restore','--exit-on-error','--no-owner','--no-acl','-d',first,saved/'source.dump'])
        query("UPDATE stream_events SET created_at=now()-interval '10 days' WHERE tenant_id='auth-a' AND connector_id='release-archive'; UPDATE stream_inbox SET processed_at=now()-interval '10 days' WHERE tenant_id='auth-a' AND connector_id='release-archive'; UPDATE stream_consumer_work SET updated_at=now()-interval '10 days' WHERE tenant_id='auth-a' AND connector_id='release-archive'",first)
        scopes=temp/'release-archive-scopes.json';scopes.write_text(json.dumps([dict(id='release-archive',operator_id='local-development',tenant_id='auth-a',connector_id='release-archive',source='qradar-siem',processor='mock-login-v1',allow_retry=True)]));scopes.chmod(0o600)
        first_env={**env,'AISOC_GO_DATABASE_URL':urlunsplit(source._replace(path='/'+first)),'AISOC_GO_AUTH_MODE':'local','AISOC_GO_STREAM_OPERATIONS_FILE':str(scopes)}
        verifier=root/'backend-go/bin/stream-archive'
        receipt=json.loads(subprocess.check_output([str(verifier),'--scope','release-archive','--directory',str(archive_root),'--min-age-days','7'],env=first_env,stderr=log,text=True,timeout=60))
        if receipt['events']!=1:raise RuntimeError('Missing isolated archive fixture')
        run([pg/'pg_dump','-d',first,'-Fc','--no-owner','--no-acl','-f',saved/'postgres.dump'])
        run([pg/'pg_restore','--exit-on-error','--no-owner','--no-acl','-d',second,saved/'postgres.dump'])
        tables=query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename").splitlines()
        for table in tables:
            quoted='"'+table.replace('"','""')+'"'
            statement="SELECT count(*)::text||':'||coalesce(md5(string_agg(hash,'' ORDER BY hash)),'empty') FROM (SELECT md5(to_jsonb(r)::text) hash FROM "+quoted+" r) records"
            if query(statement,first)!=query(statement):raise RuntimeError('Restored table fingerprint differs')
        if query("SELECT count(*) FROM pg_constraint WHERE connamespace='public'::regnamespace AND NOT convalidated")!='0':raise RuntimeError('Invalid restored constraints')
        restored={**first_env,'AISOC_GO_DATABASE_URL':urlunsplit(source._replace(path='/'+second))}
        files=helper.capture(query,saved,archive_root,verifier,restored,log)
        for path in archive_root.iterdir():path.unlink()
        run([verifier,'--verify-database'],restored)
        snapshots=helper.verify_snapshots(query)
        if snapshots<1:raise RuntimeError('Missing retained snapshot')
        (saved/files[0]['file']).write_bytes(b'corrupted local fixture')
        bad=subprocess.run([str(verifier),'--verify-database'],env=restored,stdout=log,stderr=log,timeout=60)
        if bad.returncode==0:raise RuntimeError('Corrupt archive accepted')
        query("UPDATE retention_snapshots SET document=document||'{\"corrupted\":true}'::jsonb")
        try:helper.verify_snapshots(query)
        except RuntimeError:pass
        else:raise RuntimeError('Corrupt snapshot accepted')
        result.update(passed=True,tables=len(tables),table_fingerprints_match=True,archived_events=receipt['events'],copied_files=len(files),archive_resolution_verified=True,original_temporary_files_removed=True,corruption_rejected=True,snapshot_corruption_rejected=True,snapshots_verified=snapshots)
    finally:
        for database in reversed(created):run([pg/'dropdb',database])
        report.write_text(json.dumps(result,indent=2)+'\n')
