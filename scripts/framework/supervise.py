#!/usr/bin/env python3
"""Supervise only the isolated local foundation; never the release stack."""
import fcntl
import signal
import subprocess
import sys
import threading
import dev


def main():
    dev.STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
    stopped = threading.Event()
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, lambda *_: stopped.set())
    with (dev.STATE/'supervisor.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        try:
            while not stopped.is_set():
                try:
                    # API can remain alive while PostgreSQL has failed. Restart
                    # only the owned foundation in that case to rebuild readiness.
                    if (dev.STATE/'settings.json').exists() and not dev.pg_running():
                        subprocess.run([sys.executable, str(dev.ROOT/'scripts/framework/dev.py'), 'stop'], check=True, timeout=90)
                    subprocess.run([sys.executable, str(dev.ROOT/'scripts/framework/dev.py'), 'start', '--investigation-worker', '--python-worker', '--streams'], check=True, timeout=180,
                        stdout=subprocess.DEVNULL)
                except (subprocess.SubprocessError, OSError):
                    print('Foundation restart failed; retrying in ten seconds. Inspect private service logs.', flush=True)
                stopped.wait(10)
        finally:
            subprocess.run([sys.executable, str(dev.ROOT/'scripts/framework/dev.py'), 'stop'], check=True, timeout=90)


if __name__ == '__main__': main()
