"""Independent FastAPI + gRPC sidecar. Go owns all durable state and orchestration."""
import asyncio
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from dataclasses import dataclass
import hmac
import ipaddress
import os
import threading

from fastapi import FastAPI, HTTPException, Request
import grpc
from grpc_health.v1 import health_pb2, health_pb2_grpc
import uvicorn

from aisoc.worker.v1 import worker_pb2_grpc
from worker import Worker

SERVICE = 'aisoc.worker.v1.Worker'


def loopback(address):
    host, port = address.rsplit(':', 1)
    host = host.strip('[]')
    if not ipaddress.ip_address(host).is_loopback or not 0 < int(port) < 65536:
        raise ValueError('Python service listeners must use literal loopback addresses')
    return host, int(port)


@dataclass(frozen=True)
class Settings:
    rpc_address: str
    http_address: str
    token: str

    def __post_init__(self):
        rpc, http = loopback(self.rpc_address), loopback(self.http_address)
        if rpc == http:
            raise ValueError('HTTP and gRPC require different listeners')
        if len(self.token) < 32 or not self.token.isascii() or any(c.isspace() for c in self.token):
            raise ValueError('worker token must be at least 32 non-whitespace ASCII characters')

    @classmethod
    def environment(cls):
        return cls(os.environ.get('AISOC_PYTHON_ADDR', '127.0.0.1:50051'),
                   os.environ.get('AISOC_PYTHON_HTTP_ADDR', '127.0.0.1:8001'),
                   os.environ['AISOC_WORKER_TOKEN'])


class Health(health_pb2_grpc.HealthServicer):
    """Unary standard health protocol; no long-lived Watch slots on the worker pool."""
    def __init__(self, token, serving):
        self.credential = ('Bearer ' + token).encode()
        self.serving = serving

    def Check(self, request, context):
        values = [v for k, v in context.invocation_metadata() if k == 'authorization']
        if len(values) != 1 or not hmac.compare_digest(values[0].encode(), self.credential):
            context.abort(grpc.StatusCode.UNAUTHENTICATED, 'invalid worker credential')
        if request.service not in ('', SERVICE):
            context.abort(grpc.StatusCode.NOT_FOUND, 'unknown service')
        return health_pb2.HealthCheckResponse(status=(health_pb2.HealthCheckResponse.SERVING
            if self.serving.is_set() else health_pb2.HealthCheckResponse.NOT_SERVING))


class Runtime:
    def __init__(self, settings):
        self.settings = settings
        self.serving = threading.Event()
        self.executor = ThreadPoolExecutor(max_workers=4)
        self.server = grpc.server(self.executor, maximum_concurrent_rpcs=4, options=[
            ('grpc.max_receive_message_length', 70000), ('grpc.max_send_message_length', 70000),
            ('grpc.so_reuseport', 0)])
        worker_pb2_grpc.add_WorkerServicer_to_server(Worker(settings.token), self.server)
        health_pb2_grpc.add_HealthServicer_to_server(Health(settings.token, self.serving), self.server)
        self.channel = grpc.insecure_channel(settings.rpc_address)
        self.health = health_pb2_grpc.HealthStub(self.channel)

    def start(self):
        try:
            if not self.server.add_insecure_port(self.settings.rpc_address):
                raise RuntimeError('worker bind failed')
            self.server.start()
            self.serving.set()
        except BaseException:
            self.close()
            raise

    def ready(self):
        if not self.serving.is_set():
            return False
        try:
            response = self.health.Check(health_pb2.HealthCheckRequest(service=SERVICE),
                timeout=.5, metadata=(('authorization', 'Bearer ' + self.settings.token),))
            return response.status == health_pb2.HealthCheckResponse.SERVING
        except grpc.RpcError:
            return False

    def close(self):
        self.serving.clear()
        self.server.stop(grace=5).wait(timeout=6)
        self.channel.close()
        self.executor.shutdown(wait=True, cancel_futures=True)


def create_app(settings=None):
    @asynccontextmanager
    async def lifespan(app):
        runtime = Runtime(settings or Settings.environment())
        await asyncio.to_thread(runtime.start)
        app.state.runtime = runtime
        try:
            yield
        finally:
            runtime.serving.clear()
            await asyncio.to_thread(runtime.close)

    app = FastAPI(title='AISOC Python worker', version='1.0', lifespan=lifespan,
                  docs_url=None, redoc_url=None, openapi_url=None)

    @app.get('/health')
    async def health():
        return {'status': 'ok', 'service': 'aisoc-python'}

    @app.get('/ready')
    def ready(request: Request):
        if not request.app.state.runtime.ready():
            raise HTTPException(503, 'gRPC worker unavailable or at capacity')
        return {'status': 'ready', 'transport': 'grpc', 'service': SERVICE}

    @app.get('/v1/capabilities')
    async def capabilities(request: Request):
        token = request.app.state.runtime.settings.token
        values = request.headers.getlist('authorization')
        if len(values) != 1 or not hmac.compare_digest(values[0].encode(), ('Bearer ' + token).encode()):
            raise HTTPException(401, 'invalid worker credential')
        return {'schema_version': '1.0', 'service': SERVICE,
                'plugins': [{'id': 'python.normalize', 'version': '1'}],
                'max_input_bytes': 65536, 'max_output_bytes': 65536,
                'max_concurrent_rpcs': 4, 'execution_transport': 'grpc'}

    return app


def main():
    settings = Settings.environment()
    host, port = loopback(settings.http_address)
    uvicorn.run(create_app(settings), host=host, port=port, workers=1,
                proxy_headers=False, access_log=False, server_header=False,
                limit_concurrency=64, timeout_keep_alive=5, timeout_graceful_shutdown=10)


if __name__ == '__main__':
    main()
