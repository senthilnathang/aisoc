"""Real HTTP/gRPC boundary tests; no database or live provider credentials."""
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import threading
import time
import unittest
import urllib.error
import urllib.request
from unittest.mock import patch

import grpc
from grpc_health.v1 import health_pb2, health_pb2_grpc
from aisoc.worker.v1 import worker_pb2, worker_pb2_grpc
from service import Runtime, Settings
from worker import Worker


def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


class SettingsTests(unittest.TestCase):
    def test_reject_remote_bind_duplicate_ports_and_weak_credentials(self):
        for rpc, http, token in [
            ('0.0.0.0:50051', '127.0.0.1:8001', 'x'*32),
            ('127.0.0.1:50051', '0.0.0.0:8001', 'x'*32),
            ('localhost:50051', '127.0.0.1:8001', 'x'*32),
            ('127.0.0.1:50051', '127.0.0.1:50051', 'x'*32),
            ('127.0.0.1:50051', '127.0.0.1:8001', 'short'),
        ]:
            with self.subTest(rpc=rpc, http=http), self.assertRaises(ValueError):
                Settings(rpc, http, token)


class AdmissionTests(unittest.TestCase):
    def test_saturation_rejects_excess_work_and_readiness_recovers(self):
        settings = Settings(f'127.0.0.1:{free_port()}', f'127.0.0.1:{free_port()}', 'x'*32)
        release = threading.Event()
        entered = threading.Barrier(5)

        def blocked(_worker, request, context):
            entered.wait(timeout=5)
            if not release.wait(timeout=5):
                context.abort(grpc.StatusCode.DEADLINE_EXCEEDED, 'test release timed out')
            return worker_pb2.ExecuteResponse(tenant_id=request.tenant_id)

        with patch.object(Worker, 'Execute', blocked):
            runtime = Runtime(settings)
            runtime.start()
            try:
                with grpc.insecure_channel(settings.rpc_address) as channel:
                    stub = worker_pb2_grpc.WorkerStub(channel)
                    calls = [stub.Execute.future(worker_pb2.ExecuteRequest(tenant_id='a'), timeout=8) for _ in range(4)]
                    entered.wait(timeout=5)
                    with self.assertRaises(grpc.RpcError) as err:
                        stub.Execute(worker_pb2.ExecuteRequest(), timeout=1)
                    self.assertEqual(err.exception.code(), grpc.StatusCode.RESOURCE_EXHAUSTED)
                    self.assertFalse(runtime.ready())
                    release.set()
                    for call in calls:
                        self.assertEqual(call.result(timeout=2).tenant_id, 'a')
                    self.assertTrue(runtime.ready())
                    runtime.serving.clear()
                    self.assertFalse(runtime.ready())
            finally:
                release.set()
                runtime.close()


class ServiceTests(unittest.TestCase):
    def setUp(self):
        self.token = 'test-service-credential-' + 'x'*32
        self.rpc_port, self.http_port = free_port(), free_port()
        self.metadata = (('authorization', 'Bearer '+self.token),)
        self.process = None
        self.start()
        self.channel = grpc.insecure_channel(f'127.0.0.1:{self.rpc_port}')
        self.addCleanup(self.channel.close)
        self.stub = worker_pb2_grpc.WorkerStub(self.channel)
        self.health = health_pb2_grpc.HealthStub(self.channel)

    def start(self):
        env = {k:v for k,v in os.environ.items() if k in ('PATH', 'LANG')}
        env.update(AISOC_WORKER_TOKEN=self.token, AISOC_PYTHON_ADDR=f'127.0.0.1:{self.rpc_port}',
                   AISOC_PYTHON_HTTP_ADDR=f'127.0.0.1:{self.http_port}')
        self.process = subprocess.Popen([sys.executable, str(Path(__file__).with_name('worker.py'))],
            env=env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        self.addCleanup(self.stop)
        for _ in range(100):
            if self.process.poll() is not None:
                self.fail(self.process.stderr.read().decode())
            try:
                if self.http('/ready')['status'] == 'ready':
                    return
            except (OSError, urllib.error.URLError):
                pass
            time.sleep(.05)
        self.fail('Python service readiness timed out')

    def stop(self):
        if self.process is not None:
            if self.process.poll() is None:
                self.process.terminate()
                try:
                    self.process.wait(timeout=12)
                except subprocess.TimeoutExpired:
                    self.process.kill()
                    self.process.wait(timeout=5)
                    self.fail('service did not stop gracefully')
            self.process.stderr.close()

    def http(self, path, headers=None):
        request = urllib.request.Request(f'http://127.0.0.1:{self.http_port}'+path, headers=headers or {})
        with urllib.request.urlopen(request, timeout=2) as response:
            return json.load(response)

    def request(self, **kwargs):
        values = dict(tenant_id='tenant-a', job_id='job', attempt_id='attempt',
                      plugin_id='python.normalize', plugin_version='1', input=b'  Hello WORLD ')
        values.update(kwargs)
        return worker_pb2.ExecuteRequest(**values)

    def test_http_and_grpc_share_lifecycle_and_reconnect(self):
        self.assertEqual(self.http('/health')['status'], 'ok')
        with self.assertRaises(urllib.error.HTTPError) as err:
            self.http('/v1/capabilities')
        self.assertEqual(err.exception.code, 401)
        capabilities = self.http('/v1/capabilities', {'Authorization': 'Bearer '+self.token})
        self.assertEqual(capabilities['plugins'], [{'id': 'python.normalize', 'version': '1'}])
        response = self.stub.Execute(self.request(), timeout=2, metadata=self.metadata)
        self.assertEqual(response.output, b'hello world')
        self.assertEqual(response.tenant_id, 'tenant-a')
        self.assertEqual(self.health.Check(health_pb2.HealthCheckRequest(service='aisoc.worker.v1.Worker'),
            timeout=1, metadata=self.metadata).status, health_pb2.HealthCheckResponse.SERVING)
        self.stop()
        with self.assertRaises(urllib.error.URLError):
            self.http('/health')
        with self.assertRaises(grpc.RpcError):
            self.stub.Execute(self.request(), timeout=.2, metadata=self.metadata)
        self.start()
        # Reuse the same channel across a service restart.
        response = self.stub.Execute(self.request(), timeout=5, wait_for_ready=True, metadata=self.metadata)
        self.assertEqual(response.output, b'hello world')

    def test_auth_validation_limits_and_unknown_health_service(self):
        cases = [
            (self.request(), (), grpc.StatusCode.UNAUTHENTICATED),
            (self.request(), self.metadata*2, grpc.StatusCode.UNAUTHENTICATED),
            (self.request(tenant_id=''), self.metadata, grpc.StatusCode.INVALID_ARGUMENT),
            (self.request(input=b'x'*65537), self.metadata, grpc.StatusCode.INVALID_ARGUMENT),
            (self.request(input=b'x'*80000), self.metadata, grpc.StatusCode.RESOURCE_EXHAUSTED),
            (self.request(plugin_version='2'), self.metadata, grpc.StatusCode.UNIMPLEMENTED),
        ]
        for request, metadata, expected in cases:
            with self.subTest(expected=expected), self.assertRaises(grpc.RpcError) as err:
                self.stub.Execute(request, metadata=metadata, timeout=2)
            self.assertEqual(err.exception.code(), expected)
        for service, metadata, expected in [('', (), grpc.StatusCode.UNAUTHENTICATED),
                ('unknown', self.metadata, grpc.StatusCode.NOT_FOUND)]:
            with self.assertRaises(grpc.RpcError) as err:
                self.health.Check(health_pb2.HealthCheckRequest(service=service), timeout=1, metadata=metadata)
            self.assertEqual(err.exception.code(), expected)


if __name__ == '__main__':
    unittest.main()
