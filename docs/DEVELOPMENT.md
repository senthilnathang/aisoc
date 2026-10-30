# Developer guide

Current backend: Go/PostgreSQL. The retained TypeScript/SQLite implementation is
for comparison and rollback, not normal application startup.

## Local demo import workflow

Initialize with `AISOC_RUNTIME_PROFILE=foundation ./run.sh start both`. The selected
installation serves the frontend on 8080 and the Go foundation API on 3003, with
independent Python HTTP 8001/gRPC 50051 and Redis 16379. Foundation schema is 030;
the preserved release database remains separate.

```bash
AISOC_RUNTIME_PROFILE=foundation ./run.sh import-demo showcase
./run.sh import-demo all --bundle output/demo-import/benchmark-60k --dry-run
./run.sh import-demo all --bundle output/demo-import/benchmark-60k
./run.sh import-demo files output/demo-import/benchmark-60k/benchmark-import-01.json output/demo-import/benchmark-60k/benchmark-import-02.json
```

Use the foundation environment prefix on subsequent commands if that profile is
not saved in `.run/runtime-profile`. Files must belong to validated bundles; these
commands are not arbitrary vendor JSON loaders. All requested files are checked
before scope or data changes. Missing grants are added without replacing existing
ones, and the foundation restarts only to load those additions. A local lock prevents
two launcher imports from overlapping. Resume partial imports by repeating the same
command; current checkpoints and content hashes protect accepted data.

Run `python3 -m unittest discover -s scripts/framework -p 'test_*import*.py'` and
`bash -n run.sh` after importer changes. See [bundle preparation](BENCHMARK_DATA_IMPORT.md)
for format, receipts, verification and the distinction between benchmark and demo data.

## Prerequisites

- Go toolchain required by `backend-go/go.mod` (currently 1.26.10).
- PostgreSQL 16 binaries; launchers default to `/usr/lib/postgresql/16/bin`.
- Node.js 22+ and npm for frontend and legacy comparison tooling.
- Python 3.12; Rust 1.88+ and Cargo for specialist verification.
- Run local PostgreSQL tools as an ordinary user, not root.

Install dependencies from the repository root:

```bash
npm --prefix frontend ci
npm --prefix backend ci
python3 -m venv services/python-worker/.venv
services/python-worker/.venv/bin/pip install -r services/python-worker/requirements.txt
```

Node backend dependencies are needed for shared parity/migration fixtures. Go
modules and Cargo dependencies are resolved by their build commands. Commit
lockfiles; keep environments, caches and private runtime files ignored.

## Fresh checkout: isolated development

```bash
python3 scripts/framework/dev.py start --investigation-worker
python3 scripts/framework/dev.py status
```

This creates `.run/go-dev/`, PostgreSQL on 55435, database `aisoc_go_dev`,
a dedicated non-superuser role and local-auth Go API on 3003. It retains generated
credentials privately, runs migrations, and refuses occupied ports.

To include Python FastAPI/gRPC and the Go specialist dispatcher, stop development
services and start with both `--investigation-worker --python-worker`. Python
listens on HTTP 8001 and gRPC 50051. The launcher generates its service credential
and passes no database/connector credentials to Python. The option persists across
restarts. See the [Python guide](../services/python-worker/README.md) for independent
startup, limits and how this remains separate from the initialized release.

Start the frontend in another terminal:

```bash
cd frontend
AISOC_API_PROXY_TARGET=http://127.0.0.1:3003 ./node_modules/.bin/vite --host 127.0.0.1 --port 8081 --strictPort
```

The fresh Go database starts without legacy demo records; create records through
the API/UI. Do not import the active release just to seed development. Stop the
frontend with Ctrl-C. Stop/start the Go launcher to rebuild after backend edits:

```bash
python3 scripts/framework/dev.py stop
python3 scripts/framework/dev.py start --investigation-worker
```

Stop retains the database. The local-auth launcher controls its own settings;
for custom token-mode/manual configuration use [the Go guide](../backend-go/README.md).

## Initialized release

```bash
./run.sh start both
./run.sh status both
./run.sh logs backend
./run.sh logs frontend
./run.sh stop both
```

Go is the default; the initialized release runs API 3002, frontend 8080 and
PostgreSQL 55436. The backend target includes the investigation worker. The
launcher uses retained release binaries, not live source compilation. Private
settings and data under `.run/go-runtime/` are not part of a fresh checkout.
Do not rerun initial cutover/import on an initialized release.

Authentication and binary promotion are described in
[operations](migration/OPERATIONS.md). Node variables `AUTH_MODE` and
`WORKER_ENABLED` do not configure the Go release.

## Verification

Run from the repository root:

```bash
python3 scripts/framework/check.py
node --test tests/backend-parity/*.test.mjs tests/backend-performance/*.test.mjs tests/frontend/*.test.mjs
npm --prefix backend run typecheck
npm --prefix backend test
npm --prefix frontend run build
python3 scripts/check_markdown_links.py
bash -n run.sh scripts/framework/generate.sh
git diff --check
```

The framework creates a disposable PostgreSQL cluster, builds Go/Rust, runs Go
race tests/vet and specialist tests, exercises shared HTTP/auth workflows and
checks restart/crash recovery. Never point mutation tests at active ports 3002/8080.
Go integration packages are serialized because failure-injection tests install
triggers on shared tables; individual tests still exercise concurrent operations.

Generated protobuf stubs are committed. After editing the worker proto, regenerate
with `bash scripts/framework/generate.sh` and review Go/Python outputs; Cargo
generates its Rust bindings at build time. Do not regenerate without a contract change.

See [testing](TESTING.md) for suite-to-feature mapping, browser checks and limits.
Node comparison and controlled performance commands are in the [root README](../README.md).

## Implementation conventions

### Working with gRPC workers

Read the [architecture transport map](ARCHITECTURE.md#rest-grpc-and-asynchronous-work)
first: Go owns durable state and authorization; Python exposes execution over gRPC
and management over FastAPI. Redis Streams delivers telemetry, and PostgreSQL jobs
schedule specialist work. Neither FastAPI nor gRPC is a second orchestrator.

| Read/edit | Responsibility |
|---|---|
| [worker.proto](../contracts/proto/aisoc/worker/v1/worker.proto) | Generic versioned plugin execution envelope |
| [investigation.proto](../contracts/proto/aisoc/worker/v1/investigation.proto) | Typed task, evidence and investigation result |
| [Go client](../backend-go/internal/platform/plugins/client.go) | Loopback connection, bearer metadata, size/deadline and identity checks |
| [Investigation client](../backend-go/internal/platform/plugins/investigation.go) | Task validation, deadline propagation and result QA |
| [Go dispatcher](../backend-go/cmd/worker/main.go) | Durable claim → RPC → retry/completion loop; currently serial per process |
| [Python service](../services/python-worker/service.py) | FastAPI/gRPC lifecycle, four-slot admission and health |
| [Python investigator](../services/python-worker/investigation.py) | Authenticated mock/model contract validation |
| [Rust worker](../services/wasm-worker/src/main.rs) | Optional bounded hashing/WASM execution |

For the normal supervised stack, use:

```bash
AISOC_RUNTIME_PROFILE=foundation ./run.sh start both
AISOC_RUNTIME_PROFILE=foundation ./run.sh status both
curl -fsS http://127.0.0.1:8001/health
curl -fsS http://127.0.0.1:8001/ready
```

Health probes expose no credentials or case data. `/ready` calls authenticated
gRPC health internally and can return 503 when the worker is busy; that alone is
not a reason to restart it. `/v1/capabilities` and direct gRPC health require the
private worker credential. Never paste credentials into docs, logs or shell history.
Use [Python service instructions](../services/python-worker/README.md) for independent
startup. Stop the supervisor with `run.sh stop backend` before manual child maintenance;
do not run a second Python service on the same ports or multiple Uvicorn workers.

When changing a contract:

1. Edit the Protobuf source and preserve existing field numbers; reserve removed
   fields rather than reusing their numbers. Review the Go/Python validation rules
   together: investigation messages currently reject unknown fields.
2. Run `bash scripts/framework/generate.sh`, review and commit generated Go/Python
   bindings. Rust bindings are generated by Cargo at build time.
3. Keep the same tenant/task/attempt identity throughout execution. Go must validate
   output before durable admission; worker success alone is not job completion.
4. Preserve application-owned retry/idempotency and commit boundaries. Do not add
   blanket RPC retries or let Python/Rust connect to the case database or response tools.
5. Run the focused tests and full framework checks below before promotion.

```bash
services/python-worker/.venv/bin/python -m unittest discover -s services/python-worker -v
python3 scripts/framework/check.py --with-streams
```

The existing tests cover bad/duplicate credentials, identity mismatches, size limits,
deadlines, overload/readiness recovery, restart/reconnection, typed Go→Python/Rust
calls and durable job completion/replay. See [test mapping](TESTING.md) and
[ADR 004](adr/004-python-fastapi-grpc-service.md). These are fixture/local checks,
not remote TLS validation, model-quality evaluation or a REST/gRPC speed comparison.

For future improvements, first make Go dispatch concurrency bounded and tenant-aware;
the current serial loop cannot consume all four Python slots. Replace the fixed
five-second execution cap with validated workload budgets before real long-running
inference. Remote hosts additionally need TLS/mTLS, service identity/rotation,
observability and worker routing. Do not relax the loopback guard to deploy remotely.

### PostgreSQL and Redis access

Use parameterized pgx in current code. The agreed direction is sqlc-generated
PostgreSQL access, but no sqlc configuration/generated query package is installed
yet. Introduce it incrementally while preserving existing immutable migrations,
tenant filters, transaction boundaries and specialized query behavior. Keep go-redis
for caching and Streams. Compose them behind domain-specific methods where useful;
do not hide stream ACK, cache expiry or database commit behind a generic save method.

### General conventions

The optional [Redis Streams sandbox](REDIS_STREAMS.md) is managed separately with
`python3 scripts/framework/redis_runtime.py start|status|stop`. It uses port 16379
and private `.run/redis-dev/` state. Run `python3 scripts/framework/check_streams.py`
for isolated adapter checks, or `python3 scripts/framework/check.py --with-streams`
to include the PostgreSQL/Redis bridge. Core development startup needs no Redis.

- Keep handlers/validation under `internal/transport/httpapi`, domain logic under
  `internal/modules`, infrastructure under `internal/platform`.
- Carry request contexts, use parameterized SQL, bound resource usage and scope all
  lookups/mutations by tenant. Keep data and audit writes in one transaction.
- Preserve optimistic versions, immutable snapshots and concurrency locks.
  Close pgx batch results before reusing/committing the connection.
- Measure hot paths before optimizing. Avoid cross-request caches for mutable
  cases, permissions or credentials without a complete invalidation design.
- Keep PostgreSQL migrations immutable once applied; add a new numbered file.
  Record intentional contract changes in an ADR and focused tests.
- Preserve routes and existing UI workflows. Keep API transport in `src/api.js`.
  Label simulations and unassessed metrics honestly; do not present vendor claims
  or fixture data as local measured outcomes.
- Use `gofmt`, Go vet/race checks and the relevant domain suites for backend changes.

## Files and artifacts

Source assets belong in `frontend/public/`; React code in `frontend/src/`.
Builds write only to `frontend/dist/`, including the `app.html` compatibility
alias. Go binaries/tools and Rust target output remain ignored. Test reports and
browser evidence belong in `output/`; original reference material lives in
`docs/reference/`.

Never commit `.run/`, database snapshots, connector keys or operator tokens.
Keep lockfiles, migrations, environment examples and generated contract sources.
Cleaning build caches must not delete active data, matching keys or rollback artifacts.

## Current JSON sandbox milestone

See [sandbox completion and operations](SANDBOX_COMPLETION.md) for scoped JSON
intake, independent Python FastAPI/gRPC, recovery UI, monitoring, verified archive
export, startup and measured limits. Earlier task entries are historical checkpoints.
Live vendor/model validation and privileged response activation are outside this
user-selected local release.

## Main frontend with the foundation

The local installation selects `foundation` in `.run/runtime-profile`. Use
`./run.sh start both`, `./run.sh status both`, and `./run.sh stop both` to manage
the supervised foundation and the sole frontend on 8080. The Go API is 3003,
PostgreSQL is 55435, Python HTTP/gRPC are 8001/50051, and Redis is 16379.
On a fresh checkout use `AISOC_RUNTIME_PROFILE=foundation ./run.sh start both`.
Stop the frontend before switching profiles; select `release` explicitly to access
the separate older database on 55436 through API 3002. No records are merged.

Open `/build/stream-operations` or `/build-operations` on 8080. The ten
`demo-showcase-*` sources contain 10,000 synthetic events and ten investigations.
`python3 scripts/framework/demo.py` replays safely. The supervisor owns child
restarts: use `run.sh stop backend` before manual maintenance. Do not start an
extra preview on 8082. See [delivery details](NEXT_DELIVERY_TASKS.md).
