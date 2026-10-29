# ADR 005: Redis telemetry boundary and durable Go orchestration

Status: accepted for incremental sandbox implementation, 2026-10-29.

## Decision

Redis Streams buffer telemetry and findings; existing PostgreSQL investigation
and specialist job queues remain the orchestration source of truth. Go owns source
credentials, tenant authorization, checkpoints, admission, retry and response
policy. Python stays behind gRPC; FastAPI manages the Python service lifecycle.
Rust correlation is optional pending measured benefit. No new analytics store.

The first executable contract is bounded projected telemetry, not arbitrary raw
logs. Its trusted binding comes from connector configuration: tenant, connector
instance and source must match the envelope. Evidence references are opaque
identifiers resolved through authorized Go tools, never URLs fetched directly by
the consumer. Telemetry v1 supports authentication observations; SOAR case sync
contracts will be separate so mutable case state is not mistaken for an event.

Dedup identity is tenant + connector + source + source event ID + event type +
source revision. Source revisions are opaque, not lexically ordered. A changed
revision is a new observation, not automatic permission to overwrite a case.
Same identity with different semantic content is a conflict. Envelope event ID,
ingestion timestamp and trace ID may change on redelivery without changing identity
or content hash. Missing stable source IDs/revisions require an adapter-specific
identity rule before live admission; never synthesize a fresh random dedup key on
every poll. Existing HTTP intake behavior is unchanged.

## Publication and recovery boundary

Commit source checkpoint and bounded outbox intent atomically before acknowledging
source intake. Publish, then mark publication; duplicates are expected. Downstream
consumer identity, effect and any next outbox intent commit together before ACK.
Retain replay material until durable downstream disposition or validated source
backfill makes recovery possible. No exactly-once delivery claim.

Pending reclaim can overlap with a slow consumer: uniqueness and version fencing
protect effects. Stream trimming must account for undelivered/pending work and
source recovery; a metrics increment alone is not a durable disposition. Bounded
retries, DLQ, backpressure and recovery ship before any live event intake.

## Cache and operations

The optional sandbox instance will use ACLs, bounded memory, noeviction and an
explicit persistence policy. Exact Redis/client versions and supported commands
are chosen and tested in S03. Cache entries need separate application budgets;
an evicting shared cache must not evict stream keys. Separate logical databases
are not resource isolation. Remote deployment requires TLS and scoped ACLs.

## Compatibility and rollout

S01 introduces contracts only: no new service, database migration or runtime
replacement. S02 adds isolated durable state; S03–S04 add and fault-test optional
streams. Existing release/foundation services continue unchanged. Every later
pipeline stage is enabled explicitly after its prerequisite tests pass.

Rollback disables new producers, drains/checkpoints consumers and preserves
outbox/inbox/source recovery records. Do not drop data, flush Redis, advance
cursors or migrate existing jobs into a parallel queue. The implementation tasks
and acceptance criteria are in [the task tracker](../IMPLEMENTATION_TASKS.md).
