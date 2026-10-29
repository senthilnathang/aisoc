# Streaming persistence boundary (S02)

Migration `020_stream_event_state.sql` adds four tables. It does not rewrite
existing intake, investigation, jobs or audit tables. During S02 verification it
is applied only to disposable PostgreSQL, not the running foundation or release.

| Table | Durable responsibility |
|---|---|
| `stream_source_checkpoints` | Opaque cursor and optimistic version for a tenant/connector/source |
| `stream_events` | Validated bounded envelope, stable event key and semantic content hash |
| `stream_outbox` | Publication intent, attempt/lease, retry state and publication receipt |
| `stream_inbox` | Per-processor event disposition committed with database effects |

Foreign keys retain tenant/source relationships and prevent accidental parent
deletion while recovery records exist. No automatic cleanup or cascading deletion
is installed. These are bounded recovery records, not a permanent telemetry store.
No Redis network calls or new HTTP endpoints are implemented by this package.

## Acceptance and checkpointing

`eventstate.Store.Accept` takes an authenticated `telemetry.Binding`, the expected
checkpoint version/cursor, a next opaque cursor and at most 100 validated events.
The tenant must already exist. It creates/locks the source checkpoint row, checks
the expected version, rejects conflicting content under an existing event key,
inserts new event/outbox rows and advances the checkpoint in one transaction.
Duplicate delivery IDs, ingestion times and traces do not create new events.
New source revisions remain separate. Empty pages can advance the checkpoint.

Acceptance checks existing hashes in one lookup and inserts new envelopes and
outbox intents with set-based SQL. Duplicate identities within a page are checked
before insertion; a conflict or capacity failure rolls back the entire page.

The caller supplies positive `MaxEvents` and `MaxPayloadBytes` per source binding.
The payload budget counts all retained envelopes, including published ones; it
does not claim to measure total PostgreSQL storage. The source row lock serializes
budget checks and acceptance for that binding. Tenant-wide quotas and retention
policy remain later admission/production-hardening work. No acceptance occurs once the configured budget is exceeded.

If acknowledgment of acceptance is lost, read the durable checkpoint and reconcile
the source page. A stale expected version returns `ErrCheckpoint`; never blindly
advance the source. These methods do not derive authorization from envelope fields.
Binding and cursor provenance must come from the connector/session control plane.

## Publication

`Claim` uses `FOR UPDATE SKIP LOCKED` to acquire one event with a fresh attempt ID
and a 30-second lease. Network publication happens outside SQL transactions.
`MarkPublished` requires matching source/event/attempt and an unexpired lease;
it records the Redis-style message ID without deleting the envelope or outbox.

`ClaimBatch` applies the same boundary to at most 25 events, with an independent
attempt ID per event. `Runtime.PublishBatch` publishes outside the transaction and
commits receipts together through `MarkPublishedBatch`. Every receipt must still
own an unexpired lease or the entire receipt transaction rolls back. A transport
failure commits any successful prefix and releases unattempted leases without
spending their retry budget. A crash or failed receipt commit can cause replay;
durable inbox deduplication remains required. The single-event API remains available.

`Retry` accepts a delay from one second to one minute. It schedules eligible work
or retains it as failed when its attempt cap is exhausted. Crashed final attempts
become visibly failed on the next claim scan. Exponential backoff/jitter and DLQ
policy are implemented by the optional S04 runtime; see STREAMING_RECOVERY.md.

A crash after Redis accepts a publication but before `MarkPublished` may republish
the same event after lease expiry. That is expected at-least-once behavior. The
same stable key reaches the inbox. Redis data loss after a recorded publication
is reconciled by the optional S04 runtime using retained receipts and envelopes.
Source backfill remains connector work. Published records remain retained.

## Consumer boundary

`Apply` looks up the event using the trusted source binding, verifies its stored
hash and envelope, and inserts the processor's disposition (`filtered`, `finding`
or `rejected`) in the same transaction as its callback's database effects.
Use a versioned processor identity and stable rules. The callback receives the
stored validated event and transaction: it must not commit/rollback the transaction
or perform external I/O. It may enqueue existing Go jobs or insert audit/outbox
records using that transaction.

An identical replay returns `false, nil` and does not repeat the callback. Changed
content or a changed disposition for the same processor/event returns a conflict.
Concurrent consumers serialize through the inbox's unique identity. A crash/error
before commit rolls back both inbox and effect; a replay after commit is a no-op.
Only after `Apply` succeeds may the future Redis consumer ACK the delivery.

This guarantees transactionally deduplicated database effects. It does not promise
exactly-once external actions, verify a detection rule, or create privileged actions.
The integration test uses an allowlisted sample job only to prove atomic composition.

## Verification and rollback

Run `python3 scripts/framework/check.py` from the repository root. It creates a
disposable PostgreSQL cluster, applies migrations and runs race-enabled tests.
Tests skip database cases without `AISOC_GO_TEST_DATABASE_URL`; a standalone
`go test` without that variable is not database validation.

Tests cover conflicting/stale acceptance, batch rollback, revised source records,
event/payload budgets, concurrent checkpoint ownership, publication reclaim and
stale/foreign lease rejection, bounded exhausted attempts, callback rollback,
concurrent inbox replay and duplicate job prevention. Crash boundaries are modeled
by lease expiry, fresh database connections and injected transaction failures;
real Redis/network fault tests are covered by S03/S04 (see STREAMING_RECOVERY.md).

Do not enable live ingestion at S02. Rollback disables new producers/consumers and
retains all four tables for reconciliation. No down migration or destructive reset
is needed for existing Go routes. Source binaries built after 020 expect that
schema on startup readiness; do not promote them to an unmigrated database.
