#!/usr/bin/env python3
"""Import the local showcase and/or selected checked benchmark JSON files."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import subprocess
import sys

import benchmark_import as benchmark
import demo


def select(mode, paths, bundle):
    if mode != 'files' and paths:
        raise ValueError('File arguments are supported only with files mode')
    if mode == 'files' and not paths:
        raise ValueError('Provide at least one manifest-listed JSON file')
    if mode == 'showcase':
        return []
    if mode == 'all':
        manifest, pages = benchmark.validate(bundle)
        return [(bundle, manifest, pages)]
    groups = {}
    seen = set()
    for path in paths:
        path = path.absolute()
        if path.is_symlink() or not path.is_file():
            raise ValueError('Selected files must be regular bundle JSON files')
        path = path.resolve()
        if path in seen:
            raise ValueError('Duplicate file selection')
        seen.add(path)
        groups.setdefault(path.parent, set()).add(path.name)
    selected = []
    scopes = set()
    for directory, names in groups.items():
        manifest, pages = benchmark.validate(directory)
        allowed = {entry['file']: entry['scope'] for entry in manifest['files']}
        if not names <= allowed.keys():
            raise ValueError('Selected file is not a manifest-listed event file')
        ids = {allowed[name] for name in names}
        if ids & scopes:
            raise ValueError('Multiple bundles select the same scope')
        scopes.update(ids)
        pages = [(grant, events) for grant, events in pages if grant['id'] in ids]
        subset = {**manifest, 'events': sum(len(events) for _, events in pages)}
        selected.append((directory, subset, pages))
    return selected


def execute(mode, selected, dry_run=False):
    showcase = mode in ('all', 'showcase')
    pages = [(grant, []) for grant in demo.scopes()] if showcase else []
    pages += [page for _, _, group in selected for page in group]
    summary = dict(mode=mode, showcase_events=10000 if showcase else 0,
                   benchmark_events=sum(m['events'] for _, m, _ in selected),
                   scopes=[grant['id'] for grant, _ in pages], dry_run=dry_run)
    print(json.dumps(summary), flush=True)
    if dry_run:
        return
    if not (demo.ROOT/'.run/go-dev/settings.json').is_file():
        raise ValueError('Initialize the foundation with AISOC_RUNTIME_PROFILE=foundation ./run.sh start backend')
    current = benchmark.read_json(demo.SCOPES, 1 << 20)
    missing = []
    for grant, _ in pages:
        existing = next((s for s in current if s['id'] == grant['id']), None)
        if existing is not None and existing != grant:
            raise ValueError('Existing scope differs; refusing to overwrite grants')
        if existing is None:
            missing.append(grant)
    if len(current) + len(missing) > 100:
        raise ValueError('Configured scope capacity exceeded')
    env = {**os.environ, 'AISOC_RUNTIME_PROFILE': 'foundation'}
    if missing:
        benchmark.configure(pages)
        print('New local grants added; restarting foundation to load them.', flush=True)
        subprocess.run([str(demo.ROOT/'run.sh'), 'stop', 'backend'], env=env, check=True)
    subprocess.run([str(demo.ROOT/'run.sh'), 'start', 'backend'], env=env, check=True)
    if showcase:
        subprocess.run([sys.executable, str(demo.ROOT/'scripts/framework/demo.py')], check=True)
    for directory, manifest, group in selected:
        result = benchmark.ingest(directory, manifest, group,
                                 'selected-import-receipt.json' if mode == 'files' else 'import-receipt.json')
        print(json.dumps(result), flush=True)
    print('Import accepted. Check completed/pending counts in /build-operations.', flush=True)


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['all', 'showcase', 'files'])
    parser.add_argument('files', nargs='*', type=Path)
    parser.add_argument('--bundle', type=Path, default=demo.ROOT/'output/demo-import/benchmark-60k')
    parser.add_argument('--dry-run', action='store_true', help='Validate and show selection without starting services or writing data')
    args = parser.parse_args()
    try:
        selected = select(args.mode, args.files, args.bundle)
        if args.dry_run:
            execute(args.mode, selected, True)
        else:
            with (demo.ROOT/'.run/demo-import.lock').open('a') as lock:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                execute(args.mode, selected)
    except (ValueError, OSError, KeyError, TypeError) as error:
        parser.exit(1, f'Demo import failed: {error}\n')
    except subprocess.CalledProcessError:
        parser.exit(1, 'Demo import stopped because a foundation or showcase command failed; accepted data is preserved.\n')


if __name__ == '__main__':
    main()
