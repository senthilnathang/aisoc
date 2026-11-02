# Testing and verification

Current approval contract: [independent proposer, approver and executor roles](INDEPENDENT_APPROVAL_ROLES.md). Outcome learning saves proposals; Memory requires independent approval before reuse, and responses require three distinct operators.

[Outcome learning verification](SKILLS_MEMORY_OUTCOMES.md#tests-and-local-showcase) covers approval/replay/rollback, stale and foreign evidence, draft/publication gating, later-case matching and immutable snapshots, plus real local UI feedback/usage and intercepted error/mobile tests.

The [intel/hunt/investigation test guide](INTEL_HUNT_INVESTIGATE.md#verification-and-demo) covers the real local browser flow, mobile layout, invalid imports, concurrent retries, tenant isolation, fabricated findings, audit rollback and deletion tombstones. New browser scripts retain clearly labeled demo data or intercept mutations as documented.

The [multi-tenant threat model](MULTITENANT_STREAMING_THREAT_MODEL.md) defines
common identity, isolation, replay, worker and response-security release gates.

`go test -race ./internal/platform/auth` (from `backend-go`) covers source-key
route and tenant binding in local/token modes, missing and wrong-source keys,
operator keys rejected for intake, source keys rejected for management, and
repeated/comma-joined local tenant headers. These middleware tests use a credential
resolver fixture; database rotation/revocation remains covered separately by the
intake integration tests. They do not certify production tenant isolation.

Current as of 2026-10-30. Go/PostgreSQL is the active backend. Node/Fastify/SQLite
tests remain a legacy reference; they are not the only backend verification.

## Current release checks and demo test cases

The [security review](SECURITY_REVIEW.md) records Origin-boundary and import-file
regressions, dependency audits, and the bounded-memory hashing measurement.

The Go/PostgreSQL/Redis/Python/Rust suite covers sorted concurrent receipt batches,
atomic stale-lease rollback, 500-event delivery/receipt mapping and replay without
duplicate effects. [The performance gate](PERFORMANCE_GATE.md) separates average
throughput from latency stability. [Historical evidence](STREAM_PERFORMANCE_REPORT.md)
retains earlier failed experiments and timeout observations.

Snapshot regressions also cover unknown dead work and quarantined deliveries,
empty tenant/source/connector scopes, and completed-over-dead precedence. The
scoped-join query experiment was reverted after a load-test statement timeout;
passing functional tests alone did not justify adopting it.

The later integer-state aggregate retains the same grouping and passed the full
framework suite, including the mixed-state and isolation checks above. A 60k
temporary-table comparison returned equal counts (40k completed, 5k dead without
completion, 15k pending) and lower query times in two paired trials. This isolated
query result does not establish the stream latency SLO; repeated load evidence
remains in [the performance gate report](PERFORMANCE_GATE.md).

The final profile passed the full framework suite. Separately, three consecutive
60k load runs passed the average-throughput requirement but failed the strict
latency gate; `performance_gate.py` correctly exits 1 for that series. The profile
parser rejects attempts to disable durability or inject arbitrary PostgreSQL options.

A subsequent diagnostic baseline completed 60k events at 823 EPS/p95 23.9 s;
repeatable throughput remains open. A combined claim/reconciliation SQL experiment
timed out once and completed another run at 978 EPS/p95 8.68 s, then was reverted.
The retained regression checks exhausted leases alongside fresh work and rejects
stale publication. Diagnostic tests cover bounded slow-query recording and Linux
disk counter parsing. See [follow-up evidence](PERFORMANCE_GATE.md#latency-diagnostic-follow-up).

| Case | Expected result | Coverage |
|---|---|---|
| `import-demo all --dry-run` | Validate showcase/bundle selection; no service/config/data mutation | CLI and local validation |
| `import-demo showcase` | Replay deterministic 10,000 events; duplicates insert zero | Existing showcase/API replay |
| `import-demo files FILE...` | Only selected manifest-listed sources imported | Launcher unit and live local replay |
| Quoted paths containing spaces | Preserve complete file argument | Shell dispatch regression |
| Missing, duplicate, tampered or nonmanifest files | Reject before import execution | Importer/launcher tests |
| Release profile | Refuse demo mutation | Shell dispatch regression |
| Conflicting existing grants | Refuse replacement | Launcher preflight |
| Partial import or repeated bundle | Read current checkpoint; accepted events deduplicate | Importer unit and live replay |
| Expanded source set | Bounded Redis pool; healthy workers after completion | Concurrent-reader test and API verification |

```bash
bash -n run.sh
python3 -m unittest discover -s scripts/framework -p 'test_*import*.py'
python3 scripts/check_markdown_links.py
./run.sh import-demo all --dry-run
python3 scripts/framework/benchmark_import.py verify --bundle output/demo-import/benchmark-60k
```

The milestone records below describe earlier checks; they do not override current
runtime/schema status or certify live providers and model quality.

Launcher validation passed ten importer/launcher tests and Bash syntax checks.
The live selected-file replay covered 2,000 events with zero inserts; `all` replayed
the 10,000-event showcase and 60,000-event benchmark bundle with zero inserts.
These checks validate import behavior, not throughput or model quality.

Migration/documentation baseline: full framework passed (including Go race/vet
and specialist tests), 34 legacy backend tests, 16 tooling regression tests and
3 backup lifecycle tests passed. Backend typecheck and frontend build passed.
The Vite large-chunk advisory remains; browser checks were not rerun for prose-only changes.

FastAPI/gRPC follow-up: the full disposable framework passed again, including Go
race/vet, Python tests, Go-to-Python/Rust probes and durable queue dispatch.
The final focused Python run passed eight tests, including overload admission.
The development launcher was exercised with independent Python HTTP/gRPC listeners.
No production integration or model-latency benchmark is claimed by these checks.

## Required checks

For the current REST/gRPC boundary, read the
[architecture map](ARCHITECTURE.md#rest-grpc-and-asynchronous-work) and
[contract change workflow](DEVELOPMENT.md#working-with-grpc-workers).
`services/python-worker/test_service.py` covers HTTP/gRPC lifecycle, reconnect,
authentication and overload/readiness. `backend-go/internal/platform/plugins/`
tests the client boundary; full framework checks exercise durable cross-language
dispatch. Runtime limits are separate from throughput measurements: these tests
do not establish a gRPC-over-REST speedup or remote mTLS readiness.

Streaming milestone S03 passed `python3 scripts/framework/check_streams.py` and
the full `python3 scripts/framework/check.py --with-streams` suite. Redis checks
cover authentication/ACLs, concurrent group consumption, explicit ACK, pending
reclaim, missing/poisoned payloads and a graceful AOF restart retaining pending
work. The PostgreSQL bridge proves one sample job despite duplicate publication
and consumer replay. Redis is disposable for these tests; unflagged framework
runs intentionally skip Redis-dependent cases. See [Redis Streams](REDIS_STREAMS.md).

Streaming milestone S02 passed the full disposable framework check. Five tests in
`backend-go/internal/platform/eventstate/store_integration_test.go` exercised real
PostgreSQL acceptance/outbox/checkpoint atomicity, capacity limits, concurrent
ownership, lease recovery/fencing, retained failed publications and transactional
inbox/effect replay. Existing Go race/vet and HTTP/worker tests also passed.
Lease expiry and transaction failures model crash boundaries; Redis/network fault
injection is covered by subsequent S03/S04 checks. The running databases were not migrated during this check.

Streaming milestone S01 adds Go telemetry/finding contract validation tests under
`backend-go/internal/modules/telemetry`. Race tests and vet passed, as did a
ten-second decoder fuzz run with 66,968 executions. Schema syntax and mock telemetry
format validation passed. These tests do not establish Redis capacity or delivery
guarantees; at the S01 milestone no stream pipeline was connected. The current
foundation includes the later delivery and L1 stages. See the
[contract guide](../contracts/events/README.md) for commands and boundary rules.

Python FastAPI/gRPC boundary tests live in `services/python-worker/test_service.py`:
HTTP and authenticated gRPC readiness, service restart/channel reconnection,
credential rejection, duplicate authorization, payload limits and plugin versions.
Admission tests verify excess concurrent work is rejected and readiness recovers.
Existing worker tests cover child deadline/cancellation cleanup. Go plugin tests
cover result identity, deadlines, health status and outgoing credential replacement.
The full framework check starts the combined service on disposable ports and
verifies Go dispatch through the durable queue. No live provider actions are used.

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

[Developer setup](DEVELOPMENT.md#verification) lists prerequisites. Framework
checks start disposable PostgreSQL and isolated Go/Rust/Python processes, never
the release database. Integration tests require `AISOC_GO_TEST_DATABASE_URL`;
without it database-specific Go tests skip. The framework supplies it and runs
`go test -race -p 1 ./...` plus `go vet ./...`.

## Coverage matrix

| Area | Representative executable tests | Assertions |
|---|---|---|
| Go infrastructure | `backend-go/internal/platform/*/*test.go` | Auth/config validation, leases, cancellation, identity, migration conversion, RPC bounds |
| Case/response | `case-*.mjs`, `response-*.mjs`; Go investigation/response tests | CRUD, immutable versions, conflicts, approval, notes, ordered audit, tenant checks, persistence |
| Batched investigation writes | `activity_integration_test.go` | Failed audit rolls back create/patch; no partial records or edits escape |
| Detection | `detection-rules.mjs`, `detection-registry.mjs`, `detection-intelligence.mjs` | Versioning, filtering/pagination, source binding, real alert totals, snapshot consistency |
| Sources/intake | `api-sources.mjs`, `source-mapping.mjs`, `alert-intake.mjs`, `operator-alerts.mjs` | Key expiry/rotation/revocation, normalization, deduplication, routing, transactional credential recheck |
| Worker/queue | `investigation-worker.mjs`, `investigation-queue.mjs`; Go intake tests | Three phases, retry, concurrent processing, atomic failures, tenant-local indicators, SIGKILL recovery |
| Skills | `skills-authoring.mjs`, full `run.mjs` scenarios; Go Skills tests | CRUD/material limits, publishing, suggestions, snapshots, matching, feedback replacement and outcome totals |
| Other domains | `hunts.mjs`, `connectors.mjs`, `threat-intelligence.mjs`, `dashboard.mjs` | Lifecycle, encrypted credential redaction, cascades, concurrent updates, aggregate consistency |
| Authentication | `auth.mjs`, `response-auth.mjs`; Go auth tests | Operator/source separation, sessions, CSRF, origin, expiry and tenant spoof rejection |
| Contract inventory | `coverage.test.mjs`, `report.mjs` | All 97 legacy routes probed; journey references resolve to exercised endpoints |
| Tool safety | `harness.test.mjs` | Reject active ports, remote targets and writes without fixture opt-in |
| Performance comparator | `tests/backend-performance/compare.test.mjs` | Per-operation tails, median/threshold boundary, invalid/mismatched/error reports |
| Frontend build output | `tests/frontend/build-output.test.mjs` | Compatibility alias stays in dist; no root asset copies; missing build fails |
| Recovery/operations | `scripts/migration/*.py`, `scripts/runtime/test_backup.py` | Reconciliation, reverse export, backup lifecycle and recovery safety |

Paths ending in `.mjs` in the domain rows are under `tests/backend-parity/`.
The full shared suite has 11 functional scenarios. Route coverage is not exhaustive
behavioral coverage. [ADR 003](adr/003-replacement-contract-decisions.md) defines
deliberate validation, ordering and security differences.

## Lifecycle, migration and recovery

`node tests/backend-parity/lifecycle.mjs` owns disposable Node processes and
checks restart, concurrent writes, expiry and SIGKILL behavior. The Go framework
checks restart persistence and concurrent workers, deliberately crashes a worker,
and verifies rollback/recovery. The sustained soak separately checks bounded
queues and reverse export.

Migration tools reconcile all 26 legacy tables, populated fixtures, source keys,
version/audit history and Go-era writes. Go-only specialist records have no legacy
representation; reverse export rejects them. Never use a stale SQLite snapshot as
a shortcut for rollback after Go has accepted writes.

Backup unit tests run with:

```bash
python3 -m unittest discover -s scripts/runtime -p 'test_*.py'
```

Live backup/restore and release gates are operational checks documented in
[the runbook](migration/OPERATIONS.md), not ordinary unit tests.

## Browser and frontend verification

The production build checks imports, JSX and asset resolution. Browser verification
uses the Playwright CLI and committed snippets under `scripts/framework/`:
`journey-browser-check.js`, `response-editor-check.js` and
`token-browser-check.js`. They cover API-backed screen rendering, selected
authoring/conflict workflows and login/logout/CSRF/expiry behavior. Run snippets
in an isolated preview after inspecting the page; see [tooling guide](../tests/backend-parity/README.md).

The release sweep recorded 44 screen/viewport combinations. These browser checks
are reproducible operator-driven scripts, not a comprehensive continuously running
frontend E2E/visual regression suite. Existing dashboard/hunt mobile horizontal
overflow remains a UI follow-up. The frontend build retains a large-chunk advisory.

## Performance

Use [the controlled campaign](migration/PERFORMANCE.md) rather than comparing
different browser databases. It measures list/detail/update/create with matching
fixtures, auth, concurrency and CPU affinity, including PostgreSQL resources.
Per-operation median p95/p99 must not regress by more than 10%; throughput gains
alone cannot pass the latency gate. Failed HTTP requests/resource samples or
mismatched workloads invalidate comparison. The comparator's latency flag is
not the complete migration release gate.

The latest optimized campaign had zero request errors and passed this latency
criterion. The original write-tail anomaly did not reproduce in the fresh
unmodified baseline; do not attribute all observed improvement to code changes.

## Evidence and remaining scope

Generated reports live under ignored `output/`: framework, parity, performance,
Playwright and migration directories. Private databases/keys remain under `.run/`.
Reports are local receipts, not files guaranteed to exist in a fresh checkout.
Committed docs summarize their dated scope; rerun checks for changed code.

Remaining work: CI browser automation, broader visual regression, production-like
capacity/longer soaks, real-provider contract tests when adapters exist, and
additional malformed-input/Unicode fuzzing. Current tests do not prove provider
execution, autonomous reasoning or enterprise readiness.

S04 adds seven PostgreSQL/Redis pipeline integration tests plus concurrent capacity
and retry-jitter checks to `python3 scripts/framework/check.py --with-streams`.
See [recovery evidence and limits](STREAMING_RECOVERY.md). These tests model loss
and stalled transport; they do not certify HA failover or production throughput.

S05 passed the full disposable framework suite. `qradarmock` tests cover correlation
permutations, duplicate/conflicting revisions, entity/IP/tenant separation, window
and watermark boundaries, and SOAR update/reopen conflicts. The pipeline integration
test accepts and replays a synthetic SIEM page, passes it through Redis, reads the
committed inbox snapshot and reproduces one review finding. The offline
`go run ./cmd/qradar-mock` demonstration also passed. See [scope](MOCK_QRADAR_FLOW.md).

S06 adds admission integration tests in `intake/findings_integration_test.go` and
extends the mock Redis flow to verify durable case/job receipt replay. Coverage
includes capacity races, rollback, evidence validation, tenant rotation and bounded
phase concurrency. See [finding admission](FINDING_ADMISSION.md).

The full `--with-streams` suite passed after S06, including ordinary intake progress
and analyst retry scheduling. Migration 022 was applied only in disposable checks.

S07 extends framework checks with typed Python investigation RPCs, Go QA adversarial
cases, read-only evidence isolation, mock-job admission limits and real durable
dispatcher result persistence. See [scope and limits](L1_INVESTIGATION.md).

The full S07 framework suite passed, including the real typed RPC and a completed
durable mock job after Go QA. A focused Python RPC test also verified the added
Investigator named-health endpoint. These are mock contract evaluations, not LLM
accuracy or live-provider results.

S08 adds PostgreSQL escalation/reconciliation tests for concurrent replay, analyst
update preservation, conflict/rebase, source reopen/echo, audit rollback and invalid
results. The mock provider effect and receipt share a transaction; these tests do
not establish live network write-back guarantees. See [scope](MOCK_SOAR_RECONCILIATION.md).

The full S08 framework suite passed, including all four new PostgreSQL tests and
existing Go race/vet, HTTP and specialist checks. Migration 024 was disposable-only.

S09 adds four Redis/PostgreSQL cache tests and extends the mock pipeline with local
IOC enrichment. Coverage includes positive/negative caching, source generation
invalidation, rollback, tenant separation, expiry/corruption, concurrent capacity,
ACL separation, Redis outage and source failure. See [limits](ENRICHMENT_CACHE.md).

The full S09 framework suite passed after correcting a test cleanup that closed its
database pool too early. All cache and existing regression checks passed; migration
025 was applied only in disposable tests. No cache latency improvement is claimed.

S10 full `--with-streams --stream-load` checks passed, including ACK-safe retention
and accounting. Targeted non-race load/cache probes produced the
[performance report](STREAM_PERFORMANCE_REPORT.md). Correctness success does not
mean capacity success: nominal 1,000 offered EPS was not sustained. Production
gates remain open; no additional migration or active-service change was made.

S10 profiling follow-up also passed the full framework command, including new
concurrent batch claim, independent lease, conflict/capacity rollback, atomic
receipt fencing and backpressure tests. The latest probe completed 1,000 events
at 269.66 EPS (p95 2.558 s), below the nominal offered rate. SQL timings and
post-load snapshot/claim plans are generated with the load report. For quicker
measurement iteration, `--stream-measure-only` skips full correctness and HTTP
regression checks and labels the report accordingly; it is not a release gate.

The paced workload accepts `--stream-events`, `--stream-eps` and optional
`--stream-pause-seconds`. The 3,000-event/100 EPS run with a two-second cooperative
pause exercised both consumers and completed every event with zero pending ACKs.
Its full framework check passed; the matching no-pause run was measurement-only.
See the performance report for both results and their short-duration limitations.

Operator publication recovery tests cover default-deny/exact-source grants,
stale reviews, concurrent idempotent requests, conflicting reuse, retry caps,
audit-insertion rollback and completed-event refusal. The full suite passed on
rerun after one existing intake credential-revocation test hit a database statement
timeout; no production auth behavior was changed to accommodate that failure.
This tests an internal primitive, not an enabled operator endpoint or consumer-DLQ
retry. No migration was added.

The final combined full check passed with the paced pause workload, including the
added source-grant and invalid-reason checks. Its slower repeat (75.79 EPS,
p95 15.816 s) is recorded alongside the earlier faster results; correctness success
does not imply a stable 100 EPS capacity result.

The PostgreSQL-instrumented full check also passed. The load report now includes
250 ms active-client wait samples and database counters before/after measurement;
the disposable cluster alone enables I/O timing. The profiling follow-up report
preserves the new result alongside the earlier slow repeat. Sampling does not
replace PostgreSQL process/host resource measurement or failover tests.

The subsequent full framework check passed after combining recovery-budget checks.
A race-enabled concurrency test admits only one competing work/gap record into a
one-slot budget and permits replay at capacity. The Linux resource-parser unit
test (`python3 scripts/framework/test_resource_probe.py`) also passed, including
process names containing spaces/parentheses. Actual resource sampling completed
without errors in both comparison runs. The latest 3,000-event probe drained fully
at 99.18 EPS with p95 1.970 s; no end-to-end speedup is established.

The WAL/idle-poll follow-up passed the separate full `--with-streams` framework
gate, including Go race/vet and the idle-delay configuration bounds. Four fresh
measurement-only runs (1/20/20/1 ms empty-claim delays) each completed 3,000 events
with zero final pending/dead/failure/gap/ACK backlog and no resource-sampling errors.
WAL reset timestamps matched within each measurement. The repeated results show
lower query/CPU cost at 20 ms, not a consistent tail-latency improvement; see the
performance report for every observation. The historical 1 ms harness default and
running services remain unchanged.

Snapshot accounting now has a mixed-state database test: completed, historical
dead-plus-completed, dead-only and pending events, including another processor's
work. It verifies precedence, processor isolation, the accounting identity and
oldest-pending age. The load report compares the original and materialized snapshot
queries against the same retained fixture after the timed drain, in both execution
orders, recording execution time, buffer hits/reads and temporary blocks written.
These query-plan measurements are separate from end-to-end throughput.

The full snapshot-change check passed on rerun. Its first attempt hit a statement
timeout in the existing threat-intelligence concurrency test; the new snapshot
test passed both times. Timeout settings were unchanged. The paired same-fixture
plans showed 29–32% lower snapshot execution time and 44% fewer buffer hits with no
temp writes; the final load completed all 3,000 events with zero ACK backlog.

## Current JSON sandbox milestone

See [sandbox completion and operations](SANDBOX_COMPLETION.md) for scoped JSON
intake, independent Python FastAPI/gRPC, recovery UI, monitoring, verified archive
export, startup and measured limits. Earlier task entries are historical checkpoints.
Live vendor/model validation and privileged response activation are outside this
user-selected local release.

## Persistent showcase and local response validation (2026-10-30)

The follow-on [local gate report](LOCAL_RELEASE_GATES.md) adds Ariel/Sentinel scope
contracts, payload-counter rollback, concurrent quota/ingestion isolation, bounded
Redis batch publication, archive-inclusive restore with originals removed, encrypted
archive tamper rejection and loopback HTTPS alert verification. Sustained probes now
support 60,000 events; see the performance report for measured outcomes.

The complete disposable framework suite passed with streams and a 10,000-event
load probe. Coverage includes fresh-batch atomic rollback/replay, archive content
verification and capacity release, scoped telemetry pagination, QRadar read-only
HTTP fixtures, Go → Python gRPC → JSON inference fixture → Go QA, and sandbox
session approval expiry, default kill switch, audit rollback, replay and quotas.
The JSON model fixture is deterministic, not a real LLM quality evaluation.

Browser checks use main frontend 8080, including `/build-operations` alias, source
selection, event pagination and investigation links. A sandbox session was approved,
previewed and revoked; execution was stopped again afterward. Supervisor recovery
was tested by killing an owned stream worker. Backup encryption passed an ephemeral
key decrypt/compare test and rejected a changed input; this is not off-host restore
verification. See [current limits](NEXT_DELIVERY_TASKS.md) and
[measurements](STREAM_PERFORMANCE_REPORT.md).

Common architecture checks: `python3 scripts/framework/check_jobs.py` runs real isolated
PostgreSQL fairness/lease tests; `make sqlc-check` in `backend-go` verifies generated
queries. The full framework suite also probes real Go/Python execution over mTLS.
See [test boundaries](WORKER_DISPATCH_SECURITY.md#verification).

See [investigation review visibility](INVESTIGATION_VISIBILITY.md) for the tenant-scoped read-only L1 projection, frontend states and validation.

## React 19 frontend

The frontend uses React/React DOM 19.3.1 with Chakra UI 2.10.9 and selectively enabled React Compiler 1.0. See [migration, verification and rollback notes](REACT_19_MIGRATION.md) for pinned tooling, the telemetry opt-out, browser checks and measured limitations.

### Sparse detection rule regression

`TestRegistrySparseRuleDocument` runs with `AISOC_GO_TEST_DATABASE_URL` against disposable PostgreSQL. It reproduces the sandbox routing-only JSON shape, checks registry/list/detail canonical identity and empty ATT&CK mappings, tenant isolation, and absence of read-time persistence changes. `scripts/framework/detection-registry-browser-check.js` checks HTTP 200, rule search, desktop inspector and mobile detail using the existing mock-stream-login fixture. The migration browser suite now fails on unsuccessful GET API responses, not just rendering errors.

### Navigation regression

The navigation unit test verifies that `/` belongs to **Detect → Overview**, every menu target has a route, and detail views select the correct parent. `scripts/framework/navigation-browser-check.js` verifies desktop/mobile active links, all response submenus, direct reload, Back, drawer Escape/focus restoration and access to Build links without clipped horizontal primary navigation. This test performs no API writes.

See the [workspace navigation reference](NAVIGATION.md) for the current menu hierarchy, route ownership and responsive behavior.

See [clickable breadcrumbs and tenant-scoped resource labels](BREADCRUMBS.md) for frontend/backend behavior and regression coverage.

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


## Respond workspace checks

Migration 037 and response policy/preview behavior are covered by `workspace_test.go`, `workspace_integration_test.go` and HTTP `response_workspace_test.go`. The disposable `check_detection_intelligence.py` harness includes the response package and uses serial package execution with the race detector. It checks isolation, version conflicts, concurrent policy saves, audit rollback and no case/action effects from previews. Browser fixtures in `response-workspace-browser-check.js` exercise the screens without writing demo data. See [test scope and limits](RESPONSE_WORKSPACE.md).


## Hunt verification

Hunt workspace tests cover tenant isolation, stored case/artifact matches, literal input, bounded results, timestamp conflicts, concurrent idempotent retries, notes and audit rollback. Browser fixtures cover registry/TI creation, search results, historical query attribution and responsive panels. See [commands and exact scope](HUNT_WORKSPACE.md).


## Threat Intel verification

The shared isolated PostgreSQL race suite includes threatintel tests for real registry counts, metadata guards, atomic linked hunt creation, concurrent retries, audit failure, report/IOC ownership and deleted-hunt replay. Browser fixtures cover report/IOC forms, relevance, delayed completion navigation, linked hunts and mobile/desktop views. The Hunt browser suite is updated for the shared TI registry. See [test scope](THREAT_INTEL_WORKSPACE.md).

## Skills workspace regression checks

The isolated PostgreSQL harness now includes `internal/modules/skills`, including revision concurrency, pagination/origin isolation, audit rollback and existing materials/applications. HTTP tests reject malformed controls. Run `scripts/framework/skills-workspace-browser-check.js` through Playwright against localhost:8080 for intercepted library/editor/import/preview/conflict/navigation/mobile flows; no demo writes occur. See [Skills verification](SKILLS_WORKSPACE.md).

## Enterprise Insights tests

The isolated PostgreSQL harness includes insights and the intake entity-value regression. It tests tenant isolation, snapshots, replay, archive coordination, audit rollback and prevalence. The intercepted `scripts/framework/enterprise-insights-browser-check.js` covers active/cards/prevalence/audit views, usage, edit conflicts, archive, late requests, empty states and mobile overflow without demo writes. See [verification scope](ENTERPRISE_INSIGHTS.md).

## Build workspace (2026-11-01)

Run python3 scripts/framework/check_detection_intelligence.py for isolated PostgreSQL/race coverage including internal/modules/build. HTTP tests check invalid filters. Run frontend lint/build, node --test tests/frontend/*.test.mjs, and scripts/framework/build-workspace-browser-check.js through Playwright. Browser fixtures test metadata, navigation, errors, stale responses and responsive layout without writes. See [scope](BUILD_WORKSPACE.md).

## Platform review (2026-11-01)

Run the four batches of platform-live-browser-check.js and platform-regression-browser-check.js alongside per-workspace scripts. The expanded check_detection_intelligence.py covers all domain packages with disposable PostgreSQL. check.py --with-streams additionally verifies Redis and worker/HTTP integration. Report live reads separately from intercepted mutations. See [review and verification](PLATFORM_REVIEW_2026-11-01.md).

## Reviewed suspicious-login slice — 2026-11-01

The local foundation ran the versioned JSON scenario through actual Go intake,
PostgreSQL/outbox, Redis workers and the Python gRPC mock. Four events produced one
case with four evidence references and a QA-verified INCONCLUSIVE result. Before
approval: `awaiting_review`, no note. Explicitly simulated approval: one mock note,
case still open, replay inserted zero events. Reports are under
`output/suspicious-login/{before-review,after-review}.json`.

`python3 scripts/framework/check.py --with-streams` tests the isolated pipeline,
including withheld note, operator denial, immutable approval replay and one audit/
note. Store tests verify wrong source/tenant, gate downgrade and audit-failure
rollback; configuration tests reject conflicting policies across processors.
The scenario loader's three unit tests cover unsafe origins, weakened grants,
path traversal and foreign event identity. `sqlc-check`, frontend lint and build
pass (the existing bundle-size warning remains).

Run `scripts/framework/suspicious-login-browser-check.js` through the Playwright
browser tool on the scenario case. At 1440px and 375px it checks confirmation,
comment requirements, a failed write retaining its comment, successful receipt and
no horizontal overflow. Writes in this browser fixture are intercepted. Existing
`investigation-review-browser-check.js` also passed real evidence links, queued/
failed/invalid/empty states, HTML escaping and stale-refresh handling. Screenshot
receipts are under `output/playwright/suspicious-login-review-*.png`.

These results establish local mock contract behavior, not live QRadar support,
real-model quality or production performance. See [scenario guide](SUSPICIOUS_LOGIN_FLOW.md).

## Local IAM/MFA and EDR adapters — 2026-11-01

The retained foundation ran all five versioned fixtures through Go ingestion,
Redis delivery, durable Python gRPC mock investigation, Go QA and mock SOAR sync.
Before explicit simulated approval, every scenario stopped at `awaiting_review`
without a note. Afterwards each had one note and an open case. Reimport inserted
zero events. The evidence counts are 6 (corroborating), 6 (suspicious), 5 (missing),
7 (conflicting) and 6 (stale). Results remain INCONCLUSIVE; expected gap labels
are checked by the runner. Local receipts: `output/login-context/*-{before,after}.json`.

`logincontext` Go tests cover all fixture gaps, wrong tenant/user, malformed/future
or stale times, retrieval before observation, excessive age, duplicate references,
arbitrary outcomes and invalid process metadata. Go QA tests reject concealed gaps,
benign closure and context sent to the unexpanded model contract. Config tests
reject conflicting context across processors and a missing review gate. The
PostgreSQL/Redis integration test rejects changed snapshots and foreign subjects.
Python's actual authenticated gRPC test checks contextual support/counterevidence,
neutral treatment of stale observations, gaps and existing auth/budget rejection.

The full framework includes all five context scenarios with real Go/Python
processes, PostgreSQL and Redis, mock note approval and replay. Its dedicated
receipt is `output/backend-framework/login-context-flow.json`. Run:

```bash
python3 scripts/framework/check.py --with-streams
python3 -m unittest discover -s scripts/framework -p test_suspicious_login.py
node --test tests/frontend/*.test.mjs
```

`scripts/framework/login-context-browser-check.js` passed all five retained cases
at 1440px and 375px: evidence, provenance, missing/conflicting/neutral state labels,
no horizontal overflow and no browser exceptions. It makes no domain writes.
Screenshots are under `output/playwright/login-context-{suspicious,stale}-*.png`.
These are fixture/contract tests, not provider API compatibility, model quality,
endpoint completeness or performance measurements.

Final adapter verification: the complete isolated framework suite passed with
Go race/vet, PostgreSQL migrations, Redis recovery, Python/Rust tests, typed gRPC,
HTTP authorization and all five context scenarios. All nine frontend Node test
files, ESLint, production build, sqlc diff and Markdown link checks passed. The
existing bundle-size warning remains. The approval browser regression also passed
on a context-enriched case (confirmation, rejected-write recovery and receipt).
Independent review's stale-evidence classification finding was fixed with typed
neutral citations and Go QA enforcement before the successful final run.

## Build local integration management — 2026-11-01

The complete isolated framework passed after review fixes: Go race/vet,
PostgreSQL migrations, Redis recovery, Python/Rust and gRPC tests, existing HTTP
parity and the new Build profile flow. Dedicated receipt:
`output/backend-framework/build-integrations-flow.json`.

Coverage includes server-normalized evidence preview, rejecting unknown request
fields, tenant/operator isolation, stable create retries, revision conflicts,
explicit import confirmation, sealed-edit denial, managed worker discovery,
case approval authorization and zero-insertion replay. Store tests cover first-use
tenant creation, concurrent edits with one winner, exactly one seal audit and
rollback when audit persistence fails. Preview tests reject duplicate citations
within login evidence and between login/context before an immutable profile can
reach the worker. Foreign profile reads return 404, not an internal error.

The retained local walkthrough in `scripts/framework/local-integrations-demo.js`
created **Build local IAM/EDR showcase**, validated and saved it, imported four
observations, opened the generated six-evidence case, explicitly simulated note
approval and verified one mock note. Replay inserted zero events. It reuses that
named profile on later runs. This script intentionally writes only local mock data.

`scripts/framework/local-integrations-browser-check.js` intercepts writes and
passed file import, invalid JSON feedback, conflict preservation, stable create
identity, confirmation, uncertain-import recovery and sealed read-only controls.
Desktop (1440px) and mobile (375px) checks found no horizontal overflow. Screenshots
are under `output/playwright/local-integrations-*.png`; sealed JSON remains readable
and copyable. Normal navigation/breadcrumb tests include `/build/integrations`.
Frontend Node tests, ESLint, build, sqlc drift and maintained Markdown link checks
are part of the release checks. The existing frontend bundle-size warning remains.

No live connectivity, model-quality, throughput or production response capability
is established by these checks. See [contracts and rollback](BUILD_INTEGRATIONS.md).

## Shared UI/UX regression — 2026-11-01

Run `scripts/framework/ui-consistency-browser-check.js` through Playwright after
opening `http://127.0.0.1:8080/?uiBatch=N`, for N=0..3. The 28 routes are checked at
1440/768/390px against real local Go reads (84 checks). It fails on missing h1/main,
wrong title size, hidden selected submenu, overflow, JS errors or HTTP API errors.
Run `ui-accessibility-browser-check.js` for keyboard, focus, mobile controls and
reduced motion. These scripts do not mutate database records. See
[UI/UX verification scope](UI_UX_SYSTEM.md) for limits and supporting regression checks.

## Investigate → Respond sandbox

`python3 scripts/framework/check.py --with-streams` invokes `check_case_response.py`
after a reviewed Build import. It checks foreign tenants, absent grants, evidence
references, proposal replay, explicit/expired approval, kill switch, source-version
conflicts, legacy bypass denial, audit rollback and four concurrent requests
producing one revocation/note. See `output/backend-framework/case-response-flow.json`.
Run `case-response-browser-check.js` through Playwright for intercepted-write UI
regression. `case-response-demo.js` deliberately writes one retained local mock
showcase and restores the kill switch; run only for that intended purpose.
See [validation and demo receipt](INVESTIGATE_RESPOND_SANDBOX.md).

## Case detection feedback regression

The disposable detection suite includes case ownership, pagination, concurrent CAS, audit rollback and label-change replay invalidation tests. Browser checks are scripts/framework/case-detection-feedback-browser-check.js and scripts/framework/rule-recommendations-browser-check.js. The real local demo replay preserved TP/unreviewed alerts and kept the applied rule disabled. See [test details](INVESTIGATE_DETECT_FEEDBACK.md).

## Repeatable platform acceptance

`python3 scripts/framework/acceptance.py` runs two fresh disposable framework environments. `--runs 1` is available for iteration. Missing stages and failed subprocesses cannot yield a passing aggregate. See [commands, assertions and reports](DETECT_BUILD_ACCEPTANCE.md).

## Guidance lifecycle regression

New lifecycle integration tests cover staged instructions/materials, audit rollback, stale source/revision rejection, archive and snapshot preservation. The local browser script is scripts/framework/learning-lifecycle-browser.js; platform acceptance includes lifecycle HTTP checks. See [coverage](SKILLS_MEMORY_LIFECYCLE.md).

## Build lifecycle regression

See [Build lifecycle](BUILD_INTEGRATION_LIFECYCLE.md). Run the disposable acceptance
suite plus `node --test tests/frontend/*.test.mjs`, frontend lint/build and
`make sqlc-check`/`go vet ./...` in `backend-go`. The real-browser script
`scripts/framework/build-lifecycle-browser-check.js` requires a running local
foundation and the Build IAM/EDR showcase; it retains one archived clone per run,
never imports it and never enables a response. The existing
`local-integrations-browser-check.js` intercepts mutations to exercise errors and
uncertain-import recovery without changing database state.

## Memory → Hunt — November 2026

Memory-to-Hunt regression: hunts/memory_integration_test.go verifies freshness/exclusion, historical replay/promotion, caps, tenant isolation and audit rollback. check_platform_acceptance.py covers learned-source reapproval/archive; tests/frontend/hunt-memory.test.mjs checks date labels. See [workflow](MEMORY_HUNT_FLOW.md).

## Independent approval roles — November 2026

See [role contracts and validation](INDEPENDENT_APPROVAL_ROLES.md) for Respond,
Skills and Memory. The 2026-11-01 disposable acceptance run passed in 249.96s;
frontend lint/build and all 12 frontend test files passed. Coverage includes
distinct proposer/approver/executor identities, pending contributors, stale
versions, tenant isolation, source reapproval, denied legacy execution and replay.
The credential-free browser smoke (`scripts/framework/approval-browser.js`)
passed on the refreshed local backend with no page errors. Authenticated role
handoffs are verified through local API tests, not this browser smoke.

## Unified approval inbox — November 2026

Go projection/lifecycle and HTTP filter tests, full local response/guidance acceptance assertions and frontend expiry/handoff tests cover the inbox. See [scope and validation](APPROVAL_INBOX.md).

Validation on 2026-11-01: full disposable acceptance passed in 189.87s; all 13
frontend test files, lint/build and sqlc consistency passed. Credential-free browser
smoke verified stale-revision denial, author restrictions, handoff navigation,
filters, error recovery and mobile layout with no page errors. Existing Vite bundle
size warning remains. See `scripts/framework/approval-inbox-browser.js`.

## Build bulk imports — November 2026

Go batch integration tests cover concurrent claims, quotas, partial failures, repair and replay after intake. `scripts/framework/check_bulk_import.py` extends the disposable Detect-to-Build suite with two case investigations, explicit mock-note approval and sync. Frontend envelope/progress tests and browser checks cover the new workspace. See [test scope](BUILD_BULK_IMPORT.md).

Bulk import validation on 2026-11-01: full acceptance passed in 193.93s, including
two synchronized mock notes and zero extra events after crash recovery. All 14
frontend test files and lint/build passed. Browser upload/partial import/repair,
stale-confirmation rejection, replay and mobile checks passed with no page errors.
A final NUL-input guard passed targeted Go tests after the full run. See
[the detailed report](BUILD_BULK_IMPORT.md).

## Approval ownership regression — November 2026

The disposable suite now covers concurrent claims, stale revisions/versions, replay, expiry/reclaim, atomic audit failure rollback, recipient/tenant isolation and independent response handoffs. Frontend helpers cover expiry and composite links. `scripts/framework/approval-ownership-browser.js` covers assign/release, author claim denial, expired Memory repair claim, notification read/deep-link and desktop/mobile layouts using synthetic local data. See [contracts, source map and limits](APPROVAL_ASSIGNMENT_NOTIFICATIONS.md).

## Retention and recovery tests — November 2026

Database and authenticated API tests cover protected states, version/digest conflicts, tenant/recipient isolation, role gates and notification archive/cleanup/restore replay. Browser regression covers the Build workspace on desktop/mobile. Two-clone recovery verifies copied payload files, retention policies/snapshots/audit and corruption rejection. Existing local backup verifies restored schema/readiness. See [scope, contracts and recovery tests](RETENTION_RECOVERY.md).

## Combined browser/API/backup gate — November 2026

The new release wrapper adds real JSON upload/import, independent guidance approval, notification and retention workflows, plus a desktop/mobile navigation sweep and two-clone backup recovery to the full API acceptance suite. Failure or missing evidence in any stage fails the combined result. See [usage, coverage and limits](BROWSER_RELEASE_GATE.md).

Verified twice on 2026-11-01: runs `08cef8c303864d5e9df88b8e4ece8181` and `55d792f7e8374f16a3b33d498b37cd38` passed all four stages. Each completed 72 desktop/mobile route checks, all six browser workflows, frontend lint/build and 33 regression tests, full API/framework acceptance, and recovery of 76 table fingerprints, one payload archive and two retention snapshots. Archive/snapshot corruption was rejected. See the gate guide for timings, artifacts and coverage limits.

## Critical workflow browser acceptance — November 2026

The gate now requires ten browser stages, including Respond independent approval/execution/replay, Skill staged publication/source reapproval/archive, approved Memory → stale exclusion → historical hunt promotion, and explicit investigation labels → replay → guarded local rule application. Real UI writes run against fresh disposable fixtures; execution retry uses the same browser-session HTTP request. SQL requires one response note, one execution audit and one rule application. Older six-stage reports fail validation.

Verified run `710cb82ef8d04b6c8701677f65332263` passed in 258.79 seconds: ten stages, 72 desktop/mobile route checks, 12 extra workflow screenshots/overflow checks, 33 frontend regression tests and full API/framework/backup acceptance. Five release-report and two acceptance-report unit tests passed. See [detailed evidence and limits](BROWSER_RELEASE_GATE.md).

## Local OIDC identity gate — November 2026

The combined gate now requires a fifth `identity` stage. It launches disposable Go, Vite and mock-provider services with private synthetic mappings. Real browser/API checks cover authorization-code redirects, trusted tenant/role mapping, independent approval and self-approval denial, CSRF, logout-all, role downgrade, disabled identities and malformed mapping files. Go protocol tests cover invalid token claims/signatures, PKCE, state replay/expiry and browser binding. See [OIDC setup and boundaries](OIDC_SSO.md).

The frontend routing regression protects HTML OIDC start/callback requests from SPA fallback. The existing Skill lifecycle browser helper now waits for the matching successful lifecycle response before checking resulting state; a temporarily hidden button during loading is insufficient evidence of completion.

Verified run `cebf76ec2d154dec9548d7e177d167f7` passed all five release stages in 490.11 seconds (2026-11-01/02 local run). It passed 34 frontend tests plus lint/build, full Go race/vet and API/framework acceptance, ten browser workflows and 72 desktop/mobile route checks, and all eight identity checks plus self-approval denial with an approver role. Browser reports recorded no page errors or external requests. Recovery matched 76 table fingerprints, verified one copied archive and two retention snapshots, and rejected archive/snapshot corruption. Six release-report and two acceptance-report unit tests also passed.

Generated evidence is in `output/release-gate/cebf76ec2d154dec9548d7e177d167f7/`; reports record the working tree as dirty. This validates local/mock behavior, not a live identity provider or production deployment. Earlier failed runs remain failed; the successful run includes the OIDC proxy fix and Skill lifecycle response wait.

## Local phishing workflow — 2026-11-02

Added a bounded credential-phishing JSON scenario through Build, deterministic detection, evidence-backed Python gRPC mock investigation, explicit SOAR note review and independently approved sandbox session revocation. Existing outcome-derived Skills/Memory approval and matching are reused. The acceptance suite now requires a phishing API stage and an eleventh browser workflow. No live mail provider, actual model or production response is enabled. See [contract, implementation and test boundaries](PHISHING_FLOW.md).


## Verified phishing release — 2026-11-02

Run `108f639e1ceb493f9bc044d81079f416` passed all five release stages in 279.95 seconds: frontend lint/build and 35 regression tests; backend/API acceptance including phishing; eleven browser stages with 72 desktop/mobile route checks; eight OIDC checks plus self-approval denial; and backup/restore matching 76 tables, one archived payload and two retention snapshots with corruption rejection. Go race/vet and Python worker checks ran in the disposable framework suite. Reports and screenshots are under `output/release-gate/108f639e1ceb493f9bc044d81079f416/`.

The earlier `06da61047f714c6696870297ac50aeb1` run failed during its mobile route sweep after phishing passed. The route gate now explicitly waits for a visible heading before inspecting rendered content, instead of assuming network idle means rendering is complete. The complete rerun passed without weakening authorization or evidence checks. Results validate local/mock behavior only; no live mail provider, production response, actual-model quality or throughput is certified.


## Durable local Hunt execution — 2026-11-02

Hunt searches can now run through the existing PostgreSQL job queue and Go investigation-worker, with persisted progress, cancellation, bounded automatic/explicit retries and expired-lease recovery. Completed evidence/Memory receipts and reviewed promotion remain atomic and replay-safe. The UI uses queued execution; synchronous search remains compatible. No live integrations or new service are enabled. See [contracts, limits, deployment and tests](DURABLE_HUNT_EXECUTION.md).


## Verified local release — 2026-11-02

Run `aa47ada7f2d348bdae4a7d64bdea2ed0` passed all five release stages in **450.04 seconds**. Evidence includes six API workflow stages, twelve browser stages, 72 desktop/mobile route checks, frontend lint/build and 35 regression tests, Go race/vet and Python/Rust checks, mock OIDC checks and backup/restore. Durable Hunt browser assertions cover explicit retry, persisted cancellation, enqueue replay and a lost accepted response followed by completed receipt recovery without duplicate runs. Completed and cancelled mobile screenshots were visually inspected.

The initial API attempt exposed a test request missing the required cancellation `attempts` field; that request and documentation were corrected. The subsequent browser run caught overflow from a full run ID in the button label; controls now show short labels with exact accessible names. Earlier failed/superseded runs remain failed. Independent review also identified and resolved a tenant-lock/audit deadlock risk and missing receipt refresh after terminal enqueue replay.

Reports and screenshots: `output/release-gate/aa47ada7f2d348bdae4a7d64bdea2ed0/`. This is local/mock correctness and recovery evidence, not live-provider, distributed-scale or throughput certification.
