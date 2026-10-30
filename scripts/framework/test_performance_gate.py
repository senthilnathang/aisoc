import copy
import unittest
from performance_gate import evaluate


class PerformanceGateTests(unittest.TestCase):
    def valid(self):
        return dict(events=60000, accepted=60000, completed=60000, unacked=0,
            correctness_passed=True, offered_eps=1200, scheduled_input_seconds=50,
            commit_ack_eps=1100, max_producer_schedule_lag_ms=100,
            scheduled_start_to_committed_ack_ms={'p95': 200},
            postgres_snapshot_including_one_setup_event=dict(pending=0, dead_without_disposition=0,
                publication_failed=0, historical_gap_observations=0, dead_letters=0),
            postgres_runtime=dict(fsync='on', synchronous_commit='on', full_page_writes='on'))

    def test_requires_repeated_correct_durable_low_latency_runs(self):
        baseline = [self.valid() for _ in range(3)]
        self.assertTrue(evaluate(baseline)['passed'])
        self.assertFalse(evaluate(baseline[:2])['passed'])
        for key, value in [('commit_ack_eps', 999), ('commit_ack_eps', float('nan')),
                           ('max_producer_schedule_lag_ms', 1001), ('completed', 59999),
                           ('correctness_passed', False), ('postgres_runtime', {}),
                           ('producer_batch_size', 100),
                           ('scheduled_start_to_committed_ack_ms', {'p95': 2001})]:
            reports = copy.deepcopy(baseline)
            reports[1][key] = value
            self.assertFalse(evaluate(reports)['passed'], key)

    def test_latency_failure_cannot_be_hidden_by_average_throughput(self):
        reports = [self.valid() for _ in range(3)]
        reports[1]['scheduled_start_to_committed_ack_ms']['p95'] = 20000
        result = evaluate(reports)
        self.assertTrue(result['average_throughput_passed'])
        self.assertFalse(result['passed'])


if __name__ == '__main__':
    unittest.main()
