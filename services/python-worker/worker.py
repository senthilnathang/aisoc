"""Trusted, bounded sample plugin worker. No database access or dynamic imports."""
import hmac
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
        credentials = [value for key, value in context.invocation_metadata() if key == 'authorization']
        if len(credentials) != 1 or not hmac.compare_digest(credentials[0].encode(), self.credential.encode()):
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
    # Keep the original executable entry point; FastAPI owns both listeners.
    from service import main as serve
    serve()


if __name__ == '__main__':
    main()
