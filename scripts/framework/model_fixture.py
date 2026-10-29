#!/usr/bin/env python3
"""Loopback JSON inference contract fixture. This is not an LLM."""
import argparse
import json
from http.server import BaseHTTPRequestHandler, HTTPServer


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    def do_POST(self):
        size = int(self.headers.get('Content-Length', '0'))
        if not 0 < size <= 16384:
            self.send_error(413); return
        value = json.loads(self.rfile.read(size))
        refs = [e['reference'] for e in value['evidence']]
        result = {'verdict': 'INCONCLUSIVE', 'missing_evidence': ['iam_mfa_context', 'endpoint_process_tree'],
                  'hypotheses': [{'kind': kind, 'supporting_refs': refs, 'counterevidence_refs': []}
                    for kind in ('credential_compromise', 'legitimate_user_or_automation')]}
        self.send_response(200); self.send_header('Content-Type', 'application/json'); self.end_headers()
        self.wfile.write(json.dumps(result).encode())


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument('--port', type=int, required=True)
    HTTPServer(('127.0.0.1', parser.parse_args().port), Handler).serve_forever()
