#!/usr/bin/env python3
"""Retain tested synthetic input as a checked, replayable local demo import."""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path

from demo import ROOT, SCOPES, request


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def read_json(path, limit):
    if path.is_symlink() or path.stat().st_size > limit:
        raise ValueError('Invalid or oversized artifact')
    return json.loads(path.read_bytes())


def scope(index):
    name = f'benchmark-import-{index:02}'
    return dict(id=name, operator_id='local-development', tenant_id='demo',
                connector_id=name, source='qradar-siem', processor='mock-login-v1',
                allow_retry=True, allow_mock_import=True, allow_sandbox_response=False,
                pending_warning=500, age_warning_seconds=15)


def prepare(report_path, directory):
    report = read_json(report_path, 10 << 20)
    count = report.get('events', 0)
    if (type(count) is not int or not 100 <= count <= 60000 or count % 100 or
            report.get('correctness_passed') is not True or
            report.get('accepted') != count or report.get('completed') != count or
            report.get('unacked') != 0):
        raise ValueError('Require a complete, successful bounded load report')
    source = Path(str(report_path) + '.events.jsonl')
    if source.is_symlink() or source.stat().st_size > 128 << 20:
        raise ValueError('Invalid export')
    raw = source.read_bytes()
    if digest(raw) != report.get('event_export_sha256'):
        raise ValueError('Export does not match successful report')
    events = [json.loads(line) for line in raw.splitlines()]
    if len(events) != count:
        raise ValueError('Export count differs from report')
    for i, event in enumerate(events):
        if event['event_id'] != f'load-{i:04}' or event['source_event_id'] != event['event_id']:
            raise ValueError('Unexpected benchmark input identity')
    directory.mkdir(parents=True, exist_ok=False)
    (directory / 'benchmark-events.jsonl').write_bytes(raw)
    (directory / 'benchmark-report.json').write_bytes(report_path.read_bytes())
    entries = []
    for offset in range(0, count, 1000):
        grant = scope(offset // 1000 + 1)
        batch = copy.deepcopy(events[offset:offset + 1000])
        for i, event in enumerate(batch):
            event.update(tenant_id='demo', connector_id=grant['id'], source='qradar-siem')
            # The transport benchmark repeats one entity. Give each demo event
            # its own synthetic principal to respect bounded correlation windows.
            event['projection']['principal_ref'] = f'benchmark-user-{offset+i:05}'
        payload = json.dumps({'schema_version': '1.0', 'events': batch}, indent=2).encode() + b'\n'
        name = grant['id'] + '.json'
        (directory / name).write_bytes(payload)
        entries.append(dict(scope=grant['id'], file=name, events=len(batch), sha256=digest(payload)))
    manifest = dict(schema_version='1.0', mode='synthetic-local-demo', events=count,
                    source_sha256=digest(raw), report_sha256=digest(report_path.read_bytes()),
                    transformations=['tenant/connector rebound to local demo scopes',
                                     'unique synthetic principal per event for bounded correlation'],
                    privileged_actions_enabled=False, files=entries)
    (directory / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    return validate(directory)


def validate(directory):
    manifest = read_json(directory / 'manifest.json', 1 << 20)
    if (manifest.get('schema_version') != '1.0' or manifest.get('mode') != 'synthetic-local-demo'
            or manifest.get('privileged_actions_enabled') is not False):
        raise ValueError('Invalid manifest')
    for name, key, limit in [('benchmark-events.jsonl', 'source_sha256', 128 << 20),
                             ('benchmark-report.json', 'report_sha256', 10 << 20)]:
        path = directory / name
        if path.is_symlink() or path.stat().st_size > limit or digest(path.read_bytes()) != manifest[key]:
            raise ValueError('Benchmark provenance checksum mismatch')
    entries = manifest['files']
    if not 1 <= len(entries) <= 60:
        raise ValueError('Invalid scope count')
    total = 0
    pages = []
    for index, entry in enumerate(entries, 1):
        grant = scope(index)
        if entry['scope'] != grant['id'] or entry['file'] != grant['id'] + '.json':
            raise ValueError('Invalid scope or file path')
        path = directory / entry['file']
        page = read_json(path, 2 << 20)
        if digest(path.read_bytes()) != entry['sha256'] or page.get('schema_version') != '1.0':
            raise ValueError('Payload checksum/schema mismatch')
        events = page['events']
        if len(events) != entry['events'] or not 1 <= len(events) <= 1000:
            raise ValueError('Invalid event count')
        for i, event in enumerate(events):
            expected = f'load-{total+i:04}'
            if (event.get('tenant_id') != 'demo' or event.get('connector_id') != grant['id']
                    or event.get('source') != 'qradar-siem' or event.get('event_id') != expected
                    or event.get('source_event_id') != expected):
                raise ValueError('Event binding/identity mismatch')
        total += len(events)
        pages.append((grant, events))
    if total != manifest['events'] or total > 60000:
        raise ValueError('Manifest count mismatch')
    return manifest, pages


def configure(pages):
    current = read_json(SCOPES, 1 << 20)
    for grant, _ in pages:
        existing = next((item for item in current if item['id'] == grant['id']), None)
        if existing is not None and existing != grant:
            raise ValueError('Existing grant differs; refusing to overwrite')
        if existing is None:
            current.append(grant)
    if len(current) > 100:
        raise ValueError('Configured scope capacity exceeded')
    temporary = SCOPES.with_suffix('.benchmark.tmp')
    with temporary.open('x') as file:
        json.dump(current, file, indent=2)
    temporary.replace(SCOPES)


def ingest(directory, manifest, pages):
    # Preflight all grants before the first mutation; Go independently validates
    # every envelope and current checkpoint. Restarting safely replays duplicates.
    configured = read_json(SCOPES, 1 << 20)
    for grant, _ in pages:
        if grant not in configured:
            raise ValueError('Configure grants and restart foundation before importing')
        request('/' + grant['id'])
    inserted = 0
    for grant, events in pages:
        prefix = '/' + grant['id']
        checkpoint = request(prefix)['checkpoint']
        added = 0
        for start in range(0, len(events), 100):
            receipt = request(prefix + '/mock-import', dict(schema_version='1.0',
                expected_checkpoint=checkpoint, next_cursor=f'benchmark-v1-{start+100}',
                events=events[start:start+100]))['accepted']
            checkpoint = receipt['Checkpoint']
            added += receipt['Inserted']
        inserted += added
        print(f"{grant['id']}: {added} newly inserted", flush=True)
    result = dict(passed=True, mode='local-demo-import', events=manifest['events'],
                  inserted=inserted, duplicates=manifest['events']-inserted,
                  benchmark_performance_measurement=False)
    (directory / 'import-receipt.json').write_text(json.dumps(result, indent=2) + '\n')
    return result


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['prepare', 'validate', 'configure', 'import', 'verify'])
    parser.add_argument('--bundle', type=Path, required=True)
    parser.add_argument('--report', type=Path, default=ROOT/'output/backend-framework/stream-load.json')
    args = parser.parse_args()
    if args.command == 'prepare':
        manifest, pages = prepare(args.report, args.bundle)
    else:
        manifest, pages = validate(args.bundle)
    if args.command == 'configure':
        configure(pages)
        print('Local grants configured; restart foundation before import.')
    elif args.command == 'import':
        print(json.dumps(ingest(args.bundle, manifest, pages)))
    elif args.command == 'verify':
        counts = dict(accepted=0, completed=0, pending=0, dead_letters=0, publication_failed=0)
        unhealthy = []
        for grant, events in pages:
            state = request('/' + grant['id'])
            for key in counts: counts[key] += state['snapshot'][key]
            if (state['snapshot']['accepted'] != len(events) or
                    state['snapshot']['completed'] != len(events) or
                    state['worker'].get('error_code') or state['worker'].get('status') != 'running'):
                unhealthy.append(grant['id'])
        result = dict(passed=not unhealthy and not any(counts[k] for k in
                      ('pending', 'dead_letters', 'publication_failed')), counts=counts, unhealthy=unhealthy)
        (args.bundle/'verification.json').write_text(json.dumps(result, indent=2)+'\n')
        print(json.dumps(result))
        if not result['passed']: raise SystemExit(1)
    else:
        print(json.dumps(dict(valid=True, events=manifest['events'], sources=len(pages))))


if __name__ == '__main__':
    main()
