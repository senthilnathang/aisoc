#!/usr/bin/env python3
"""Manage an isolated Node API (3004) and frontend (8082) for local comparison."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
STATE = ROOT / '.run/node-compare'
SERVICES = {'api': 3004, 'frontend': 8082}


def owned(name):
    try:
        pid = int((STATE / f'{name}.pid').read_text())
        env = Path(f'/proc/{pid}/environ').read_bytes().split(b'\0')
        if f'AISOC_COMPARE_SERVICE={name}'.encode() in env and f'AISOC_COMPARE_ROOT={ROOT}'.encode() in env:
            return pid
    except (OSError, ValueError):
        pass
    return None


def healthy(port):
    try:
        with urllib.request.urlopen(f'http://127.0.0.1:{port}/health', timeout=2) as response:
            return response.status == 200
    except OSError:
        return False


def stop(name):
    if pid := owned(name):
        os.killpg(pid, signal.SIGTERM)
        for _ in range(100):
            if not owned(name):
                break
            time.sleep(.1)
        else:
            raise RuntimeError(f'{name} did not stop; inspect its log')
    (STATE / f'{name}.pid').unlink(missing_ok=True)


def start(name):
    if owned(name):
        if not healthy(SERVICES[name]):
            raise RuntimeError(f'{name} is running but unhealthy')
        return
    with socket.socket() as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind(('127.0.0.1', SERVICES[name]))
    env = {**os.environ, 'AISOC_COMPARE_SERVICE': name, 'AISOC_COMPARE_ROOT': str(ROOT),
           'NODE_ENV': 'development', 'HOST': '127.0.0.1', 'PORT': '3004',
           'DATABASE_PATH': str(STATE / 'sqlite.db'), 'AUTH_MODE': 'local',
           'AUTH_OPERATORS_FILE': '', 'DEFAULT_TENANT_ID': 'demo', 'WORKER_ENABLED': 'true',
           'APP_ORIGINS': 'http://localhost:8082,http://127.0.0.1:8082',
           'AISOC_API_PROXY_TARGET': 'http://127.0.0.1:3004'}
    if name == 'api':
        cwd = ROOT / 'backend'
        command = ['node', '--import', './node_modules/tsx/dist/loader.mjs', 'src/server.ts']
    else:
        cwd = ROOT / 'frontend'
        command = ['node', './node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '8082', '--strictPort']
    with (STATE / f'{name}.log').open('a') as log:
        process = subprocess.Popen(command, cwd=cwd, env=env, stdout=log, stderr=log, start_new_session=True)
    (STATE / f'{name}.pid').write_text(str(process.pid))
    for _ in range(100):
        if process.poll() is not None:
            raise RuntimeError(f'{name} exited; see {STATE}/{name}.log')
        if healthy(SERVICES[name]):
            return
        time.sleep(.1)
    stop(name)
    raise RuntimeError(f'{name} failed readiness; see its log')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['start', 'stop', 'status'])
    args = parser.parse_args()
    os.umask(0o077)
    STATE.mkdir(parents=True, exist_ok=True)
    with (STATE / 'lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if args.action == 'start':
            for name in SERVICES:
                start(name)
        elif args.action == 'stop':
            for name in reversed(SERVICES):
                stop(name)
        print(json.dumps({name: {'pid': owned(name), 'url': f'http://127.0.0.1:{port}',
                                'healthy': bool(owned(name)) and healthy(port)}
                          for name, port in SERVICES.items()}, indent=2))


if __name__ == '__main__':
    main()
