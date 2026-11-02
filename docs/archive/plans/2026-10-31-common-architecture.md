# Common architecture implementation plan

Goal: complete the bounded common-architecture increment on main; RisingWave stays separate.
Architecture: PostgreSQL owns jobs and leases; sqlc generates pgx queries. Go owns
bounded execution and fair tenant selection. Optional mutual TLS authenticates the
Go/Python transport while bearer and task identity checks remain mandatory.

Scope and authorization: local validation only, no production deployment or live
responses. Preserve demo data. User authorized execution without further design
approval. No destructive migrations, broker, or other new service infrastructure.

- [x] Migrate `platform/jobs` queries to pinned sqlc-generated pgx code using the
  existing migration schema. Keep `Enqueue` in the caller's transaction and stale
  result/lease checks. Check regeneration and real PostgreSQL regression tests.
- [x] Add an additive dispatcher-state migration and tenant-row locking for fair
  claims. Oldest dispatched eligible tenant wins; per-tenant running leases are
  capped. Add bounded worker concurrency (default 2, 1..4), per-tenant cap (default
  1, 1..4), and cancellation-aware shutdown. Test noisy/small tenants, concurrent
  claims, retries, cancellation and expired leases in a disposable database.
- [x] Add optional Go/Python mTLS configuration using dedicated CA, client/server
  certs and keys. Reject partial config and untrusted peers, verify server name,
  retain plaintext loopback defaults and keep HTTP management loopback-only.
  Validate handshakes, wrong CA/name, missing client identity and bearer rejection.
- [x] Run local framework validation including PG/Redis, Go race/vet, Python tests,
  and generation/docs checks. Re-evaluate performance without weakening existing
  durability or latency gates; record failures honestly rather than declaring
  hardware-dependent targets achieved.
- [x] Update architecture, developer/runtime docs, roadmap, tests and evidence;
  commit/push common changes only. Roll back code by reverting commits; the additive
  dispatcher table may remain unused by old code without dropping data.

Review risks: concurrent claims exceeding tenant cap; old queued jobs omitted from
new state; cancelled or expired attempts committing; partial TLS config falling back
to plaintext; fixture/environment secrets entering logs. Tests must cover these
boundaries. Service cert rotation requires restart; automated PKI is out of scope.


Execution evidence: full disposable framework suite passed after the migration
upgrade regression fix. Original migration ordering reproduced a missed concurrent
writer; trigger-before-backfill fixed it. Independent code review accepted the fix.
See ../../benchmarks/common-architecture-2026-10-31.json for checks and measurements.
The performance evaluation task is complete, but its stability target is not met:
all three diagnostic probes failed one or more strict latency/lag gates. No
production or stable-capacity claim is made. One probe overlapped the migration test.
