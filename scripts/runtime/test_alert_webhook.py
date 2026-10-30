"""Local HTTPS and redaction verification; no external delivery."""
import json
from pathlib import Path
import ssl
import subprocess
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler,HTTPServer
import alert_webhook


class AlertTests(unittest.TestCase):
    def test_tls_trust_and_bounded_payload(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);key=root/'key.pem';cert=root/'cert.pem';configuration=root/'alert.json';received=[]
            subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1','-keyout',str(key),'-out',str(cert)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,check=True)
            class Handler(BaseHTTPRequestHandler):
                def log_message(self,*args):pass
                def do_POST(self):
                    received.append(json.loads(self.rfile.read(int(self.headers['Content-Length']))));self.send_response(204);self.end_headers()
            server=HTTPServer(('127.0.0.1',0),Handler);context=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);context.load_cert_chain(cert,key);server.socket=context.wrap_socket(server.socket,server_side=True)
            thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
            try:
                config={'endpoint':f'https://127.0.0.1:{server.server_port}/alerts','ca_file':str(cert)};configuration.write_text(json.dumps(config))
                alert_webhook.send(configuration,'go-api','unavailable')
                self.assertEqual(received,[{'schema_version':'1','component':'go-api','reason':'unavailable'}])
                config.pop('ca_file');configuration.write_text(json.dumps(config))
                with self.assertRaises(OSError):alert_webhook.send(configuration,'go-api','unavailable')
                with self.assertRaises(ValueError):alert_webhook.send(configuration,'case-contains-PII','unavailable')
                self.assertEqual(len(received),1)
            finally:server.shutdown();thread.join();server.server_close()


if __name__=='__main__':unittest.main()
