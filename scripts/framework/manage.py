#!/usr/bin/env python3
"""Manage the supervised local foundation for run.sh; no release-data changes."""
import argparse
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
import urllib.request
import dev

SUPERVISOR = dev.ROOT / 'scripts/framework/supervise.py'
PIDFILE = dev.STATE / 'supervisor.pid'
LOGFILE = dev.STATE / 'supervisor.log'


def owned_pid():
    try:
        pid = int(PIDFILE.read_text())
        if pid <= 1:
            return None
        args = Path(f'/proc/{pid}/cmdline').read_bytes().split(b'\0')
        if str(SUPERVISOR).encode() in args:
            return pid
    except (OSError, ValueError):
        pass
    return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['start', 'stop', 'status', 'logs'])
    command = parser.parse_args().command
    dev.STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
    pid = owned_pid()
    if command == 'logs':
        subprocess.run(['tail', '-n', '60', str(LOGFILE)], check=True)
    elif command == 'status':
        print(f'Foundation supervisor: {pid or "stopped"}')
        subprocess.run([sys.executable, str(dev.ROOT / 'scripts/framework/dev.py'), 'status'], check=True)
    elif command == 'stop':
        if pid:
            os.kill(pid, signal.SIGTERM)
            for _ in range(1200):
                if owned_pid() != pid:
                    break
                time.sleep(.1)
            else:
                raise SystemExit('Supervisor still stopping; inspect its log before retrying.')
            PIDFILE.unlink(missing_ok=True)
        else:
            subprocess.run([sys.executable, str(dev.ROOT / 'scripts/framework/dev.py'), 'stop'], check=True)
        print('Foundation stopped; data retained.')
    else:
        if not pid:
            descriptor = os.open(LOGFILE, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
            with os.fdopen(descriptor, 'ab') as log:
                child = subprocess.Popen([sys.executable, str(SUPERVISOR)], cwd=dev.ROOT,
                                         stdout=log, stderr=log, start_new_session=True)
            PIDFILE.write_text(str(child.pid) + '\n')
            PIDFILE.chmod(0o600)
        for _ in range(180):
            if not owned_pid():
                raise SystemExit('Foundation supervisor exited; inspect .run/go-dev/supervisor.log.')
            try:
                with urllib.request.urlopen('http://127.0.0.1:3003/ready', timeout=1) as result:
                    if result.status == 200:
                        print('Supervised Go foundation ready: http://127.0.0.1:3003')
                        return
            except OSError:
                pass
            time.sleep(1)
        raise SystemExit('Foundation readiness timed out; inspect private service logs.')


if __name__ == '__main__':
    main()
