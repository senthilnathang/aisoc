# Testing and verification

Current as of 2026-10-29. Go/PostgreSQL is the active backend. Node/Fastify/SQLite
tests remain a legacy reference; they are not the only backend verification.

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
