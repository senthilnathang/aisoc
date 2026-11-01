# Developer guide

For [case outcome → Skills/Memory](SKILLS_MEMORY_OUTCOMES.md), reuse `skills.MutateTx`/`insights.SaveTx` under the approval transaction. Preserve case revision checks, tenant-owned evidence and explicit approval; never publish generated guidance or override verdicts implicitly.

For [JSON intelligence import and hunt promotion](INTEL_HUNT_INVESTIGATE.md), use the example JSON, module sqlc queries and migration 044. Extend canonical validation before adding IOC types. Promotion must read a server-stored tenant finding and use the existing case-creation transaction; never accept an evidence snapshot or tenant from the browser.

Current backend: Go/PostgreSQL. The retained TypeScript/SQLite implementation is
for comparison and rollback, not normal application startup.

See the [performance gate](PERFORMANCE_GATE.md) for repeated 1,000 EPS validation
and the optional, allowlisted local PostgreSQL profile. Average throughput and
latency stability are evaluated separately; one fast run does not pass the gate.

Load reports include a bounded slow-query timeline (100 ms minimum, 256 entries,
with an overflow count) and PostgreSQL aggregate timings. Resource companions
record dirty/writeback memory and cumulative block-device counters. Align SQL
`started_at` plus `end_ms` with resource `started_at_unix_seconds` plus elapsed
seconds. Query identifiers hash normalized SQL; arguments are not recorded.
Host counters include other workloads; partition and parent-disk counters overlap
and must not be summed. These measurements can locate stalls, not prove device
failure. The first diagnostic baseline predates the resource wall-clock origin
and cannot be aligned precisely with SQL timestamps.

Failed load probes retain `<report>.failure.json` with partial accepted/completed
counts and query diagnostics. A five-second EXPLAIN attempt captures the snapshot
plan without re-executing it. Capture is best effort if the database is unavailable;
the original test failure remains authoritative. Do not import or evaluate this
artifact as a successful throughput run.

Stream status uses one grouped integer state aggregate: accepted=1, completed=2,
dead=4. Only accepted keys count; the completed bit takes precedence over dead.
This replaces three Boolean aggregates without changing scope, retention or
durability. The [temporary-table comparison](../tests/backend-performance/snapshot-query.sql)
reproduces the query experiment in a dedicated local PostgreSQL connection. It
does not access application records or measure end-to-end throughput.

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
- Node.js ^20.19.0, ^22.13.0, or >=24 and npm for frontend and legacy comparison tooling.
- Python 3.12; Rust 1.88+ and Cargo for specialist verification.
- Run local PostgreSQL tools as an ordinary user, not root.

Install dependencies from the repository root:

```bash
npm --prefix frontend ci
npm --prefix backend ci
python3 -m venv services/python-worker/.venv
services/python-worker/.venv/bin/python -m pip install --upgrade 'pip==26.2'
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

Bounded tenant-aware specialist dispatch and optional Go/Python mTLS are now
implemented. See [configuration, migration and rollback](WORKER_DISPATCH_SECURITY.md).
Production still needs certificate lifecycle automation, worker routing, operational
monitoring and model-specific deadlines. Local defaults remain unchanged.

### PostgreSQL and Redis access

Tenant authentication belongs in `platform/auth`, not individual route handlers.
Source keys authorize only POST intake events/alerts for their source ID. Never
replace the transaction-level key check in `intake.IngestSource` with middleware
alone: rotation/revocation must serialize with the domain write. Header tenant IDs
are assertions against authenticated credentials; only local demo mode allows a
tenant selector. Repeated or comma-joined local selectors return HTTP 400.

`platform/jobs` and `modules/navigation` use sqlc v1.31.1 generated pgx/v5 queries. Edit SQL in
`backend-go/internal/platform/jobs/queries` or `backend-go/internal/modules/navigation/queries`, run `make sqlc` from `backend-go`, and
commit generated files together. Install with `python3 scripts/framework/install_sqlc.py`
from the repo root; `make sqlc-check` detects drift. Continue incrementally while
preserving existing immutable migrations,
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

See [investigation review visibility](INVESTIGATION_VISIBILITY.md) for the tenant-scoped read-only L1 projection, frontend states and validation.

## React 19 frontend

The frontend uses React/React DOM 19.3.1 with Chakra UI 2.10.9 and selectively enabled React Compiler 1.0. See [migration, verification and rollback notes](REACT_19_MIGRATION.md) for pinned tooling, the telemetry opt-out, browser checks and measured limitations.

## Navigation structure

`frontend/src/navigation.js` owns section labels, route links and detail-view parent mapping. `Navigation.jsx` renders desktop section links, persistent subnavigation and the mobile drawer; `main.jsx` uses the same route map. Keep these definitions shared when adding a screen. Root `/` is **Detect → Overview**, followed by Rule registry and Intelligence. Respond owns Overview, Cases, Actions, Approvals, Workflows, Runbooks and Activity. Build owns API sources, Stream operations and Connectors. Detail routes retain their parent section. Mobile navigation exposes every child link and restores keyboard focus on Escape.

Run `node --test tests/frontend/navigation.test.mjs` and the local Playwright snippet `scripts/framework/navigation-browser-check.js` to verify ownership, submenu links, deep-link reloads, browser Back and mobile focus/navigation.

See the [workspace navigation reference](NAVIGATION.md) for the current menu hierarchy, route ownership and responsive behavior.

Breadcrumb development uses `breadcrumbs.js` plus `Breadcrumbs.jsx` and the Go navigation module. See [API contract, resource allowlist, cancellation and tests](BREADCRUMBS.md).

### Detection Intelligence screenshot implementation (2026-10-31)

Source/rule treemap, coverage and escalation views, search, linked-case drill-down, and responsive summary panels now use the tenant-scoped Go sqlc/pgx projection. Existing `/detect/intelligence` links remain valid; `/detect/detection-intelligence` is an alias. Coverage means linked alerts, not completed investigations. See [implementation, API, metric definitions and verification](DETECTION_INTELLIGENCE.md). Local Rule Recommendations and Detection Routing are now implemented; provider synchronization remains future work.

### Detection Rules workspace (2026-10-31)

The Rules screenshot layout now uses Go/sqlc period-specific metrics, a backend-served local catalog, and URL-persisted inspector selection, filters and tabs. Existing CRUD, audit and all-time APIs are retained. FP share now uses explicit analyst labels; assessed coverage and local recommendations have separate evidence-backed workflows. See [UI, API contracts, test workflow and rollback](DETECTION_RULES.md).

### Detection Coverage (2026-10-31)

The Coverage workspace now provides a pinned ATT&CK radar/table, technique drill-down and tenant-scoped, versioned analyst assessments. Migration 033 is additive; sqlc writes and audit commit together. Verified coverage excludes stale/expired reviews and non-detection decisions. The old Overview coverage example now links to the real workspace. See [reference provenance, denominator, APIs, testing and rollback](DETECTION_COVERAGE.md).

### Rule Recommendations (2026-10-31)

The Rules inspector now provides explicit analyst labels, deterministic proposals, local query validation, bounded replay receipts and version-checked apply/dismiss. Apply is limited to disabled, unbound local rules; provider sync remains unavailable. Migration 034 adds tenant-scoped labels and proposals with atomic audit. See [workflow, API, architecture, tests and rollback](RULE_RECOMMENDATIONS.md).

### Detection Routing (2026-11-01)

The Routing workspace adds ordered universal policies, per-rule defaults, entity lists/exceptions and audit history. Go previews bounded stored evidence before active changes and applies the same evaluator during local intake, preserving protected escalation and duplicate decisions. Migration 035 is additive; no quarantine or external provider actions are enabled. See [workflow, architecture, APIs, tests and rollback](DETECTION_ROUTING.md).

### Investigation workspace (2026-11-01)

The investigation detail now provides screenshot-inspired Summary, Report, Remediation, Artifacts graph/table and a private case evidence-lookup drawer. Existing L1 review, runbooks, feedback and action simulations remain available. Go supplies bounded provenance projections; migration 036 stores actor-scoped idempotent lookup messages with atomic audit. No model-backed conversation or external containment is implied. See [screens, APIs, architecture, limits, tests and rollback](INVESTIGATION_WORKSPACE.md).


## Respond development

See [Response workspace](RESPONSE_WORKSPACE.md) for the JSON runbook import shape and policy/preview contracts. Edit `backend-go/internal/modules/response/queries/workspace.sql`, regenerate with `make -C backend-go sqlc`, and run the disposable database harness for policy concurrency/audit tests. Frontend components are `ResponseCases.jsx`, `ResponsePolicies.jsx`, `WorkflowCanvas.jsx` and the preserved `ResponsePlans.jsx` editor. Use `scripts/framework/response-workspace-browser-check.js` for intercepted browser mutations. Migration 037 must be applied before using the new APIs.


## Hunt development

Use `HuntWorkspace.jsx` and `internal/modules/hunts/workspace.go`; new SQL is in `hunts/queries/workspace.sql`. Regenerate with `make -C backend-go sqlc`. Apply migration 038 through normal startup. The isolated workspace harness includes hunts/navigation; browser fixtures are in `scripts/framework/hunt-workspace-browser-check.js`. See [contracts and local limits](HUNT_WORKSPACE.md).


## Threat Intel development

`ThreatIntelWorkspace.jsx` serves report registry/detail and the Hunt TI route. New backend code is `threatintel/workspace.go`, generated `threatsql`, and `httpapi/threat_workspace.go`. Apply migration 039, regenerate SQL with `make -C backend-go sqlc`, and run the disposable test harness plus `scripts/framework/threat-intel-browser-check.js`. See [version guards, retry semantics and limits](THREAT_INTEL_WORKSPACE.md).

## Skills workspace development

`frontend/src/SkillsRegistry.jsx` owns the paginated library and text import; `Skills.jsx` retains editor/materials/templates/suggestions/outcomes. Go workspace projections live in `internal/modules/skills/queries/workspace.sql`; regenerate with `make -C backend-go sqlc`. New editor writes use required `expected_version` and explicit desired enablement. Preserve form data on 409, and never silently refresh a revision after external/material edits. See [Skills developer details](SKILLS_WORKSPACE.md).

## Enterprise Insights development

`frontend/src/EnterpriseInsights.jsx` replaces sample-backed Memory. Go queries live in `internal/modules/insights/queries/workspace.sql`; regenerate through sqlc. `skills.Context.InsightEntities` must contain actual entity values only, never evidence labels/types. Maintain revision checks, application uniqueness and atomic auditing. Start the local backend to apply 040 before loading the UI. See [developer contracts](ENTERPRISE_INSIGHTS.md).

## Build workspace (2026-11-01)

frontend/src/BuildWorkspace.jsx consumes GET /api/v1/build/catalog. backend-go/internal/modules/build/queries/catalog.sql defines the allowlist; regenerate with make -C backend-go sqlc. Exclude credentials, config and instruction bodies. Keep connector rows inspect-only and preserve stale-response protection. See [contracts](BUILD_WORKSPACE.md).

## Platform review (2026-11-01)

Overview.jsx uses only the dashboard contract. Response filters and pagination must reach Go; keep the search toolbar mounted during refresh. Response summary is generated from investigations/queries/response_summary.sql. Source paging extends the existing parameterized intake query; validate limit/offset at the HTTP boundary. Rule selection uses server search. Preserve stale-response guards. See [review and verification](PLATFORM_REVIEW_2026-11-01.md).

## Repeatable suspicious-login scenario

See [the scenario guide](SUSPICIOUS_LOGIN_FLOW.md) for `run.sh suspicious-login`,
versioned JSON configuration, local scope setup, restart and approval. Migration 041
is additive; sqlc generates the approval queries. Keep the foundation mock profile
and explicit analyst gate when editing fixtures.

## Local IAM/MFA and EDR context

[Configurable JSON adapters](LOGIN_CONTEXT_ADAPTERS.md) extend the suspicious-login flow with
tenant/subject-bound provenance, typed gRPC snapshots, contextual hypotheses and
explicit missing/stale/conflicting evidence. Five historical fixtures remain
INCONCLUSIVE and require note approval; no live provider or model is activated.

## Build local integration management (042)

[The local integration studio](BUILD_INTEGRATIONS.md) at `/build/integrations` adds versioned
draft editors, JSON file import, Go validation and evidence preview. Explicit import
seals a tenant-scoped snapshot and feeds the existing workers without restart.
Case note approval remains mandatory; provider endpoints and response execution
remain disabled. Existing provider-specific connector records remain inspect-only.

## Shared frontend UI/UX

Use `WorkspaceHeader` and the existing Chakra theme for workspace pages. Maintain
one page h1, labeled controls, keyboard focus, reduced motion and responsive action
wrapping. See [implementation conventions](UI_UX_SYSTEM.md). Run the live read-only
`ui-consistency-browser-check.js` batches and `ui-accessibility-browser-check.js`
after changes to shared shell/theme styles, followed by affected workflow checks.

## Case-linked sandbox responses

Migration 043 adds case/action linkage and append-only mock SOAR response notes.
The new response queries use sqlc/pgx; the existing executor accepts the owning
transaction so response effects, note and audit commit together. Configure a
separate trusted `allow_sandbox_response` grant, never inherit it from Build imports.
See [contracts, state handling and rollback](INVESTIGATE_RESPOND_SANDBOX.md).

## Case detection feedback

The case panel reuses AlertLabelReview and the existing recommendation engine. Maintain rule-before-alert lock order and atomic label/case-audit/rule-audit writes. Regenerate sqlc after changing queries; exercise the disposable database and browser checks documented in [Investigate → Detect](INVESTIGATE_DETECT_FEEDBACK.md).

## Platform acceptance workflow

Use `python3 scripts/framework/acceptance.py` after cross-module changes. It extends the existing disposable framework, does not import showcase IDs, and rejects optimized Python assertions. Avoid concurrent framework invocations. See [prerequisites and report handling](DETECT_BUILD_ACCEPTANCE.md).
