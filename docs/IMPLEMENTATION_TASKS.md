# Streaming and agentic L1 implementation tasks

Started 2026-10-29 after review of the QRadar brief, Redis amendment and flow diagram.
Tasks run in dependency order. Preserve the working Go/PostgreSQL and Python
FastAPI/gRPC foundation. No production containment or live provider credentials
are required for the first milestone.

| ID | Task | Depends on | Acceptance gate | Status |
|---|---|---|---|---|
| S01 | Versioned telemetry/finding contracts and Redis boundary ADR | Reviewed diagram | Typed Go validation, source/tenant binding, stable revision-aware identities, mock fixture and negative tests | Complete |
| S02 | Durable ingestion outbox, consumer inbox and source checkpoints | S01 | Additive migration tested on disposable PostgreSQL; atomic checkpoint/publication intent, duplicate/conflict and crash replay tests | Complete |
| S03 | Optional Redis Streams adapter and isolated local runtime | S02 | Pinned Redis/client compatibility; ACL, noeviction, bounded memory, publish/read/ACK/reclaim; no effect on core startup when disabled | Complete |
| S04 | Recovery, retries, DLQ and backpressure | S03 | Crash before/after commit/ACK; lost publication, stale reclaim, Redis loss and DLQ failure; no silent acceptance/loss | Complete |
| S05 | Mock QRadar intake and deterministic suspicious-login finding | S04 | Separate SOAR/SIEM source identities, duplicate/update/reopen handling, replayable event-time correlation, evidence references | Complete (bounded mock) |
| S06 | Finding admission into existing Go investigation jobs | S05 | Durable idempotent case/job creation, tenant fairness and bounded concurrency; no replacement Redis investigation queue | Complete (internal sandbox path) |
| S07 | Evidence tools, Python investigation contract and QA | S06 | Typed gRPC tasks/results, competing hypotheses, citation/missing-evidence checks and budgets; mock inference labeled honestly | Complete (mock contract and QA) |
| S08 | Human escalation and mock SOAR reconciliation | S07 | Conflict-aware draft/write-back, analyst update preservation, version checks and replay without duplicate notes | Complete (note-only mock) |
| S09 | Tenant-aware enrichment caching | S07 | Real bounded read use case; freshness/provenance, TTL/invalidation, negative caching and safe cache-outage behavior | Complete (opt-in local IOC tool) |
| S10 | Stream observability and load/failure report | S04–S09 | Accepted/disposition reconciliation, queue age, replay gaps, p50/p95/p99, CPU/RAM; safe retention and operator recovery; measured workload and limits documented | Complete for bounded local sandbox; production capacity gate open |
| S11 | Local JSON sandbox rollout (user-selected scope) | S10 | Scoped import, worker restart/replay, typed mock inference, SOAR notes and browser validation | Complete — local foundation deployed and browser verified |
| S12 | Rust optimization and autonomous response proposals | Measurements / separate action policy review | Rust only with end-to-end benefit; containment requires explicit authorization, audit, compensation and kill switch | Deferred |

S02–S04 form one reliability milestone: streams must not carry live traffic before
all three pass. Remote provider access, production enablement, breaking migrations
and privileged responses are separate gates. Do not change current HTTP ingestion
semantics or use Redis TTL keys as durable incident deduplication.

See [repository gap analysis](redis-streams-gap-analysis.md) for concrete file
locations, failure scenarios, migration risks and rollback requirements.

## S01 completion evidence

- [ADR 005](adr/005-redis-streams-boundary.md) records the accepted sandbox boundary.
- [Contracts and fixture](../contracts/events/README.md) define 16 KiB projected
  authentication telemetry and review-only findings, with explicit source revisions.
- [Go validator/tests](../backend-go/internal/modules/telemetry/contract_test.go)
  cover foreign tenants/connectors/sources, replay identity, changed content,
  revisions, timestamps/IPs, duplicate/unknown JSON fields, fabricated citations,
  missing evidence and injected action fields.
- Go race tests and vet passed. Ten-second fuzz run: 66,968 executions, no failure.
  Both JSON Schemas passed draft-2020-12 schema validation; the telemetry fixture
  passed with format checking enabled. These are correctness checks, not EPS results.
- Foundation services stayed running. S01 introduced no migration, Redis instance,
  provider access, model inference or response execution.

## S02 completion evidence

- [Migration 020](../backend-go/migrations/020_stream_event_state.sql) adds four
  recovery tables without changing existing intake or job tables.
- [Persistence store](../backend-go/internal/platform/eventstate/store.go) commits
  source checkpoints/envelopes/outbox intent atomically, fences publisher attempts,
  and deduplicates database effects using the transactional consumer inbox.
- [Five database integration tests](../backend-go/internal/platform/eventstate/store_integration_test.go)
  passed with the race detector against disposable PostgreSQL. Coverage includes
  partial-batch rollback, changed revisions, budget exhaustion, concurrent acceptance,
  expired/stale/foreign leases, retained exhausted publications, failed effect
  rollback, concurrent redelivery and duplicate job prevention.
- Full framework check passed, including all Go race tests/vet, existing HTTP/auth
  workflows, worker recovery and Python/Rust dispatch. Running foundation/release
  services remained healthy on their existing schemas; 020 was not applied there.
- See [streaming persistence](STREAMING_PERSISTENCE.md) for guarantees, limits,
  migration/rollback and the remaining Redis-specific failure tests. Next: S03.

## S03 completion evidence

- [Go Streams adapter](../backend-go/internal/platform/streams/redis.go) adds bounded
  publish/read/ACK/reclaim, source-bound keys and explicit missing-payload reporting.
  Pinned client: go-redis v9.23.0; verified local Redis baseline: 7.0.15.
- [Redis launcher](../scripts/framework/redis_runtime.py) manages only its own
  opt-in loopback instance, with private role ACLs, AOF and bounded noeviction memory.
  Start/status/stop and restart with retained pending work were verified.
- `python3 scripts/framework/check_streams.py` passed: credentials/default-user
  rejection, ACL separation, group replay, concurrent consumers, explicit ACK,
  reclaim, missing payloads, poison preservation and graceful persistence restart.
- `python3 scripts/framework/check.py --with-streams` passed the existing full
  framework plus the real Redis/PostgreSQL bridge. Duplicate publication and
  consumer replay after database commit created exactly one sample Go job.
- Running foundation/release and unrelated host Redis instances were unchanged.
  The optional development Redis profile was stopped after its smoke test; private
  configuration/persistence are retained. No live telemetry or finding worker is
  connected. Next: S04 recovery, retries, DLQ and backpressure before live delivery.
- [Operations and limits](REDIS_STREAMS.md) distinguish graceful restart evidence
  from untested abrupt data loss, failover, memory-exhaustion and throughput guarantees.

## S04 completion evidence

[Recovery foundation](STREAMING_RECOVERY.md) adds durable retries/DLQ, bounded
publication, stale-consumer fencing and retained-event replay. Seven pipeline
integration tests cover retry rollback, DLQ failure, poison isolation, stream loss,
OOM, stalled transport and metadata limits. Concurrent publication and retry-jitter
checks supplement existing replay-after-commit tests. Full framework verification
uses `python3 scripts/framework/check.py --with-streams`. Migration 021 is only
applied to disposable databases. Next: S05 mock QRadar/suspicious-login flow.

## S05 completion evidence

- [Mock flow](MOCK_QRADAR_FLOW.md) documents synthetic SIEM input, the separate pure
  SOAR revision reducer, deterministic correlation and explicit completeness limits.
- `go run ./cmd/qradar-mock` (from `backend-go`) produced four events, one review
  finding with four evidence references, open/closed/reopened mock case states and
  zero response actions. It makes no provider, model or database calls.
- Full `python3 scripts/framework/check.py --with-streams` passed, including the
  mock page through real disposable PostgreSQL/Redis and replay without duplicate
  accepted events. Unit checks cover ordering, revisions, tenant and time boundaries.
- No live connector, continuous scheduler, durable finding admission or SOAR
  write-back is claimed. S06 adds durable finding/case/job admission next.

## S06 completion evidence

[Finding admission](FINDING_ADMISSION.md) reuses existing intake transaction and
investigation jobs. Migration 022 adds canonical receipts and tenant scheduling
state. Tests exercise concurrent replay, rollback, active/retained limits, evidence
validation, tenant rotation and one-phase-per-tenant concurrency. The mock Redis
flow now produces a durable case/job and replays to the same IDs. Full verification
uses `python3 scripts/framework/check.py --with-streams`; no live provider or model
execution is enabled. Next: S07 evidence/Python investigation contracts and QA.

The full suite passed with five admission tests, including ordinary intake progress
and analyst retry scheduling, plus the extended Redis-to-admission flow. Existing
HTTP, Go race/vet and specialist checks passed; active services stayed unchanged.

## S07 implementation

[Typed investigation](L1_INVESTIGATION.md) adds a read-only Go evidence adapter,
idempotent/capped mock enqueue, typed Python gRPC service and deterministic Go QA.
The existing specialist dispatcher owns leases/retries and result persistence.
Mock output is always inconclusive and requires review; no live LLM, provider tools,
case closure or containment is enabled. Next: S08 escalation and mock SOAR sync.

Full `python3 scripts/framework/check.py --with-streams` passed, including the real
Go/Python typed RPC, durable mock result commit after QA and existing regression
checks. Focused named-health/contract tests passed after the health registration
update. Migration 023 only extends the plugin allowlist in disposable databases;
active services remain unchanged.

## S08 implementation

[Mock SOAR reconciliation](MOCK_SOAR_RECONCILIATION.md) adds durable L2-review
feedback/audit, note-only drafts, source revision checks and explicit conflict
rebase. Existing analyst fields are preserved. Four integration tests cover replay,
conflict/reopen/echo handling, rollback and invalid job output. Migration 024 only
adds sandbox state; no provider calls, analyst notifications or privileged actions
are enabled. Next: S09 bounded tenant-aware enrichment caching.

Full `python3 scripts/framework/check.py --with-streams` passed with all four S08
tests, existing Go race/vet, HTTP workflows and Python/Rust dispatch. Documentation
links and diff checks passed. Migration 024 remained disposable-only; running
release/foundation services were verified running without restart or migration.

## S09 implementation

[Enrichment cache](ENRICHMENT_CACHE.md) adds an opt-in Go local IOC evidence tool,
tenant/generation-scoped cache, bounded positive/negative TTLs and authoritative
source fallback. Migration 025 invalidates entries transactionally on IOC changes.
Tests cover isolation, invalidation, expiry, capacity, ACLs and outages; the mock
pipeline exercises repeated enrichment. Default processing is unchanged and no
speedup is claimed. Next: S10 observability, retention and measured load/failure gates.

Full `python3 scripts/framework/check.py --with-streams` passed with all four cache
integration tests, repeated enrichment through the mock pipeline, Go race/vet and
existing HTTP/Python/Rust checks. Migration 025 remained disposable-only. Markdown
links/diff checks passed; active services were not restarted or migrated.

## S10 progress and measured gates

- Added consistent source accounting, oldest pending age and separate failure/gap
  observations, plus bounded explicit Redis cleanup guarded by inbox commit, ACK,
  age and single-group checks. Durable recovery/evidence/audit records remain retained.
- Full framework and new retention tests passed. Opt-in load and cache reports are
  documented in [measured results](STREAM_PERFORMANCE_REPORT.md).
- The 1,000-event probes drained at 64–120 EPS versus nominal 1,000 offered EPS.
  Local IOC caching showed no useful benefit. Existing uncached processing stays
  default; no live rollout or Rust/database replacement is justified by these results.
- SQL/stage profiling and query-plan inspection are complete for the bounded probe.
  Set-based admission, snapshot query fixes and publication batches of at most 25
  events preserve independent leases and durable receipts. Full regression checks
  passed; latest probe: 269.66 EPS, p95 2.558 s, 1,000/1,000 completed and zero pending.
  Intermediate probes varied (195–303 EPS); sustained 1,000 EPS remains unproven.
- Remaining: consumer transaction/resource profiling and further measured optimization, sustained/burst
  SLO gates, full resource/fault-under-load tests, metrics integration, durable
  archival/dedup policy and complete operator recovery tooling. See [operations](STREAM_OPERATIONS.md).
- S11 stays gated. Running services and databases remain unchanged.

### S10 paced-load and operator recovery follow-up

- Added configurable bounded input rate/count, scheduling-delay-inclusive latency,
  and an optional cooperative pause of both consumers. The 3,000-event, 100 EPS
  pause probe passed full correctness checks and drained every event; a matching
  measurement-only baseline also drained fully. This is 30-second slowdown evidence,
  not crash/failover or production capacity approval. See the performance report.
- Added an internal, default-deny publication retry primitive using exact operator
  and source grants, stale-review checks, a three-retry cap and atomic existing audit
  records. It preserves source state, evidence and inbox deduplication and introduces
  no migration or enabled route. Consumer DLQ and operator UI/API remain pending.
- The full framework suite passed on rerun. One preceding run hit an existing
  intake credential-revocation test timeout; the new eventstate tests passed in
  both runs. Production authentication and running services were not changed.
- The final combined correctness/load check also passed, but its repeated 100 EPS
  pause probe drained at only 75.79 EPS with p95 15.816 s and producer scheduling
  lag 4.458 s. All 3,000 events completed with no final backlog. This variance keeps
  capacity gates open even at 100 EPS; resource/lock profiling remains the next
  performance task. The slower result is retained in the performance report.
- Added 250 ms PostgreSQL active-client wait sampling and before/after database
  I/O/cache/transaction counters. The instrumented full check passed (3,000 events,
  101.53 drain EPS, p95 2.178 s), observing WAL waits and occasional row/transaction
  waits without reproducing the severe slowdown. PostgreSQL process/host resource,
  WAL timing and scan/polling-overhead profiling remain pending; capacity is not
  established. Test-only I/O timing leaves active databases unchanged.
- Added disposable PostgreSQL process-tree CPU/RSS and host load/memory sampling,
  with explicit wider-window/shared-memory limits. Combined recovery-budget
  existence/capacity SQL saves one call per new record while preserving the source
  lock. Full framework and new concurrent shared-budget test passed. The paired
  probe saved 3,000 SQL calls but showed no end-to-end speedup (after: 99.18 EPS,
  p95 1.970 s). Next performance work: WAL-specific timing and retained-count/idle
  polling overhead, with repeatable comparable runs. Operational rollout gates
  (consumer DLQ/UI/API, archival, monitoring, provider validation) remain open.
- Completed WAL-specific timing and a four-run reversed-order empty-poll comparison
  using identical fresh measurement environments. A 20 ms idle delay reduced
  claim queries about 86% and paired observed PostgreSQL CPU about 31–38%, but did
  not consistently improve p95. All four runs completed 3,000/3,000 events with no
  final backlog. The harness exposes the delay explicitly; running services and
  historical defaults remain unchanged. Next: retained-budget/observation scan
  costs and operational recovery/monitoring gates; capacity remains unproven.
- Separate full framework verification passed after the WAL/polling harness
  changes, including Go race/vet, configuration bounds, HTTP regressions and
  Python/Rust dispatch. No schema or active-service change was made.
- Optimized retained-event accounting by materializing status expressions once
  per snapshot query. Same-fixture, reversed-order plans improved from 57.7–58.0 ms
  to 39.1–41.1 ms with about 44% fewer buffer hits and no temp writes. Full checks
  passed on rerun, including mixed-state precedence/isolation/age tests; an initial
  existing threat-intelligence concurrency test timed out. The paced load completed
  3,000/3,000 events (p95 1.788 s). No schema or service change. Remaining scan work:
  retained metadata budget counts and larger-retention behavior; operational
  recovery/UI/API, archival and monitoring gates remain open.

## Current JSON sandbox milestone

See [sandbox completion and operations](SANDBOX_COMPLETION.md) for scoped JSON
intake, independent Python FastAPI/gRPC, recovery UI, monitoring, verified archive
export, startup and measured limits. Earlier task entries are historical checkpoints.
Live vendor/model validation and privileged response activation are outside this
user-selected local release.
