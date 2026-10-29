# Streaming recovery foundation (S04)

Go's `internal/modules/telemetrypipeline` now joins PostgreSQL outbox/inbox state
to Redis. These are sandbox library primitives, not a running telemetry service.
S05 supplies mock intake and scheduling. Existing Go APIs, investigation jobs and
Python FastAPI/gRPC remain unchanged.

## Durable processing

Metadata admission keeps a source-checkpoint row lock across its budget check and
insert. The existence and capacity checks now share one SQL round trip; existing
identities bypass the retained-row count. Work and replay-gap records still share
the same per-source/processor budget. A concurrency test verifies only one can
claim the last slot, while an already admitted identity remains replayable at capacity.

Migration 021 adds consumer work, dead-letter and replay-gap tables plus an outbox
recovery counter. Attempts use 30-second fenced leases, callbacks receive a
10-second context deadline, and reclaim requires 35 seconds of idle time. Inbox,
database effects and successful work completion commit together. Callbacks must
respect cancellation, use only the supplied transaction, and never perform external
actions or commit/rollback themselves. Expired attempts cannot commit effects.

Failures roll back effects and retry with exponential backoff and jitter (1 second
to less than 60 seconds). Consumers allow 1–10 attempts; publication defaults to
five. Exhausted consumer work enters a PostgreSQL DLQ before ACK; failed publications
remain in the outbox. DLQ records contain reason codes and identifiers, not raw
poisoned payloads or arbitrary errors. DLQ failure leaves deliveries pending.
Conflicting/unknown deliveries use their delivery ID for quarantine so forged
content cannot consume a legitimate accepted event's retry budget.

`Process` owns ACK; nil can mean busy work remains pending. `RecoveryStats` exposes
retained states, observed gaps and failed publications, not a dashboard or DLQ
replay API. Callers must schedule PublishOne, Poll, Recover and Reconcile with
bounded frequency, preserve scan cursors and inspect errors.

## Backpressure and replay

`PublishBounded` atomically checks stream length and publishes via Lua, without
trimming. Capacity exhaustion and Redis OOM defer the durable publication without
spending a failure attempt. The lower-level S03 `Publish` has no entry cap; the
runtime uses `PublishBounded`. Publisher ACLs add EVAL/XLEN within existing key and
command restrictions; consumers add exact-entry lookup.

Recovery records deleted pending IDs and reclaims abandoned work. Reconciliation
scans unfinished PostgreSQL receipts even after stream/group loss, recreates the
group and republishes retained events. Transport errors never imply absence.
Three republication cycles are allowed; another disappearance leaves a failed
outbox record. Real QRadar backfill remains S11 work. Gap counts are historical
observations, not counts of currently unresolved incidents.

This assumes one required processor/group per source, not general multi-group
replay. Envelope budgets are per source; recovery budgets are per source/processor,
including completed/dead work and gaps. They are not tenant-wide quotas. There is
no automatic cleanup: full streams or metadata budgets deliberately pause progress.
S06 adds tenant admission; S10 must define safe retention and operator recovery
before live rollout.

## Verification and limits

Run `python3 scripts/framework/check.py --with-streams` for disposable PostgreSQL
and Redis checks, including seven pipeline integration tests:

- Retry exhaustion and transactional effect rollback.
- DLQ storage failure without ACK and poison/conflict isolation.
- Complete stream/group loss and retained-event replay.
- Deleted pending entries, abandoned work and stale-attempt fencing.
- Stream capacity and actual Redis OOM backpressure.
- Stalled TCP transport, bounded failure and restored publication.
- Metadata limits and rollback when effects outlive a lease.

Additional checks cover concurrent publication caps and jitter bounds; the existing
bridge covers replay after commit before ACK. Lease expiry/transaction failures
model worker crashes, stream deletion models data loss, and a stalled local socket
models a network fault. These do not certify HA failover, abrupt power-loss
durability, EPS, latency SLOs, live QRadar or production response authorization.

## Migration and rollback

Migration 021 is additive and applied only in disposable checks. Running release
and foundation databases remain on 019; new source builds expect all migrations.
Do not promote them against an unmigrated database. Rollback disables the optional
pipeline and preserves envelopes, receipts and recovery records for reconciliation.
Do not flush Redis or drop tables to clear failures.

See [tasks](IMPLEMENTATION_TASKS.md), [Redis operations](REDIS_STREAMS.md) and
[persistence](STREAMING_PERSISTENCE.md).
