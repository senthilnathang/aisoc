# Developer guide

Current backend: Go/PostgreSQL. The retained TypeScript/SQLite implementation is
for comparison and rollback, not normal application startup.

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
