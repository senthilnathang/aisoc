#!/usr/bin/env python3
"""Build and verify the replacement framework against a disposable PostgreSQL cluster."""
import hashlib
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
PG = Path(os.environ.get('AISOC_TEST_PG_BIN', '/usr/lib/postgresql/16/bin'))


def port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


def main():
    if os.geteuid() == 0:
        raise RuntimeError('Run as an ordinary user; initdb refuses root')
    if not (PG/'initdb').exists():
        raise RuntimeError('Set AISOC_TEST_PG_BIN to the PostgreSQL binary directory')
    report = ROOT/'output/backend-framework'
    report.mkdir(parents=True, exist_ok=True)
    (report/'report.json').write_text(json.dumps({'passed':False,'status':'running','active_backend_modified':False})+'\n')
    env = os.environ.copy()
    children = []
    pg_started = False
    with tempfile.TemporaryDirectory(prefix='aisoc-go-check-') as directory, (report/'check.log').open('w') as log:
        temp = Path(directory)
        def run(args, cwd=ROOT, input=None):
            subprocess.run([str(arg) for arg in args], cwd=cwd, env=env, input=input,
                           text=True, stdout=log, stderr=log, check=True, timeout=900 if args[0]=='go' else 300)
        def spawn(args, cwd=ROOT, specialist=False):
            process_env = {key:value for key,value in env.items() if key in ('PATH','LANG','AISOC_WORKER_TOKEN','AISOC_PYTHON_ADDR','AISOC_RUST_ADDR')} if specialist else env
            process = subprocess.Popen([str(arg) for arg in args], cwd=cwd, env=process_env, stdout=log, stderr=log)
            children.append(process)
            return process
        def sql(statement):
            return subprocess.check_output([str(PG/'psql'), '-X', '-v', 'ON_ERROR_STOP=1', '-At'],
                env=env, input=statement, text=True, stderr=log, timeout=15).strip()
        def wait_port(number):
            for _ in range(100):
                try:
                    with socket.create_connection(('127.0.0.1', number), timeout=.2): return
                except OSError: time.sleep(.1)
            raise RuntimeError('Framework process failed to listen; see check.log')
        def http(path, expected, headers=None):
            try:
                request=urllib.request.Request('http://'+env['AISOC_GO_ADDR']+path,headers=headers or {})
                with urllib.request.urlopen(request, timeout=5) as response:
                    code, body = response.status, response.read()
            except urllib.error.HTTPError as error:
                code, body = error.code, error.read()
            assert code == expected, (path, code, expected)
            return json.loads(body)
        try:
            password=secrets.token_hex(24)
            pwfile=temp/'password';pwfile.write_text(password);pwfile.chmod(0o600)
            pgport,apiport,pythonport,rustport=port(),port(),port(),port()
            env.update(PGHOST='127.0.0.1',PGPORT=str(pgport),PGUSER='aisoc',PGPASSWORD=password,PGDATABASE='postgres')
            run([PG/'initdb','-D',temp/'pg','-U','aisoc','--auth-local=trust','--auth-host=scram-sha-256','--pwfile',pwfile])
            run([PG/'pg_ctl','-D',temp/'pg','-l',temp/'pg.log','-o',f'-h 127.0.0.1 -p {pgport} -k {temp}','-w','start'])
            pg_started=True
            sql('CREATE DATABASE aisoc_go_test;')
            env['PGDATABASE']='aisoc_go_test'
            url=f'postgres://aisoc:{password}@127.0.0.1:{pgport}/aisoc_go_test?sslmode=disable'
            env.update(AISOC_GO_DATABASE_URL=url,AISOC_GO_TEST_DATABASE_URL=url,
                AISOC_GO_ADDR=f'127.0.0.1:{apiport}',AISOC_PYTHON_ADDR=f'127.0.0.1:{pythonport}',
                AISOC_RUST_ADDR=f'127.0.0.1:{rustport}',AISOC_WORKER_TOKEN=secrets.token_hex(32))
            env.update(AISOC_GO_CONNECTOR_KEY=secrets.token_hex(32),AISOC_GO_AUTH_MODE='local',AISOC_GO_OPERATORS_FILE='',AISOC_GO_ENV='development',AISOC_GO_SECURE_COOKIES='false',AISOC_GO_SESSION_TTL_MS='28800000')
            for name in ('api','migrate','worker','plugin-probe','investigation-worker'):
                run(['go','build','-o','bin/'+name,'./cmd/'+name], ROOT/'backend-go')
            run(['cargo','test','--locked','--manifest-path','services/wasm-worker/Cargo.toml'])
            run(['cargo','build','--locked','--manifest-path','services/wasm-worker/Cargo.toml'])
            python=ROOT/'services/python-worker/.venv/bin/python'
            run([python,'-m','unittest','-v'],ROOT/'services/python-worker')
            api=spawn([ROOT/'backend-go/bin/api']);wait_port(apiport)
            http('/health',200);http('/ready',503)
            run([ROOT/'backend-go/bin/migrate'])
            http('/ready',200);http('/api/v1/investigations',200)
            metrics=http('/metrics',200)
            assert metrics['database_pool']['maximum']==8
            assert metrics['investigation_jobs']['active']==0
            # Packages install failure-injection triggers on the same audit table.
            # Serialize packages to avoid unrelated DDL locks; each package still
            # exercises concurrent domain writes with the race detector enabled.
            run(['go','test','-race','-p','1','./...'],ROOT/'backend-go')
            run(['go','vet','./...'],ROOT/'backend-go')
            run(['node','tests/backend-parity/response-library.mjs','--url','http://'+env['AISOC_GO_ADDR'],'--allow-fixture-writes','--label','go','--output','output/backend-parity/go-response-library.json'])
            run(['node','tests/backend-parity/case-runbooks.mjs','--url','http://'+env['AISOC_GO_ADDR'],'--allow-fixture-writes','--label','go','--output','output/backend-parity/go-case-runbooks.json'])
            saved=json.loads((ROOT/'output/backend-parity/go-case-runbooks.json').read_text())['persistence_fixture']
            run(['node','tests/backend-parity/response-validation.mjs','--url','http://'+env['AISOC_GO_ADDR'],'--allow-fixture-writes','--label','go','--output','output/backend-parity/go-response-validation.json'])
            run(['node','tests/backend-parity/response-errors.mjs','--url','http://'+env['AISOC_GO_ADDR'],'--allow-fixture-writes','--label','go','--output','output/backend-parity/go-response-errors.json'])
            run(['node','tests/backend-parity/case-scalars.mjs','--url','http://'+env['AISOC_GO_ADDR'],'--allow-fixture-writes','--label','go','--output','output/backend-parity/go-case-scalars.json'])
            run(['node','tests/backend-parity/case-edits.mjs','--url','http://'+env['AISOC_GO_ADDR'],'--allow-fixture-writes','--label','go','--output','output/backend-parity/go-case-edits.json'])
            edits=json.loads((ROOT/'output/backend-parity/go-case-edits.json').read_text())['persistence_fixture']
            edits_path='/api/v1/investigations/'+edits['case_id']
            edits_before=http(edits_path,200,{'x-tenant-id':edits['tenant']})
            run(['node','tests/backend-parity/detection-rules.mjs','--url','http://'+env['AISOC_GO_ADDR'],'--allow-fixture-writes','--label','go','--output','output/backend-parity/go-detection-rules.json'])
            detection=json.loads((ROOT/'output/backend-parity/go-detection-rules.json').read_text())['persistence_fixture']
            detection_path='/api/v1/detection-rules/'+detection['rule_id']
            detection_before=http(detection_path,200,{'x-tenant-id':detection['tenant']})
            run(['node','tests/backend-parity/detection-registry.mjs','--url','http://'+env['AISOC_GO_ADDR'],'--allow-fixture-writes','--label','go','--output','output/backend-parity/go-detection-registry.json'])
            registry=json.loads((ROOT/'output/backend-parity/go-detection-registry.json').read_text())['persistence_fixture']
            registry_path='/api/v1/detection-registry?sort=name&direction=asc'
            registry_before=http(registry_path,200,{'x-tenant-id':registry['tenant']})
            run(['node','tests/backend-parity/api-sources.mjs','--url','http://'+env['AISOC_GO_ADDR'],'--allow-fixture-writes','--label','go','--output','output/backend-parity/go-api-sources.json'])
            source=json.loads((ROOT/'output/backend-parity/go-api-sources.json').read_text())['persistence_fixture']
            source_path='/api/v1/api-sources/'+source['source_id']
            source_before=http(source_path,200,{'x-tenant-id':source['tenant']})
            run(['node','tests/backend-parity/source-mapping.mjs','--url','http://'+env['AISOC_GO_ADDR'],'--allow-fixture-writes','--label','go','--output','output/backend-parity/go-source-mapping.json'])
            mapping=json.loads((ROOT/'output/backend-parity/go-source-mapping.json').read_text())['persistence_fixture']
            mapping_path='/api/v1/api-sources/'+mapping['source_id']
            mapping_before=http(mapping_path,200,{'x-tenant-id':mapping['tenant']})
            run(['node','tests/backend-parity/alert-intake.mjs','--url','http://'+env['AISOC_GO_ADDR'],'--allow-fixture-writes','--label','go','--output','output/backend-parity/go-alert-intake.json'])
            intake=json.loads((ROOT/'output/backend-parity/go-alert-intake.json').read_text())['persistence_fixture']
            intake_paths=['/api/v1/alerts/'+intake['alert_id'],'/api/v1/investigations/'+intake['case_id'],'/api/v1/detection-rules/'+intake['rule_id']]
            intake_before=[http(path,200,{'x-tenant-id':intake['tenant']}) for path in intake_paths]
            run(['node','tests/backend-parity/investigation-queue.mjs','--url','http://'+env['AISOC_GO_ADDR'],'--allow-fixture-writes','--label','go','--output','output/backend-parity/go-investigation-queue.json'])
            queue=json.loads((ROOT/'output/backend-parity/go-investigation-queue.json').read_text())['persistence_fixture']
            queue_before=http('/api/v1/investigation-queue',200,{'x-tenant-id':queue['tenant']})
            run(['node','tests/backend-parity/operator-alerts.mjs','--url','http://'+env['AISOC_GO_ADDR'],'--allow-fixture-writes','--label','go','--output','output/backend-parity/go-operator-alerts.json'])
            operator_alert=json.loads((ROOT/'output/backend-parity/go-operator-alerts.json').read_text())['persistence_fixture']
            operator_alert_path='/api/v1/alerts/'+operator_alert['alert_id']
            operator_alert_before=http(operator_alert_path,200,{'x-tenant-id':operator_alert['tenant']})
            run(['node','tests/backend-parity/skills-authoring.mjs','--url','http://'+env['AISOC_GO_ADDR'],'--allow-fixture-writes','--label','go','--output','output/backend-parity/go-skills-authoring.json'])
            skill=json.loads((ROOT/'output/backend-parity/go-skills-authoring.json').read_text())['persistence_fixture']
            skill_path='/api/v1/skills/'+skill['skill_id']
            skill_before=http(skill_path,200,{'x-tenant-id':skill['tenant']})
            run(['node','tests/backend-parity/dashboard.mjs','--url','http://'+env['AISOC_GO_ADDR'],'--allow-fixture-writes','--label','go','--output','output/backend-parity/go-dashboard.json'])
            dashboard=json.loads((ROOT/'output/backend-parity/go-dashboard.json').read_text())['persistence_fixture']
            dashboard_before=http('/api/v1/dashboard',200,{'x-tenant-id':dashboard['tenant']})
            run(['node','tests/backend-parity/connectors.mjs','--url','http://'+env['AISOC_GO_ADDR'],'--allow-fixture-writes','--label','go','--output','output/backend-parity/go-connectors.json'])
            connector=json.loads((ROOT/'output/backend-parity/go-connectors.json').read_text())['persistence_fixture']
            connector_path='/api/v1/connectors/'+connector['connector_id']
            connector_before=http(connector_path,200,{'x-tenant-id':connector['tenant']})
            run(['node','tests/backend-parity/hunts.mjs','--url','http://'+env['AISOC_GO_ADDR'],'--allow-fixture-writes','--label','go','--output','output/backend-parity/go-hunts.json'])
            hunt=json.loads((ROOT/'output/backend-parity/go-hunts.json').read_text())['persistence_fixture']
            hunt_path='/api/v1/hunts/'+hunt['hunt_id']
            hunt_before=http(hunt_path,200,{'x-tenant-id':hunt['tenant']})
            run(['node','tests/backend-parity/threat-intelligence.mjs','--url','http://'+env['AISOC_GO_ADDR'],'--allow-fixture-writes','--label','go','--output','output/backend-parity/go-threat-intelligence.json'])
            threat=json.loads((ROOT/'output/backend-parity/go-threat-intelligence.json').read_text())['persistence_fixture']
            threat_path='/api/v1/threat-intel-reports/'+threat['report_id']
            threat_before=http(threat_path,200,{'x-tenant-id':threat['tenant']})
            run(['node','tests/backend-parity/detection-intelligence.mjs','--url','http://'+env['AISOC_GO_ADDR'],'--allow-fixture-writes','--label','go','--output','output/backend-parity/go-detection-intelligence.json'])
            intelligence=json.loads((ROOT/'output/backend-parity/go-detection-intelligence.json').read_text())['persistence_fixture']
            intelligence_before=http('/api/v1/detection-intelligence',200,{'x-tenant-id':intelligence['tenant']})
            run(['node','tests/backend-parity/case-activity.mjs','--url','http://'+env['AISOC_GO_ADDR'],'--allow-fixture-writes','--label','go','--output','output/backend-parity/go-case-activity.json'])
            activity=json.loads((ROOT/'output/backend-parity/go-case-activity.json').read_text())['persistence_fixture']
            activity_path='/api/v1/investigations/'+activity['case_id']
            activity_before=http(activity_path,200,{'x-tenant-id':activity['tenant']})
            runbook_path='/api/v1/investigations/'+saved['case_id']+'/runbooks'
            runbook_before=http(runbook_path,200,{'x-tenant-id':saved['tenant']})
            identity=json.loads(sql("SELECT json_build_array(tenant_id,id)::text FROM response_plans ORDER BY ordinal LIMIT 1"))
            persisted=http('/api/v1/response-plans/'+identity[1],200,{'x-tenant-id':identity[0]})
            api.terminate();api.wait(timeout=10)
            api=spawn([ROOT/'backend-go/bin/api']);wait_port(apiport)
            assert http('/api/v1/response-plans/'+identity[1],200,{'x-tenant-id':identity[0]})==persisted
            assert http(runbook_path,200,{'x-tenant-id':saved['tenant']})==runbook_before
            assert http(activity_path,200,{'x-tenant-id':activity['tenant']})==activity_before
            assert http(edits_path,200,{'x-tenant-id':edits['tenant']})==edits_before
            assert http(detection_path,200,{'x-tenant-id':detection['tenant']})==detection_before
            assert http(registry_path,200,{'x-tenant-id':registry['tenant']})==registry_before
            assert http(source_path,200,{'x-tenant-id':source['tenant']})==source_before
            assert http(mapping_path,200,{'x-tenant-id':mapping['tenant']})==mapping_before
            assert [http(path,200,{'x-tenant-id':intake['tenant']}) for path in intake_paths]==intake_before
            assert http('/api/v1/investigation-queue',200,{'x-tenant-id':queue['tenant']})==queue_before
            assert http(operator_alert_path,200,{'x-tenant-id':operator_alert['tenant']})==operator_alert_before
            assert http(skill_path,200,{'x-tenant-id':skill['tenant']})==skill_before
            assert http('/api/v1/dashboard',200,{'x-tenant-id':dashboard['tenant']})==dashboard_before
            assert http(connector_path,200,{'x-tenant-id':connector['tenant']})==connector_before
            assert http(hunt_path,200,{'x-tenant-id':hunt['tenant']})==hunt_before
            assert http(threat_path,200,{'x-tenant-id':threat['tenant']})==threat_before
            assert http('/api/v1/detection-intelligence',200,{'x-tenant-id':intelligence['tenant']})==intelligence_before
            # Kill a real worker while its first phase is blocked inside the
            # step insert. Terminating the orphaned DB session releases the test
            # sleep immediately; all phase writes must roll back.
            intake_tenant=intake['tenant'].replace("'","''")
            intake_case=intake['case_id'].replace("'","''")
            sql(f"CREATE FUNCTION framework_pause_phase() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.tenant_id='{intake_tenant}' AND NEW.investigation_id='{intake_case}' THEN PERFORM pg_sleep(30); END IF; RETURN NEW; END $$; CREATE TRIGGER framework_pause_phase BEFORE INSERT ON investigation_steps FOR EACH ROW EXECUTE FUNCTION framework_pause_phase();")
            crashed=spawn([ROOT/'backend-go/bin/investigation-worker'])
            blocked_pid=None
            for _ in range(200):
                blocked=sql("SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND wait_event='PgSleep' AND query LIKE 'INSERT INTO investigation_steps%' LIMIT 1")
                if blocked: blocked_pid=int(blocked);break
                time.sleep(.1)
            if blocked_pid is None: raise RuntimeError('Investigation worker did not reach interrupted phase')
            crashed.kill();crashed.wait(timeout=10)
            sql(f'SELECT pg_terminate_backend({blocked_pid});')
            sql('DROP FUNCTION framework_pause_phase() CASCADE;')
            assert sql(f"SELECT phase FROM investigation_jobs WHERE tenant_id='{intake_tenant}' AND investigation_id='{intake_case}'")=='0'
            assert sql(f"SELECT count(*) FROM case_records WHERE tenant_id='{intake_tenant}' AND investigation_id='{intake_case}'")=='0'
            assert sql(f"SELECT count(*) FROM investigation_steps WHERE tenant_id='{intake_tenant}' AND investigation_id='{intake_case}'")=='0'
            investigators=[spawn([ROOT/'backend-go/bin/investigation-worker']) for _ in range(2)]
            run(['node','tests/backend-parity/investigation-worker.mjs','--url','http://'+env['AISOC_GO_ADDR'],'--allow-fixture-writes','--label','go','--output','output/backend-parity/go-investigation-worker.json'])
            run(['node','tests/backend-parity/run.mjs','--url','http://'+env['AISOC_GO_ADDR'],'--allow-fixture-writes','--label','go','--output','output/backend-parity/go-full.json'])
            processed=json.loads((ROOT/'output/backend-parity/go-investigation-worker.json').read_text())['persistence_fixture']
            processed_path='/api/v1/investigations/'+processed['case_id']
            processed_before=http(processed_path,200,{'x-tenant-id':processed['tenant']})
            recovered=http('/api/v1/investigations/'+intake['case_id'],200,{'x-tenant-id':intake['tenant']})
            assert recovered['jobs'][0]['status']=='completed' and len(recovered['steps'])==3
            for investigator in investigators: investigator.terminate();investigator.wait(timeout=10)
            api.terminate();api.wait(timeout=10)
            operators=temp/'operators.json'
            operators.write_text(json.dumps([{'id':'fixture-'+key,'tenant_id':'auth-'+key,'token_hash':hashlib.sha256(('parity_fixture_'+key*40).encode()).hexdigest()} for key in ('a','b')]))
            operators.chmod(0o600)
            env.update(AISOC_GO_AUTH_MODE='token',AISOC_GO_OPERATORS_FILE=str(operators))
            api=spawn([ROOT/'backend-go/bin/api']);wait_port(apiport)
            # Token-mode fixture cannot read the local processing tenant. Verify
            # persisted state through SQL and the earlier local-mode snapshot.
            assert sql(f"SELECT count(*) FROM investigation_steps WHERE tenant_id='{processed['tenant']}' AND investigation_id='{processed['case_id']}'")==str(len(processed_before['steps']))
            run(['node','tests/backend-parity/response-auth.mjs','--with-cases','--url','http://'+env['AISOC_GO_ADDR'],'--allow-fixture-writes','--label','go','--output','output/backend-parity/go-response-auth.json'])
            py=spawn([python,ROOT/'services/python-worker/worker.py'],specialist=True)
            rust=spawn([ROOT/'services/wasm-worker/target/debug/aisoc-wasm-worker'],specialist=True)
            wait_port(pythonport);wait_port(rustport)
            run([ROOT/'backend-go/bin/plugin-probe'])
            sql("BEGIN; INSERT INTO tenants(id) VALUES('framework-e2e'); INSERT INTO jobs(tenant_id,id,plugin_id,plugin_version,input) VALUES ('framework-e2e','00000000-0000-4000-8000-000000000001','python.normalize','1',convert_to('  HELLO   WORLD  ','UTF8')), ('framework-e2e','00000000-0000-4000-8000-000000000002','rust.sha256','1',convert_to('hello','UTF8')), ('framework-e2e','00000000-0000-4000-8000-000000000003','rust.wasm_ascii_upper','1',convert_to('wasm','UTF8')); COMMIT;")
            spawn([ROOT/'backend-go/bin/worker'])
            for _ in range(150):
                if sql("SELECT count(*) FROM jobs WHERE tenant_id='framework-e2e' AND state='completed'")=='3': break
                time.sleep(.1)
            else: raise RuntimeError('Durable jobs did not complete')
            values=sql("SELECT convert_from(output,'UTF8') FROM jobs WHERE tenant_id='framework-e2e' ORDER BY id").splitlines()
            assert values==['hello world',hashlib.sha256(b'hello').hexdigest(),'WASM'], values
            for process in (py,rust): process.terminate();process.wait(timeout=10)
            http('/ready',200);http('/health',200)
            checks=['Go race tests and vet','PostgreSQL migration and readiness','response library HTTP parity and restart persistence','manual cases and runbook HTTP parity, concurrency and restart persistence','source intake, mapping, metrics and credential transaction checks','three-phase investigation worker HTTP parity, explicit retry, concurrent workers and SIGKILL rollback/recovery','operator/session/CSRF and tenant HTTP parity including case runbooks','response and case audit failure rollback, foreign keys and cascade','transaction rollback, concurrent claim, lease recovery, stale/cross-tenant/cancelled result rejection','Python and Rust unit tests','Go to Python/Rust RPC outputs and bad credential rejection','durable Go jobs dispatch to both workers','core readiness independent of optional workers']
            checks += ['Skills authoring/material revisions, matching, suggestions, applications, feedback and outcomes', 'all 11 shared functional scenarios', 'bounded WASM transformation and Python subprocess cleanup', 'HTTP error/latency, pool and queue metrics']
            (report/'report.json').write_text(json.dumps({'passed':True,'checks':checks,'active_backend_modified':False},indent=2)+'\n')
            print('PASS isolated Go + PostgreSQL + Rust + Python framework',flush=True)
            print('Report: '+str(report/'report.json'),flush=True)
        finally:
            for process in reversed(children):
                if process.poll() is None:
                    process.terminate()
                    try: process.wait(timeout=10)
                    except subprocess.TimeoutExpired: process.kill();process.wait()
            if pg_started:
                run([PG/'pg_ctl','-D',temp/'pg','-m','fast','-w','stop'])


if __name__=='__main__': main()
