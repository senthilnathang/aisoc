# Local 1,000 EPS verification

Date: 2026-10-30. This measures synthetic normalized telemetry through durable
PostgreSQL admission/outbox, Redis delivery, Go processing/inbox and ACK. It does
not measure HTTP ingress, Rust correlation, finding latency, Python/LLM reasoning,
live providers, production retention, replicated failover or power-loss recovery.

## Acceptance

`scripts/framework/performance_gate.py` requires three independent, identically
configured runs of at least 60,000 events and 50 seconds of scheduled input (with
one millisecond allowed for timer quantization).

- **Average throughput:** final durable publication commit or consumer ACK rate
  at least 1,000 EPS; offered load at least 1,000 EPS; every event accepted and
  completed; zero pending, unacknowledged, dead, failed-publication or replay-gap
  counts; fsync, synchronous commit and full-page writes enabled.
- **Stability:** all the above, scheduled-to-ACK p95 at most two seconds and
  maximum producer scheduling lag at most one second in every run.

The tool reports `average_throughput_passed` separately but exits successfully
only when the entire stability gate passes. Average throughput is not a stable
latency or production-capacity claim. The gate uses `commit_ack_eps`; the separate
`achieved_eps` includes the backlog monitor's final wakeup and can be lower.

## Changes

The shared 500-event ceiling bounds admission, publication, receipt transactions,
fresh processing and ACK. Existing smaller batches remain compatible. HTTP bodies
remain limited to 1 MiB, envelopes to 16 KiB, and retained payload/recovery quotas
remain enforced. The per-entity correlation window remains 100 events.

Receipt transactions lock supplied keys in sorted order, join each event to its
attempt/message ID once and update a bounded tuple-ID set. One stale member rolls
back the whole batch. Tuple IDs stay within one statement on the current
unpartitioned outbox; partitioning would require revisiting this query. Replay and
failed fresh batches retain the per-event retry/DLQ path. ACK follows durable commit.

The disposable load harness no longer deletes the entire fixture row-by-row before
discarding its temporary cluster. This avoids redundant WAL between probes; it
does not change the timed processing path. Normal integration tests still clean
their tenant, and the harness still stops/removes its own PostgreSQL/Redis state.

## Reproduce

Pause the initialized local foundation for a comparable measurement, preserving
its data. Run the following three times and save each report before the next run.
Other workloads on this shared host are not controlled.

```bash
python3 scripts/framework/check.py --with-streams --stream-load \
  --stream-measure-only --stream-events 60000 --stream-eps 1100 \
  --stream-producer-batch 500 --stream-consumer-batch 500 \
  --stream-idle-poll-ms 100 --stream-monitor-ms 1000 \
  --pg-shared-buffers-mb 512 --pg-work-mem-mb 32 \
  --pg-wal-sync-method fsync --pg-wal-init-zero off
```

Preserve `output/backend-framework/stream-load.json` and its `.resources.json`
companion under distinct names, then evaluate the reports:

```bash
python3 scripts/framework/performance_gate.py \
  output/backend-framework/eps1000-sustained-01.json \
  output/backend-framework/eps1000-sustained-02.json \
  output/backend-framework/eps1000-sustained-03.json
```

`--summary` displays selected measurements without evaluating acceptance. Omit
`--stream-measure-only` for full correctness checks. Restore the foundation after
benchmarking, including after a failed probe. Do not run concurrent load probes.

## Optional local PostgreSQL profile

`.run/go-dev/postgres-profile.json` accepts only bounded shared-buffer/working-memory
values and supported WAL sync/initialization choices. The launcher explicitly
enables fsync, synchronous commit and full-page writes. Unknown keys, unsafe values,
duplicate keys and symlinks are rejected. See the
[example profile](../deploy/examples/postgres-local-throughput.json).

Changing the profile requires a backend restart, not a migration. Without it,
ordinary PostgreSQL tuning defaults remain, with durability enabled. To roll back,
remove the optional profile and restart; PostgreSQL data is retained. Working
memory is per operation, so concurrent operations can consume multiples of 32 MiB
in addition to shared buffers. This is not a universal production default.

PostgreSQL documents these choices in its
[WAL configuration reference](https://www.postgresql.org/docs/16/runtime-config-wal.html).
`wal_init_zero=off` skips zero-filling new segments; it does not disable commit
synchronization. These settings do not prove device power-loss guarantees.

## Results

Three consecutive, unchanged 60,000-event runs used 1,100 EPS offered load,
500-event batches, one publisher and two consumers. Each accepted/completed all
60,000 events with zero pending/unacknowledged/dead/publication-failed/gap counts.
The database snapshot additionally includes one setup event per run.

| Run | Final commit/ACK EPS | EPS including monitor wakeup | Scheduled-to-ACK p95 | p99 | Maximum producer lag |
|---|---:|---:|---:|---:|---:|
| 1 | 1,062.68 | 1,058.91 | 3.632 s | 4.801 s | 1.537 s |
| 2 | 1,104.14 | 1,103.69 | 6.052 s | 7.060 s | 2.340 s |
| 3 | 1,094.92 | 1,082.31 | 3.498 s | 4.435 s | 0.939 s |

**This historical series met average 1,000 EPS throughput; subsequent probes
did not reproduce it consistently. The strict stability gate fails.** All three p95 values exceed two seconds; two
runs exceed the one-second producer-lag threshold. The evaluator returns
`average_throughput_passed: true`, `passed: false`, exit status 1. No threshold
was relaxed to turn a slow run into a pass. These results do not complete a stable
production SLO or the separate ingest-to-finding target.

Each run carried 29,370,000 envelope bytes (~489.5 bytes/event), not a 2 KiB raw-log
mix. Go 1.26.10, eight visible CPUs, no race detector during measurement;
race/fault checks run separately. PostgreSQL used 512 MiB shared buffers, 32 MiB
working memory, `wal_sync_method=fsync`, `wal_init_zero=off`, zero commit delay and
all three durability settings enabled. Other host workloads were not controlled;
the ext4/NVMe filesystem was 97% used. PostgreSQL WAL-write/sync waits and intermittent
multi-second commits remain observed bottlenecks; this does not diagnose a device fault.

Earlier probes on the same host included a 724 EPS/26.0 s p95 baseline; larger
buffers alone (695 EPS); an alternative WAL method (763 EPS); and receipt-query
candidates that did not improve repeatably and were reverted. A set-receipt load
attempt hit an I/O timeout and is retained as `eps1000-set-receipt-timeout.log`.
Single good runs around 1,104 EPS/0.41–0.49 s p95 did not survive every repeat and
are not substituted for the consecutive series above. Removing redundant teardown
did not eliminate the latency spikes.

Raw reports and resource samples are retained locally as
`output/backend-framework/eps1000-sustained-0{1,2,3}.json` and corresponding
`.resources.json` files. A [compact evidence file](benchmarks/1000eps-local-2026-10-30.json)
is checked in with original-report hashes, measurements and the failed stability
verdict. Earlier unsuccessful experiments remain under
`output/backend-framework/eps1000-*`. See [historical measurements](STREAM_PERFORMANCE_REPORT.md).
The remaining performance task is reducing long WAL/commit stalls and repeating
the unchanged stability gate on controlled durable storage; no such storage was
provided or provisioned in this local-only session.

The final full framework run with this profile passed Go race/vet, PostgreSQL/Redis
transaction and recovery checks, Python/Rust tests, typed gRPC and the mock L1 flow.
Importer tests (13), performance-gate tests (2), and profile validation (1) passed.
The local foundation now uses the example PostgreSQL profile and optimized binaries.
Post-restart API verification preserved all 70,000 demo events, with no pending
events or unhealthy benchmark scopes. A 500-event API replay inserted zero records;
501 events were rejected with HTTP 400. `/build-operations` on port 8080 returned 200.

## Latency diagnostic follow-up

The same offered load, batches and PostgreSQL profile produced these later probes:

| Probe | Completed | Commit/ACK EPS | p95 | Maximum producer lag |
|---|---:|---:|---:|---:|
| Diagnostic baseline | 60,000 | 822.97 | 23.892 s | 15.321 s |
| Combined claim/reconciliation statement | 60,000 | 978.39 | 8.682 s | 3.239 s |

The candidate also hit a database read timeout in its first attempt. Its SQL change
was reverted: these observations do not demonstrate a repeatable benefit. Both
completed probes had zero unacknowledged entries. No durability or gate threshold
was relaxed. An accidentally overlapping probe was interrupted and excluded.

Retained diagnostics add slow-query timing and disk/dirty-memory samples. The
baseline observed prolonged disk activity with low write throughput; counters
include unrelated workloads, and the baseline lacks a resource wall-clock origin,
so this is evidence of host I/O pressure, not attribution of individual stalls or
a device-fault diagnosis. Later resource reports include that origin for alignment.

Raw artifacts are `output/backend-framework/latency-diagnostics-baseline.json`,
`latency-claim-candidate.json` and their `.resources.json` companions; the failed
attempt is `latency-claim-candidate-timeout.log`. Compact measurements and hashes
are in [diagnostic evidence](benchmarks/latency-diagnostics-2026-10-30.json).
Stable 1,000 EPS remains unverified. Controlled durable storage remains the next
validation dependency; no dedicated storage was supplied in this session.

After reverting the SQL experiment, the full isolated Go/PostgreSQL/Redis/Rust/
Python framework suite passed, including Go race checks and the new mixed
exhausted/fresh lease regression. The two resource-parser tests and 323 relative
documentation links passed. These correctness checks do not pass the performance
gate.
