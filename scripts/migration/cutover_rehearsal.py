#!/usr/bin/env python3
"""Rehearse frontend proxy switch and post-write rollback using private copies."""
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import time
import urllib.request

ROOT=Path(__file__).resolve().parents[2]
def port():
    with socket.socket() as sock:sock.bind(('127.0.0.1',0));return sock.getsockname()[1]

def main():
    os.umask(0o077);state=ROOT/'.run/cutover-rehearsal'/secrets.token_hex(6);state.mkdir(parents=True)
    apiport,pgport,webport=port(),port(),port();children=[]
    out=ROOT/'output/migration';out.mkdir(parents=True,exist_ok=True)
    with (state/'rehearsal.log').open('w') as log:
        def run(command):subprocess.run([str(x) for x in command],cwd=ROOT,stdout=log,stderr=log,check=True,timeout=900)
        def request(base,path,method='GET',body=None,status=200):
            headers={'x-tenant-id':'cutover-fixture'};data=None
            if body is not None:headers['content-type']='application/json';data=json.dumps(body).encode()
            with urllib.request.urlopen(urllib.request.Request(base+path,data=data,headers=headers,method=method),timeout=10) as response:
                if response.status!=status:raise RuntimeError('Unexpected rehearsal response')
                return json.load(response)
        def wait_ready(base,path='/health'):
            for _ in range(100):
                try:return request(base,path)
                except OSError:time.sleep(.1)
            raise RuntimeError('Rehearsal listener not ready')
        def preview(target):
            child=subprocess.Popen([str(ROOT/'frontend/node_modules/.bin/vite'),'preview','--host','127.0.0.1','--port',str(webport),'--strictPort','--outDir','../output/go-preview'],cwd=ROOT/'frontend',env={**os.environ,'AISOC_API_PROXY_TARGET':target},stdout=log,stderr=log)
            children.append(child);wait_ready(f'http://127.0.0.1:{webport}');return child
        manage=['python3','scripts/runtime/manage.py']
        try:
            snapshot=state/'source.json';run(['python3','scripts/migration/snapshot.py','export','.run/migration-fixture/full.sqlite',snapshot])
            start=time.monotonic()
            run([*manage,'init','--state',state,'--source',snapshot,'--api-port',apiport,'--pg-port',pgport])
            exported=state/'before-writes.json';run([*manage,'export','--state',state,'--output',exported])
            run(['python3','scripts/migration/snapshot.py','compare',snapshot,exported])
            run([*manage,'start','--state',state])
            go=f'http://127.0.0.1:{apiport}';web=f'http://127.0.0.1:{webport}'
            proxy=preview(go)
            if request(web,'/health').get('database')!='postgresql':raise RuntimeError('Proxy did not route to Go')
            case=request(web,'/api/v1/investigations','POST',{'title':'Acknowledged after proxy switch','source':'Rehearsal','severity':'low'},201)
            switch_seconds=time.monotonic()-start
            run(['python3','scripts/runtime/monitor.py','--state',state,'--seconds','20'])
            rollback_start=time.monotonic();proxy.terminate();proxy.wait(timeout=10)
            run([*manage,'stop','--state',state])
            post=state/'after-writes.json';run([*manage,'export','--state',state,'--output',post])
            restored=state/'rollback.sqlite';run(['python3','scripts/migration/snapshot.py','restore',post,restored])
            run(['python3','scripts/migration/snapshot.py','export',restored,state/'restored.json'])
            run(['python3','scripts/migration/snapshot.py','compare',post,state/'restored.json'])
            info=state/'node.json'
            node=subprocess.Popen(['node','tests/backend-parity/serve-recovery.mjs','--database',str(restored),'--info',str(info)],cwd=ROOT,stdout=log,stderr=log);children.append(node)
            for _ in range(100):
                if info.exists():break
                if node.poll() is not None:raise RuntimeError('Rollback Node failed to start')
                time.sleep(.1)
            else:raise RuntimeError('Rollback Node startup timeout')
            target=json.loads(info.read_text())['url'];proxy=preview(target)
            if request(web,'/api/v1/investigations/'+case['id'])['title']!='Acknowledged after proxy switch':raise RuntimeError('Rollback lost acknowledged write')
            if request(web,'/health').get('database')=='postgresql':raise RuntimeError('Rollback still routes to Go')
            report={'passed':True,'active_services_modified':False,'switch_rehearsal_seconds':switch_seconds,'rollback_rehearsal_seconds':time.monotonic()-rollback_start,'checks':['private data import reconciled','frontend proxy routes to Go','acknowledged write through frontend proxy','operational monitor','post-write reverse export reconciled','frontend proxy routes to restored Node','acknowledged write visible after rollback'],'private_artifacts':str(state)}
            (out/'cutover-rehearsal.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
        finally:
            for child in reversed(children):
                if child.poll() is None:child.terminate();child.wait(timeout=15)
            if (state/'settings.json').exists():run([*manage,'stop','--state',state])

if __name__=='__main__':main()
