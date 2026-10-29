#!/usr/bin/env python3
"""Manage AISOC's opt-in, loopback-only Redis sandbox; never use the host default."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import signal
import socket
import subprocess
import time

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_STATE = ROOT / '.run/redis-dev'
PINNED_VERSION = '7.0.15'  # Installed sandbox baseline, not a production approval.
# Redis packages can use a multicall executable selected by argv[0]. Preserve the
# redis-server symlink when launching; resolve only for process identity checks.
REDIS = Path(os.environ.get('AISOC_REDIS_BIN', '/usr/bin/redis-server')).absolute()
CLI = '/usr/bin/redis-cli'


def verify_binary():
    version = subprocess.check_output([str(REDIS), '--version'], text=True, timeout=5)
    match = re.search(r'v=([\d.]+)', version)
    if not match or match.group(1) != PINNED_VERSION:
        raise RuntimeError('Expected the pinned sandbox Redis '+PINNED_VERSION)


def settings(state):
    return json.loads((state / 'settings.json').read_text())


def prepare(state, port):
    state = state.resolve()
    if not 1024 <= port <= 65535 or port == 6379:
        raise ValueError('Use a dedicated non-default Redis port')
    verify_binary()
    state.mkdir(parents=True, exist_ok=True, mode=0o700)
    if (state / 'settings.json').exists():
        config = settings(state)
        if config['port'] != port or config['version'] != PINNED_VERSION:
            raise RuntimeError('Existing Redis state has different port/version; refusing replacement')
    else:
        if (state / 'appendonlydir').exists() or (state / 'dump.rdb').exists():
            raise RuntimeError('Persistence exists without settings; refusing to overwrite')
        config = {'port': port, 'version': PINNED_VERSION,
                  'passwords': {role: secrets.token_hex(32) for role in ('admin', 'publisher', 'consumer', 'cache', 'retention')}}
        private = state / 'settings.json'
        private.write_text(json.dumps(config))
        private.chmod(0o600)
    # Extend older opt-in profiles without rotating their existing credentials.
    if 'cache' not in config['passwords']:
        config['passwords']['cache'] = secrets.token_hex(32)
        private = state / 'settings.json'
        private.write_text(json.dumps(config))
        private.chmod(0o600)
    acl = ['user default off']
    if 'retention' not in config['passwords']:
        config['passwords']['retention'] = secrets.token_hex(32)
        private = state / 'settings.json'
        private.write_text(json.dumps(config))
        private.chmod(0o600)
    rights = {
        'admin': '~soc:* +@all',
        'publisher': '~soc:telemetry:* +ping +hello +xadd +xlen +eval',
        'consumer': '~soc:telemetry:* +ping +hello +xgroup|create +xreadgroup +xack +xautoclaim +xpending +xrange',
        'cache': '~soc:cache:ioc:* +ping +hello +eval +hstrlen +hget +hexists +hlen +hset +pttl +pexpire',
        'retention': '~soc:telemetry:* +ping +hello +eval +xrange +xinfo|groups +xpending +xdel +time',
    }
    for role, commands in rights.items():
        digest = hashlib.sha256(config['passwords'][role].encode()).hexdigest()
        acl.append(f'user aisoc-{role} on #{digest} -@all {commands}')
    aclfile = state / 'users.acl'
    aclfile.write_text('\n'.join(acl)+'\n')
    aclfile.chmod(0o600)
    # Generated paths are quoted for the Redis config parser, not a shell.
    lines = [
        'bind 127.0.0.1', f'port {port}', 'protected-mode yes', 'daemonize no',
        'databases 1', 'maxclients 32', 'maxmemory 64mb', 'maxmemory-policy noeviction',
        'appendonly yes', 'appendfsync everysec', 'save ""', 'tcp-keepalive 30',
        'auto-aof-rewrite-percentage 100', 'auto-aof-rewrite-min-size 16mb',
        'aclfile '+json.dumps(str(aclfile)), 'dir '+json.dumps(str(state)),
        'logfile '+json.dumps(str(state / 'redis.log')),
        'pidfile '+json.dumps(str(state / 'server.pid')),
    ]
    conf = state / 'redis.conf'
    conf.write_text('\n'.join(lines)+'\n')
    conf.chmod(0o600)
    return config


def pid(state):
    try:
        record = json.loads((state / 'process.pid').read_text())
        value = record['pid']
        proc = Path(f'/proc/{value}')
        start_ticks = proc.joinpath('stat').read_text().split(') ', 1)[1].split()[19]
        if (proc.joinpath('exe').resolve() == REDIS.resolve()
                and proc.joinpath('cwd').resolve() == state.resolve()
                and start_ticks == record['start_ticks']):
            return value
    except (OSError, ValueError, KeyError, TypeError, IndexError):
        pass
    return None


def command(state, *args):
    config = settings(state)
    env = {key: value for key, value in os.environ.items() if key in ('PATH', 'LANG')}
    env['REDISCLI_AUTH'] = config['passwords']['admin']
    result = subprocess.run([CLI, '-e', '--raw', '-h', '127.0.0.1', '-p', str(config['port']),
        '--user', 'aisoc-admin', *args], env=env, text=True, capture_output=True, timeout=4)
    if result.returncode != 0:
        raise RuntimeError('AISOC Redis management command failed')
    return result.stdout.strip()


def start(state, port):
    state = state.resolve()
    if pid(state):
        if command(state, 'PING') != 'PONG':
            raise RuntimeError('Owned Redis is not ready')
        return
    prepare(state, port)
    with socket.socket() as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind(('127.0.0.1', port))
        except OSError:
            raise RuntimeError('Dedicated Redis port is occupied; no service was changed') from None
    env = {key: value for key, value in os.environ.items() if key in ('PATH', 'LANG')}
    env['AISOC_REDIS_INSTANCE'] = str(state)
    with (state / 'launcher.log').open('a') as log:
        process = subprocess.Popen([str(REDIS), str(state / 'redis.conf')], cwd=state,
            env=env, stdout=log, stderr=log, start_new_session=True)
    try:
        start_ticks = Path(f'/proc/{process.pid}/stat').read_text().split(') ', 1)[1].split()[19]
        (state / 'process.pid').write_text(json.dumps({'pid': process.pid, 'start_ticks': start_ticks}))
        for _ in range(50):
            if process.poll() is not None:
                raise RuntimeError('Redis exited; see its private log')
            try:
                if command(state, 'PING') == 'PONG':
                    return
            except (OSError, RuntimeError, subprocess.TimeoutExpired):
                pass
            time.sleep(.1)
        raise RuntimeError('Redis readiness timed out')
    except BaseException:
        if process.poll() is None:
            process.terminate()
            process.wait(timeout=15)
        raise


def stop(state):
    value = pid(state)
    if value is None:
        return
    os.kill(value, signal.SIGTERM)
    for _ in range(150):
        if not pid(state):
            (state / 'process.pid').unlink(missing_ok=True)
            return
        time.sleep(.1)
    raise RuntimeError('Redis did not stop; persistence and process left for inspection')


def test_env(state):
    config = settings(state)
    return {'AISOC_TEST_REDIS_ADDR': f'127.0.0.1:{config["port"]}',
            **{f'AISOC_TEST_REDIS_{role.upper()}_PASSWORD': password
               for role, password in config['passwords'].items()}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['start', 'stop', 'status'])
    args = parser.parse_args()
    state = DEFAULT_STATE
    state.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (state / 'lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if args.action == 'start':
            start(state, 16379)
            print('AISOC Redis ready: 127.0.0.1:16379; AOF/noeviction; telemetry not connected')
        elif args.action == 'stop':
            stop(state)
            print('AISOC Redis stopped; persistence and private ACL settings retained')
        else:
            running = pid(state) is not None
            healthy = running and command(state, 'PING') == 'PONG'
            print('AISOC Redis: '+('ready on 127.0.0.1:16379' if healthy else 'stopped'))


if __name__ == '__main__':
    main()
