# AISOC

Local security-operations application: React frontend, Go API and investigation
worker, PostgreSQL persistence, and optional Rust/WASM and Python specialist
workers. The Node/SQLite backend was replaced on **2026-10-29**. All 97 legacy
routes are implemented for supported workflows; deliberate differences are in
[ADR 003](docs/adr/003-replacement-contract-decisions.md).

The development framework includes an independent
[Python FastAPI/gRPC service](services/python-worker/README.md): FastAPI manages
service health and lifecycle; Go dispatches bounded work through gRPC.

[Local performance validation](docs/PERFORMANCE_GATE.md) completed three 60,000-event
runs at 1,063–1,104 EPS. A subsequent diagnostic baseline fell to 823 EPS;
throughput is not consistently repeatable and latency still fails the two-second
p95 gate. These are synthetic transport results, not
live-provider or AI investigation capacity.

## Workspace navigation

Open [localhost:8080](http://localhost:8080) for **Detect → Overview**.
Detect also contains Rule registry and Intelligence. Respond has its own response
workspace and submenus; Build contains API sources, Stream operations and Connectors.
On mobile, use **Menu** to access every section. See the [complete navigation map](docs/NAVIGATION.md).

## Run the initialized application

The local showcase now uses **one frontend on port 8080**, backed by the Go
foundation on 3003. Open [Stream operations](http://localhost:8080/build/stream-operations)
(also available at `/build-operations`) and select `demo-showcase-01` through
`demo-showcase-10`: each contains 1,000 persisted events and one investigation.
The extra demo frontend on 8082 has been stopped.
An additional 60,000 synthetic benchmark events are available under
`benchmark-import-01` through `benchmark-import-60`. Their reusable JSON bundle
and replay-safe import commands are documented in [benchmark data import](docs/BENCHMARK_DATA_IMPORT.md).

```bash
./run.sh import-demo all --dry-run   # validate selection, no writes
./run.sh import-demo all             # showcase + default benchmark bundle
./run.sh import-demo showcase        # built-in 10,000-event showcase only
./run.sh import-demo files output/demo-import/benchmark-60k/benchmark-import-01.json
```

Imports require the foundation profile; on a fresh checkout use
`AISOC_RUNTIME_PROFILE=foundation`. `all` requires the prepared bundle and fails
before importing if it is missing; `showcase` needs no benchmark artifacts.
Existing records deduplicate. New source grants trigger a foundation restart.

`run.sh` reads `.run/runtime-profile` (`foundation` on this installation). A fresh
checkout defaults to `release`; select foundation explicitly with
`AISOC_RUNTIME_PROFILE=foundation ./run.sh start both`. Stop the frontend before
switching profiles so its API proxy is restarted. Foundation startup supervises
Go, Python and stream workers; stop preserves data. The release database remains
separate and is never merged or overwritten by switching profiles.
See [current delivery status](docs/NEXT_DELIVERY_TASKS.md) for implementation limits.
Configurable Ariel/Sentinel reads, private model-service configuration, archived
payload recovery and local HTTPS alert checks are described in
[local release gates](docs/LOCAL_RELEASE_GATES.md). Real vendor/model validation and
production activation are not inferred from passing fixture tests.

```bash
./run.sh start both
./run.sh status both
./run.sh logs backend
./run.sh stop both
```

| Service | Address |
|---|---|
| Frontend | http://localhost:8080 |
| Go API (foundation profile) | http://127.0.0.1:3003 |
| Readiness (foundation profile) | http://127.0.0.1:3003/ready |
| Foundation PostgreSQL | 127.0.0.1:55435 |

`run.sh` defaults to Go. A private `.run/backend-mode` override supports explicit
rollback. Backend startup starts PostgreSQL, the Go API and investigation worker;
it does not start optional specialists. The optimized API/worker binaries are
installed in the release. The `release` profile uses API 3002 and PostgreSQL 55436;
the selected `foundation` profile uses the showcase database and current code.

The launcher requires initialized `.run/go-runtime/` data, private settings and
verified binaries, which are intentionally not committed. For a **fresh checkout**,
follow [development setup](docs/DEVELOPMENT.md) to create an isolated Go database
and start a frontend against port 3003. Do not rerun historical cutover to start development.

## Start the Go/Python foundation

After installing the [development prerequisites](docs/DEVELOPMENT.md), run:

```bash
python3 scripts/framework/dev.py start --investigation-worker --python-worker --streams
python3 scripts/framework/dev.py status
```

| Foundation component | Address |
|---|---|
| Go API/readiness | http://127.0.0.1:3003/ready |
| Python FastAPI/readiness | http://127.0.0.1:8001/ready |
| Python authenticated gRPC | 127.0.0.1:50051 |
| Development PostgreSQL | 127.0.0.1:55435 |

The launcher also starts the Go investigation worker and specialist dispatcher.
When supervised through `run.sh`, stop with `./run.sh stop backend`; otherwise use
`python3 scripts/framework/dev.py stop`. Data and private settings are
retained. If a core-only development API is already running, stop it before
enabling Python. Rust remains optional and is exercised by the framework tests.

This foundation uses a separate development database. The release frontend on
8080 uses API 3003 when the foundation profile is selected. Switching to the release
profile points it at API 3002 and its separate records.
The JSON sandbox supports intake, Redis delivery, Go correlation, typed Python mock
investigation, Go QA and mock SOAR notes. Open `/build/stream-operations` on the
foundation frontend. Live vendors and model inference need separate validation.
See [sandbox guide](docs/SANDBOX_COMPLETION.md).

Redis Streams has an independent, opt-in [sandbox launcher](docs/REDIS_STREAMS.md)
on port 16379. Its adapter and PostgreSQL bridge are verified with disposable
fixtures; live telemetry intake, retry/DLQ and provider integration remain gated
by the [implementation tasks](docs/IMPLEMENTATION_TASKS.md).

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

The optional [agentic L1 sandbox](docs/L1_INVESTIGATION.md) now includes typed
Go-to-Python investigation RPCs, durable mock jobs and Go QA. It has no live model
or production response enablement; see the [task tracker](docs/IMPLEMENTATION_TASKS.md).

[Mock SOAR reconciliation](docs/MOCK_SOAR_RECONCILIATION.md) adds audited review
records and version-checked note drafts while preserving analyst updates.

[Local IOC caching](docs/ENRICHMENT_CACHE.md) is opt-in, tenant-scoped and invalidated
by PostgreSQL source changes. Cache failures fall back to authoritative reads.

Common backend architecture now includes sqlc-generated job queries, bounded tenant-fair
specialist dispatch and optional Go/Python mTLS. See [configuration and verification](docs/WORKER_DISPATCH_SECURITY.md).

See [investigation review visibility](docs/INVESTIGATION_VISIBILITY.md) for the tenant-scoped read-only L1 projection, frontend states and validation.

## React 19 frontend

The frontend uses React/React DOM 19.3.1 with Chakra UI 2.10.9 and selectively enabled React Compiler 1.0. See [migration, verification and rollback notes](docs/REACT_19_MIGRATION.md) for pinned tooling, the telemetry opt-out, browser checks and measured limitations.

See [clickable breadcrumbs and tenant-scoped resource labels](docs/BREADCRUMBS.md) for frontend/backend behavior and regression coverage.

### Detection Intelligence screenshot implementation (2026-10-31)

Source/rule treemap, coverage and escalation views, search, linked-case drill-down, and responsive summary panels now use the tenant-scoped Go sqlc/pgx projection. Existing `/detect/intelligence` links remain valid; `/detect/detection-intelligence` is an alias. Coverage means linked alerts, not completed investigations. See [implementation, API, metric definitions and verification](docs/DETECTION_INTELLIGENCE.md). Local Rule Recommendations and Detection Routing are now implemented; provider synchronization remains future work.

### Detection Rules workspace (2026-10-31)

The Rules screenshot layout now uses Go/sqlc period-specific metrics, a backend-served local catalog, and URL-persisted inspector selection, filters and tabs. Existing CRUD, audit and all-time APIs are retained. FP share now uses explicit analyst labels; assessed coverage and local recommendations have separate evidence-backed workflows. See [UI, API contracts, test workflow and rollback](docs/DETECTION_RULES.md).

### Detection Coverage (2026-10-31)

The Coverage workspace now provides a pinned ATT&CK radar/table, technique drill-down and tenant-scoped, versioned analyst assessments. Migration 033 is additive; sqlc writes and audit commit together. Verified coverage excludes stale/expired reviews and non-detection decisions. The old Overview coverage example now links to the real workspace. See [reference provenance, denominator, APIs, testing and rollback](docs/DETECTION_COVERAGE.md).

### Rule Recommendations (2026-10-31)

The Rules inspector now provides explicit analyst labels, deterministic proposals, local query validation, bounded replay receipts and version-checked apply/dismiss. Apply is limited to disabled, unbound local rules; provider sync remains unavailable. Migration 034 adds tenant-scoped labels and proposals with atomic audit. See [workflow, API, architecture, tests and rollback](docs/RULE_RECOMMENDATIONS.md).

### Detection Routing (2026-11-01)

The Routing workspace adds ordered universal policies, per-rule defaults, entity lists/exceptions and audit history. Go previews bounded stored evidence before active changes and applies the same evaluator during local intake, preserving protected escalation and duplicate decisions. Migration 035 is additive; no quarantine or external provider actions are enabled. See [workflow, architecture, APIs, tests and rollback](docs/DETECTION_ROUTING.md).

### Investigation workspace (2026-11-01)

The investigation detail now provides screenshot-inspired Summary, Report, Remediation, Artifacts graph/table and a private case evidence-lookup drawer. Existing L1 review, runbooks, feedback and action simulations remain available. Go supplies bounded provenance projections; migration 036 stores actor-scoped idempotent lookup messages with atomic audit. No model-backed conversation or external containment is implied. See [screens, APIs, architecture, limits, tests and rollback](docs/INVESTIGATION_WORKSPACE.md).


## Respond workspace

The [Respond workspace](docs/RESPONSE_WORKSPACE.md) now includes the Cases board, remediation policy configuration, workflow canvas/dry previews and a runbook table with JSON import. Open `/respond/cases` on the main frontend. Policies remain local sandbox only; no provider execution is enabled.


## Hunt workspace

The [Hunt workspace](docs/HUNT_WORKSPACE.md) provides a registry, TI report hunting table and routed Plan/notes/Entities/Findings detail. Open `/hunt/threat-hunting`. New searches use real stored evidence with persisted receipts; no live telemetry query or LLM reasoning is implied.


## Threat Intel workspace

The [Threat Intel workspace](docs/THREAT_INTEL_WORKSPACE.md) adds the screenshot-based report table, analyst metadata/relevance, real IOC counts, report editing and active-IOC-to-local-hunt links. `/threat-intel` and `/hunt/threat-intelligence` share the same data/UI. Hunt creation is explicit, idempotent and audit-backed; it does not launch live queries.

## Skills workspace

Open `/skills` for the screenshot-aligned library and three-column editor: paginated custom/augmented guidance, text import, references, relevance rules, safe preview and version-checked save/publish/enablement. Guidance is recorded for analyst review, not executed as privileged actions. See [Skills workspace](docs/SKILLS_WORKSPACE.md).

## Memory / Enterprise Insights

`/memory` now provides persisted organizational context, the active insight table, generated case-context cards, reviewed prevalence suggestions, audit and usage drilldowns. Go records active exact-entity matches as immutable investigation context; hints never change verdicts or execute actions. See [Enterprise Insights](docs/ENTERPRISE_INSIGHTS.md).

## Build workspace (2026-11-01)

Open `/build` for saved assets, metadata inspection and links to Skills, response design and integrations. See [Build scope and API](docs/BUILD_WORKSPACE.md).
