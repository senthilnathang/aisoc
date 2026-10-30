# ADR 004: Independent Python FastAPI service with Go-controlled gRPC execution

Status: accepted for the development framework, 2026-10-29.

Implementation follow-up, 2026-10-30: this ADR records the original normalization
boundary. The local foundation now also exposes typed `Investigator/Investigate`,
explicit mock investigation jobs and an optional configured JSON model adapter.
The original ownership decision remains: Go orchestrates and admits results;
FastAPI manages the Python process, and execution uses gRPC. See the current
[architecture](../ARCHITECTURE.md#rest-grpc-and-asynchronous-work) and
[developer guide](../DEVELOPMENT.md#working-with-grpc-workers) for implemented
limits and remaining distributed-worker work. Real-model quality is not certified.

## Decision

Go remains the API, authorization, persistence and orchestration owner. The Python
worker becomes one independently runnable process with FastAPI HTTP on loopback
8001 and the existing gRPC worker on loopback 50051. FastAPI lifespan starts and
drains gRPC; Uvicorn runs one process without reload. The original `worker.py`
entry point remains compatible.

Go calls `aisoc.worker.v1.Worker/Execute` directly. HTTP exposes liveness, readiness
and authenticated capabilities; it introduces no second queue, action executor,
database connection or orchestration API. Future model-serving adapters belong in
Python, with domain authorization remaining in Go.

The versioned protobuf envelope and result identity checks remain unchanged.
Standard unary `grpc.health.v1.Health/Check` requires the worker credential.
Streaming health Watch remains unimplemented to avoid occupying bounded worker
slots indefinitely. FastAPI readiness checks the actual gRPC listener and returns
503 when unavailable or saturated. Core Go readiness remains independent of Python.

## Reliability and security

- Four concurrent RPCs, 70,000-byte wire limits and 65,536-byte payload limits.
- Go execution deadline remains five seconds; Python child execution remains
  bounded to three seconds with cancellation/termination cleanup.
- Go reuses channels and replaces outgoing service authorization while preserving
  other metadata. PostgreSQL job leases own application retries. No new automatic
  execution retry policy is introduced.
- The development launcher passes no database credentials, connector keys or
  operator tokens to Python.
- Both listeners require literal loopback: same-host processes or shared-network-
  namespace sidecars. Remote deployment requires authenticated TLS before enabling
  non-loopback addresses.
- SIGTERM drains gRPC and closes the thread pool/channel. Python failure does not
  stop the core Go API or local investigation worker.

## Alternatives and consequences

An HTTP-only Python backend would duplicate the existing gRPC boundary. A separate
FastAPI process would duplicate runtime lifecycle without a present need. Redis,
a broker and another workflow engine are unnecessary for this change.

At initial acceptance, only the trusted normalization plugin existed. That change did not implement LLM
inference, QRadar connectors, agent reasoning or privileged responses. Measure
network/model workloads before changing language boundaries for performance.

## Compatibility, validation and rollback

No database migration or worker protobuf change. Rust and existing domain APIs
remain compatible. Tests cover Go-to-Python execution, durable dispatch, readiness,
restart/reconnection, authentication, payload limits, identity and deadlines.

Enable through the development launcher's `--python-worker` option. The initialized
release and its rollback-retention restrictions remain unchanged. To disable,
stop development, set `python_worker_enabled` to false in its private settings,
then restart. Preserve queued jobs, service credentials and release state.

References: [FastAPI lifespan](https://fastapi.tiangolo.com/advanced/events/),
[gRPC health checking](https://grpc.io/docs/guides/health-checking/) and
[gRPC deadlines](https://grpc.io/docs/guides/deadlines/).
