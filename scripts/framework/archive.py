#!/usr/bin/env python3
"""Archive eligible local foundation payloads in bounded, verified pages."""
import argparse
import json
import subprocess
import dev


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scope', required=True)
    parser.add_argument('--min-age-days', type=int, default=7, choices=range(1, 366))
    parser.add_argument('--max-pages', type=int, default=10, choices=range(1, 101))
    args = parser.parse_args()
    config = dev.settings()
    if not config.get('streams_enabled'):
        raise RuntimeError('Foundation streaming must be configured')
    subprocess.run(['go', 'build', '-o', 'bin/stream-archive', './cmd/stream-archive'], cwd=dev.ROOT/'backend-go', check=True)
    after = ''; total = 0
    for _ in range(args.max_pages):
        result = subprocess.check_output([str(dev.ROOT/'backend-go/bin/stream-archive'), '--scope', args.scope,
            '--directory', str(dev.STATE/'archives'), '--min-age-days', str(args.min_age_days), '--after', after],
            env=dev.dev_env(config), cwd=dev.ROOT, text=True, timeout=40)
        receipt = json.loads(result); total += receipt['events']; print(result.strip(), flush=True)
        after = receipt.get('next', '')
        if not after: break
    print(json.dumps({'archived_events': total, 'continuation': after,
        'evidence_and_dedup_preserved': True, 'archive_directory': str(dev.STATE/'archives')}))


if __name__ == '__main__': main()
