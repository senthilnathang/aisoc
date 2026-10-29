#!/usr/bin/env python3
"""Check local release readiness, errors, memory and queue lag; no external messages."""
import argparse
import json
from pathlib import Path
import time
import urllib.request
from manage import ROOT

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--state',default=str(ROOT/'.run/go-runtime'))
    parser.add_argument('--seconds',type=int,default=0,help='Observation duration; zero performs one check')
    args=parser.parse_args();state=Path(args.state).resolve()
    if not state.is_relative_to(ROOT/'.run') or not 0<=args.seconds<=86400:parser.error('Invalid state or duration')
    config=json.loads((state/'settings.json').read_text());base=f"http://127.0.0.1:{config['api_port']}"
    start=time.monotonic();samples=[];baseline_errors=None;baseline_failed=None
    while True:
        with urllib.request.urlopen(base+'/ready',timeout=3) as response:
            if response.status!=200:raise RuntimeError('Release is not ready')
        with urllib.request.urlopen(base+'/metrics',timeout=3) as response:metrics=json.load(response)
        errors=metrics['responses_total']['5xx'];failed=metrics['investigation_jobs']['failed']
        if baseline_errors is None:baseline_errors=errors;baseline_failed=failed
        sample={'elapsed_seconds':round(time.monotonic()-start),'http_5xx':errors-baseline_errors,'new_failed_jobs':failed-baseline_failed,'heap_bytes':metrics['go_heap_bytes'],'active_jobs':metrics['investigation_jobs']['active'],'oldest_active_seconds':metrics['investigation_jobs']['oldest_active_seconds'],'pool':metrics['database_pool']}
        samples.append(sample);print(json.dumps(sample),flush=True)
        if sample['http_5xx']>0 or sample['new_failed_jobs']>0 or sample['heap_bytes']>256*1024*1024 or sample['oldest_active_seconds']>60:raise RuntimeError('Release observation threshold exceeded')
        if time.monotonic()-start>=args.seconds:break
        time.sleep(min(10,args.seconds-(time.monotonic()-start)))
    out=ROOT/'output/migration';out.mkdir(parents=True,exist_ok=True)
    (out/'observation.json').write_text(json.dumps({'passed':True,'duration_seconds':args.seconds,'samples':samples},indent=2)+'\n')

if __name__=='__main__':main()
