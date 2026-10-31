#!/usr/bin/env python3
"""Run job repository tests in an owned disposable PostgreSQL cluster."""
import os
from pathlib import Path
import secrets
import subprocess
import tempfile
from check import PG, ROOT, port


def main():
    with tempfile.TemporaryDirectory(prefix='aisoc-job-check-') as directory:
        temp = Path(directory)
        password = secrets.token_hex(24)
        pw = temp / 'password'
        pw.write_text(password)
        pw.chmod(0o600)
        pgport = port()
        env = os.environ.copy()
        env.update(PGHOST='127.0.0.1', PGPORT=str(pgport), PGUSER='aisoc', PGPASSWORD=password)
        env['AISOC_GO_TEST_DATABASE_URL'] = f'postgres://aisoc:{password}@127.0.0.1:{pgport}/aisoc_go_jobs_test?sslmode=disable'
        def run(args, **kwargs):
            subprocess.run([str(a) for a in args], check=True, timeout=180,
                           env=env, **kwargs)
        run([PG/'initdb', '-D', temp/'pg', '-U', 'aisoc', '--auth-local=trust',
             '--auth-host=scram-sha-256', '--pwfile', pw], stdout=subprocess.DEVNULL)
        started = False
        try:
            run([PG/'pg_ctl', '-D', temp/'pg', '-l', temp/'pg.log', '-o',
                 f'-h 127.0.0.1 -p {pgport} -k {temp}', '-w', 'start'], stdout=subprocess.DEVNULL)
            started = True
            run([PG/'createdb', 'aisoc_go_jobs_test'])
            run(['go', 'test', '-race', '-count=1', '-v', './internal/platform/jobs'], cwd=ROOT/'backend-go')
        finally:
            if started:
                run([PG/'pg_ctl', '-D', temp/'pg', '-m', 'fast', '-w', 'stop'], stdout=subprocess.DEVNULL)


if __name__ == '__main__':
    main()
