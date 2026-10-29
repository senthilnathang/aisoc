#!/usr/bin/env python3
"""Verify S03 against disposable authenticated Redis; preserve all running stacks."""
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile

import redis_runtime as runtime

ROOT = Path(__file__).resolve().parents[2]


def main():
    report = ROOT / 'output/streams'
    report.mkdir(parents=True, exist_ok=True)
    receipt = report / 'report.json'
    receipt.write_text(json.dumps({'passed': False, 'status': 'running'})+'\n')
    with tempfile.TemporaryDirectory(prefix='aisoc-redis-check-') as directory, (report/'check.log').open('w') as log:
        state = Path(directory)
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        try:
            runtime.start(state, port)
            assert runtime.command(state, 'CONFIG', 'GET', 'maxmemory-policy').splitlines()[-1] == 'noeviction'
            assert runtime.command(state, 'CONFIG', 'GET', 'appendonly').splitlines()[-1] == 'yes'
            assert runtime.command(state, 'CONFIG', 'GET', 'maxmemory').splitlines()[-1] == str(64*1024*1024)
            # Verify graceful restart retains a pending entry, not just a key/value.
            key = 'soc:telemetry:restart-check'
            message = runtime.command(state, 'XADD', key, '*', 'fixture', 'restart')
            runtime.command(state, 'XGROUP', 'CREATE', key, 'restart-check', '0')
            runtime.command(state, 'XREADGROUP', 'GROUP', 'restart-check', 'consumer-1', 'COUNT', '1', 'STREAMS', key, '>')
            runtime.stop(state)
            runtime.start(state, port)
            assert runtime.command(state, 'XLEN', key) == '1'
            assert runtime.command(state, 'XPENDING', key, 'restart-check').splitlines()[0] == '1'
            assert runtime.command(state, 'XACK', key, 'restart-check', message) == '1'
            runtime.command(state, 'DEL', key)
            # Disallow accidental access to a developer-supplied database from this
            # Redis-only suite. Full framework tests own PostgreSQL integration.
            env = {k: v for k, v in os.environ.items() if not k.startswith('AISOC_')}
            env.update(runtime.test_env(state))
            for args in (['go', 'test', '-race', '-count=1', '-v', './internal/platform/streams'],
                         ['go', 'vet', './internal/platform/streams']):
                subprocess.run(args, cwd=ROOT/'backend-go', env=env, stdout=log,
                    stderr=log, check=True, timeout=180)
            receipt.write_text(json.dumps({'passed': True, 'redis_version': runtime.PINNED_VERSION,
                'scope': 'disposable Redis adapter and graceful persistence restart; no throughput/failover claim',
                'active_services_modified': False}, indent=2)+'\n')
            print('PASS isolated Redis Streams adapter; report: output/streams/report.json')
        finally:
            runtime.stop(state)


if __name__ == '__main__':
    main()
