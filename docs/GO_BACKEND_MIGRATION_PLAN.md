# Go backend migration: completed plan and acceptance record

Status: **completed local replacement and cutover on 2026-10-29**. Go/PostgreSQL
is active on 3002, with frontend 8080. Node is outside normal startup and the
request path; explicit comparison and recovery tooling remains available.

## Accepted architecture

Go owns domain APIs, authentication, tenant checks, approvals, audits and PostgreSQL
writes. A separate Go investigation worker shares domain modules. Optional specialist
dispatch invokes Rust/WASM or Python through versioned gRPC; specialists have no
database authority. See [architecture](ARCHITECTURE.md),
[ADR 002](adr/002-go-backend-replacement.md) and
[contract/runtime decisions](adr/003-replacement-contract-decisions.md).

## Completed phases

| Phase | Evidence |
|---|---|
| 0: Inventory/baseline | 97 routes, 26 legacy tables, journey mapping, shared HTTP fixtures |
| 1: Go foundation | Config, migrations/pools, tenant/auth/session/CSRF, health/readiness/metrics |
| 2: Response | Versions, conflicts, archive/restore, case runbooks, approval and audit rollback |
| 3: Domains | Investigations, detection, intake, Skills, hunts, connectors, intelligence/dashboard |
| 4: Specialists | Bounded embedded Wasmi and trusted Python invocation/failure isolation |
| 5: Recovery | Consistent snapshot/import, reconciliation, restore and Go-era reverse export |
| 6: Verification | HTTP/auth, race/vet, browser, concurrency/restart, performance/soak, operations |
| 7: Cutover | Final import, Go selection, observation, backup and Node removal from startup |

All eight release items and 42 local checks passed at cutover. Maintenance took
23.3 seconds, followed by ten minutes without new HTTP 5xx, failed jobs or backlog.
[Release status](migration/RELEASE_STATUS.md) records scope and evidence.

## Acceptance boundaries

- Supported workflows preserve tenant IDs, state, audit/version history,
  credentials, deduplication and simulation semantics.
- Typed validation, tenant joins and ordering differences are recorded in ADR 003.
  Exhaustive malformed JavaScript/SQLite and Unicode emulation is not claimed.
- Related mutations and audits are atomic. Failure injection, concurrent writes,
  restart and worker crash/recovery are tested.
- Ordinary routes work without optional workers. Specialist results validate
  identity, limits, lease and cancellation before commit.
- Migration reconciles counts, content, relationships, versions, credentials and
  jobs. Post-write rollback must preserve acknowledged data.
- Performance compares matching datasets/auth/resources using repeat medians and
  at most 10% p95/p99 regression per measured operation. This is workload-scoped.
- Local backup/restore, readiness, observation and rollback are verified; remote
  hosting and unattended operations need additional deployment work.

## Post-cutover optimization

Investigation SQL batching retains transactions and locks; typed detail responses
avoid redundant JSON work; Skills aliases are loaded lazily. Full framework
verification passed and tested API/worker binaries were promoted to the release.
Prior binaries remain private recovery artifacts.

The final controlled campaign passed its per-operation latency gate with zero
errors. Earlier shared-host write-tail spikes did not reproduce in the fresh
unmodified baseline. [Performance evidence](migration/PERFORMANCE.md) distinguishes
those observations from the measured improvement.

## Retained recovery constraints

Retain legacy source, keys, snapshots and backups for at least the planned
seven-day rollback window. No deletion is automatic. Post-write rollback pauses
writers, exports/reconciles current PostgreSQL into a new legacy database,
validates it, switches routing and runs only Node. If acknowledged data cannot be
preserved, repair Go instead of selecting stale state.

Go-only specialist jobs remain disabled in the release while legacy rollback is
required. Use [operations](migration/OPERATIONS.md) for explicit recovery. Never
rerun initial import/cutover against an initialized release. Development and
benchmarks use separate databases/ports/credentials; there are no live dual writes
or automatic Node fallbacks.

## Remaining work

Local migration parity is complete. [Delivery roadmap](ROADMAP.md) tracks rollback
closeout, off-host/unattended operations, production hardening and new capabilities.
Real providers, external queries, autonomous reasoning and live response remain
separate product work.
