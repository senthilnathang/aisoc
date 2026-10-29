# Backend performance evidence

Measured locally on 2026-10-29. These are shared-host, fixed-workload comparisons,
not language benchmarks or production capacity guarantees.

## Final optimized Node/Go campaign

Median of three repeats per dataset. Higher throughput and lower latency are better.

| Metric | Node small | Go small | Node large | Go large |
|---|---:|---:|---:|---:|
| Requests/second | 196.6 | 273.1 | 179.7 | 221.4 |
| Overall p95 (ms) | 91.1 | 57.7 | 91.9 | 62.0 |
| Overall p99 (ms) | 143.8 | 81.6 | 127.4 | 86.6 |

All 12 repeats had zero request errors. Every operation's median p95/p99 stayed
within the 10% regression ceiling relative to Node. This latency gate is one
criterion, not the entire release gate.

Go whole-stack proportional memory was 25.9% lower on small and 31.6% lower on
large. CPU time was 0.9% higher on small and 22.2% higher on large. Summed RSS was
higher because PostgreSQL shared pages appear in multiple processes; proportional
memory accounts for that sharing. Not every resource metric improves.

## Before and after code edits

Fresh unmodified Go baseline versus optimized Go, matching small-fixture workload
and diagnostics, median of three repeats:

| Metric | Before | After |
|---|---:|---:|
| Requests/second | 236.6 | 273.1 |
| Update p95 / p99 (ms) | 62.8 / 86.0 | 51.4 / 73.9 |
| Create p95 / p99 (ms) | 73.2 / 109.7 | 58.5 / 80.5 |
| Detail p95 / p99 (ms) | 77.3 / 125.2 | 67.4 / 97.0 |
| List p95 / p99 (ms) | 45.0 / 70.3 | 39.4 / 57.3 |

Changes: batched tenant/case inserts and update/audit commands within existing
transactions; typed detail responses avoiding redundant JSON conversion; lazy
connector-alias lookup reused within one Skills application. Locks, tenant checks,
audit rollback, fsync and synchronous commit remain intact. Mutable business
state is not cached across requests. Full framework/race/vet/HTTP/auth/recovery
checks passed and the tested API/worker were promoted to the active release.

## Earlier anomaly

An earlier campaign measured small Go update/create p99 around 630/620 ms versus
Node around 110/109 ms. It failed the per-operation latency threshold despite
better aggregate throughput. Those spikes did **not** reproduce in the fresh
unmodified diagnostic baseline; their disappearance cannot be credited entirely
to code changes.

That baseline recorded about 5.3 seconds cumulative WAL sync time across three
runs, low aggregate pool waiting and no application SQL statement above the
50 ms logging threshold. Counters include setup and job probes, not just timed
requests. Host scheduling/storage variability is plausible, not a proven cause
of the original spikes. Continued observation remains operational follow-up.

## Reproduction and controls

```bash
python3 scripts/framework/benchmark.py --controlled --postgres-diagnostics --output-dir output/backend-performance/new-campaign
node tests/backend-performance/compare.mjs --before output/backend-performance/new-campaign/node-campaign.json --after output/backend-performance/new-campaign/go-campaign.json --output output/backend-performance/new-campaign/campaign-comparison.json
```

- Token auth, same two-CPU affinity, eight clients and 3,000 requests per repeat.
- Two tenants, initially 100 or 1,000 cases per tenant; fresh databases each repeat.
- 50% list, 30% detail, 10% update, 10% create; warm-up reads precede measurement.
- Three repeats per dataset; stacks run sequentially, not under competing load.
- Worker fixture interval 100 ms; optional specialists disabled.
- Go resources include API, worker and dedicated PostgreSQL descendants.
- Affinity includes the load generator and does not reserve CPUs from other work.
- Closed-loop HTTP load does not measure browser rendering or open-loop saturation.

Use a new output directory per campaign. `--sizes small` and `--repeats 1` are
diagnostic options, not equivalent to the complete campaign. PostgreSQL diagnostics
retain slow-statement timing without bind parameters, WAL counters, durability
settings and API pool metrics from disposable instances.

The comparator rejects failed requests/sampling, mismatched fingerprints/repeats
or operation sets, empty reports and invalid latency values. It reports aggregate
and per-operation medians and explicit p95/p99 regressions above 10%.

Local evidence: `output/backend-performance/write-baseline/`, `write-optimized/`,
and earlier `comparison-2026-10-29/`. Raw outputs remain ignored; this summary is
committed. The original cutover campaign under `controlled/` is a separate dated
receipt in [release status](RELEASE_STATUS.md), not interchangeable with later runs.
