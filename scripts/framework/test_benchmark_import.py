import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import benchmark_import as importer


class BenchmarkImportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.report = self.root/'report.json'
        events = [dict(event_id=f'load-{i:04}', source_event_id=f'load-{i:04}',
                       tenant_id='disposable', connector_id='mock-qradar', source='qradar-siem',
                       projection=dict(principal_ref='same-user')) for i in range(100)]
        raw = b''.join(json.dumps(e).encode()+b'\n' for e in events)
        Path(str(self.report)+'.events.jsonl').write_bytes(raw)
        self.report.write_text(json.dumps(dict(events=100, accepted=100, completed=100,
            unacked=0, correctness_passed=True, event_export_sha256=importer.digest(raw))))
        self.bundle = self.root/'bundle'

    def test_preserves_input_and_documents_rebinding(self):
        manifest, pages = importer.prepare(self.report, self.bundle)
        self.assertEqual(100, manifest['events'])
        self.assertEqual('demo', pages[0][1][0]['tenant_id'])
        self.assertFalse(pages[0][0]['allow_sandbox_response'])
        self.assertEqual(100, len({e['projection']['principal_ref'] for e in pages[0][1]}))
        self.assertEqual(Path(str(self.report)+'.events.jsonl').read_bytes(),
                         (self.bundle/'benchmark-events.jsonl').read_bytes())

    def test_failed_report_cannot_prepare(self):
        report = json.loads(self.report.read_text()); report['completed'] = 99
        self.report.write_text(json.dumps(report))
        with self.assertRaises(ValueError): importer.prepare(self.report, self.bundle)
        self.assertFalse(self.bundle.exists())

    def test_tampering_and_path_escape_rejected(self):
        importer.prepare(self.report, self.bundle)
        path = self.bundle/'benchmark-import-01.json'
        original = path.read_bytes(); path.write_bytes(original+b' ')
        with self.assertRaises(ValueError): importer.validate(self.bundle)
        path.write_bytes(original)
        manifest = json.loads((self.bundle/'manifest.json').read_text())
        manifest['files'][0]['file'] = '../report.json'
        (self.bundle/'manifest.json').write_text(json.dumps(manifest))
        with self.assertRaises(ValueError): importer.validate(self.bundle)

    def test_resume_uses_current_checkpoint_and_counts_duplicates(self):
        manifest, pages = importer.prepare(self.report, self.bundle)
        grants = self.root/'scopes.json'; grants.write_text(json.dumps([pages[0][0]]))
        calls = []
        def request(path, body=None):
            if body is None: return {'checkpoint': {'Cursor': 'already-imported', 'Version': 1}}
            calls.append(body)
            return {'accepted': {'Checkpoint': {'Version': 2}, 'Inserted': 0}}
        with patch.object(importer, 'SCOPES', grants), patch.object(importer, 'request', request):
            result = importer.ingest(self.bundle, manifest, pages)
        self.assertEqual(0, result['inserted'])
        self.assertEqual(100, result['duplicates'])
        self.assertEqual('already-imported', calls[0]['expected_checkpoint']['Cursor'])


if __name__ == '__main__': unittest.main()
