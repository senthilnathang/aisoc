#!/usr/bin/env python3
"""Temporary loopback token-auth browser fixture; never changes the normal launchers.

Requires dev.py start and a frontend build in output/go-preview. Fixture credentials
are the same PUBLIC TEST values used by response-auth.mjs, never production tokens.
Ctrl-C stops only this command's child processes and removes its credential file.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import tempfile
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[2]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ttl-ms', type=int, default=10000)
    args = parser.parse_args()
    if not 1000 <= args.ttl_ms <= 86400000:
        parser.error('TTL must be between 1000 and 86400000 milliseconds')
    for port in (3004, 8082):
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', port))
    if not (ROOT/'output/go-preview/index.html').is_file():
        parser.error('Build the isolated frontend preview first; see backend-go/README.md')
    config = json.loads((ROOT/'.run/go-dev/settings.json').read_text())
    children = []
    def interrupt(_signum, _frame):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, interrupt)
    logs = ROOT/'output/playwright'
    logs.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='aisoc-token-preview-') as temp:
        credentials = Path(temp)/'operators.json'
        credentials.write_text(json.dumps([
            {'id':'browser-'+key, 'tenant_id':'browser-auth-'+key,
             'token_hash':hashlib.sha256(('parity_fixture_'+key*40).encode()).hexdigest()}
            for key in ('a', 'b')]))
        credentials.chmod(0o600)
        env = {**os.environ, 'AISOC_GO_ADDR':'127.0.0.1:3004',
               'AISOC_GO_DATABASE_URL':config['url'], 'AISOC_GO_AUTH_MODE':'token',
               'AISOC_GO_OPERATORS_FILE':str(credentials), 'AISOC_GO_ENV':'development',
               'AISOC_GO_SECURE_COOKIES':'false', 'AISOC_GO_SESSION_TTL_MS':str(args.ttl_ms),
               'AISOC_GO_APP_ORIGINS':'http://127.0.0.1:8082',
               'AISOC_PYTHON_ADDR':'', 'AISOC_RUST_ADDR':'', 'AISOC_WORKER_TOKEN':''}
        with (logs/'token-preview-api.log').open('w') as api_log, (logs/'token-preview-vite.log').open('w') as vite_log:
            try:
                children.append(subprocess.Popen([ROOT/'backend-go/bin/api'],env=env,stdout=api_log,stderr=api_log))
                for _ in range(100):
                    if children[0].poll() is not None:
                        raise RuntimeError('Token API exited; inspect token-preview-api.log')
                    try:
                        with urllib.request.urlopen('http://127.0.0.1:3004/ready',timeout=.5) as response:
                            if response.status==200: break
                    except (OSError, TimeoutError): pass
                    time.sleep(.1)
                else: raise RuntimeError('Token API readiness timed out')
                # No database credentials or operator file are passed to Vite.
                children.append(subprocess.Popen([
                    ROOT/'frontend/node_modules/.bin/vite','preview','--host','127.0.0.1',
                    '--port','8082','--strictPort','--outDir','../output/go-preview'],
                    cwd=ROOT/'frontend',env={**os.environ,'AISOC_API_PROXY_TARGET':'http://127.0.0.1:3004'},
                    stdout=vite_log,stderr=vite_log))
                print('Token browser fixture: http://127.0.0.1:8082/respond',flush=True)
                print(f'PUBLIC TEST credentials only; session TTL {args.ttl_ms} ms; Ctrl-C to stop',flush=True)
                while all(child.poll() is None for child in children):
                    time.sleep(.5)
                raise RuntimeError('A preview child exited unexpectedly; inspect output/playwright logs')
            except KeyboardInterrupt:
                pass
            finally:
                for child in reversed(children):
                    if child.poll() is None:
                        child.terminate()
                        try: child.wait(timeout=10)
                        except subprocess.TimeoutExpired:
                            child.kill()
                            child.wait(timeout=5)


if __name__ == '__main__':
    main()
