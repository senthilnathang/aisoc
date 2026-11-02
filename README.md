# AISOC

A local security-operations application: a React 19 frontend, a Go API and
investigation worker, and PostgreSQL persistence. Optional Python (FastAPI/gRPC)
and Rust/WASM specialist services are included for development and tests. The
legacy Node/SQLite backend is retained only for comparison and rollback.

All integrations are local or mock. The application does not call live SIEM, EDR,
mail, identity or model providers, and it does not perform production response
actions. See [limits](#current-limits).

## Current status

Last updated 2026-11-02.

- **Go backend:** the release is initialized from a legacy SQLite snapshot into its
  own PostgreSQL cluster under `.run/go-runtime/`. API readiness is on port **3004**
  on this installation.
- **React 19:** React and React DOM 19.3.1 with Chakra UI 2.10.9 and the React
  Compiler enabled, except for the telemetry browser. See
  [React 19 migration](docs/REACT_19_MIGRATION.md).
- **Shared record lists:** Detection rules and routing, hunts, threat intel, skills,
  memory, build catalog, investigations, respond registries and API sources use the
  shared paginated table. Remaining raw-table lists are listed in
  [records table](docs/frontend/RECORDS_TABLE.md).
- **Verification:** the Go suite passes with the race detector against disposable
  PostgreSQL; frontend lint, build and 37 regression tests pass.
- **Performance:** average throughput is about 1,100 events/s, but the strict
  stability gate still fails on p95 latency. See [performance gate](docs/PERFORMANCE_GATE.md).

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Go | 1.26.10 (from `backend-go/go.mod`) | `./run.sh install` installs it under `~/.local` without sudo |
| Node.js | 20.19 or newer (22.13+ or 24 also accepted) | Required by `frontend/package.json` |
| PostgreSQL | 16, at `/usr/lib/postgresql/16` | Used by the release and test launchers |
| Python | 3 | Launchers and framework scripts |
| Chromium | Optional | Browser tests use Playwright's bundled browser or `CHROME_PATH` |

`./run.sh install` checks the Go version required by `backend-go/go.mod`. If Go is
missing or too old, it downloads the required release from go.dev, checks its
SHA-256 and installs it under `~/.local/go-<version>`. A cached toolchain can be
linked into `~/.local/bin` instead. `run.sh` puts `~/.local/bin` first on `PATH`.

## Quick start

```bash
./run.sh install                          # Go toolchain, if needed
(cd frontend && npm ci)                   # frontend dependencies
./run.sh start backend                    # Go API and investigation worker
./run.sh start frontend                   # Vite dev server on http://localhost:8080
./run.sh status
```

Before `start` works, the release must be initialized (see
[Initialize the Go release](#initialize-the-go-release)). Until then, `start`
refuses with `Initialize a release before managing it`, and `stop` and `status`
report that nothing is initialized.

Open <http://localhost:8080> for **Detect → Overview**.

## Run modes

`run.sh` reads a private profile from `.run/runtime-profile` or the
`AISOC_RUNTIME_PROFILE` environment variable, and the backend from `.run/backend-mode`.
Default: `release` profile with the Go backend.

| Profile | Command | Data | API address |
|---|---|---|---|
| `release` (default) | `./run.sh start backend` | `.run/go-runtime/` PostgreSQL cluster | Port from `.run/go-runtime/settings.json` (3004 here; 3002 reserved for the final cutover) |
| `foundation` | `AISOC_RUNTIME_PROFILE=foundation ./run.sh start both` | Development database on port 55435 | 3003 |

The two profiles never share or overwrite records. Stop the frontend before
switching profiles so its API proxy restarts. A `node` backend mode is available
through `.run/backend-mode` for rollback. The Node backend starts on 3002 and is not
used by default.

### Commands

```bash
./run.sh install                          # install a sufficient Go toolchain
./run.sh start|stop|status|logs [all|backend|frontend]
./run.sh suspicious-login [--configure]   # local scenario (foundation profile)
./run.sh import-demo all [--dry-run]      # demo data (foundation profile)
```

`./run.sh` without a target applies to `all` (backend and frontend). `logs backend`
prints the last 60 lines of the release API log.

| Service | Address |
|---|---|
| Frontend (Vite dev server) | http://localhost:8080 |
| Release API (`release` profile) | http://127.0.0.1:3004 on this installation |
| Foundation API (`foundation` profile) | http://127.0.0.1:3003 |
| Python FastAPI readiness (foundation) | http://127.0.0.1:8001/ready |

## Initialize the Go release

A fresh release is created from a consistent snapshot of the legacy SQLite database.

```bash
python3 scripts/migration/snapshot.py export backend/data/sqlite.db .run/legacy-snapshot.json
python3 scripts/runtime/manage.py init --source .run/legacy-snapshot.json --api-port 3004
./run.sh start backend
```

- The snapshot and `.run/go-runtime/settings.json` contain **plaintext connector
  credentials and generated passwords**. Keep them inside ignored `.run/`.
- `init` refuses to overwrite existing state. A failed import leaves
  `imported: false` and `start` refuses to run. Move the failed directory aside
  before retrying.
- Missing response-plan and runbook tables are treated as empty. The legacy Node
  code creates them on demand. Every other missing table fails the import.
- Use `--api-port` to avoid a port held by a running legacy backend. Only the final
  cutover may use 3002.

## Repository layout

| Path | Contents |
|---|---|
| `frontend/` | React 19 application (`src/`), static assets (`public/`), Vite build and `scripts/publish.mjs` |
| `backend-go/` | Go API, worker and specialist commands (`cmd/`), domain modules (`internal/modules/`), HTTP transport (`internal/transport/`), PostgreSQL migrations and sqlc queries |
| `services/python-worker/` | Python FastAPI and gRPC service for mock investigation and health |
| `services/wasm-worker/` | Rust/WASM worker used by framework tests |
| `backend/` | Legacy Node/SQLite backend, kept for comparison and rollback |
| `scripts/framework/` | Checks, release gates, acceptance, benchmarks and browser test scripts |
| `scripts/runtime/` | Release and foundation lifecycle (`manage.py`), rollback and backup |
| `scripts/migration/` | Snapshot export/restore and comparison tools |
| `tests/frontend/` | Frontend regression tests (`node --test`) |
| `tests/backend-parity/`, `tests/backend-performance/` | Legacy-to-Go parity and performance tests |
| `contracts/` | Route inventory, journey mapping and protobuf/plugin contracts |
| `deploy/` | Service and backup templates, including production templates |
| `docs/` | Architecture, API, data model, testing, roadmap and decisions. `docs/archive/plans/` holds the historical plans |
| `docs/reference/` | Original security assessment |
| `.run/`, `output/` | Ignored: private runtime state and generated evidence |

## Testing

```bash
# Go: the database-backed tests skip unless AISOC_GO_TEST_DATABASE_URL is set.
cd backend-go && go vet ./... && go test -race -p 1 ./...

# Frontend
cd frontend && npm run lint && npm run build
node --test tests/frontend/*.test.mjs

# Full framework check: starts disposable PostgreSQL and specialist processes, then runs Go, Rust, Python and HTTP API checks.
python3 scripts/framework/check.py
```

- Tests must not write to the release database. The HTTP harness rejects the
  release ports (3002 and 8080).
- Per-workspace browser checks live in `scripts/framework/*-browser*.mjs` and
  `*-records-table-browser.mjs`. They intercept writes and use read-only real API checks.
- The release gate runs browser workflows, API acceptance and isolated backup recovery:
  `python3 scripts/framework/release_gate.py --chromium-executable /path/to/chrome`.
- Some scripts hard-code `/opt/google/chrome/chrome`. Install Chrome there or edit
  the script's `executablePath`.

Details and evidence locations: [testing guide](docs/TESTING.md) and
[development setup](docs/DEVELOPMENT.md).

## Feature areas

| Area | What it covers | Reference |
|---|---|---|
| Detect | Rule registry, versions, period metrics, coverage, routing, recommendations | [rules](docs/DETECTION_RULES.md), [coverage](docs/DETECTION_COVERAGE.md), [routing](docs/DETECTION_ROUTING.md), [intelligence](docs/DETECTION_INTELLIGENCE.md) |
| Investigate | Cases, evidence, feedback, runbooks, durable investigation jobs, detection feedback | [workspace](docs/INVESTIGATION_WORKSPACE.md), [feedback](docs/INVESTIGATE_DETECT_FEEDBACK.md), [visibility](docs/INVESTIGATION_VISIBILITY.md) |
| Respond | Response plans, runbooks, approvals, mock sandbox revocation, approval inbox | [workspace](docs/RESPONSE_WORKSPACE.md), [independent roles](docs/INDEPENDENT_APPROVAL_ROLES.md), [inbox](docs/APPROVAL_INBOX.md), [sandbox](docs/INVESTIGATE_RESPOND_SANDBOX.md) |
| Hunt | Local evidence search, durable execution, notes, promotion | [workspace](docs/HUNT_WORKSPACE.md), [execution](docs/DURABLE_HUNT_EXECUTION.md) |
| Threat Intel | JSON import, IOC validation, reports, linked hunts | [workspace](docs/THREAT_INTEL_WORKSPACE.md), [flow](docs/INTEL_HUNT_INVESTIGATE.md) |
| Skills and Memory | Guidance library, materials and versions, reviewed outcomes, enterprise insights | [skills](docs/SKILLS_WORKSPACE.md), [lifecycle](docs/SKILLS_MEMORY_LIFECYCLE.md), [insights](docs/ENTERPRISE_INSIGHTS.md), [outcomes](docs/SKILLS_MEMORY_OUTCOMES.md) |
| Build | Assets, local integrations, bulk JSON imports, API sources, retention and recovery | [workspace](docs/BUILD_WORKSPACE.md), [integrations](docs/BUILD_INTEGRATIONS.md), [API sources](docs/frontend/RECORDS_TABLE.md#api-sources-integration), [retention](docs/RETENTION_RECOVERY.md) |
| Ingestion and streams | Scoped API-source keys, normalized and native intake, streaming persistence, recovery | [API contract](docs/API_CONTRACT.md), [stream operations](docs/STREAM_OPERATIONS.md), [streaming](docs/STREAMING_PERSISTENCE.md) |
| Identity | Local login-free mode, token mode, opt-in OIDC/SSO, operator roles | [authentication](docs/migration/OPERATIONS.md#authentication-configuration), [OIDC](docs/OIDC_SSO.md) |

The records table (`frontend/src/components/RecordsTable.jsx`) takes one server page
and its total. Pages own their data fetching, filters, URL state and actions. See
[records table](docs/frontend/RECORDS_TABLE.md).

## Data and recovery

PostgreSQL holds active data. Connector credentials are encrypted with a separate
key, so recovery needs both the database backup and the key. Keep snapshots, backups
and the legacy Node code for at least the seven-day rollback window. After a write,
roll back by exporting current Go data, never by restarting stale SQLite. See
[operations and recovery](docs/migration/OPERATIONS.md).

## Current limits

- No live provider calls. Vendor, mail, identity and model integrations are
  fixture-tested or local/mock only. Live validation is separate work.
- The strict 1,000 events/s p95 gate still fails; see [performance gate](docs/PERFORMANCE_GATE.md).
- The investigation worker records supplied evidence and reviewed results. It does
  not run SIEM queries, perform containment or run autonomous LLM investigations.
- Skills and memory are advisory. They never change verdicts or run actions.
- Node 20.19+ is required by the frontend, but Node 18 is installed in some
  environments. Use Node 20.19 or newer for the frontend build and tests.

Roadmap and open work: [delivery roadmap](docs/ROADMAP.md),
[next delivery tasks](docs/NEXT_DELIVERY_TASKS.md), and
[implementation tasks](docs/IMPLEMENTATION_TASKS.md).

## Documentation

Start with [architecture](docs/ARCHITECTURE.md), [developer setup](docs/DEVELOPMENT.md),
[API contract](docs/API_CONTRACT.md), [data model](docs/DATA_MODEL.md),
[testing](docs/TESTING.md) and [migration status](docs/migration/RELEASE_STATUS.md).
The full index is in [docs/README.md](docs/README.md). Architecture decisions are in
[docs/adr/](docs/adr/). Archived delivery plans are in
[docs/archive/plans/](docs/archive/plans/README.md).
