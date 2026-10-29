#!/usr/bin/env python3
"""Sequential, disposable Node/Go campaign including PostgreSQL resource samples."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import tempfile
import time
import urllib.request

ROOT=Path(__file__).resolve().parents[2]
PG=Path('/usr/lib/postgresql/16/bin')

def port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1',0));return sock.getsockname()[1]

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--controlled',action='store_true',help='Use the same two-CPU affinity and token authentication for both stacks')
    parser.add_argument('--output-dir',type=Path,help='Separate report directory, preserving previous release evidence')
    parser.add_argument('--sizes',choices=['small','large','small,large'],default='small,large')
    parser.add_argument('--repeats',type=int,choices=range(1,11),default=3)
    parser.add_argument('--postgres-diagnostics',action='store_true',help='Retain slow statement timing and WAL I/O timing from disposable PostgreSQL')
    args=parser.parse_args()
    affinity=sorted(os.sched_getaffinity(0))
    if args.controlled:
        if len(affinity)<2:raise RuntimeError('Two allowed CPUs required')
        os.sched_setaffinity(0,affinity[:2])
    os.umask(0o077)
    out=(args.output_dir or ROOT/'output/backend-performance'/('controlled' if args.controlled else 'observational')).resolve();out.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='aisoc-benchmark-') as temporary, (out/'campaign.log').open('w') as log:
        temp=Path(temporary);env=dict(os.environ);processes=[];started=False
        def run(args,cwd=ROOT):
            subprocess.run([str(a) for a in args],cwd=cwd,env=env,stdout=log,stderr=log,check=True)
        common=['--requests','3000','--concurrency','8']
        if args.controlled:common+=['--auth','token']
        try:
            for name in ('api','migrate','investigation-worker'):
                run(['go','build','-o','bin/'+name,'./cmd/'+name],ROOT/'backend-go')
            run(['node','tests/backend-performance/run.mjs',*common,'--sizes',args.sizes,'--repeats',str(args.repeats),'--label','node','--output',out/'node-campaign.json'])
            password=secrets.token_hex(24);pw=temp/'password';pw.write_text(password)
            pgport,apiport=port(),port()
            env.update(PGHOST='127.0.0.1',PGPORT=str(pgport),PGUSER='aisoc',PGPASSWORD=password,PGDATABASE='postgres')
            run([PG/'initdb','-D',temp/'pg','-U','aisoc','--auth-local=trust','--auth-host=scram-sha-256','--pwfile',pw])
            pg_options=f'-h 127.0.0.1 -p {pgport} -k {temp}'
            if args.postgres_diagnostics:
                pg_options+=' -c log_min_duration_statement=50 -c log_parameter_max_length=0 -c track_wal_io_timing=on -c track_io_timing=on'
            run([PG/'pg_ctl','-D',temp/'pg','-l',temp/'postgres.log','-o',pg_options,'-w','start']);started=True
            env.update(AISOC_GO_DATABASE_URL=f'postgres://aisoc:{password}@127.0.0.1:{pgport}/aisoc_go_benchmark?sslmode=disable',AISOC_GO_ADDR=f'127.0.0.1:{apiport}',AISOC_GO_AUTH_MODE='local',AISOC_GO_ENV='development',AISOC_GO_OPERATORS_FILE='',AISOC_GO_CONNECTOR_KEY=secrets.token_hex(32),AISOC_PYTHON_ADDR='',AISOC_RUST_ADDR='',AISOC_WORKER_TOKEN='')
            if args.controlled:
                operators=temp/'operators.json'
                operators.write_text(json.dumps([{'id':'fixture-'+key,'tenant_id':'auth-'+key,'token_hash':hashlib.sha256(('parity_fixture_'+key*40).encode()).hexdigest()} for key in ('a','b')]))
                env.update(AISOC_GO_AUTH_MODE='token',AISOC_GO_OPERATORS_FILE=str(operators))
            base=f'http://127.0.0.1:{apiport}'
            postmaster=int((temp/'pg/postmaster.pid').read_text().splitlines()[0])
            combined=None
            for size in args.sizes.split(','):
                for repeat in range(args.repeats):
                    run([PG/'createdb','aisoc_go_benchmark'])
                    run([ROOT/'backend-go/bin/migrate'])
                    for name in ('api','investigation-worker'):
                        processes.append(subprocess.Popen([str(ROOT/'backend-go/bin'/name)],env=env,cwd=ROOT,stdout=log,stderr=log))
                    for _ in range(100):
                        try:
                            with urllib.request.urlopen(base+'/ready',timeout=2) as response:
                                if response.status==200:break
                        except OSError:time.sleep(.1)
                    else:raise RuntimeError('Go benchmark API not ready')
                    core=','.join(str(p.pid) for p in processes)
                    pids=core+','+str(postmaster)
                    single=out/f'go-{size}-{repeat+1}.json'
                    run(['node','tests/backend-performance/run.mjs',*common,'--repeats','1','--sizes',size,'--url',base,'--allow-fixture-writes','--pids',pids,'--core-pids',core,'--process-roots','--label','go-whole-stack','--output',single])
                    result=json.loads(single.read_text());result['reports'][0]['repeat']=repeat+1
                    if args.postgres_diagnostics:
                        diagnostic=subprocess.check_output([str(PG/'psql'),'-X','-At','-c',"SELECT json_build_object('wal', (SELECT row_to_json(w) FROM pg_stat_wal w), 'settings', (SELECT json_object_agg(name,setting) FROM pg_settings WHERE name IN ('fsync','synchronous_commit','full_page_writes','shared_buffers','max_connections','wal_sync_method','track_wal_io_timing')))"] ,env=env,text=True)
                        (out/f'postgres-{size}-{repeat+1}.json').write_text(diagnostic)
                        with urllib.request.urlopen(base+'/metrics',timeout=5) as response:
                            (out/f'metrics-{size}-{repeat+1}.json').write_bytes(response.read())
                    if combined is None:combined={**result,'reports':[]}
                    combined['reports']+=result['reports']
                    for process in reversed(processes):process.terminate();process.wait(timeout=10)
                    processes.clear()
                    run([PG/'dropdb','aisoc_go_benchmark'])
            (out/'go-campaign.json').write_text(json.dumps(combined,indent=2)+'\n')
            run(['node','tests/backend-performance/compare.mjs','--before',out/'node-campaign.json','--after',out/'go-campaign.json','--output',out/'campaign-comparison.json'])
            metadata={'scope':'Node API + in-process worker + SQLite versus Go API + investigation worker + dedicated PostgreSQL and child processes','optional_workers':'disabled for both; core workload needs neither','worker_interval_ms':100,'cpu_affinity':sorted(os.sched_getaffinity(0)),'auth':'token' if args.controlled else 'local','fresh_database_per_repeat':True,'host_limits':'same inherited host/cgroup; affinity includes load generator; CPUs are not reserved from other host processes','rss_note':'Summed process RSS double-counts PostgreSQL shared pages; not proportional-set-size.','gate':'Check per-operation latency and resource results; intake soak is separate.'}
            (out/'campaign-environment.json').write_text(json.dumps(metadata,indent=2)+'\n')
            print(f'Campaign complete: {out}/campaign-comparison.json')
        finally:
            for process in reversed(processes):
                process.terminate()
                try:process.wait(timeout=10)
                except subprocess.TimeoutExpired:process.kill();process.wait()
            if started:
                run([PG/'pg_ctl','-D',temp/'pg','-m','fast','-w','stop'])
                if args.postgres_diagnostics:shutil.copyfile(temp/'postgres.log',out/'postgres.log')

if __name__=='__main__':main()
