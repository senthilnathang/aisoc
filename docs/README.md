# Documentation index

Current architecture and local migration status: 2026-10-30. The selected foundation
uses API 3003/schema 030, with a 70,000-event local demo. The release on 3002 is
preserved separately. Historical migration reports and ADR dates remain unchanged.

| Document | Purpose |
|---|---|
| [Root README](../README.md) | Running application, capabilities and repository layout |
| [Architecture](ARCHITECTURE.md) | Go/PostgreSQL and optional specialist boundaries |
| [Developer guide](DEVELOPMENT.md) | Fresh checkout, local setup, conventions and checks |
| [Go guide](../backend-go/README.md) | Backend configuration and specialist runtime setup |
| [API contract](API_CONTRACT.md) | Supported HTTP behavior and auth/intake semantics |
| [Data model](DATA_MODEL.md) | Logical entities and physical PostgreSQL mapping |
| [Frontend integration](FRONTEND_INTEGRATION.md) | Routes, API transport and UI boundaries |
| [Testing](TESTING.md) | Suite coverage, commands, browser evidence and limits |
| [Benchmark data import](BENCHMARK_DATA_IMPORT.md) | Retained test JSON, checksummed demo bundles and replay-safe Go API import |
| [Delivery roadmap](ROADMAP.md) | Completed work and prioritized follow-up |
| [Feature roadmap](FEATURE_ROADMAP.md) | Product acceptance criteria beyond migration |
| [Migration completion](GO_BACKEND_MIGRATION_PLAN.md) | Completed phases and recovery constraints |
| [Release receipt](migration/RELEASE_STATUS.md) | Original cutover checks and retained evidence |
| [Operations](migration/OPERATIONS.md) | Lifecycle, auth, backups, upgrades and rollback |
| [Performance](migration/PERFORMANCE.md) | Absolute results, optimizations and measurement limits |
| [ADR 002](adr/002-go-backend-replacement.md) | Accepted backend replacement decision |
| [ADR 003](adr/003-replacement-contract-decisions.md) | Intentional contract/runtime differences |
| [ADR 004](adr/004-python-fastapi-grpc-service.md) | Independent Python FastAPI lifecycle and Go gRPC boundary |
| [Python service](../services/python-worker/README.md) | Startup, health, capabilities and worker contracts |
| [Redis Streams review](redis-streams-gap-analysis.md) | Proposed telemetry/cache boundary, repository gaps and incremental plan; not implemented |
| [Implementation tasks](IMPLEMENTATION_TASKS.md) | Ordered streaming and agentic L1 tasks, dependencies and acceptance gates |
| [ADR 005](adr/005-redis-streams-boundary.md) | Accepted sandbox boundary: Redis telemetry, PostgreSQL durable orchestration |
| [Streaming persistence](STREAMING_PERSISTENCE.md) | S02 transactions, outbox leases, inbox deduplication and recovery limits |
| [Redis Streams sandbox](REDIS_STREAMS.md) | Opt-in runtime, ACLs, adapter limits and disposable verification |

[Phase-zero notes](migration/PHASE_0_STATUS.md), [Node baseline](migration/NODE_BASELINE.md),
[ADR 001](adr/001-local-modular-monolith.md) and
[vendor technology observations](BACKEND_TECHNOLOGY_ASSESSMENT.md) are historical
context. They do not describe the active backend. The original assessment and
visual references live under `reference/`; generated verification receipts live
under ignored `output/` and are not guaranteed on a fresh checkout.

[Streaming recovery](STREAMING_RECOVERY.md) documents S04 retry/DLQ, backpressure,
replay, tests and operational limits.

[Mock QRadar flow](MOCK_QRADAR_FLOW.md) documents S05 synthetic intake, event-time
correlation, SOAR revision handling and the runnable offline demonstration.

[Finding admission](FINDING_ADMISSION.md) documents S06 atomic case/job receipts,
tenant admission limits, fair scheduling and release boundaries.

[Typed L1 investigation](L1_INVESTIGATION.md) documents S07 Go evidence access,
Python gRPC mock reasoning, durable dispatch, QA and evaluation limits.

[Mock SOAR reconciliation](MOCK_SOAR_RECONCILIATION.md) documents S08 audited L2
review records, conflict-aware note drafts and sandbox replay guarantees.

[Enrichment cache](ENRICHMENT_CACHE.md) documents S09 tenant-aware local IOC reads,
TTL/invalidation, source fallback, bounded Redis storage and performance limits.

[Streaming operations](STREAM_OPERATIONS.md) covers S10 accounting, explicit safe
Redis cleanup and outstanding rollout gates. [Measured results](STREAM_PERFORMANCE_REPORT.md)
record actual throughput, latency, resource scope and cache comparison.

## Current JSON sandbox milestone

See [sandbox completion and operations](SANDBOX_COMPLETION.md) for scoped JSON
intake, independent Python FastAPI/gRPC, recovery UI, monitoring, verified archive
export, startup and measured limits. Earlier task entries are historical checkpoints.
Live vendor/model validation and privileged response activation are outside this
user-selected local release.

## Latest local delivery

- [Persistent demo, response sandbox and remaining gates](NEXT_DELIVERY_TASKS.md)
- [Configurable local integrations and release validation](LOCAL_RELEASE_GATES.md)
- [QRadar and inference adapter contracts](INTEGRATION_ADAPTERS.md)
- [Production preparation](../deploy/production/README.md)

Use the main frontend on 8080 for the showcase; no separate 8082 demo is needed.
