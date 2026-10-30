#!/usr/bin/env python3
"""Retain tested synthetic input as a checked, replayable local demo import."""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import stat
import tempfile

from demo import ROOT, SCOPES, request


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def open_artifact(path, limit):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    source = os.fdopen(descriptor, 'rb')
    metadata = os.fstat(source.fileno())
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_size > limit:
        source.close()
        raise ValueError('Require a bounded regular artifact file')
    return source


def read_bytes(path, limit):
    with open_artifact(path, limit) as source:
        raw = source.read(limit + 1)
    if len(raw) > limit:
        raise ValueError('Artifact exceeds size limit')
    return raw


def unique_object(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError('Duplicate JSON field')
        value[key] = item
    return value


def read_json(path, limit):
    return json.loads(read_bytes(path, limit), object_pairs_hook=unique_object)


def artifact_digest(path, limit):
    # Hash large provenance input incrementally rather than loading it in RAM.
    hashed = hashlib.sha256()
    total = 0
    with open_artifact(path, limit) as source:
        while chunk := source.read(min(65536, limit + 1 - total)):
            total += len(chunk)
            if total > limit:
                raise ValueError('Artifact exceeds size limit')
            hashed.update(chunk)
    return hashed.hexdigest()


def write_json(path, value):
    # Replace the destination entry atomically; never open a bundle-supplied
    # receipt symlink/hardlink for writing or truncate its external target.
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', dir=path.parent, prefix='.receipt-', delete=False) as output:
            temporary = Path(output.name)
            json.dump(value, output, indent=2)
            output.write('\n')
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def scope(index):
    name = f'benchmark-import-{index:02}'
    return dict(id=name, operator_id='local-development', tenant_id='demo',
                connector_id=name, source='qradar-siem', processor='mock-login-v1',
                allow_retry=True, allow_mock_import=True, allow_sandbox_response=False,
                pending_warning=500, age_warning_seconds=15)


def prepare(report_path, directory):
    report_raw = read_bytes(report_path, 10 << 20)
    report = json.loads(report_raw, object_pairs_hook=unique_object)
    count = report.get('events', 0)
    if (type(count) is not int or not 100 <= count <= 60000 or count % 100 or
            report.get('correctness_passed') is not True or
            report.get('accepted') != count or report.get('completed') != count or
            report.get('unacked') != 0):
        raise ValueError('Require a complete, successful bounded load report')
    source = Path(str(report_path) + '.events.jsonl')
    raw = read_bytes(source, 128 << 20)
    if digest(raw) != report.get('event_export_sha256'):
        raise ValueError('Export does not match successful report')
    events = [json.loads(line, object_pairs_hook=unique_object) for line in raw.splitlines()]
    if len(events) != count:
        raise ValueError('Export count differs from report')
    for i, event in enumerate(events):
        if event['event_id'] != f'load-{i:04}' or event['source_event_id'] != event['event_id']:
            raise ValueError('Unexpected benchmark input identity')
    directory.mkdir(parents=True, exist_ok=False)
    (directory / 'benchmark-events.jsonl').write_bytes(raw)
    (directory / 'benchmark-report.json').write_bytes(report_raw)
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
                    source_sha256=digest(raw), report_sha256=digest(report_raw),
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
        if artifact_digest(path, limit) != manifest[key]:
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
        raw = read_bytes(path, 2 << 20)
        page = json.loads(raw, object_pairs_hook=unique_object)
        if digest(raw) != entry['sha256'] or page.get('schema_version') != '1.0':
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


def ingest(directory, manifest, pages, receipt_name='import-receipt.json'):
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
                  scopes=[grant['id'] for grant, _ in pages],
                  benchmark_performance_measurement=False)
    write_json(directory / receipt_name, result)
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
        write_json(args.bundle/'verification.json', result)
        print(json.dumps(result))
        if not result['passed']: raise SystemExit(1)
    else:
        print(json.dumps(dict(valid=True, events=manifest['events'], sources=len(pages))))


if __name__ == '__main__':
    main()
