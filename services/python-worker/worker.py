"""Trusted, bounded sample plugin worker. No database access or dynamic imports."""
import concurrent.futures
import hmac
import ipaddress
import os
import signal
import threading
import subprocess
import sys
import time
from pathlib import Path

import grpc
from aisoc.worker.v1 import worker_pb2, worker_pb2_grpc


class Worker(worker_pb2_grpc.WorkerServicer):
    def __init__(self, token):
        self.credential = 'Bearer ' + token

    def Execute(self, request, context):
        metadata = dict(context.invocation_metadata())
        if not hmac.compare_digest(metadata.get('authorization', ''), self.credential):
            context.abort(grpc.StatusCode.UNAUTHENTICATED, 'invalid worker credential')
        if any(not value or len(value.encode()) > 120 for value in (request.tenant_id, request.job_id, request.attempt_id)) or len(request.input) > 65536:
            context.abort(grpc.StatusCode.INVALID_ARGUMENT, 'invalid identity or payload size')
        if request.plugin_id != 'python.normalize' or request.plugin_version != '1':
            context.abort(grpc.StatusCode.UNIMPLEMENTED, 'unknown plugin version')
        if not context.is_active():
            context.abort(grpc.StatusCode.CANCELLED, 'request cancelled')
        process = subprocess.Popen([sys.executable, '-I', str(Path(__file__).with_name('plugin_runner.py')), request.plugin_id],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            env={'LANG': 'C.UTF-8', 'PATH': '/usr/bin:/bin'}, close_fds=True)
        deadline = time.monotonic() + 3
        payload = request.input
        try:
            while True:
                if not context.is_active():
                    context.abort(grpc.StatusCode.CANCELLED, 'request cancelled')
                if time.monotonic() >= deadline:
                    context.abort(grpc.StatusCode.DEADLINE_EXCEEDED, 'plugin deadline exceeded')
                try:
                    result, _ = process.communicate(payload, timeout=.05)
                    break
                except subprocess.TimeoutExpired:
                    payload = None
            if process.returncode == 4:
                context.abort(grpc.StatusCode.INVALID_ARGUMENT, 'input must be UTF-8')
            if process.returncode != 0:
                context.abort(grpc.StatusCode.RESOURCE_EXHAUSTED, 'plugin failed or exceeded limits')
        finally:
            if process.poll() is None:
                process.kill()
            process.wait(timeout=5)
        if len(result) > 65536:
            context.abort(grpc.StatusCode.RESOURCE_EXHAUSTED, 'output too large')
        return worker_pb2.ExecuteResponse(tenant_id=request.tenant_id, job_id=request.job_id,
            attempt_id=request.attempt_id, plugin_id=request.plugin_id,
            plugin_version=request.plugin_version, output=result)


def main():
    address = os.environ.get('AISOC_PYTHON_ADDR', '127.0.0.1:50051')
    host, port = address.rsplit(':', 1)
    if not ipaddress.ip_address(host.strip('[]')).is_loopback or not 0 < int(port) < 65536:
        raise ValueError('framework RPC must bind loopback')
    token = os.environ['AISOC_WORKER_TOKEN']
    if len(token) < 32:
        raise ValueError('worker token must contain at least 32 characters')
    stop = threading.Event()
    for signum in (signal.SIGTERM, signal.SIGINT):
        signal.signal(signum, lambda *_: stop.set())
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        server = grpc.server(executor, maximum_concurrent_rpcs=4, options=[
            ('grpc.max_receive_message_length', 70000), ('grpc.max_send_message_length', 70000)])
        worker_pb2_grpc.add_WorkerServicer_to_server(Worker(token), server)
        if not server.add_insecure_port(address):
            raise RuntimeError('worker bind failed')
        server.start()
        print('Python sample worker listening on '+address, flush=True)
        stop.wait()
        server.stop(grace=5).wait(timeout=6)


if __name__ == '__main__':
    main()
