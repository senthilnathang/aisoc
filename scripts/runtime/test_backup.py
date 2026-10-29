"""Failure/status and overlapping-backup regression checks; no live database."""
import contextlib
import fcntl
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import backup


class BackupStatusTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.state = self.root / '.run/go-runtime'
        self.state.mkdir(parents=True)
        (self.state / 'settings.json').write_text('{}')
        self.report = self.root / 'output/migration/release-backup.json'

    def invoke(self):
        with patch.object(backup, 'ROOT', self.root), patch('sys.argv', ['backup.py']), contextlib.redirect_stderr(io.StringIO()), contextlib.redirect_stdout(io.StringIO()):
            backup.main()

    def test_failure_replaces_old_success_without_secret(self):
        self.report.parent.mkdir(parents=True)
        self.report.write_text('{"passed":true}')
        with patch.object(backup, 'backup', side_effect=RuntimeError('private-password')):
            with self.assertRaises(SystemExit) as raised:
                self.invoke()
        self.assertEqual(raised.exception.code, 1)
        result = json.loads(self.report.read_text())
        self.assertFalse(result['passed'])
        self.assertEqual(result['status'], 'failed')
        self.assertNotIn('private-password', self.report.read_text())

    def test_overlap_preserves_active_report(self):
        self.report.parent.mkdir(parents=True)
        self.report.write_text('{"status":"running"}')
        with (self.root / '.run/backup.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with patch.object(backup, 'backup') as execute:
                with self.assertRaises(SystemExit):
                    self.invoke()
                execute.assert_not_called()
        self.assertEqual(json.loads(self.report.read_text()), {'status': 'running'})

    def test_success_published_after_verification(self):
        def verified(state):
            self.assertEqual(state, self.state)
            self.assertEqual(json.loads(self.report.read_text())['status'], 'running')
            return {'passed': True, 'tables': {}, 'backup_seconds': 1,
                    'restore_seconds': 2, 'private_artifacts': 'private'}
        with patch.object(backup, 'backup', side_effect=verified):
            self.invoke()
        self.assertEqual(json.loads(self.report.read_text())['status'], 'complete')


if __name__ == '__main__':
    unittest.main()
