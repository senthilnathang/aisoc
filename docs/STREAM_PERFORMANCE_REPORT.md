# S10 measured sandbox results — 2026-10-29

**Correctness checks passed; production capacity is not established.** The current
durable pipeline, including the batching changes below, did not keep up with the
nominal 1,000 EPS probe.
Do not enable live QRadar ingestion based on these results.

Command: `python3 scripts/framework/check.py --with-streams --stream-load`.
Go 1.26.10; 8 visible logical CPUs/GOMAXPROCS 8; disposable PostgreSQL/Redis on the
shared development host. One publisher, two consumers; targeted measurement without
the race detector. Full correctness tests separately passed with race/vet checks.

## Streaming measurements

Each probe submitted 1,000 synthetic authentication events in ten 100-event batches,
scheduled 100 ms apart. Total projected envelope payload: 487,000 bytes (~487/event),
not the proposed production 2 KB/event workload. Timing includes durable admission,
publication, processing/disposition and ACK, not findings, cases or LLM investigation.

| Metric | Initial probe | Initial follow-up |
|---|---:|---:|
| Nominal offered EPS | 1,000 | 1,000 |
| Accepted / completed | 1,000 / 1,000 | 1,000 / 1,000 |
| Drain time | 15.535 s | 8.338 s |
| Achieved drain throughput | 64.37 EPS | 119.94 EPS |
| p50 ingress-start → committed ACK | 4.409 s | 4.179 s |
| p95 | 11.520 s | 6.432 s |
| p99 | 12.779 s | 6.701 s |
| Sampled peak pending | 966 | 960 |
| Final pending / unacknowledged | 0 / 0 | 0 / 0 |
| Go test-process CPU time | 4.408 s | 6.021 s |
| Go test-process peak RSS | 42,808 KiB | 43,976 KiB |

The initial follow-up Redis sample reported 1,800,232 bytes used memory, 1,800,312 bytes peak
used memory and 14,229,504 bytes RSS. PostgreSQL CPU/RSS and total host resources
were not measured. Setup contributes one extra event to the explicit database
snapshot: 1,001 accepted and completed, zero pending/dead, no publication failure
or observed gap in this fault-free load probe.

These are two bounded observations with substantial variation, not a proven
optimization or sustained capacity estimate. The final run includes a measurement
coordination fix to wait for publisher receipt completion before cancelling workers;
the production processing path was not optimized between those two probes.

## SQL profiling and bounded batching follow-up

Profiling identified repeated database work, not a measured Go CPU or parser
bottleneck. The original snapshot plan took 524.374 ms and removed 500,500 row
pairs in each of two nested-loop joins. Correlated existence checks reduced the
latest post-load snapshot plan to 17.297 ms on the same 1,001-event fixture.
These are individual plans with different cache/statistics conditions.

Implemented changes preserve the transaction and replay boundaries:

- Admission reads existing hashes once per page and inserts envelopes/outbox rows
  with set-based SQL, retaining atomic checkpoint, conflict and capacity checks.
- Claims acquire at most 25 events with independent attempt IDs and correlated
  envelope lookups. Publication receipts commit in bounded batches, with complete
  rollback if any lease is stale. Backpressure releases unattempted work.
- Test-only profiling records SQL, stage and elapsed client time without argument
  values. Query-plan diagnostics run after measurement; claim diagnostics roll back.

| Profiled probe | Drain EPS | p95 ACK latency |
|---|---:|---:|
| Before these optimizations | 160.60 | Not transcribed |
| Batched admission and snapshot query change | 194.62 | 4.013 s |
| Bounded publication claims | 303.20 | 2.234 s |
| Latest: batched receipts and independent attempt fencing | 269.66 | 2.558 s |

The latest full framework run passed Go race/vet, database and Redis integration,
HTTP regressions and Python/Rust dispatch. New tests cover concurrent disjoint
claims, cross-event attempt rejection, admission rollback, atomic stale-receipt
rejection and release of unattempted events on backpressure. The non-race load
probe accepted/completed 1,000/1,000 events in 3.708 s; p50 was 1.418 s and p99
2.679 s. Final pending/unacknowledged/dead/gaps were zero. Peak sampled pending
was 646. Go CPU was 2.224 s and peak RSS 42,696 KiB; Redis peak used memory was
1,788,408 bytes. PostgreSQL CPU/RSS remain unmeasured.

In that latest profile, consumer commits accounted for 2,000 calls and 2,818.6 ms
of cumulative client time; snapshot calls accounted for 1,045.8 ms across 28 calls.
Concurrent totals overlap and include server/network/wait time, so they cannot be
added or interpreted as server CPU. The next investigation is consumer transaction
cost, source-budget serialization and resource behavior under sustained load.

This shared-host series shows improvement over the profiled baseline, but does
not isolate each change or establish sustained capacity. In particular, the final
receipt-batching change has no demonstrated incremental end-to-end speedup over
the preceding 303 EPS observation. The 1,000 EPS gate remains unmet. Intermediate
reports are retained locally under `output/backend-framework/profiling/`.

## Cache comparison

Fifty warm-cache and fifty uncached local IOC lookups alternated against one tenant
and one indicator. Both read authoritative PostgreSQL generation; no external TI
request is involved.

| Latency | Cached | Uncached |
|---|---:|---:|
| p50 | 0.437 ms | 0.389 ms |
| p95 | 0.706 ms | 0.702 ms |
| p99 | 0.839 ms | 0.869 ms |

The cache has no demonstrated useful benefit for this cheap local lookup. Keep it
opt-in and preserve the existing uncached default. The sample is too small to infer
tail-latency improvement or behavior under contention/external-provider latency.

The latest follow-up again showed no useful local-cache benefit: cached/uncached
p50 0.185/0.161 ms, p95 0.289/0.298 ms and p99 0.368/0.404 ms (50 samples each).

## Reliability and retention evidence

The full suite passed the existing Redis loss, stalled transport, OOM/backpressure,
retry/DLQ, stale lease, rollback, QA and mock SOAR conflict tests. The new retention
test preserves uncommitted and pending entries, refuses multiple groups, keeps young
entries, removes only eligible committed entries, and preserves durable accounting.
Faults were tested separately from load; this is not concurrent chaos/failover proof.

Latest generated reports: `output/backend-framework/stream-load.json`,
`stream-load.json.cache.json`, `report.json` and `check.log`. Reports are generated
evidence, not checked-in production guarantees. This document preserves the observed
results for review.

## Required next work

### Paced load and consumer slowdown follow-up

The harness now accepts bounded event counts/rates and a cooperative consumer
pause. Two local runs scheduled 3,000 events at 100 EPS in 100-event batches over
a nominal 30-second input window (last batch at 29 seconds):

| Measurement | No pause | Two-second pause per consumer |
|---|---:|---:|
| Accepted / completed | 3,000 / 3,000 | 3,000 / 3,000 |
| Drain time | 29.532 s | 29.464 s |
| p50 actual admission start → ACK | 226.991 ms | 205.612 ms |
| p95 | 1,451.260 ms | 1,471.657 ms |
| p99 | 1,951.874 ms | 2,243.082 ms |
| Maximum producer schedule lag | 7.065 ms | 10.258 ms |
| Sampled peak pending | 195 | 276 |
| Final pending / unacknowledged | 0 / 0 | 0 / 0 |

The pause run also passed the full framework correctness suite. The no-pause
comparison used `--stream-measure-only`, which skips full correctness gates.
Both consumers exercised their pause near 15 seconds; the pause run's scheduled
arrival-to-ACK p95 was 1,472.507 ms, including producer scheduling delay.
The pause run used 8.037 Go CPU seconds and 42,900 KiB peak Go RSS; Redis peak
used memory was 3,187,384 bytes. PostgreSQL CPU/RSS remain unmeasured.

The results demonstrate full drain after a controlled slowdown in this bounded
fixture. Shared-host variation prevents attributing the small p95 difference to
the pause. This is neither abrupt worker death nor Redis/network failover, and
30 seconds at 100 EPS does not establish the 1,000 EPS target or a production SLO.
Local reports: `profiling/paced-100eps-baseline.json` and
`profiling/paced-100eps-consumer-pause.json` under `output/backend-framework/`.

**A final repeat was substantially slower.** With the same 3,000-event, 100 EPS
schedule and two-second consumer pause, it drained in 39.582 seconds (75.79 EPS).
Actual-admission-to-ACK p50/p95/p99 were 1.322/15.816/16.161 seconds; scheduled
arrival-to-ACK p95 was 15.816 seconds. Producer scheduling lag reached 4.458 seconds
and sampled pending peaked at 1,055 events. All 3,000 events still completed, both
pauses ran, and final pending/unacknowledged/dead/publication failures/gaps were zero.
The complete framework correctness suite passed in this run.

Its profile recorded 6,000 consumer commits totaling 32.751 seconds of cumulative
client time (maximum 2.445 seconds), and 3,000 source-checkpoint lock calls totaling
15.319 seconds (maximum 2.162 seconds). These concurrent totals include server,
network and wait time; they do not establish the cause. The source path and host/
PostgreSQL resource contention need further measurement. Preserve this result as
`profiling/paced-100eps-pause-repeat.json`; do not select only the faster observations.
**Even sustained 100 EPS is not established by this series.**

### PostgreSQL wait and I/O instrumentation follow-up

The same paced pause workload now records active benchmark-client wait events at
250 ms intervals and before/after database counters, with I/O timing enabled only
in disposable PostgreSQL. The full framework check passed. This instrumented run
completed 3,000/3,000 events at 101.53 drain EPS; p50/p95/p99 were
243.466/2,178.333/2,686.683 ms. Maximum producer scheduling lag was 275.777 ms,
sampled pending peaked at 296, and final unacknowledged entries were zero.

Across 118 polling samples, active-backend observations were:

| Wait classification | Backend observations |
|---|---:|
| No reported wait (`CPU_or_runnable`) | 110 |
| `IO:WALSync` | 20 |
| `Client:ClientRead` | 6 |
| `LWLock:WALWrite` | 5 |
| `Lock:transactionid` | 2 |
| `Lock:tuple` | 1 |

These are sampled backend counts, not durations or CPU percentages; multiple
backends can appear in one sample. Database counters increased by 27,755 commits
and 22,788,500 buffer hits, with zero additional block reads, temp bytes or deadlocks.
Reported database block-write time increased 22.991 ms. These counters include
monitoring/other disposable-database clients, can lag, and do not measure WAL fsync
time or PostgreSQL process CPU/RSS. The buffer-hit volume and idle publication
polling/retained-record scans warrant investigation, not an assumed diagnosis.

This run captured WAL and occasional row/transaction waits but did not reproduce
the preceding severe slowdown. Instrumentation adds overhead, and the prior slow
result remains valid evidence against a stable capacity claim. Next measurements
should cover PostgreSQL/host CPU, memory, WAL timing and scan/polling overhead.
Report: `output/backend-framework/profiling/paced-100eps-postgres-diagnostics.json`.

### Process resources and shared-budget query follow-up

Linux resource sampling now accompanies the same 3,000-event/100 EPS pause probe.
The metadata admission path combines its existence/capacity checks into one query,
retaining the separate source lock and transaction. This removes 3,000 SQL calls
in this workload; it does not remove the retained-record count or source serialization.
A concurrent work-versus-gap test verifies that only one writer can claim the last
budget slot and that replay of the admitted identity still succeeds at capacity.

| Observation | Before combined query | After combined query |
|---|---:|---:|
| Completed events | 3,000 | 3,000 |
| Drain EPS | 101.17 | 99.18 |
| p50 actual admission start → ACK | 236.374 ms | 242.305 ms |
| p95 | 1,482.559 ms | 1,970.458 ms |
| p99 | 2,239.551 ms | 2,261.691 ms |
| Maximum producer schedule lag | 6.804 ms | 7.293 ms |
| Observed PostgreSQL CPU seconds, wider invocation window | 29.96 | 29.27 |
| Peak summed PostgreSQL RSS bytes (shared pages counted repeatedly) | 292,007,936 | 531,943,424 |
| Host 1-minute load range | 1.66–2.16 | 2.64–3.09 |

No resource sampling errors were reported. The baseline was measurement-only; the
after run passed the full framework suite before measurement, so the disposable
database had different preceding activity. Resource windows include Go test
compilation/setup/cleanup; observed CPU misses processes exiting between polls,
and summed RSS is not physical memory use. Host load includes unrelated workloads.
These results do not isolate the query change's effect or demonstrate an end-to-end
speedup. The query reduction is verified; the higher after-run p95 remains reported.
Both runs completed every event; the final after-run snapshot had zero pending,
dead, publication failures or gaps, and Redis had zero unacknowledged entries.

Local archived pairs: `profiling/before-budget-query.json` and
`profiling/after-budget-query.json`, with matching `.resources.json` files under
`output/backend-framework/`. The full framework, resource-parser unit check,
Python compilation, Markdown links and diff checks passed. Existing services were
not restarted or migrated.

### Repeated empty-poll and WAL timing assessment

Added `--stream-idle-poll-ms` (1–100 ms, historical default 1 ms) and cluster-wide
WAL counters/timing in the disposable test cluster. Four fresh, measurement-only
runs used identical 3,000-event/100 EPS input, two consumers, a two-second consumer
pause and the same instrumentation. Order was 1 ms, 20 ms, 20 ms, 1 ms; the second
pair reverses the first to reduce order bias. No running service schedule changed.

| Run / empty-claim delay | Claim queries | Observed PostgreSQL CPU seconds | p95 ACK latency | Cumulative WAL sync ms | Buffer-hit delta |
|---|---:|---:|---:|---:|---:|
| A / 1 ms | 8,727 | 33.03 | 1,469.354 ms | 5,726.151 | 23,432,874 |
| A / 20 ms | 1,189 | 20.50 | 3,967.402 ms | 9,431.442 | 11,182,187 |
| B / 20 ms | 1,270 | 21.53 | 1,478.140 ms | 5,451.843 | 11,275,587 |
| B / 1 ms | 9,283 | 31.08 | 1,483.747 ms | 5,676.044 | 23,596,272 |

Every run accepted/completed 3,000/3,000 events with zero final pending, dead,
publication failures, observed gaps and unacknowledged entries. Resource sampling
reported no errors, and WAL reset timestamps matched within each run. The wider
resource-window, counter-lag and shared-host limitations above still apply.

The 20 ms setting reduced claim queries by about 86%, buffer hits by about 52%,
and paired observed PostgreSQL CPU by about 31–38%. This is useful evidence of
benchmark empty-poll overhead. It is not evidence of better tail latency: one
20 ms run had p95 3.97 s alongside higher cumulative WAL sync time. That association
does not establish causation. All drain rates were 101.4–101.8 EPS because the
workload was paced; these rates do not establish maximum or sustained capacity.

Keep the existing default for historical reproducibility; use the explicit flag
for further comparisons. Production scheduling needs a bounded idle wait chosen
against discovery-latency requirements, with no delay imposed between nonempty
batches. `PublishBatch` remains a single-call primitive; this change does not
silently install a publisher loop. Retained-budget and observation scans still
need profiling/optimization independently of empty polling. WAL-specific timing
is now implemented; physical-memory attribution and tail-latency causes remain open.

Archived load/resource pairs are `profiling/polling-{1ms,20ms}-{a,b}.json` and
matching `.resources.json` under `output/backend-framework/`. These four runs are
measurement-only and do not replace the separate full regression gate.

### Retained-event snapshot query improvement

The snapshot plan repeated the completed-event lookup four times per retained
event across its aggregates. Materializing the per-event status expressions once
within the statement removes that repetition without introducing a persistent
cache, schema change or weaker accounting. The snapshot still scans retained
events and must be polled at a bounded frequency.

Post-load `EXPLAIN (ANALYZE, BUFFERS)` comparisons used the same 3,001-event fixture
(3,000 load events plus setup), alternating original/materialized/materialized/
original to expose order effects:

| Query | Execution time | Shared buffer hits | Shared reads / temp writes |
|---|---:|---:|---:|
| Original, first | 57.727 ms | 54,226 | 0 / 0 |
| Materialized, first | 39.137 ms | 30,214 | 0 / 0 |
| Materialized, second | 41.071 ms | 30,212 | 0 / 0 |
| Original, second | 57.979 ms | 54,220 | 0 / 0 |

This demonstrates about 29–32% less query execution time and 44% fewer buffer
hits for this fixture. It does not establish behavior at much larger retention
sizes, where materialization may spill. The mixed-state test verifies completed
precedence over historical dead work, dead-only/pending accounting, processor
isolation and oldest-pending age.

The full framework check passed on rerun. An initial run stopped at a statement
timeout in the existing threat-intelligence concurrency test; the new snapshot
test passed in both runs, and timeout settings were not changed. The final paced
20 ms-poll/100 EPS/two-second-pause probe completed 3,000/3,000 events at 101.42
drain EPS, with p50/p95/p99 239.342/1,787.543/2,597.270 ms and zero final pending,
dead, publication failures, gaps or unacknowledged entries. This paced result is
not an isolated end-to-end speedup or production capacity claim.

Archived files: `profiling/materialized-snapshot.json`, matching `.resources.json`
and `.snapshot-plan.json` under `output/backend-framework/`. The paired query
measurements are embedded in `snapshot_query_comparison` in the load report.

### Remaining release work

1. Extend the completed SQL/plan profiling with PostgreSQL resource/lock/I/O data
   and consumer-stage measurements. Consumer commits and retained-budget checks
   remain candidates for improvement; preserve crash recovery and idempotency.
   Do not add Rust or another datastore on the assumption that it fixes this result.
2. Establish an agreed sustained/burst target and representative payload/model mix,
   then rerun longer loads, resource measurements and faults under load.
3. Complete monitored operational thresholds, consumer-DLQ recovery/operator
   transport (the internal audited publication retry primitive is implemented) and
   durable archival/dedup retention policy. Redis cleanup alone cannot remove the
   PostgreSQL recovery storage cap.

S10 therefore remains partial and S11 live-provider rollout stays gated. See
[operations](STREAM_OPERATIONS.md) and [tasks](IMPLEMENTATION_TASKS.md).
# Local completion: 10,000-event burst probe

After migration 026 replaced per-admission retained metadata counts with
transactional derived counters, a fresh isolated probe scheduled 10,000 projected
authentication events at 1,000 EPS, with 3,000 EPS for the middle third of batches.
One publisher, two consumers and a 20 ms empty-claim delay were used. It is an
overload probe with no provider/model calls, not an end-to-end LLM benchmark.

| Measurement | Final run |
|---|---:|
| Accepted / completed | 10,000 / 10,000 |
| Final unacknowledged deliveries / pending events | 0 / 0 |
| Elapsed drain time | 43.512 s |
| Average drain throughput | 229.82 EPS |
| Scheduled-input-to-ACK p50 / p95 / p99 | 18.556 / 34.758 / 35.292 s |
| Sampled peak pending | 8,220 |
| Maximum producer scheduling lag | 40.149 ms |

The provisional 1,000 EPS capacity target is **not met**. Finding p95 is not
measured by this transport benchmark; the observed ACK p95 also exceeds 2 seconds.
The initial run completed every event at 252.51 EPS but failed during a single
large test-cleanup DELETE. Test cleanup now deletes at most 100 rows per statement;
the application SQL timeout is unchanged, and the repeated run passed. Both
artifacts are retained under `output/backend-framework/`, with the final result
prefixed `sandbox-burst-`. The full correctness result is separately retained as
`sandbox-correctness-report.json`; measurement-only does not rerun all gates.

Major observed costs remain durable transaction commits, publication claims,
retained-event snapshot scans and contention on the source checkpoint. These
results do not justify a Rust rewrite: moving parsing would not remove those SQL
and durability costs. The local UI pipeline is deliberately capped at 1,000
retained events per source and must not be advertised as this load generator's
production equivalent. Live model quality, replicated failover and power-loss
durability remain outside the selected local JSON scope.

## 2026-10-30: batched transactions and bounded query plans

Fresh deliveries share a transaction (up to 100 events); recovery retains the
leased per-event path. Outbox claims update locked candidate tuples, inbox lookups
use bounded point queries, status aggregation avoids correlated scans, and idle
completed scopes skip repeated correlation. Correctness and fault tests passed.

| Measurement | Completed | Drain EPS | Scheduled-to-ACK p95 |
|---|---:|---:|---:|
| Earlier 10k overload baseline | 10,000 | 230 | 34.8 s |
| Optimized 10k burst, 1k base / 3k peak offered | 10,000 | 895 | 3.669 s |
| Final 10k steady schedule, 1k offered | 10,000 | 641 | 5.409 s |

The final run used two consumers, batch limit 100, one publisher and 20 ms
empty-claim delay. Accepted-to-ACK p95 was 2.317 s, excluding producer scheduling
delay. Final pending and unacknowledged counts were zero. These measure synthetic
delivery, not LLM investigation or ingest-to-finding latency. Host contention and
different offered schedules prevent a controlled speedup claim. Stable 1,000 EPS
remains unmet. Checkpoint row locking dominates process-query elapsed time.

Local evidence: `output/backend-framework/final-steady-stream-load.json` and
`set-snapshot-stream-load.json`. The complete regression suite passed. The running
sandbox retains its conservative default consumer batch; the benchmark explicitly
opts into 100. These bounded runs do not establish sustained production capacity.
