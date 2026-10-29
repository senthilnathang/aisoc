# Streaming operations, retention and release gates (S10)

This is a sandbox operations boundary, not production throughput approval.
Run `python3 scripts/framework/check.py --with-streams --stream-load` for the full
correctness suite and opt-in measurements. It creates disposable PostgreSQL/Redis;
existing release/foundation services are not restarted or migrated.

## Reconciliation and observation

`eventstate.Store.Snapshot` reports one consistent SQL snapshot per trusted source
binding and processor. Its accounting identity is:

`accepted = completed dispositions + dead without disposition + pending`

Oldest pending age excludes completed/dead work. Publication failures, historical
gap observations and DLQ counts are separate diagnostic counters: they can overlap
and must not be summed into accepted events. Gaps describe observations, not a
count of unresolved losses. The authenticated scoped operations API exposes these metrics. The UI polls
every five seconds without overlap; no public all-tenant metrics endpoint is added.

The accounting query materializes its per-event status expressions once within
the statement. This avoids repeating correlated inbox lookups for each aggregate
and age calculation; it is not a persistent cache and has no invalidation window.
Completed disposition takes precedence over historical dead work. The snapshot
still scans retained source events, so query-local reuse does not replace retention
limits or bounded monitoring frequency.

Use Redis pending count together with PostgreSQL accounting: a completed inbox may
still have a pending delivery if ACK failed, and missing stream/group state may
leave no Redis pending record while durable unfinished events still exist.

## Explicit Redis retention

`telemetrypipeline.Runtime.Prune` scans at most 100 entries and returns a continuation
cursor, removal count and skip reasons. It requires a committed inbox disposition
with matching event identity/content hash. The Redis script then atomically checks:

- Exactly one group exists and it is the configured required processor.
- The entry still has the same identity/hash and is not in the pending list.
- Its Redis entry timestamp is at least the configured age (1 minute–7 days),
  measured against Redis server time.

Only then does it delete that exact stream entry. Uncommitted, pending, malformed,
changed, young and multi-group entries are preserved. No blanket MAXLEN trimming,
implicit ACK or automatic cleanup timer is introduced. The separate
`aisoc-retention` role is restricted to telemetry inspection and deletion; ordinary
publishers/consumers do not gain deletion permissions. Its credentials are trusted
operator/service credentials: ACLs alone cannot enforce the PostgreSQL check, so
callers must use `Runtime.Prune`, not raw XDEL or transport-only Retire.

PostgreSQL envelopes, inboxes, receipts, DLQ and audit records are retained. Deleting
those would remove replay/dedup/provenance guarantees; automatic evidence deletion is not implemented. Verified export can compact
eligible completed-work metadata; see the sandbox guide. Source and metadata budgets can therefore still pause intake.
Live rollout requires agreed source replay windows, evidence retention/access policy,
archive verification and dedup tombstone policy before changing durable retention.

## Recovery procedure

1. Inspect the scoped snapshot, Redis pending age and source checkpoint. Pause new
   intake when storage budgets or queue-age limits are exceeded; never advance a
   source cursor after failed acceptance.
2. For expired work, use bounded `Recover` pages; it respects durable leases and
   retries. For missing stream/group state, use `Reconcile` pages against retained
   receipts. A transport error does not prove an entry is missing.
3. Inspect retained failure reason codes and original evidence for DLQ/failed outbox
   records. Exhausted work does not automatically reset. The internal publication
   retry primitive below requires an explicit grant and review. Consumer DLQ retry and authenticated operator UI/API are implemented; retries
   preserve the old DLQ in audit. Do not reset attempts with ad-hoc SQL.
4. Resolve SOAR version conflicts through explicit mock rebase after review; never
   overwrite analyst fields or enable production actions to clear a queue.
5. Once dispositions and ACKs are verified, explicitly prune eligible Redis entries.
   Resume only after reconciling accepted/disposition totals and source replay gaps.

Local defaults warn at 500 pending events or 15 seconds oldest pending age.
Scope configuration can override these engineering defaults; they are not SLAs.

## Audited publication retry foundation

`eventstate.OperatorRecovery.RetryPublication` reuses `audit_events` and introduces
no schema or enabled HTTP endpoint. Its default empty grant list denies recovery.
Trusted service configuration must grant an authenticated operator the exact tenant,
connector and source binding. A future operator transport must derive the principal
from authentication, never accept it from an event or request body.

The review request names one event, an idempotency request ID, a bounded ticket
reference and an allowlisted reason (`transport_restored` or
`configuration_corrected`). It includes expected publication attempt ID/count,
recovery count and prior operator retry count. Under the outbox row lock, the method
requires failed state and matching expectations, refuses an already committed
disposition, records the review audit and requeues publication in one transaction.
Audit failure leaves the event failed. An identical request returns its prior
success without resetting work again; changed reuse is rejected. Authorization is
checked even for repeated requests.

At most three operator retries are allowed per source event, counted from retained
audit records. Ordinary publication attempts reset, but transport recovery count,
envelopes, source cursors, inbox deduplication and historical audits remain intact.
The method does not reset consumer dead letters, alter evidence, or authorize a
response action. Keep these audit records while recovery/dedup state is retained;
archival must preserve the retry count before any deletion is designed.

Tests cover denial, tenant mismatch, stale review, concurrent idempotent requests,
changed request reuse, retry caps, audit rollback and completed-event rejection.
Operator UI/API authentication, inspection and consumer-DLQ recovery are now
implemented for the local sandbox. See [current guide](SANDBOX_COMPLETION.md).

## Measurement scope

By default, `output/backend-framework/stream-load.json` records a bounded 1,000-event offered-load
probe: ten batches of 100 projected authentication events, scheduled 100 ms apart,
one publisher and two consumers. It measures ingress-attempt start through database
disposition commit and Redis ACK. It does not measure finding generation, case
admission, Python/LLM investigation or incident resolution time. Sampling/SQL
observability overhead is included. A setup event is excluded from latency/rate
samples but included explicitly in the final database snapshot.

The report separates offered EPS from achieved drain throughput, p50/p95/p99,
sampled backlog/age, Go test-process CPU seconds/peak RSS and Redis memory. PostgreSQL
CPU/RSS and whole-host resource use are not measured. The targeted load run is
without the race detector; correctness tests run separately with it.

The publisher claims at most 25 events and commits their publication receipts in
a batch, retaining independent event leases. The report includes PostgreSQL client
query, batch and pool-acquisition timings by stage, without argument values.
Timing totals overlap and must not be added together. Snapshot and claim
`EXPLAIN (ANALYZE, BUFFERS)` reports are generated after the timed probe; the claim
diagnostic rolls back its changes.

`postgres_diagnostics` adds before/after `pg_stat_database`/`pg_stat_wal` counters and 250 ms
samples of active benchmark-client wait names/counts. The disposable test cluster
enables `track_io_timing` and `track_wal_io_timing`; existing running databases are unchanged. Compare counter
deltas only if `stats_reset` matches. Counters can lag and include other clients in
the disposable test database, including the monitoring queries. Wait sampling may
miss short waits, and `CPU_or_runnable` means no reported wait, not measured CPU.
WAL counters are cluster-wide for the disposable instance and carry their own
reset timestamp. WAL write/sync times are cumulative, not end-to-end latency; do
not add them to overlapping client query times. No session SQL text, arguments or
credentials are collected by this sampler.
The separate `stream-load.json.resources.json` now samples the disposable
PostgreSQL process tree once per second, recording observed CPU seconds and summed
RSS alongside host load averages and available memory. Its window covers the
entire Go test invocation, including compilation/setup/cleanup, so it is wider
than the timed event drain. Exited processes can make observed CPU an underestimate;
summed RSS double-counts shared pages and is not physical memory consumption.
Host metrics include unrelated workloads. It reads no process command lines or
environments. Resource sampling errors are explicit in the report. Deeper host
contention and physical memory attribution remain pending.

For measurement iteration only, add `--stream-measure-only` to
`python3 scripts/framework/check.py --with-streams --stream-load`. This skips the
full correctness and HTTP regression gates and explicitly labels the report;
it cannot replace the full command before accepting a code change.

The configurable paced probe uses `--stream-events` (100–10,000 in multiples of
100), `--stream-eps` (100–1,000), and optional `--stream-pause-seconds` (0–10).
For example:

```sh
python3 scripts/framework/check.py --with-streams --stream-load --stream-events 3000 --stream-eps 100 --stream-pause-seconds 2
```

This schedules 100-event batches once a second and cooperatively pauses both
consumers for two seconds near the input midpoint, before their next read. It
does not kill a worker or exercise pending-entry claim recovery. Both pauses must
be exercised for the test to pass. Reports include nominal input duration, maximum
producer schedule lag and latency from scheduled arrival as well as actual admission
start, so producer delays remain visible. The last batch starts at 29 seconds in
this example; drain EPS slightly above 100 is not a capacity estimate. Reports
still require complete admission/disposition reconciliation and zero pending ACKs.

`--stream-idle-poll-ms` controls the benchmark publisher's delay after an empty
claim (1–100 ms, existing default 1 ms). Nonempty batches continue immediately.
The wait observes cancellation, and the report records the selected delay. This
is a harness control, not a change to the running services or `PublishBatch`'s
single-call behavior. Compare delays using the same event rate/count/pause and
fresh disposable environments; changing polling can trade discovery latency for
fewer empty database queries. Production scheduling still needs an explicit policy.

`stream-load.json.cache.json` compares 50 alternating cached/uncached exact local IOC
lookups each, after warmup, against one tenant/indicator. Both paths read PostgreSQL
generation. It is a small local microbenchmark, not external TI or contention data.
Caching remains opt-in regardless of the result.

The existing fault suite covers stream loss, expired/stale work, poisoned messages,
DLQ storage failure, stalled TCP, OOM/backpressure and transaction rollback. Those
faults are tested separately from load. Neither suite establishes replicated Redis
failover, abrupt power-loss durability or sustained production EPS.

## Remaining rollout gates

- Meet an agreed sustained/burst workload and ingest/finding/verdict SLO, with
  representative payload sizes and model latency. A drained small probe is not enough.
- Extend the SQL/client-stage profiling with PostgreSQL resource and lock/I/O
  measurements under sustained load. Query-plan fixes and bounded publication
  batching are implemented; remaining per-event consumer transactions need measured
  investigation. Rust is not justified by these measurements alone.
- Extend the verified local archive, retained deduplication, operator recovery and
  scoped dashboard to production storage/monitoring. Validate live source backfill
  and actual provider-version/permission contracts.
- Test partitions/failover under load and approve shadow-mode operational ownership.

See [measured results](STREAM_PERFORMANCE_REPORT.md), [task tracker](IMPLEMENTATION_TASKS.md)
and [recovery foundation](STREAMING_RECOVERY.md). S11 uses the user-selected local
JSON scope; live-provider rollout remains a separate future gate.

## Current payload retention and demo interface

The main UI is `http://localhost:8080/build/stream-operations`; `/build-operations`
is an alias. Foundation mode routes every API request to Go 3003. Ten demo sources
contain 1,000 events each; event JSON and case links use that same backend.

Migration 029 extends export beyond completed-work compaction: eligible payloads
are replaced with verified archive references atomically with audit. API/evidence
readers verify and resolve original content. Missing/corrupt files fail closed;
case-referenced evidence is excluded. Hot limits default to 1,000 events, configurable
to 10,000, with a 16 MiB cap; archived payloads release hot capacity. Durable event
identity metadata remains capped at 100,000 per source. Preserve archive files
alongside database backups. See [operational details](NEXT_DELIVERY_TASKS.md).
