# AISOC

Local security-operations application: React frontend, Go API and investigation
worker, PostgreSQL persistence, and optional Rust/WASM and Python specialist
workers. The Node/SQLite backend was replaced on **2026-10-29**. All 97 legacy
routes are implemented for supported workflows; deliberate differences are in
[ADR 003](docs/adr/003-replacement-contract-decisions.md).

The development framework includes an independent
[Python FastAPI/gRPC service](services/python-worker/README.md): FastAPI manages
service health and lifecycle; Go dispatches bounded work through gRPC.

## Run the initialized application

```bash
./run.sh start both
./run.sh status both
./run.sh logs backend
./run.sh stop both
```

| Service | Address |
|---|---|
| Frontend | http://localhost:8080 |
| Go API | http://127.0.0.1:3002 |
| Readiness | http://127.0.0.1:3002/ready |
| Release PostgreSQL | 127.0.0.1:55436 |

`run.sh` defaults to Go. A private `.run/backend-mode` override supports explicit
rollback. Backend startup starts PostgreSQL, the Go API and investigation worker;
it does not start optional specialists. The optimized API/worker binaries are
installed in the release. Comparison and development stacks are stopped by default.

The launcher requires initialized `.run/go-runtime/` data, private settings and
verified binaries, which are intentionally not committed. For a **fresh checkout**,
follow [development setup](docs/DEVELOPMENT.md) to create an isolated Go database
and start a frontend against port 3003. Do not rerun historical cutover to start development.

## Start the Go/Python foundation

After installing the [development prerequisites](docs/DEVELOPMENT.md), run:

```bash
python3 scripts/framework/dev.py start --investigation-worker --python-worker
python3 scripts/framework/dev.py status
```

| Foundation component | Address |
|---|---|
| Go API/readiness | http://127.0.0.1:3003/ready |
| Python FastAPI/readiness | http://127.0.0.1:8001/ready |
| Python authenticated gRPC | 127.0.0.1:50051 |
| Development PostgreSQL | 127.0.0.1:55435 |

The launcher also starts the Go investigation worker and specialist dispatcher.
Stop with `python3 scripts/framework/dev.py stop`; data and private settings are
retained. If a core-only development API is already running, stop it before
enabling Python. Rust remains optional and is exercised by the framework tests.

This foundation uses a separate development database. The release frontend on
8080 continues to use API 3002; it does not display development records. To use a
frontend with the foundation, follow [development setup](docs/DEVELOPMENT.md).
Only the normalization plugin is currently implemented in Python; QRadar/Sentinel
adapters and LLM investigation are the next product work, not running capabilities.

## Implemented workflows

- Investigation cases, evidence, feedback, audit history, determination and retry.
- Detection authoring, versions, registry filters, alert intelligence and routing.
- Scoped API-source keys, normalized/native intake, mapping preview and deduplication.
- Durable three-phase local investigations with restart and crash recovery.
- Versioned response plans, pinned runbooks, checklists and approval recording.
- Skills authoring, material versions, suggestions, matching snapshots and outcomes.
- Connector configuration, threat intelligence and local hunt/response simulations.

The worker records supplied evidence, checks tenant-local indicators and records
review results. It does not execute SIEM queries, call security providers, perform
containment or run autonomous LLM investigations. Skills record advisory guidance.
Provider adapters, enterprise identity and hosting are separate [roadmap work](docs/ROADMAP.md).

## Authentication and data

Local mode is login-free and accepts the development tenant header. Token mode
binds tenants to operators; browser sessions use HttpOnly cookies, CSRF and exact
origins. Source credentials authorize intake only. Go uses `AISOC_GO_*` settings;
the release launcher reads equivalent fields from private settings. Node variables
`AUTH_MODE` and `WORKER_ENABLED` do not configure Go. See
[authentication configuration](docs/migration/OPERATIONS.md#authentication-configuration).

PostgreSQL holds active data. Connector credentials use encryption with a separate
key; recovery needs both database backup and key. Retain private snapshots, backups
and Node reference code through at least the seven-day rollback window. Post-write
rollback must export current Go data, never restart stale SQLite. See
[operations and recovery](docs/migration/OPERATIONS.md).

## Verification and comparison

```bash
python3 scripts/framework/check.py
node --test tests/backend-parity/*.test.mjs tests/backend-performance/*.test.mjs tests/frontend/*.test.mjs
npm --prefix frontend run build
python3 scripts/check_markdown_links.py
```

Install [verification prerequisites](docs/DEVELOPMENT.md#verification) first.
Framework checks use disposable PostgreSQL and specialist processes. Tests must
not write to the release; the HTTP harness rejects active ports 3002/8080.

For an independent Node comparison application:

```bash
python3 scripts/runtime/node-compare.py start   # API 3004, frontend 8082
python3 scripts/runtime/node-compare.py status
python3 scripts/runtime/node-compare.py stop
```

It uses separate seeded SQLite data and never switches the release. Browser data
is independent; use fresh matched fixtures for measured performance:

```bash
python3 scripts/framework/benchmark.py --controlled --postgres-diagnostics --output-dir output/backend-performance/new-campaign
```

Use a new output directory per campaign. Stacks run sequentially with matching
token auth, two-CPU affinity, eight clients, 3,000 requests and three repeats per
small/large dataset. Final optimized median Node/Go throughput was **197/273
requests/s** on small and **180/221 requests/s** on large, with zero errors and no
per-operation p95/p99 regression above 10%. These shared-host results are not
production capacity guarantees. [Performance evidence](docs/migration/PERFORMANCE.md)
records the earlier anomaly, before/after measurements and resource costs.

## Repository layout

| Path | Purpose |
|---|---|
| `frontend/src/`, `frontend/public/` | React application and editable static assets |
| `backend-go/` | Active API, workers, domain modules and PostgreSQL migrations |
| `services/` | Optional Rust/WASM and independent Python FastAPI/gRPC service |
| `backend/` | Retained Node reference for comparisons and rollback |
| `contracts/` | Route inventory, journey mapping and protobuf/plugin contracts |
| `scripts/` | Framework checks, migration and runtime management |
| `tests/` | HTTP compatibility, performance and build-tool regression tests |
| `deploy/` | Optional service and backup timer templates |
| `docs/` | Architecture, API, model, development, testing, roadmap and decisions |
| `docs/reference/` | Historical assessment and original visual references |

Build output stays in component `dist/`, `bin/` or `target/` directories.
Private runtime state stays in ignored `.run/`; generated evidence in `output/`.
Lockfiles, migrations, contracts and environment examples remain tracked.
Frontend builds no longer copy generated bundles into the source root.

Start with [architecture](docs/ARCHITECTURE.md), [developer setup](docs/DEVELOPMENT.md),
[API](docs/API_CONTRACT.md), [data model](docs/DATA_MODEL.md),
[testing](docs/TESTING.md), or [migration completion](docs/migration/RELEASE_STATUS.md).
