import json
import os
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

    def test_receipt_replaces_links_without_modifying_target(self):
        target = self.root/'private.json'
        target.write_text('preserve me')
        for kind in ('symlink', 'hardlink'):
            receipt = self.root/kind
            if kind == 'symlink': receipt.symlink_to(target)
            else: os.link(target, receipt)
            importer.write_json(receipt, {'passed': True})
            self.assertEqual('preserve me', target.read_text())
            self.assertFalse(receipt.is_symlink())
            self.assertEqual({'passed': True}, json.loads(receipt.read_text()))
            self.assertEqual(0o600, receipt.stat().st_mode & 0o777)

    def test_artifact_rejects_links_fifo_oversize_and_duplicate_keys(self):
        link = self.root/'link'
        link.symlink_to(self.report)
        with self.assertRaises(OSError): importer.read_json(link, 10000)
        fifo = self.root/'fifo'
        os.mkfifo(fifo)
        with self.assertRaises(ValueError): importer.read_json(fifo, 10000)
        with self.assertRaises(ValueError): importer.read_json(self.report, 1)
        duplicate = self.root/'duplicate.json'
        duplicate.write_text('{"tenant_id":"a","tenant_id":"b"}')
        with self.assertRaises(ValueError): importer.read_json(duplicate, 1000)

    def test_streamed_digest_matches_and_enforces_size(self):
        source = self.root/'large.jsonl'
        raw = b'x' * 150000
        source.write_bytes(raw)
        self.assertEqual(importer.digest(raw), importer.artifact_digest(source, len(raw)))
        with self.assertRaises(ValueError): importer.artifact_digest(source, len(raw)-1)

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
