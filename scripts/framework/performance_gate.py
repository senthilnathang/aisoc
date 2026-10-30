#!/usr/bin/env python3
"""Evaluate repeated local transport reports; never certify model/production capacity."""
import argparse
import json
import math
from pathlib import Path


def evaluate(reports):
    failures = []
    if len(reports) < 3:
        failures.append('Require at least three independent sustained runs')
    signatures = {json.dumps({key: report.get(key) for key in (
        'offered_eps', 'producer_batch_size', 'consumer_batch_limit',
        'publisher_claim_batch_size', 'postgres_runtime', 'go_version', 'race',
        'disposable_cluster_cleanup')}, sort_keys=True)
        for report in reports}
    if len(signatures) > 1:
        failures.append('Repeated runs must use the same workload and runtime configuration')
    throughput_failures = list(failures)
    for index, report in enumerate(reports, 1):
        def require(condition, message, latency=False):
            if not condition:
                failures.append(f'run {index}: {message}')
                if not latency:
                    throughput_failures.append(f'run {index}: {message}')
        def bounded(value, lower, upper):
            return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and lower <= value <= upper
        count = report.get('events')
        require(bounded(count, 60000, 100000), 'require at least 60,000 events')
        require(report.get('correctness_passed') is True and report.get('accepted') == count and report.get('completed') == count and report.get('unacked') == 0, 'incomplete or incorrect delivery')
        require(bounded(report.get('offered_eps'), 1000, 2000), 'offered load below target or outside tested bounds')
        require(bounded(report.get('scheduled_input_seconds'), 50 - .001, 3600), 'input window too short')
        require(bounded(report.get('commit_ack_eps'), 1000, 100000), 'final commit/ACK throughput below 1,000 EPS')
        require(bounded(report.get('max_producer_schedule_lag_ms'), 0, 1000), 'producer fell more than 1 second behind', latency=True)
        require(bounded(report.get('scheduled_start_to_committed_ack_ms', {}).get('p95'), 0, 2000), 'scheduled-to-ACK p95 exceeds 2 seconds', latency=True)
        state = report.get('postgres_snapshot_including_one_setup_event', {})
        require(all(state.get(key) == 0 for key in ('pending', 'dead_without_disposition', 'publication_failed', 'historical_gap_observations', 'dead_letters')), 'nonzero or missing final failure/backlog counts')
        pg = report.get('postgres_runtime', {})
        require(all(pg.get(key) == 'on' for key in ('fsync', 'synchronous_commit', 'full_page_writes')), 'durability settings not verified')
    return {'passed': not failures, 'average_throughput_passed': not throughput_failures,
        'scope': 'local synthetic durable transport only; average throughput does not imply stable latency or production capacity',
        'runs': len(reports), 'failures': failures}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--summary', action='store_true', help='Display selected measurements without evaluating the gate')
    parser.add_argument('reports', type=Path, nargs='+')
    args = parser.parse_args()
    if len({path.resolve() for path in args.reports}) != len(args.reports):
        parser.error('Each report path must be distinct')
    reports = [json.loads(path.read_text()) for path in args.reports]
    if args.summary:
        for path, report in zip(args.reports, reports):
            print(json.dumps({'file': str(path), **{key: report.get(key) for key in (
                'status', 'accepted', 'completed', 'unacked', 'achieved_eps', 'commit_ack_eps',
                'scheduled_start_to_committed_ack_ms', 'max_producer_schedule_lag_ms',
                'postgres_runtime')}}))
        return
    if len({report.get('event_export_sha256') for report in reports}) != len(reports):
        parser.error('Repeated reports must come from independent generated fixtures')
    result = evaluate(reports)
    print(json.dumps(result, indent=2))
    raise SystemExit(0 if result['passed'] else 1)


if __name__ == '__main__':
    main()
