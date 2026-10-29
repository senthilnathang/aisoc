#!/usr/bin/env python3
"""Replay-safe synthetic showcase loader for the local foundation, never release."""
import argparse
import copy
import json
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
SCOPES = ROOT / '.run/go-dev/stream-scopes.json'
BASE = 'http://127.0.0.1:3003/api/v1/stream-operations'


def request(path, body=None):
    req = urllib.request.Request(BASE + path, data=None if body is None else json.dumps(body).encode(),
        headers={'Content-Type': 'application/json', 'X-Tenant-Id': 'demo'})
    with urllib.request.urlopen(req, timeout=30) as response:
        return json.load(response)


def scopes():
    return [{'id': f'demo-showcase-{n:02}', 'operator_id': 'local-development',
        'tenant_id': 'demo', 'connector_id': f'demo-showcase-{n:02}', 'source': 'qradar-siem',
        'processor': 'mock-login-v1', 'allow_retry': True, 'allow_mock_import': True,
        'allow_sandbox_response': n == 1,
        'pending_warning': 500, 'age_warning_seconds': 15} for n in range(1, 11)]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--configure', action='store_true', help='Add ten private local grants; restart foundation afterward')
    args = parser.parse_args()
    if args.configure:
        current = json.loads(SCOPES.read_text())
        for scope in scopes():
            existing = next((s for s in current if s['id'] == scope['id']), None)
            if existing is not None and existing != scope:
                raise RuntimeError('Existing showcase scope differs; refusing to overwrite')
            if existing is None: current.append(scope)
        if len(current) > 100: raise RuntimeError('Too many configured scopes')
        temporary = SCOPES.with_suffix('.tmp')
        temporary.touch(mode=0o600, exist_ok=False)
        temporary.write_text(json.dumps(current, indent=2) + '\n')
        temporary.replace(SCOPES)
        print('Ten demo scopes configured; restart the local foundation before loading.')
        return
    inserted = 0
    for scope in scopes():
        prefix = '/' + scope['id']
        page = request(prefix + '/mock-example')
        events = page['events']
        for event in events:
            event['projection']['principal_ref'] = scope['id'] + '-review-user'
        for n in range(4, 1000):
            event = copy.deepcopy(events[0])
            event.update(event_id=f'demo-event-{n:04}', source_event_id=f'demo-event-{n:04}',
                evidence_ref=f'mock-siem:demo-{n:04}', event_type='authentication.failed', severity='low')
            event['projection'].update(principal_ref=f'demo-user-{n:04}', asset_ref=f'demo-host-{n % 25:02}', source_ip=f'192.0.2.{1+n%250}')
            events.append(event)
        checkpoint = request(prefix)['checkpoint']
        source_inserted = 0
        for start in range(0, len(events), 100):
            receipt = request(prefix + '/mock-import', {'schema_version': '1.0',
                'expected_checkpoint': checkpoint, 'next_cursor': f'demo-v1-{start+100}',
                'events': events[start:start+100]})['accepted']
            checkpoint = receipt['Checkpoint']; source_inserted += receipt['Inserted']
        inserted += source_inserted
        print(f"{scope['id']}: {source_inserted} new synthetic events", flush=True)
    print(f'Completed: 10,000 deterministic showcase events; {inserted} newly inserted. Repeating is safe.')


if __name__ == '__main__': main()
