"""Loopback mTLS handshakes using temporary, test-only certificates."""
from pathlib import Path
import subprocess
import os
import tempfile
import unittest
import grpc
from grpc_health.v1 import health_pb2, health_pb2_grpc
from aisoc.worker.v1 import worker_pb2, worker_pb2_grpc
from service import Runtime, Settings
from test_service import free_port

class TLSTests(unittest.TestCase):
    def test_mutual_tls_and_identity(self):
        with tempfile.TemporaryDirectory(prefix='aisoc-tls-') as d:
            p=Path(d)
            def openssl(*args):
                subprocess.run(['openssl',*args],cwd=p,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            openssl('req','-x509','-newkey','rsa:2048','-nodes','-keyout','ca.key','-out','ca.pem','-days','1','-subj','/CN=Test CA')
            for name in ('worker.test','go.test','other.test'):
                openssl('req','-newkey','rsa:2048','-nodes','-keyout',name+'.key','-out',name+'.csr','-subj','/CN='+name)
                (p/'extensions').write_text('subjectAltName=DNS:'+name+'\nextendedKeyUsage=serverAuth,clientAuth\n')
                openssl('x509','-req','-in',name+'.csr','-CA','ca.pem','-CAkey','ca.key','-CAcreateserial','-out',name+'.pem','-days','1','-extfile','extensions')
            settings=Settings(f'127.0.0.1:{free_port()}',f'127.0.0.1:{free_port()}','x'*32,
                tls_ca_file=str(p/'ca.pem'),tls_cert_file=str(p/'worker.test.pem'),tls_key_file=str(p/'worker.test.key'),
                tls_server_name='worker.test',tls_client_name='go.test')
            runtime=Runtime(settings);runtime.start()
            try:
                self.assertTrue(runtime.ready())
                probe=os.environ.get('AISOC_TLS_GO_PROBE')
                if probe:
                    env={k:v for k,v in os.environ.items() if k in ('PATH','LANG')}
                    env.update(AISOC_GO_DATABASE_URL='postgres://localhost/aisoc_go_tls_probe',
                        AISOC_PYTHON_ADDR=settings.rpc_address,AISOC_WORKER_TOKEN=settings.token,
                        AISOC_PYTHON_TLS_CA_FILE=str(p/'ca.pem'),AISOC_GO_WORKER_TLS_CERT_FILE=str(p/'go.test.pem'),
                        AISOC_GO_WORKER_TLS_KEY_FILE=str(p/'go.test.key'),AISOC_PYTHON_TLS_SERVER_NAME='worker.test')
                    subprocess.run([probe],env=env,check=True,timeout=20)

                for name,allowed in [('go.test',True),('other.test',False)]:
                    creds=grpc.ssl_channel_credentials((p/'ca.pem').read_bytes(),(p/(name+'.key')).read_bytes(),(p/(name+'.pem')).read_bytes())
                    with grpc.secure_channel(settings.rpc_address,creds,options=[('grpc.ssl_target_name_override','worker.test')]) as ch:
                        check=health_pb2_grpc.HealthStub(ch).Check
                        if allowed:
                            self.assertEqual(check(health_pb2.HealthCheckRequest(),timeout=2,metadata=(('authorization','Bearer '+'x'*32),)).status,health_pb2.HealthCheckResponse.SERVING)
                            with self.assertRaises(grpc.RpcError):check(health_pb2.HealthCheckRequest(),timeout=2)
                        else:
                            with self.assertRaises(grpc.RpcError) as error:check(health_pb2.HealthCheckRequest(),timeout=2,metadata=(('authorization','Bearer '+'x'*32),))
                            self.assertEqual(error.exception.code(),grpc.StatusCode.UNAUTHENTICATED)
                self_creds=grpc.ssl_channel_credentials((p/'ca.pem').read_bytes(),(p/'worker.test.key').read_bytes(),(p/'worker.test.pem').read_bytes())
                with grpc.secure_channel(settings.rpc_address,self_creds,options=[('grpc.ssl_target_name_override','worker.test')]) as ch:
                    with self.assertRaises(grpc.RpcError) as error:
                        worker_pb2_grpc.WorkerStub(ch).Execute(worker_pb2.ExecuteRequest(),timeout=2,metadata=(('authorization','Bearer '+'x'*32),))
                    self.assertEqual(error.exception.code(),grpc.StatusCode.UNAUTHENTICATED)
                with grpc.secure_channel(settings.rpc_address,grpc.ssl_channel_credentials((p/'ca.pem').read_bytes()),options=[('grpc.ssl_target_name_override','worker.test')]) as ch:
                    with self.assertRaises(grpc.RpcError):health_pb2_grpc.HealthStub(ch).Check(health_pb2.HealthCheckRequest(),timeout=.5)
            finally:runtime.close()
    def test_partial_tls_fails_closed(self):
        with self.assertRaises(ValueError):Settings('127.0.0.1:50051','127.0.0.1:8001','x'*32,tls_ca_file='missing')
