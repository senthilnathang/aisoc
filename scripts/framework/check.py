#!/usr/bin/env python3
"""Build and verify the replacement framework against a disposable PostgreSQL cluster."""
import hashlib
import argparse
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
import redis_runtime
from resource_probe import ResourceProbe

ROOT = Path(__file__).resolve().parents[2]
PG = Path(os.environ.get('AISOC_TEST_PG_BIN', '/usr/lib/postgresql/16/bin'))


def port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--with-streams',action='store_true',help='Include disposable Redis and PostgreSQL/stream bridge tests')
    parser.add_argument('--stream-load',action='store_true',help='Measure bounded synthetic traffic in isolated PostgreSQL/Redis after correctness checks')
    parser.add_argument('--stream-measure-only',action='store_true',help='Isolated measurement iteration; skips full correctness gates')
    parser.add_argument('--stream-events',type=int,default=1000,help='Synthetic event count (100..10000, multiples of 100)')
    parser.add_argument('--stream-eps',type=int,default=1000,help='Scheduled offered rate (100..1000 EPS)')
    parser.add_argument('--stream-pause-seconds',type=int,default=0,help='Pause both consumers halfway through scheduled input (0..10 seconds)')
    parser.add_argument('--stream-idle-poll-ms',type=int,default=1,help='Benchmark publisher delay after an empty claim (1..100 ms)')
    parser.add_argument('--stream-burst-multiplier',type=int,default=1,choices=range(1,6),help='Multiply offered EPS for the middle third of event batches (1..5)')
    parser.add_argument('--stream-consumer-batch',type=int,default=10,choices=range(1,101),help='Bounded fresh-event transaction batch (1..100)')
    options=parser.parse_args()
    if options.stream_load and not options.with_streams:
        parser.error('--stream-load requires --with-streams')
    if options.stream_measure_only and not options.stream_load:
        parser.error('--stream-measure-only requires --stream-load')
    if not (100 <= options.stream_events <= 10000 and options.stream_events % 100 == 0 and 100 <= options.stream_eps <= 1000 and 0 <= options.stream_pause_seconds <= 10 and 1 <= options.stream_idle_poll_ms <= 100):
        parser.error('Invalid bounded stream workload configuration')
    if not options.stream_load and (options.stream_events != 1000 or options.stream_eps != 1000 or options.stream_pause_seconds != 0 or options.stream_idle_poll_ms != 1 or options.stream_burst_multiplier != 1 or options.stream_consumer_batch != 10):
        parser.error('Stream workload options require --stream-load')
    if os.geteuid() == 0:
        raise RuntimeError('Run as an ordinary user; initdb refuses root')
    if not (PG/'initdb').exists():
        raise RuntimeError('Set AISOC_TEST_PG_BIN to the PostgreSQL binary directory')
    report = ROOT/'output/backend-framework'
    report.mkdir(parents=True, exist_ok=True)
    (report/'report.json').write_text(json.dumps({'passed':False,'status':'running','active_backend_modified':False})+'\n')
    if options.stream_load:
        for filename in ('stream-load.json','stream-load.json.cache.json','stream-load.json.resources.json'):
            (report/filename).write_text(json.dumps({'status':'not_completed'})+'\n')
    env = os.environ.copy()
    env.pop('AISOC_STREAM_LOAD_REPORT',None)
    children = []
    pg_started = False
    redis_state = None
    with tempfile.TemporaryDirectory(prefix='aisoc-go-check-') as directory, (report/'check.log').open('w') as log:
        temp = Path(directory)
        def run(args, cwd=ROOT, input=None):
            subprocess.run([str(arg) for arg in args], cwd=cwd, env=env, input=input,
                           text=True, stdout=log, stderr=log, check=True, timeout=900 if args[0]=='go' else 300)
        def spawn(args, cwd=ROOT, specialist=False):
            process_env = {key:value for key,value in env.items() if key in ('PATH','LANG','AISOC_WORKER_TOKEN','AISOC_PYTHON_ADDR','AISOC_PYTHON_HTTP_ADDR','AISOC_RUST_ADDR')} if specialist else env
            if specialist and any(str(arg).endswith('python-worker/worker.py') for arg in args):
                process_env.update({key:value for key,value in env.items() if key in ('AISOC_INFERENCE_URL','AISOC_INFERENCE_MODEL','AISOC_INFERENCE_CREDENTIAL_FILE')})
            process = subprocess.Popen([str(arg) for arg in args], cwd=cwd, env=process_env, stdout=log, stderr=log)
            children.append(process)
            return process
        def sql(statement):
            return subprocess.check_output([str(PG/'psql'), '-X', '-v', 'ON_ERROR_STOP=1', '-At'],
                env=env, input=statement, text=True, stderr=log, timeout=15).strip()
        def measure_streams():
            env['AISOC_STREAM_LOAD_EVENTS']=str(options.stream_events)
            env['AISOC_STREAM_LOAD_EPS']=str(options.stream_eps)
            env['AISOC_STREAM_LOAD_PAUSE_SECONDS']=str(options.stream_pause_seconds)
            env['AISOC_STREAM_LOAD_IDLE_POLL_MS']=str(options.stream_idle_poll_ms)
            env['AISOC_STREAM_LOAD_BURST_MULTIPLIER']=str(options.stream_burst_multiplier)
            env['AISOC_STREAM_LOAD_CONSUMER_BATCH']=str(options.stream_consumer_batch)
            env['AISOC_STREAM_LOAD_REPORT']=str(report/'stream-load.json')
            try:
                pgpid=int((temp/'pg/postmaster.pid').read_text().splitlines()[0])
                with ResourceProbe(pgpid, report/'stream-load.json.resources.json'):
                    run(['go','test','-count=1','-run','^TestStreamLoadReport$','-v','./internal/modules/telemetrypipeline'],ROOT/'backend-go')
                run(['go','test','-count=1','-run','^TestCacheLoadReport$','-v','./internal/modules/enrichment'],ROOT/'backend-go')
            finally:
                env.pop('AISOC_STREAM_LOAD_REPORT',None)
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
            # Never inherit an external Redis target into this destructive fixture suite.
            for key in list(env):
                if key.startswith('AISOC_TEST_REDIS_'): del env[key]
            if options.with_streams:
                redis_state=temp/'redis'
                redis_runtime.start(redis_state,port())
                env.update(redis_runtime.test_env(redis_state))
            password=secrets.token_hex(24)
            pwfile=temp/'password';pwfile.write_text(password);pwfile.chmod(0o600)
            pgport,apiport,pythonport,rustport,pythonhttpport=port(),port(),port(),port(),port()
            env.update(PGHOST='127.0.0.1',PGPORT=str(pgport),PGUSER='aisoc',PGPASSWORD=password,PGDATABASE='postgres')
            run([PG/'initdb','-D',temp/'pg','-U','aisoc','--auth-local=trust','--auth-host=scram-sha-256','--pwfile',pwfile])
            run([PG/'pg_ctl','-D',temp/'pg','-l',temp/'pg.log','-o',f'-h 127.0.0.1 -p {pgport} -k {temp} -c track_io_timing=on -c track_wal_io_timing=on','-w','start'])
            pg_started=True
            sql('CREATE DATABASE aisoc_go_test;')
            env['PGDATABASE']='aisoc_go_test'
            url=f'postgres://aisoc:{password}@127.0.0.1:{pgport}/aisoc_go_test?sslmode=disable'
            env.update(AISOC_GO_DATABASE_URL=url,AISOC_GO_TEST_DATABASE_URL=url,
                AISOC_GO_ADDR=f'127.0.0.1:{apiport}',AISOC_PYTHON_ADDR=f'127.0.0.1:{pythonport}',
                AISOC_PYTHON_HTTP_ADDR=f'127.0.0.1:{pythonhttpport}',
                AISOC_RUST_ADDR=f'127.0.0.1:{rustport}',AISOC_WORKER_TOKEN=secrets.token_hex(32))
            env.update(AISOC_GO_CONNECTOR_KEY=secrets.token_hex(32),AISOC_GO_AUTH_MODE='local',AISOC_GO_OPERATORS_FILE='',AISOC_GO_ENV='development',AISOC_GO_SECURE_COOKIES='false',AISOC_GO_SESSION_TTL_MS='28800000')
            for name in ('api','migrate','worker','plugin-probe','integration-probe','investigation-worker','stream-worker','stream-archive'):
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
            if options.stream_measure_only:
                measure_streams()
                (report/'report.json').write_text(json.dumps({'passed':True,'scope':'measurement_only','full_correctness_checks_run':False,'active_backend_modified':False},indent=2)+'\n')
                print('PASS isolated measurement only; full correctness gates skipped',flush=True)
                return
            # Packages install failure-injection triggers on the same audit table.
            # Serialize packages to avoid unrelated DDL locks; each package still
            # exercises concurrent domain writes with the race detector enabled.
            run(['go','test','-race','-p','1','./...'],ROOT/'backend-go')
            run(['go','vet','./...'],ROOT/'backend-go')
            if options.stream_load:
                measure_streams()
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
            wait_port(pythonhttpport)
            with urllib.request.urlopen(f'http://127.0.0.1:{pythonhttpport}/ready', timeout=5) as response:
                assert json.load(response)['transport']=='grpc'
            run([ROOT/'backend-go/bin/plugin-probe'])
            sql("BEGIN; INSERT INTO tenants(id) VALUES('framework-e2e'); INSERT INTO jobs(tenant_id,id,plugin_id,plugin_version,input) VALUES ('framework-e2e','00000000-0000-4000-8000-000000000001','python.normalize','1',convert_to('  HELLO   WORLD  ','UTF8')), ('framework-e2e','00000000-0000-4000-8000-000000000002','rust.sha256','1',convert_to('hello','UTF8')), ('framework-e2e','00000000-0000-4000-8000-000000000003','rust.wasm_ascii_upper','1',convert_to('wasm','UTF8')); COMMIT;")
            spawn([ROOT/'backend-go/bin/worker'])
            investigation_input = subprocess.check_output([str(python), '-c', "from aisoc.worker.v1.investigation_pb2 import InvestigationTask,EvidenceItem; print(InvestigationTask(tenant_id='framework-e2e',incident_id='mock-case',task_id='00000000-0000-4000-8000-000000000004',schema_version='1',mode='mock-v1',max_output_bytes=8192,evidence=[EvidenceItem(reference='mock:auth',content_hash='a'*64,event_time='2026-01-01T00:00:00Z',event_type='authentication.failed')]).SerializeToString().hex())"], cwd=ROOT/'services/python-worker', text=True, timeout=5).strip()
            assert all(c in '0123456789abcdef' for c in investigation_input)
            sql("INSERT INTO jobs(tenant_id,id,plugin_id,plugin_version,input) VALUES ('framework-e2e','00000000-0000-4000-8000-000000000004','python.investigate_mock','1',decode('" + investigation_input + "','hex'))")
            for _ in range(150):
                if sql("SELECT count(*) FROM jobs WHERE tenant_id='framework-e2e' AND state='completed'")=='4': break
                time.sleep(.1)
            else: raise RuntimeError('Durable jobs did not complete')
            values=sql("SELECT convert_from(output,'UTF8') FROM jobs WHERE tenant_id='framework-e2e' AND plugin_id<>'python.investigate_mock' ORDER BY id").splitlines()
            assert values==['hello world',hashlib.sha256(b'hello').hexdigest(),'WASM'], values
            investigation_output=sql("SELECT encode(output,'hex') FROM jobs WHERE tenant_id='framework-e2e' AND plugin_id='python.investigate_mock'")
            run([python,'-c',"import sys; from aisoc.worker.v1.investigation_pb2 import InvestigationResult; r=InvestigationResult.FromString(bytes.fromhex(sys.stdin.read())); assert r.verdict=='INCONCLUSIVE' and r.requires_human_review and r.tenant_id=='framework-e2e' and len(r.hypotheses)==2; print('PASS durable typed investigation result after Go QA')"],ROOT/'services/python-worker',input=investigation_output)
            if options.with_streams:
                scopes=temp/'stream-scopes.json'
                scopes.write_text(json.dumps([{'id':'mock-siem','operator_id':'fixture-a','tenant_id':'auth-a','connector_id':'mock-qradar','source':'qradar-siem','processor':'mock-login-v1','allow_retry':True,'allow_mock_import':True,'allow_sandbox_response':True}]))
                env.update(AISOC_GO_STREAM_OPERATIONS_FILE=str(scopes),AISOC_STREAM_REDIS_ADDR=env['AISOC_TEST_REDIS_ADDR'],AISOC_STREAM_REDIS_PUBLISHER_PASSWORD=env['AISOC_TEST_REDIS_PUBLISHER_PASSWORD'],AISOC_STREAM_REDIS_CONSUMER_PASSWORD=env['AISOC_TEST_REDIS_CONSUMER_PASSWORD'])
                api.terminate();api.wait(timeout=10)
                api=spawn([ROOT/'backend-go/bin/api']);wait_port(apiport)
                def stream_http(path, body=None, actor='a', expected=200):
                    headers={'Authorization':'Bearer parity_fixture_'+actor*40,'Content-Type':'application/json'}
                    request=urllib.request.Request('http://'+env['AISOC_GO_ADDR']+'/api/v1/stream-operations'+path,headers=headers,data=None if body is None else json.dumps(body).encode())
                    try:
                        with urllib.request.urlopen(request,timeout=10) as response: code,value=response.status,json.load(response)
                    except urllib.error.HTTPError as error: code,value=error.code,json.load(error)
                    assert code==expected,(code,expected,value)
                    return value
                assert stream_http('',actor='b')['items']==[]
                stream_http('/mock-siem',actor='b',expected=403)
                stream_http('/mock-siem/events',actor='b',expected=403)
                stream_http('/mock-siem/events?after=invalid',expected=400)
                page=stream_http('/mock-siem/mock-example')
                stream_http('/mock-siem/mock-import',page,actor='b',expected=403)
                stream_http('/mock-siem/retry-publication',{},actor='b',expected=403)
                stream_http('/mock-siem/retry-consumer',{},actor='b',expected=403)
                stream_http('/mock-siem/rebase-soar',{},actor='b',expected=403)
                stream_http('/mock-siem/mock-import',{**page,'unexpected':True},expected=400)
                stream_http('/mock-siem/mock-import',{**page,'next_cursor':'x'*(1024*1024)},expected=413)
                imported=stream_http('/mock-siem/mock-import',page,expected=202)
                assert imported['accepted']['Inserted']==4
                events_page=stream_http('/mock-siem/events')
                assert len(events_page['items'])==4 and not events_page['next_after']
                assert all(item['event']['tenant_id']=='auth-a' for item in events_page['items'])
                stream_worker=spawn([ROOT/'backend-go/bin/stream-worker'])
                for _ in range(200):
                    if sql("SELECT count(*) FROM mock_soar_notes WHERE tenant_id='auth-a' AND connector_id='mock-soar'")=='1': break
                    if stream_worker.poll() is not None: raise RuntimeError('Sandbox stream worker exited')
                    time.sleep(.1)
                else: raise RuntimeError('JSON-to-Redis-to-Python-to-mock-SOAR flow did not complete')
                page['expected_checkpoint']=imported['accepted']['Checkpoint']
                page['next_cursor']='mock-replay'
                replayed=stream_http('/mock-siem/mock-import',page,expected=202)
                assert replayed['accepted']['Inserted']==0
                stream_worker.kill();stream_worker.wait(timeout=10)
                page['expected_checkpoint']=replayed['accepted']['Checkpoint'];page['next_cursor']='mock-after-restart'
                for event in page['events']:
                    for key in ('event_id','source_event_id','evidence_ref'): event[key]+='-restart'
                    event['projection']['principal_ref']='restart-user'
                assert stream_http('/mock-siem/mock-import',page,expected=202)['accepted']['Inserted']==4
                stream_worker=spawn([ROOT/'backend-go/bin/stream-worker'])
                for _ in range(200):
                    if sql("SELECT count(*) FROM mock_soar_notes WHERE tenant_id='auth-a' AND connector_id='mock-soar'")=='2': break
                    time.sleep(.1)
                else: raise RuntimeError('Sandbox worker restart did not recover queued intake')
                observed=stream_http('/mock-siem')
                assert observed['snapshot']['accepted']==observed['snapshot']['completed']==8 and observed['snapshot']['pending']==0
                assert sql("SELECT count(*) FROM l1_escalations WHERE tenant_id='auth-a' AND state='synced'")=='2'
                (report/'sandbox-flow.json').write_text(json.dumps({'passed':True,'mode':'JSON mocks; no privileged actions','accepted':8,'replayed_insertions':0,'mock_soar_notes':2,'worker_restart_recovered':True,'tenant_denial_verified':True},indent=2)+'\n')
                action={'id':'demo-revoke','session_id':'demo-session','principal_ref':'demo-user','expected_version':1,'ticket':'TEST-REVIEW'}
                def response_op(operation, expected=200, **extra):
                    return stream_http('/mock-siem/sandbox-session',{**action,'operation':operation,**extra},expected=expected)
                stream_http('/mock-siem/sandbox-session',{**action,'operation':'create_session'},actor='b',expected=403)
                assert response_op('create_session')['version']==1
                assert response_op('propose')['state']=='proposed'
                response_op('execute',403)
                assert not response_op('dry_run')['would_execute']
                assert response_op('approve')['state']=='approved'
                response_op('execute',403) # Default kill switch remains enabled.
                response_op('policy',stopped=False)
                assert response_op('dry_run')['would_execute']
                sql("UPDATE sandbox_session_actions SET approval_expires_at=now()-interval '1 second' WHERE tenant_id='auth-a' AND id='demo-revoke'")
                response_op('execute',403)
                assert not response_op('dry_run')['would_execute']
                sql("UPDATE sandbox_session_actions SET approval_expires_at=now()+interval '1 minute' WHERE tenant_id='auth-a' AND id='demo-revoke'")
                sql("CREATE FUNCTION sandbox_audit_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='sandbox_execute' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER sandbox_audit_fail BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION sandbox_audit_fail()")
                response_op('execute',500)
                assert sql("SELECT revoked FROM sandbox_sessions WHERE tenant_id='auth-a' AND id='demo-session'")=='f'
                sql('DROP TRIGGER sandbox_audit_fail ON audit_events; DROP FUNCTION sandbox_audit_fail()')
                assert response_op('execute')['state']=='executed'
                assert response_op('execute')['replayed']
                assert response_op('create_session')['revoked'] # Never resurrect an existing session.
                response_op('policy',stopped=True)
                sql("INSERT INTO sandbox_session_actions(tenant_id,connector_id,source,id,session_id,expected_version,ticket) SELECT 'auth-a','mock-qradar','qradar-siem','capacity-'||n,'demo-session',1,'TEST' FROM generate_series(1,99) n")
                response_op('propose',409,id='capacity-overflow')
                stream_worker.terminate();stream_worker.wait(timeout=10)
            py.terminate();py.wait(timeout=10)
            modelport=port()
            model_fixture=spawn([python,ROOT/'scripts/framework/model_fixture.py','--port',str(modelport)],specialist=True)
            wait_port(modelport)
            env.update(AISOC_INFERENCE_URL=f'http://127.0.0.1:{modelport}/investigate',AISOC_INFERENCE_MODEL='fixture-v1',AISOC_PROBE_MODEL='1')
            py=spawn([python,ROOT/'services/python-worker/worker.py'],specialist=True)
            wait_port(pythonport);wait_port(pythonhttpport)
            run([ROOT/'backend-go/bin/plugin-probe'])
            env.pop('AISOC_PROBE_MODEL',None)
            for process in (py,rust,model_fixture): process.terminate();process.wait(timeout=10)
            http('/ready',200);http('/health',200)
            checks=['Go race tests and vet','PostgreSQL migration and readiness','response library HTTP parity and restart persistence','manual cases and runbook HTTP parity, concurrency and restart persistence','source intake, mapping, metrics and credential transaction checks','three-phase investigation worker HTTP parity, explicit retry, concurrent workers and SIGKILL rollback/recovery','operator/session/CSRF and tenant HTTP parity including case runbooks','response and case audit failure rollback, foreign keys and cascade','transaction rollback, concurrent claim, lease recovery, stale/cross-tenant/cancelled result rejection','Python and Rust unit tests','Go to Python/Rust RPC outputs and bad credential rejection','durable Go jobs dispatch to both workers','core readiness independent of optional workers']
            checks += ['Skills authoring/material revisions, matching, suggestions, applications, feedback and outcomes', 'all 11 shared functional scenarios', 'bounded WASM transformation and Python subprocess cleanup', 'HTTP error/latency, pool and queue metrics']
            checks += ['FastAPI lifecycle with authenticated standard gRPC readiness and Go-to-Python execution']
            if options.with_streams:
                checks += ['Authenticated scoped JSON import, Redis delivery, typed Python investigation, Go QA, mock SOAR notes, replay idempotency and real stream-worker SIGKILL/restart']
                checks += ['Redis ACLs, stream delivery/ACK/reclaim/gap reporting and PostgreSQL outbox/inbox duplicate-effect prevention',
                           'Durable consumer retries and DLQ, DLQ outage without ACK, bounded atomic publish/OOM backpressure, stalled TCP recovery, missing-stream replay, poison isolation and stale consumer fencing']
            (report/'report.json').write_text(json.dumps({'passed':True,'checks':checks,'active_backend_modified':False},indent=2)+'\n')
            print('PASS isolated Go + PostgreSQL + Rust + Python framework',flush=True)
            print('Report: '+str(report/'report.json'),flush=True)
        finally:
            for process in reversed(children):
                if process.poll() is None:
                    process.terminate()
                    try: process.wait(timeout=10)
                    except subprocess.TimeoutExpired: process.kill();process.wait()
            try:
                if pg_started:
                    run([PG/'pg_ctl','-D',temp/'pg','-m','fast','-w','stop'])
            finally:
                if redis_state is not None:
                    redis_runtime.stop(redis_state)


if __name__=='__main__': main()
