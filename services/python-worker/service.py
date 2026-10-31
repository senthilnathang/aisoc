"""Independent FastAPI + gRPC sidecar. Go owns all durable state and orchestration."""
import asyncio
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from dataclasses import dataclass
import hmac
import ipaddress
import os
from pathlib import Path
import threading

from fastapi import FastAPI, HTTPException, Request
import grpc
from grpc_health.v1 import health_pb2, health_pb2_grpc
import uvicorn

from aisoc.worker.v1 import worker_pb2_grpc
from worker import Worker
from investigation import Investigator
from model_adapter import JSONModel
from aisoc.worker.v1 import investigation_pb2_grpc

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
    inference_url: str = ''
    inference_model: str = ''
    inference_credential_file: str = ''

    tls_ca_file: str = ''
    tls_cert_file: str = ''
    tls_key_file: str = ''
    tls_server_name: str = ''
    tls_client_name: str = ''

    @property
    def tls_enabled(self):
        return any((self.tls_ca_file, self.tls_cert_file, self.tls_key_file, self.tls_server_name, self.tls_client_name))

    def __post_init__(self):
        if self.tls_enabled and not all((self.tls_ca_file, self.tls_cert_file, self.tls_key_file, self.tls_server_name, self.tls_client_name)):
            raise ValueError('all Python mTLS settings are required')
        if self.tls_enabled:
            if self.tls_client_name == self.tls_server_name:
                raise ValueError('Go client and worker identities must differ')
            host, port = self.rpc_address.rsplit(':', 1)
            ip = ipaddress.ip_address(host.strip('[]'))
            if ip.is_unspecified or not 0 < int(port) < 65536:
                raise ValueError('mTLS requires a specific bind IP and valid port')
            rpc = (str(ip), int(port))
        else:
            rpc = loopback(self.rpc_address)
        http = loopback(self.http_address)
        if rpc == http:
            raise ValueError('HTTP and gRPC require different listeners')
        if len(self.token) < 32 or not self.token.isascii() or any(c.isspace() for c in self.token):
            raise ValueError('worker token must be at least 32 non-whitespace ASCII characters')

    @classmethod
    def environment(cls):
        return cls(os.environ.get('AISOC_PYTHON_ADDR', '127.0.0.1:50051'),
                   os.environ.get('AISOC_PYTHON_HTTP_ADDR', '127.0.0.1:8001'),
                   os.environ['AISOC_WORKER_TOKEN'], os.environ.get('AISOC_INFERENCE_URL', ''),
                   os.environ.get('AISOC_INFERENCE_MODEL', ''), os.environ.get('AISOC_INFERENCE_CREDENTIAL_FILE', ''),
                   os.environ.get('AISOC_PYTHON_TLS_CA_FILE', ''), os.environ.get('AISOC_PYTHON_TLS_CERT_FILE', ''),
                   os.environ.get('AISOC_PYTHON_TLS_KEY_FILE', ''), os.environ.get('AISOC_PYTHON_TLS_SERVER_NAME', ''),
                   os.environ.get('AISOC_PYTHON_TLS_CLIENT_NAME', ''))


class Health(health_pb2_grpc.HealthServicer):
    """Unary standard health protocol; no long-lived Watch slots on the worker pool."""
    def __init__(self, token, serving):
        self.credential = ('Bearer ' + token).encode()
        self.serving = serving

    def Check(self, request, context):
        values = [v for k, v in context.invocation_metadata() if k == 'authorization']
        if len(values) != 1 or not hmac.compare_digest(values[0].encode(), self.credential):
            context.abort(grpc.StatusCode.UNAUTHENTICATED, 'invalid worker credential')
        if request.service not in ('', SERVICE, 'aisoc.worker.v1.Investigator'):
            context.abort(grpc.StatusCode.NOT_FOUND, 'unknown service')
        return health_pb2.HealthCheckResponse(status=(health_pb2.HealthCheckResponse.SERVING
            if self.serving.is_set() else health_pb2.HealthCheckResponse.NOT_SERVING))


class PeerIdentity(grpc.ServerInterceptor):
    """Require a verified client certificate SAN, in addition to bearer auth."""
    def __init__(self, settings):
        self.client = settings.tls_client_name.encode()
        self.self_probe = settings.tls_server_name.encode()

    def intercept_service(self, continuation, details):
        handler = continuation(details)
        if handler is None or handler.unary_unary is None:
            return handler
        def invoke(request, context):
            names = context.auth_context().get('x509_subject_alternative_name', ())
            permitted = self.client in names or (details.method == '/grpc.health.v1.Health/Check' and self.self_probe in names)
            if not permitted:
                context.abort(grpc.StatusCode.UNAUTHENTICATED, 'worker client identity rejected')
            return handler.unary_unary(request, context)
        return grpc.unary_unary_rpc_method_handler(invoke, request_deserializer=handler.request_deserializer,
                                                  response_serializer=handler.response_serializer)


class Runtime:
    def __init__(self, settings):
        self.settings = settings
        self.serving = threading.Event()
        self.executor = ThreadPoolExecutor(max_workers=4)
        self.server = grpc.server(self.executor, maximum_concurrent_rpcs=4,
            interceptors=[PeerIdentity(settings)] if settings.tls_enabled else [], options=[
            ('grpc.max_receive_message_length', 70000), ('grpc.max_send_message_length', 70000),
            ('grpc.so_reuseport', 0)])
        worker_pb2_grpc.add_WorkerServicer_to_server(Worker(settings.token), self.server)
        model = JSONModel(settings.inference_url, settings.inference_model, settings.inference_credential_file or None) if settings.inference_url else None
        investigation_pb2_grpc.add_InvestigatorServicer_to_server(Investigator(settings.token, model), self.server)
        health_pb2_grpc.add_HealthServicer_to_server(Health(settings.token, self.serving), self.server)
        self.server_credentials = None
        if settings.tls_enabled:
            ca = Path(settings.tls_ca_file).read_bytes()
            key = Path(settings.tls_key_file).read_bytes()
            cert = Path(settings.tls_cert_file).read_bytes()
            self.server_credentials = grpc.ssl_server_credentials([(key, cert)], root_certificates=ca, require_client_auth=True)
            # The service certificate also has clientAuth for its own readiness
            # probe. It is allowed only as this worker's self-probe identity.
            self.channel = grpc.secure_channel(settings.rpc_address, grpc.ssl_channel_credentials(ca, key, cert),
                options=[('grpc.ssl_target_name_override', settings.tls_server_name)])
        else:
            self.channel = grpc.insecure_channel(settings.rpc_address)
        self.health = health_pb2_grpc.HealthStub(self.channel)

    def start(self):
        try:
            bound = (self.server.add_secure_port(self.settings.rpc_address, self.server_credentials)
                     if self.server_credentials else self.server.add_insecure_port(self.settings.rpc_address))
            if not bound:
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
                'investigation_rpc': 'aisoc.worker.v1.Investigator/Investigate',
                'investigation_mode': 'mock-v1',
                'investigation_modes': ['mock-v1', 'model-v1'] if request.app.state.runtime.settings.inference_url else ['mock-v1'],
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
