#!/usr/bin/env python3
"""Check local release readiness, errors, memory and queue lag; no external messages."""
import argparse
import json
import shutil
from pathlib import Path
import time
import urllib.request
from manage import ROOT
import alert_webhook

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--state',default=str(ROOT/'.run/go-runtime'))
    parser.add_argument('--seconds',type=int,default=0,help='Observation duration; zero performs one check')
    parser.add_argument('--api-port',type=int,help='Explicit local API port; foundation uses 3003')
    parser.add_argument('--webhook-config',help='Optional private HTTPS alert configuration; no delivery unless supplied')
    parser.add_argument('--min-free-gib',type=float,default=5,help='Local free-disk threshold; provisional default 5 GiB')
    args=parser.parse_args();state=Path(args.state).resolve()
    if not 0<=args.min_free_gib<=1024:parser.error('Invalid free-disk threshold')
    if not state.is_relative_to(ROOT/'.run') or not 0<=args.seconds<=86400:parser.error('Invalid state or duration')
    config=json.loads((state/'settings.json').read_text());api_port=args.api_port or config.get('api_port')
    if not isinstance(api_port,int) or not 1<=api_port<=65535:parser.error('Provide a valid --api-port for this runtime')
    base=f"http://127.0.0.1:{api_port}"
    start=time.monotonic();samples=[];baseline_errors=None;baseline_failed=None
    while True:
        try:
            with urllib.request.urlopen(base+'/ready',timeout=3) as response:
                if response.status!=200:raise RuntimeError('Release is not ready')
            with urllib.request.urlopen(base+'/metrics',timeout=3) as response:metrics=json.load(response)
        except (OSError,ValueError,RuntimeError):
            if args.webhook_config:alert_webhook.send(args.webhook_config,'go-api','unavailable')
            raise
        errors=metrics['responses_total']['5xx'];failed=metrics['investigation_jobs']['failed']
        if baseline_errors is None:baseline_errors=errors;baseline_failed=failed
        sample={'elapsed_seconds':round(time.monotonic()-start),'http_5xx':errors-baseline_errors,'new_failed_jobs':failed-baseline_failed,'heap_bytes':metrics['go_heap_bytes'],'active_jobs':metrics['investigation_jobs']['active'],'oldest_active_seconds':metrics['investigation_jobs']['oldest_active_seconds'],'pool':metrics['database_pool']}
        sample['disk_free_gib']=round(shutil.disk_usage(state).free/(1024**3),3)
        samples.append(sample);print(json.dumps(sample),flush=True)
        if sample['http_5xx']>0 or sample['new_failed_jobs']>0 or sample['heap_bytes']>256*1024*1024 or sample['oldest_active_seconds']>60 or sample['disk_free_gib']<args.min_free_gib:
            if args.webhook_config:alert_webhook.send(args.webhook_config,'go-api','threshold_exceeded')
            raise RuntimeError('Release observation threshold exceeded')
        if time.monotonic()-start>=args.seconds:break
        time.sleep(min(10,args.seconds-(time.monotonic()-start)))
    out=ROOT/'output/migration';out.mkdir(parents=True,exist_ok=True)
    (out/'observation.json').write_text(json.dumps({'passed':True,'duration_seconds':args.seconds,'samples':samples},indent=2)+'\n')

if __name__=='__main__':main()
