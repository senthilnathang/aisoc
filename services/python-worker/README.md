# Python FastAPI / gRPC service

An independently runnable service in the Go-first framework. Go owns orchestration,
tenant authorization, durable retries and result admission. Python has no database
or privileged response-tool credentials.

```mermaid
flowchart LR
  API[Go API] --> DB[(PostgreSQL)]
  Dispatcher[Go specialist dispatcher] --> DB
  Dispatcher -->|authenticated gRPC Execute| Python[Python worker]
  FastAPI[FastAPI lifespan] -->|starts and drains| Python
  Monitor[Health probes] -->|HTTP health / ready| FastAPI
```

## Start with Go development services

From the repository root:

```bash
python3 -m venv services/python-worker/.venv
services/python-worker/.venv/bin/pip install -r services/python-worker/requirements.txt
python3 scripts/framework/dev.py stop
python3 scripts/framework/dev.py start --investigation-worker --python-worker
python3 scripts/framework/dev.py status
```

The launcher retains a private service credential in `.run/go-dev/settings.json`,
starts Python independently and connects the Go dispatcher to gRPC. Enabling the
option persists across development restarts. Stop with
`python3 scripts/framework/dev.py stop`; data remains intact. The initialized
release on 3002/8080 is unaffected.

## Run independently

Supply `AISOC_WORKER_TOKEN` from private environment configuration: at least 32
non-whitespace ASCII characters. Run:

```bash
services/python-worker/.venv/bin/python services/python-worker/worker.py
```

| Setting | Default | Purpose |
|---|---|---|
| `AISOC_PYTHON_ADDR` | `127.0.0.1:50051` | gRPC listener; configure the same value in Go |
| `AISOC_PYTHON_HTTP_ADDR` | `127.0.0.1:8001` | FastAPI listener |
| `AISOC_WORKER_TOKEN` | Required | Matching private service credential in Go/Python |

Both listeners require literal loopback and different addresses. This supports
same-host or shared-network-namespace sidecars. Remote plaintext RPC is rejected.
Use this entry point: extra Uvicorn workers/reload would compete for the gRPC port.

## Endpoints and contracts

| Interface | Behavior |
|---|---|
| HTTP `GET /health` | Process liveness; no credentials or case data |
| HTTP `GET /ready` | Actual authenticated gRPC health check; 503 on outage/saturation |
| HTTP `GET /v1/capabilities` | Bearer-authenticated plugin versions and limits |
| gRPC `grpc.health.v1.Health/Check` | Authenticated unary health for `aisoc.worker.v1.Worker` |
| gRPC `aisoc.worker.v1.Worker/Execute` | Existing versioned, bounded execution contract |

Go executes work over gRPC; there is no HTTP execution bypass. Only
`python.normalize` version `1` exists: a trusted bounded subprocess, not an LLM
or arbitrary-code runtime. Unknown plugin versions fail closed. Inputs/outputs
preserve tenant/job/attempt/plugin identity.

Four RPCs can execute concurrently. Go imposes a five-second deadline; Python
enforces three-second child execution, 64 KiB payloads and subprocess cleanup.
Health shares the admission limit and may report not ready under load; readiness
failure alone should not trigger a process restart.

## Verification

```bash
services/python-worker/.venv/bin/python -m unittest discover -s services/python-worker -v
python3 scripts/framework/check.py
```

The full check uses disposable PostgreSQL and random listener ports. It verifies
Go-to-Python outputs, credential rejection and durable dispatch alongside existing
Rust/domain tests. Provider credentials are not needed.
See [ADR 004](../../docs/adr/004-python-fastapi-grpc-service.md).
