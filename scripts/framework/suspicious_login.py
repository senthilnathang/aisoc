#!/usr/bin/env python3
"""Configurable local JSON → Go/Redis/Python/QA → reviewed mock SOAR scenario."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import time
import urllib.request
from urllib.parse import urlparse, quote

ROOT = Path(__file__).resolve().parents[2]
DEFAULT = ROOT / 'examples/scenarios/suspicious-login/scenario.json'


def load(path):
    raw = path.read_bytes()
    if len(raw) > 65536:
        raise ValueError('Scenario configuration exceeds 64 KiB')
    config = json.loads(raw)
    if set(config) - {'context_file', 'expected_missing'} != {'schema_version', 'name', 'mode', 'api_base', 'scope', 'events_file'} or config['schema_version'] != '1' or config['mode'] != 'local-json-mock-v1':
        raise ValueError('Unsupported scenario contract')
    endpoint = urlparse(config['api_base'])
    if endpoint.scheme != 'http' or endpoint.hostname not in ('127.0.0.1', 'localhost', '::1') or endpoint.port == 3002 or endpoint.username or endpoint.password or endpoint.query or endpoint.fragment or endpoint.path not in ('', '/'):
        raise ValueError('Use a local foundation/disposable API origin; release port 3002 is forbidden')
    scope = config['scope']
    if scope.get('require_analyst_review') is not True or scope.get('allow_mock_import') is not True or scope.get('allow_sandbox_response') is not False or scope.get('source') != 'qradar-siem' or scope.get('processor') != 'mock-login-v1':
        raise ValueError('Scenario requires reviewed mock intake with response execution disabled')
    event_path = (path.parent / config['events_file']).resolve()
    if not event_path.is_relative_to(path.parent.resolve()) or event_path.stat().st_size > 65536:
        raise ValueError('Events must be a bounded local scenario file')
    events = json.loads(event_path.read_text())
    if not isinstance(events, list) or len(events) != 4:
        raise ValueError('Suspicious-login scenario requires four observations')
    for event in events:
        for key in ('tenant_id', 'connector_id', 'source'):
            if event.get(key) != scope[key]:
                raise ValueError('Event identity differs from configured trusted source')
    if 'context_file' in config:
        context_path = (path.parent / config['context_file']).resolve()
        if not context_path.is_relative_to(path.parent.resolve()) or context_path.stat().st_size > 32768:
            raise ValueError('Context must be a bounded local scenario file')
        bundle = json.loads(context_path.read_text())
        if bundle.get('tenant_id') != scope['tenant_id']:
            raise ValueError('Context tenant differs from trusted source')
        scope['mock_login_context'] = bundle
    return config, events


class Client:
    def __init__(self, config):
        self.origin = config['api_base'].rstrip('/')
        self.headers = {'Content-Type': 'application/json', 'X-Tenant-Id': config['scope']['tenant_id']}
    def request(self, path, body=None):
        req = urllib.request.Request(self.origin + path, headers=self.headers, data=None if body is None else json.dumps(body).encode())
        # Redirects must not forward trusted tenant context outside the local origin.
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *args):
                return None
        with urllib.request.build_opener(NoRedirect).open(req, timeout=10) as response:
            return json.load(response)


def configure(config):
    profile = ROOT / '.run/runtime-profile'
    if not profile.exists() or profile.read_text().strip() != 'foundation':
        raise ValueError('Initialize the local foundation profile first')
    path = ROOT / '.run/go-dev/stream-scopes.json'
    with (ROOT / '.run/demo-import.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        scopes = json.loads(path.read_text())
        scope = config['scope']
        existing = next((x for x in scopes if x['id'] == scope['id']), None)
        if existing is not None and existing != scope:
            raise ValueError('Existing grant differs; refusing to overwrite')
        if existing is None:
            if len(scopes) >= 100:
                raise ValueError('Scope limit reached')
            scopes.append(scope)
            temporary = path.with_suffix('.scenario.tmp')
            fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, 'w') as out:
                json.dump(scopes, out, indent=2)
                out.write('\n')
            temporary.replace(path)
    return {'configured': True, 'restart_required': True, 'scope': scope['id']}


def run(config, events, approve=False, comment='', timeout=60):
    if approve and len(comment.strip()) < 10:
        raise ValueError('Approval needs an explicit review comment of at least ten characters')
    c = Client(config)
    if c.request('/health').get('database') != 'postgresql':
        raise ValueError('Go/PostgreSQL API required')
    scope = config['scope']
    base = '/api/v1/stream-operations/' + quote(scope['id'], safe='')
    before = c.request(base)
    if before['scope'] != scope:
        # Optional server defaults are allowed, but every configured grant must agree.
        if any(before['scope'].get(k) != v for k, v in scope.items()):
            raise ValueError('Server grant differs; configure/restart before import')
    page = {'schema_version': '1.0', 'expected_checkpoint': before['checkpoint'], 'next_cursor': 'suspicious-login-v1', 'events': events}
    accepted = c.request(base + '/mock-import', page)['accepted']
    deadline = time.monotonic() + timeout
    def wait_for(states):
        while time.monotonic() < deadline:
            state = c.request(base)
            if state.get('cases') and state['cases'][0]['state'] in states:
                if len(state['cases']) != 1:
                    raise ValueError('Use a dedicated source with exactly one scenario finding')
                return state
            time.sleep(.5)
        raise TimeoutError('Scenario did not reach expected stage; inspect Stream operations')
    state = wait_for({'awaiting_review', 'synced'})
    case = state['cases'][0]
    case_path = '/api/v1/investigations/' + quote(case['investigation_id'], safe='')
    review = c.request(case_path + '/l1')
    if review['result_status'] != 'verified' or review['result']['verdict'] != 'INCONCLUSIVE' or not review['result']['requires_human_review'] or len(review['evidence']) != len(events) + sum(len(scope.get('mock_login_context', {}).get(k, [])) for k in ('iam', 'edr')) or not review['review_required']:
        raise ValueError('Evidence/QA/review contract failed')
    if 'expected_missing' in config and sorted(review['result']['missing_evidence']) != sorted(config['expected_missing']):
        raise ValueError('Context gap evaluation differs from expected scenario')
    if not review.get('reviewed_by') and (case['note_id'] or case['state'] != 'awaiting_review'):
        raise ValueError('Mock note was written before analyst approval')
    if approve and not review.get('reviewed_by'):
        c.request(base + '/approve-mock-note', {'job_id': review['job_id'], 'comment': comment})
        c.request(base + '/approve-mock-note', {'job_id': review['job_id'], 'comment': comment})
        state = wait_for({'synced'})
        case = state['cases'][0]
        review = c.request(case_path + '/l1')
    replay = c.request(base + '/mock-import', {**page, 'expected_checkpoint': state['checkpoint']})['accepted']
    if replay['Inserted'] != 0:
        raise ValueError('Replay inserted duplicate events')
    if c.request(case_path)['status'] != 'open':
        raise ValueError('Scenario unexpectedly changed case status')
    return {'passed': True, 'mode': 'local-json-mock-v1', 'scope': scope['id'], 'inserted': accepted['Inserted'], 'replay_inserted': replay['Inserted'], 'case_id': case['investigation_id'], 'job_id': review['job_id'], 'evidence_count': len(review['evidence']), 'verdict': review['result']['verdict'], 'missing_evidence': review['result']['missing_evidence'], 'context': [{'reference': e['reference'], **e['context']} for e in review['evidence'] if e.get('context')], 'qa': review['result_status'], 'sync_state': case['state'], 'reviewed_by': review.get('reviewed_by'), 'review_comment': review.get('review_comment'), 'note_id': case['note_id'], 'case_status': 'open', 'live_provider_calls': 0, 'model_quality_evaluated': False, 'privileged_actions_enabled': state['privileged_actions_enabled']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, default=DEFAULT)
    parser.add_argument('--configure', action='store_true')
    parser.add_argument('--approve-mock-note', action='store_true')
    parser.add_argument('--comment', default='')
    parser.add_argument('--timeout', type=int, default=60)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    if not 1 <= args.timeout <= 120:
        parser.error('Timeout must be 1..120 seconds')
    config, events = load(args.config.resolve())
    result = configure(config) if args.configure else run(config, events, args.approve_mock_note, args.comment, args.timeout)
    text = json.dumps(result, indent=2) + '\n'
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(text)
    print(text, end='')


if __name__ == '__main__':
    main()
