#!/usr/bin/env python3
"""Import/reverse-export rehearsal in a fresh database; never changes Node data."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import secrets
import socket
import sqlite3
import subprocess
import time
import urllib.request

ROOT=Path(__file__).resolve().parents[2]
PG=Path('/usr/lib/postgresql/16/bin')

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',default='backend/data/sqlite.db',help='Read-only SQLite source; defaults to the active database')
    args=parser.parse_args()
    os.umask(0o077)
    config=json.loads((ROOT/'.run/go-dev/settings.json').read_text())
    run_id=secrets.token_hex(6);name='aisoc_go_rehearsal_'+run_id
    output=ROOT/'.run/migration'/run_id;output.mkdir(parents=True)
    env={**os.environ,'PGHOST':'127.0.0.1','PGPORT':'55435','PGUSER':'aisoc_admin','PGPASSWORD':config['admin_password'],'PGDATABASE':'postgres'}
    api=None;created=False
    with (output/'commands.log').open('w') as log:
        def run(args,run_env=env,check=True):return subprocess.run([str(a) for a in args],cwd=ROOT,env=run_env,stdout=log,stderr=log,check=check,timeout=180)
        try:
            run([PG/'createdb','-O','aisoc_app',name]);created=True
            subprocess.run(['go','build','-o','bin/data-migrate','./cmd/data-migrate'],cwd=ROOT/'backend-go',stdout=log,stderr=log,check=True)
            subprocess.run(['go','build','-o','bin/api','./cmd/api'],cwd=ROOT/'backend-go',stdout=log,stderr=log,check=True)
            with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
            api_env={**os.environ,'AISOC_GO_DATABASE_URL':config['url'].replace('/aisoc_go_dev?','/'+name+'?'), 'AISOC_GO_ADDR':'127.0.0.1:'+str(port),'AISOC_GO_AUTH_MODE':'local','AISOC_GO_OPERATORS_FILE':'','AISOC_GO_ENV':'development','AISOC_GO_CONNECTOR_KEY':config['connector_key'],'AISOC_PYTHON_ADDR':'','AISOC_RUST_ADDR':'','AISOC_WORKER_TOKEN':''}
            snapshot=output/'source.json';exported=output/'roundtrip.json';post=output/'after-go-writes.json'
            run(['python3','scripts/migration/snapshot.py','export',args.source,snapshot])
            data=json.loads(snapshot.read_text());bad=output/'invalid.json'
            data['tables']['investigations'].append(dict(data['tables']['investigations'][0]));bad.write_text(json.dumps(data))
            failed=run([ROOT/'backend-go/bin/data-migrate','import',bad],api_env,False)
            if failed.returncode==0:raise RuntimeError('Invalid import unexpectedly succeeded')
            count=subprocess.check_output([str(PG/'psql'),'-X','-At','-d',name,'-c','select count(*) from tenants'],env=env,text=True).strip()
            if count!='0':raise RuntimeError('Failed import left partial data')
            run([ROOT/'backend-go/bin/data-migrate','import',snapshot],api_env)
            run([ROOT/'backend-go/bin/data-migrate','import',snapshot],api_env)
            run([ROOT/'backend-go/bin/data-migrate','export',exported],api_env)
            run(['python3','scripts/migration/snapshot.py','compare',snapshot,exported])
            api=subprocess.Popen([str(ROOT/'backend-go/bin/api')],cwd=ROOT,env=api_env,stdout=log,stderr=log)
            base='http://127.0.0.1:'+str(port);tenant='migration-rehearsal-'+run_id
            def request(method,path,body=None,expected=200,headers=None):
                h={'x-tenant-id':tenant,**(headers or {})};encoded=None
                if body is not None:h['content-type']='application/json';encoded=json.dumps(body).encode()
                r=urllib.request.Request(base+path,method=method,headers=h,data=encoded)
                with urllib.request.urlopen(r,timeout=15) as response:
                    if response.status!=expected:raise RuntimeError('Unexpected rehearsal HTTP status')
                    raw=response.read();return json.loads(raw) if raw else None
            for _ in range(100):
                try:request('GET','/ready');break
                except OSError:time.sleep(.1)
            else:raise RuntimeError('Rehearsal API did not start')
            case=request('POST','/api/v1/investigations',{'title':'Go-era write','source':'Rehearsal','severity':'low'},201)
            connector=request('POST','/api/v1/connectors',{'name':'Rehearsal','type':'custom','secret':'rehearsal-credential'},201)
            rule=request('POST','/api/v1/detection-rules',{'name':'Rehearsal','severity':'low'},201)
            source=request('POST','/api/v1/api-sources',{'name':'Rehearsal','provider':'Fixture','rule_id':rule['id']},201)
            alert=request('POST','/api/v1/intake/'+source['source']['id']+'/alerts',{'external_id':'rehearsal-event','title':'Queued state','severity':'low'},201,{'authorization':'Bearer '+source['api_key']})
            duplicate=request('POST','/api/v1/intake/'+source['source']['id']+'/alerts',{'external_id':'rehearsal-event','title':'Queued state','severity':'low'},200,{'authorization':'Bearer '+source['api_key']})
            if alert['alert']['id']!=duplicate['alert']['id']:raise RuntimeError('Deduplication failed')
            skill=request('POST','/api/v1/skills',{'name':'Go-era skill'},201)
            request('POST','/api/v1/skills/'+skill['id']+'/materials',{'name':'Guide.txt','content':'Retain this revision'},201)
            api.terminate();api.wait(timeout=10);api=None
            run([ROOT/'backend-go/bin/data-migrate','export',post],api_env)
            restored=output/'rollback.sqlite';run(['python3','scripts/migration/snapshot.py','restore',post,restored])
            db=sqlite3.connect(restored)
            assert db.execute('select title from investigations where tenant_id=? and id=?',(tenant,case['id'])).fetchone()[0]=='Go-era write'
            assert db.execute('select secret_ciphertext from connectors where tenant_id=? and id=?',(tenant,connector['id'])).fetchone()[0]=='rehearsal-credential'
            assert db.execute('select key_hash from api_sources where tenant_id=? and id=?',(tenant,source['source']['id'])).fetchone()[0]==hashlib.sha256(source['api_key'].encode()).hexdigest()
            assert db.execute('select status from investigation_jobs where tenant_id=? and investigation_id=?',(tenant,alert['alert']['investigation_id'])).fetchone()[0]=='queued'
            assert db.execute('select count(*) from skill_material_versions where tenant_id=?',(tenant,)).fetchone()[0]==1
            db.close()
            restored_snapshot=output/'restored.json';run(['python3','scripts/migration/snapshot.py','export',restored,restored_snapshot]);run(['python3','scripts/migration/snapshot.py','compare',post,restored_snapshot])
            fixture=output/'node-validation.json'
            fixture.write_text(json.dumps({'tenant':tenant,'case_id':case['id'],'source_id':source['source']['id'],'api_key':source['api_key'],'alert_id':alert['alert']['id'],'alert':{'external_id':'rehearsal-event','title':'Queued state','severity':'low'}}))
            run(['node','tests/backend-parity/verify-rollback.mjs','--database',restored,'--fixture',fixture])
            report={'passed':True,'source_database_modified':False,'checks':['consistent SQLite backup','invalid import atomic rollback','idempotent import','all-table canonical reconciliation','Go-era records and credentials','queued jobs and deduplication','reverse export and SQLite restore'],'private_artifacts':str(output)}
            (ROOT/'output/migration').mkdir(exist_ok=True);(ROOT/'output/migration/rehearsal.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
        finally:
            if api is not None:api.terminate();api.wait(timeout=10)
            if created:run([PG/'dropdb',name])

if __name__=='__main__':main()
