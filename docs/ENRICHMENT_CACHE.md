# Tenant-aware local IOC cache (S09)

`enrichment.Store.Lookup` caches a bounded read of active tenant-local threat
indicators. `l1.EnrichLogin` uses it explicitly for the source IPs in an admitted
login finding. It verifies stored finding/evidence provenance, deduplicates inputs
and performs at most four lookups under a two-second context deadline. Results
remain Go-owned context; they are not automatically passed to Python, used as a
verdict, or applied to a case. No external TI provider is contacted.

## Authority and freshness

PostgreSQL is always authoritative. Migration 025 adds `enrichment_generations`
and a trigger that changes the tenant generation on indicator insert, update or
delete, in the same transaction. A rolled-back mutation does not invalidate the
committed generation. Cascading report deletion also invalidates cached indicators.

Every lookup reads the current generation in a repeatable-read transaction—even
on a Redis hit. The cache field includes generation, exact indicator type and value
hash; its key includes tenant identity. A source update makes both positive and
negative entries unreachable to later snapshots. Concurrent changes after a read's
snapshot appear on the next lookup. Results include source provenance, generation,
retrieval/expiry timestamps, bounded matches and a truncation flag.

Positive entries last 30 seconds; negative entries last five seconds. A negative
entry means **no active local exact match**, never benign or safe. Retrieval time
is the local lookup time, not proof that a TI feed itself is fresh. Matching preserves
existing exact type/value semantics; no new IP/domain canonicalization is assumed.

## Bounds and failure behavior

- At most 32 matching indicator/report IDs and severities are returned. A 33rd row
  sets `truncated`; callers must not interpret truncated results as exhaustive.
- Redis holds one hash per tenant, with at most 128 fields and 8 KiB per value.
  A Lua script enforces the field cap atomically. The whole hash expires after
  60 seconds without sliding renewal. Expired/generation-obsolete fields can occupy
  slots until that expiry; a full hash skips insertion and returns source data.
- Cache reads/writes have 200 ms operation budgets, bounded connection pools and
  no automatic retries. Misses, corrupt/expired/foreign entries, transport errors,
  full cache and failed writes fall back to source data. Source failure returns an
  error even if cached data exists; stale data is not silently served.
- Cache values must use the canonical encoded shape, expected tenant/query/generation,
  valid TTL and bounded match fields. Redis is trusted service infrastructure;
  these checks are not cryptographic protection from a compromised cache writer.
- `CacheStatus` reports hit, miss, disabled, unavailable, capacity or bypass for
  callers. Exporting aggregate metrics/alerts and workload benchmarks is S10 work.

The optional Redis launcher adds an `aisoc-cache` role restricted to
`soc:cache:ioc:*` and the needed hash/Lua commands. It cannot read/write telemetry
streams. Existing profiles gain a new role on their next explicit preparation;
existing credentials are retained. Tests only use disposable instances. Remote
plaintext addresses remain disallowed; TLS is required before remote deployment.

The sandbox shares Redis's existing 64 MiB `noeviction` budget. Tenant count can
still exhaust that global budget, causing source fallback and stream backpressure.
Production needs measured cache/telemetry memory isolation and retention policy;
this is not a guarantee of cache capacity for arbitrary tenant counts.

## Integration, verification and rollout

Caching is opt-in via a constructed cache client. Existing HTTP routes and local
investigation processing keep their current uncached path. No default service
dependency, live model/provider integration or new API endpoint is introduced.

`python3 scripts/framework/check.py --with-streams` covers positive/negative hits,
insert/update/delete invalidation, rolled-back changes, tenant separation, malformed
and expired entries, concurrent field limits, role restrictions, stalled Redis
fallback, truncated results and source failure. The existing mock pipeline calls
the Go enrichment tool twice and checks the second read is cached, without changing
the inconclusive investigation policy.

There is no claimed speedup. Hits still require a PostgreSQL generation read and
Redis I/O; for an already cheap indexed lookup this may be slower. The trigger also
adds per-tenant write contention. S10 must measure hit rate, latency, source-query
cost and write overhead before enabling the cache in a live path.

Source has 25 migrations and 41 tables. Migration 025 is tested only on disposable
databases; running release/foundation remain on 019. Rollback disables the cache
client and continues authoritative reads, retaining the generation table/trigger
until a separately reviewed cleanup. Do not flush shared Redis to disable caching.

See [implementation tasks](IMPLEMENTATION_TASKS.md), [Redis operations](REDIS_STREAMS.md)
and [typed L1 investigation](L1_INVESTIGATION.md).
