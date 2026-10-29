# Backend replacement completion report

Completed: **2026-10-29**. AISOC now uses **Go/PostgreSQL** on port **3002**;
the frontend remains on **8080**. The former Node API and worker are stopped.
All 42 local release checks passed before the switch. The maintenance window was
23.3 seconds, followed by ten minutes with no HTTP 5xx, new failed jobs or backlog.

| Item | Result | Evidence |
|---|---|---|
| 1. Skills authoring and materials | Complete | CRUD, publish/toggle/history, material limits, revisions and archive; shared HTTP/auth tests, transaction/concurrency/restart checks and browser authoring/upload/edit/publish. |
| 2. Skills integration | Complete | Manual cases, authenticated intake, investigation phases and hunts; immutable applications, feedback, outcomes and suggestions. All 11 shared functional scenarios pass. |
| 3. API/frontend compatibility | Complete for supported workflows | All 97 routes implemented; domain/auth/CSRF/tenant checks, 44 desktop/mobile screen combinations and live migrated-data reads passed. Deliberate legacy differences are in ADR 003. |
| 4. Rust/WASM and Python foundation | Complete | Go RPC dispatch, bounded embedded Wasmi execution, trusted Python subprocess limits/cancellation, identity/size validation and failure isolation verified. Ordinary routes work without optional workers. |
| 5. Data migration | Complete | All 26 legacy tables reconciled from the final snapshot; populated-fixture and Go-era reverse exports passed. Restored Node accepted a Go-issued source key and preserved deduplication. |
| 6. Performance and soak | Complete for local release | Matched token-mode, two-CPU-affinity campaigns; per-operation p95/p99 gate passed. Final ten-minute soak completed 24,972 operations and 551 alerts with zero errors, 42.1 ms p99, worker SIGKILL recovery and reconciled reverse export. |
| 7. Operations and recovery | Complete for local release | Separate release cluster/role/key, lifecycle and metrics, private backup plus restore/readiness verification, vulnerability scans, validated optional service units and proxy-switch/rollback rehearsal. |
| 8. Cutover and Node retirement | Complete | Go is selected by the normal launcher; Node is outside the request/worker path. Final observation and live backup/restore passed. Recovery artifacts and legacy code remain available. |

## Measured comparison

This section records the original cutover campaign. Later investigation-path
optimizations were verified and promoted to the active release; see
[the subsequent performance review](PERFORMANCE.md) for the fresh before/after
baseline, absolute Node/Go results and write-tail anomaly. Those later results
are separate from the original 42-check release receipt.

Three independent repeats per dataset, matching token authentication, eight-client
concurrency, 3,000 requests and 100-ms worker intervals. Each repeat used a fresh
database. Go measurements include its API, investigation worker and PostgreSQL.
The same two-CPU affinity included each stack and its load generator.

| Median change from Node/SQLite | Small dataset | Larger dataset |
|---|---:|---:|
| Throughput | +44.6% | +61.1% |
| p95 latency | −33.1% | −41.0% |
| p99 latency | −54.1% | −32.2% |
| Whole-stack proportional memory | −26.9% | −31.4% |

These are local shared-host measurements, not universal language claims or a
production capacity guarantee. Summed RSS was higher for PostgreSQL because
shared pages appear in several processes; proportional memory accounts for that.
CPU time was about 3.9% higher on the small fixture and 17.8% lower on the larger
fixture. Every measured operation's median p95/p99 stayed within the predeclared
10% regression ceiling, with repeatable median throughput gains.

## Evidence and operation

- [Operations, backups and rollback](OPERATIONS.md).
- [Contract/runtime decisions](../adr/003-replacement-contract-decisions.md).
- [Route tracker](../../contracts/go-implementation.json) and
  [frontend journey mapping](../../contracts/frontend-journeys.json).
- `output/backend-framework/report.json`: full race/vet, HTTP, auth, restart,
  crash/recovery and specialist-runtime checks.
- `output/backend-performance/controlled/`: workload, environment and comparison.
- `output/backend-performance/soak.json`: final sustained workload and recovery.
- `output/playwright/go-journey-review.json`: 44 screen/viewport checks.
- `output/migration/`: reconciliation, Node rollback, proxy rehearsal, release
  gates, live observation, backup verification and final cutover reports.

Go, Rust, Python and frontend dependency scans reported no known vulnerabilities
after patching the Go toolchain and dependencies. This is point-in-time evidence;
continue routine dependency reviews.

## Retained boundaries

The normal launcher now defaults to Go even without a selector file. Optional
Node comparison and Go preview stacks are stopped in normal operation. Source,
contracts, lockfiles and test cases are versioned; local reports, build output,
private keys and runtime databases remain ignored. Historical reference images
and the assessment are retained under `docs/reference/`.

Retain private snapshots, matching connector keys, backups and the Node reference
for at least the planned seven-day rollback window. No cleanup is automatic.
Rollback must export current Go-era data; restarting Node against the old snapshot
would lose acknowledged writes. Go-only specialist job records remain disabled in
the domain database while legacy rollback is required.

The migration preserves local simulations: no live containment, external hunt
queries or provider adapters were enabled. The Python host is for trusted
allowlisted plugins, not arbitrary uploaded code. Remote TLS deployment,
enterprise SSO, off-host backup scheduling and third-party plugin hosting remain
separate platform extensions.

The browser sweep recorded existing mobile horizontal overflow on the dashboard
and hunt pages. Those layouts were unchanged; API-backed rendering and workflows
passed. Exhaustive emulation of malformed SQLite/JavaScript inputs and exotic
Unicode folding is not claimed.
