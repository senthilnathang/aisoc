# Testing and verification

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
