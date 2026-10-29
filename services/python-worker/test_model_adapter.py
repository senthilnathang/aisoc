import json
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from aisoc.worker.v1 import investigation_pb2 as pb
from model_adapter import JSONModel


class ModelAdapterTests(unittest.TestCase):
    def test_json_fixture_and_citation_veto(self):
        result = {'verdict': 'INCONCLUSIVE', 'missing_evidence': ['iam_mfa_context'],
                  'hypotheses': [{'kind': kind, 'supporting_refs': ['evidence-1'], 'counterevidence_refs': []}
                                 for kind in ('credential_compromise', 'legitimate_user_or_automation')]}
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args): pass
            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                if body['max_output_tokens'] != 1024 or 'tools' in body:
                    self.send_error(400); return
                self.send_response(200); self.end_headers(); self.wfile.write(json.dumps(result).encode())
        server = HTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        try:
            model = JSONModel(f'http://127.0.0.1:{server.server_port}/investigate', 'fixture-v1')
            task = pb.InvestigationTask(deadline_unix_ms=int((time.time()+20)*1000),
                evidence=[pb.EvidenceItem(reference='evidence-1', content_hash='a'*64,
                    event_type='authentication.failed', event_time='2026-10-29T10:00:00Z')])
            self.assertEqual(model.investigate(task)['verdict'], 'INCONCLUSIVE')
            result['hypotheses'][0]['supporting_refs'] = ['invented-evidence']
            with self.assertRaises(ValueError): model.investigate(task)
            result['execute_action'] = 'revoke_session'
            with self.assertRaises(ValueError): model.investigate(task)
        finally:
            server.shutdown(); thread.join(); server.server_close()

    def test_endpoint_restrictions(self):
        for endpoint in ('http://example.invalid/model', 'https://user:secret@example.invalid/model', 'https://example.invalid/model?key=secret'):
            with self.assertRaises(ValueError): JSONModel(endpoint, 'model')


if __name__ == '__main__': unittest.main()
