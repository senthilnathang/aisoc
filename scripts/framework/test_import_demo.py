import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import benchmark_import as benchmark
import import_demo as launcher


class ImportLauncherTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        report = self.root/'report.json'
        raw = b''.join(json.dumps(dict(event_id=f'load-{i:04}', source_event_id=f'load-{i:04}',
            projection=dict(principal_ref='original'))).encode()+b'\n' for i in range(1100))
        Path(str(report)+'.events.jsonl').write_bytes(raw)
        report.write_text(json.dumps(dict(events=1100, accepted=1100, completed=1100,
            unacked=0, correctness_passed=True, event_export_sha256=benchmark.digest(raw))))
        self.bundle = self.root/'bundle with spaces'
        benchmark.prepare(report, self.bundle)

    def test_selected_file_keeps_only_requested_scope(self):
        selection = launcher.select('files', [self.bundle/'benchmark-import-02.json'], self.bundle)
        self.assertEqual(100, selection[0][1]['events'])
        self.assertEqual(['benchmark-import-02'], [g['id'] for g, _ in selection[0][2]])
        with patch.object(launcher.subprocess, 'run') as run, patch.object(benchmark, 'ingest') as ingest:
            launcher.execute('files', selection, dry_run=True)
        run.assert_not_called(); ingest.assert_not_called()

    def test_all_includes_bundle_and_showcase_plan(self):
        selection = launcher.select('all', [], self.bundle)
        self.assertEqual(1100, selection[0][1]['events'])
        self.assertEqual([], launcher.select('showcase', [], self.root/'missing'))

    def test_invalid_selection_rejected_before_any_execution(self):
        first = self.bundle/'benchmark-import-01.json'
        for paths in ([], [first, first], [self.bundle/'manifest.json'], [first, self.root/'missing.json']):
            with self.assertRaises((ValueError, OSError)):
                launcher.select('files', paths, self.bundle)
        first.write_text('{}')
        with self.assertRaises(ValueError): launcher.select('all', [], self.bundle)

    def test_shell_dispatch_quotes_paths_and_refuses_release(self):
        script = launcher.demo.ROOT/'run.sh'
        args = [str(script), 'import-demo', 'files', str(self.bundle/'benchmark-import-02.json'), '--dry-run']
        env = {**os.environ, 'AISOC_RUNTIME_PROFILE': 'foundation'}
        result = subprocess.run(args, env=env, capture_output=True, text=True)
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertEqual(100, json.loads(result.stdout)['benchmark_events'])
        result = subprocess.run(args, env={**env, 'AISOC_RUNTIME_PROFILE':'release'}, capture_output=True, text=True)
        self.assertNotEqual(0, result.returncode)
        self.assertIn('foundation', result.stderr)

    def test_conflicting_grant_prevents_service_or_data_changes(self):
        selected = launcher.select('files', [self.bundle/'benchmark-import-02.json'], self.bundle)
        state = self.root/'.run/go-dev'; state.mkdir(parents=True)
        (state/'settings.json').write_text('{}')
        grants = state/'stream-scopes.json'
        wrong = {**benchmark.scope(2), 'allow_sandbox_response':True}
        grants.write_text(json.dumps([wrong]))
        with patch.object(launcher.demo, 'ROOT', self.root), patch.object(launcher.demo, 'SCOPES', grants), \
             patch.object(launcher.subprocess, 'run') as run, patch.object(benchmark, 'ingest') as ingest:
            with self.assertRaises(ValueError): launcher.execute('files', selected)
        run.assert_not_called(); ingest.assert_not_called()
        self.assertEqual([wrong], json.loads(grants.read_text()))

    def test_only_missing_selected_grants_trigger_restart(self):
        selected = launcher.select('files', [self.bundle/'benchmark-import-02.json'], self.bundle)
        state = self.root/'.run/go-dev'; state.mkdir(parents=True)
        (state/'settings.json').write_text('{}')
        grants = state/'stream-scopes.json'; grants.write_text('[]')
        with patch.object(launcher.demo, 'ROOT', self.root), patch.object(launcher.demo, 'SCOPES', grants), \
             patch.object(launcher.subprocess, 'run') as run, patch.object(benchmark, 'configure') as configure, \
             patch.object(benchmark, 'ingest', return_value={'inserted':100}) as ingest:
            launcher.execute('files', selected)
            self.assertEqual(['benchmark-import-02'], [g['id'] for g, _ in configure.call_args.args[0]])
            self.assertEqual(['stop', 'start'], [c.args[0][1] for c in run.call_args_list])
            self.assertEqual('selected-import-receipt.json', ingest.call_args.args[3])
            grants.write_text(json.dumps([benchmark.scope(2)]))
            run.reset_mock(); configure.reset_mock()
            launcher.execute('files', selected)
            configure.assert_not_called()
            self.assertEqual(['start'], [c.args[0][1] for c in run.call_args_list])


if __name__ == '__main__': unittest.main()
