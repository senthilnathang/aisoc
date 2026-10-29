#!/usr/bin/env python3
"""Evaluate recorded release evidence; never changes application routing."""
import hashlib
import json
from pathlib import Path
import statistics
from manage import ROOT

def source_digest():
    paths=[]
    for directory in ('backend-go/cmd','backend-go/internal','backend-go/migrations','services/wasm-worker/src','services/python-worker/aisoc','frontend/src','scripts/runtime'):
        paths.extend(p for p in (ROOT/directory).rglob('*') if p.is_file() and p.suffix in ('.go','.sql','.rs','.py','.jsx','.js','.css'))
    paths.extend((ROOT/'services/python-worker').glob('*.py'))
    paths.extend(ROOT/name for name in ('backend-go/go.mod','backend-go/go.sum','services/wasm-worker/Cargo.toml','services/wasm-worker/Cargo.lock','services/python-worker/requirements.txt','frontend/package.json','frontend/package-lock.json','frontend/vite.config.js','run.sh','contracts/plugins.json'))
    digest=hashlib.sha256()
    for path in sorted(set(paths)):
        digest.update(str(path.relative_to(ROOT)).encode()+b'\0'+path.read_bytes()+b'\0')
    return digest.hexdigest()

def evaluate():
    checks=[];failures=[]
    def record(name,condition):
        checks.append({'check':name,'passed':bool(condition)})
        if not condition:failures.append(name)
    def read(path):
        try:return json.loads((ROOT/path).read_text())
        except (OSError,ValueError):return {}
    for name,path in [
        ('full framework regression','output/backend-framework/report.json'),
        ('SQLite/PostgreSQL reconciliation','output/migration/rehearsal.json'),
        ('PostgreSQL restore fingerprints','output/migration/postgres-restore.json'),
        ('release backup and restored readiness','output/migration/release-backup.json'),
        ('Node boots Go-era rollback and source keys','output/migration/node-rollback.json'),
        ('proxy cutover and post-write rollback rehearsal','output/migration/cutover-rehearsal.json'),
        ('desktop/mobile screen rendering','output/playwright/go-journey-review.json'),
        ('browser token/session/CSRF flows','output/playwright/go-token-review.json'),
        ('browser response authoring/conflicts','output/playwright/go-editor-review.json')]:
        record(name,read(path).get('passed') is True)
    routes=read('contracts/go-implementation.json')
    record('all 97 routes implemented',len(routes.get('routes',routes.get('implemented',{})))==97)
    implementation=[p for folder in ('backend-go/cmd','backend-go/internal','backend-go/migrations','services/wasm-worker/src') for p in (ROOT/folder).rglob('*') if p.is_file() and p.suffix in ('.go','.rs','.sql')]
    implementation += [ROOT/'backend-go/go.mod',ROOT/'backend-go/go.sum',ROOT/'services/wasm-worker/Cargo.lock',*list((ROOT/'services/python-worker').glob('*.py'))]
    regression=ROOT/'output/backend-framework/report.json'
    record('regression evidence newer than implementation',regression.exists() and regression.stat().st_mtime>=max(p.stat().st_mtime for p in implementation))
    soak=read('output/backend-performance/soak.json')
    record('ten-minute soak and worker crash recovery',soak.get('passed') and soak.get('duration_seconds',0)>=600 and soak.get('worker_sigkill_recovered') and soak.get('post_soak_reverse_export_reconciled'))
    try:go=(ROOT/'output/backend-framework/go-vulnerabilities.txt').read_text()
    except OSError:go=''
    record('Go vulnerability scan','No vulnerabilities found.' in go and 'Vulnerability #' not in go)
    rust=read('output/backend-framework/rust-vulnerabilities.json')
    record('Rust vulnerability scan',rust.get('vulnerabilities',{}).get('found') is False and not rust.get('warnings'))
    python=read('output/backend-framework/python-vulnerabilities.json')
    record('Python vulnerability scan',bool(python.get('dependencies')) and all(not row.get('vulns') for row in python['dependencies']))
    frontend=read('output/backend-framework/frontend-vulnerabilities.json')
    record('frontend dependency scan',frontend.get('metadata',{}).get('vulnerabilities',{}).get('total')==0)
    before=read('output/backend-performance/controlled/node-campaign.json');after=read('output/backend-performance/controlled/go-campaign.json')
    record('matching benchmark workloads',bool(before.get('fixture_fingerprint')) and before.get('fixture_fingerprint')==after.get('fixture_fingerprint'))
    for size in ('small','large'):
        old=[r for r in before.get('reports',[]) if r['size']==size];new=[r for r in after.get('reports',[]) if r['size']==size]
        record(size+' benchmark repeats',len(old)==len(new)==3)
        if len(old)!=3 or len(new)!=3:continue
        record(size+' zero benchmark errors',all(not r['error_count'] and not r.get('resources',{}).get('sampling_error') for r in old+new))
        # These are independent sequential repeats, not paired simultaneous
        # experiments. Use the predeclared median comparison; require a majority
        # of Go repeats to exceed the Node median as well.
        baseline=statistics.median(r['successful_rps'] for r in old)
        record(size+' repeatable median throughput gain',statistics.median(r['successful_rps'] for r in new)>baseline and sum(r['successful_rps']>baseline for r in new)>=2)
        for operation in ('list','detail','update','create'):
            for metric in ('p95_ms','p99_ms'):
                a=statistics.median(r['operations'][operation][metric] for r in old);b=statistics.median(r['operations'][operation][metric] for r in new)
                record(size+' '+operation+' '+metric+' <= 10% regression',b<=a*1.1)
        record(size+' whole-stack proportional memory <= 512 MiB',all(0<r.get('resources',{}).get('sampled_peak_pss_bytes',0)<=512*1024*1024 for r in new))
    record('no unfinished browser requests',not read('output/playwright/go-journey-review.json').get('http_errors',['missing']))
    return {'passed':not failures,'source_digest':source_digest(),'checks':checks,'failures':failures,'scope':'Local AISOC replacement; optional workers remain separate, loopback-only and disabled in the rollback domain database.'}

def main():
    report=evaluate();out=ROOT/'output/migration';out.mkdir(parents=True,exist_ok=True)
    (out/'release-gate.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'passed':report['passed'],'checks':len(report['checks']),'failures':report['failures']}))
    if not report['passed']:raise SystemExit(1)

if __name__=='__main__':main()
