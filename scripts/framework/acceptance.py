#!/usr/bin/env python3
"""Repeat the disposable local/mock Detect-to-Build suite and retain per-run reports."""
import argparse
import fcntl
import json
from pathlib import Path
import shutil
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
REQUIRED = {'build_response', 'skills_memory', 'intel_hunt', 'detect_feedback'}


def validate_report(report):
    if report.get('passed') is not True or report.get('mode') != 'local/mock':
        raise ValueError('Acceptance did not pass in local/mock mode')
    if report.get('active_backend_modified') is not False:
        raise ValueError('Missing isolation guarantee')
    if set(report.get('stages', {})) != REQUIRED:
        raise ValueError('Missing acceptance stage')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runs', type=int, choices=range(1, 4), default=2)
    args = parser.parse_args()
    if not __debug__:
        parser.error('Assertions must be enabled; remove -O/PYTHONOPTIMIZE')
    output = ROOT/'output/platform-acceptance'
    output.mkdir(parents=True, exist_ok=True)
    with (output/'.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        result = {'passed': False, 'mode': 'local/mock', 'requested_runs': args.runs,
                  'revision': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
                  'dirty': bool(subprocess.check_output(['git', 'status', '--porcelain'], cwd=ROOT, text=True)),
                  'runs': []}
        manifest = output/'report.json'
        def save():
            manifest.write_text(json.dumps(result, indent=2)+'\n')
        save()
        for number in range(1, args.runs+1):
            target = output/('run-'+str(number))
            target.mkdir(exist_ok=True)
            # Never consume a report left by an earlier successful run.
            source = ROOT/'output/backend-framework/platform-acceptance.json'
            source.unlink(missing_ok=True)
            start = time.monotonic()
            print(f'Running disposable acceptance {number}/{args.runs}', flush=True)
            with (target/'runner.log').open('w') as log:
                process = subprocess.run([sys.executable, str(ROOT/'scripts/framework/check.py'), '--with-streams', '--platform-acceptance'], cwd=ROOT, stdout=log, stderr=subprocess.STDOUT)
            item = dict(number=number, passed=False, exit_code=process.returncode, seconds=round(time.monotonic()-start, 2))
            result['runs'].append(item)
            for name in ('platform-acceptance.json', 'report.json', 'case-response-flow.json', 'login-context-flow.json', 'build-integrations-flow.json', 'bulk-import-flow.json'):
                path = ROOT/'output/backend-framework'/name
                if path.exists():
                    shutil.copyfile(path, target/name)
            save()
            if process.returncode:
                raise SystemExit(f'Acceptance failed; inspect {target}/runner.log and output/backend-framework/check.log')
            try:
                validate_report(json.loads(source.read_text()))
            except (ValueError, OSError) as exc:
                raise SystemExit(f'Incomplete acceptance report: {exc}') from exc
            item['passed'] = True
            save()
        result['passed'] = True
        save()
        print('PASS repeated local acceptance: '+str(manifest))


if __name__ == '__main__':
    main()
