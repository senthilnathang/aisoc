# Durable local Hunt execution implementation plan

**Goal:** Queue bounded local evidence searches with observable progress, cancellation, bounded retries and restart recovery; preserve immutable evidence and idempotent promotion.

**Architecture:** Reuse PostgreSQL jobs and fair tenant admission with a Go-only `go.hunt_search` handler in the existing investigation-worker process. Add a tenant/hunt/run-to-job mapping and sqlc queries. Freeze query/revision/actor at enqueue. Read evidence at execution, capture approved Memory at successful completion, and atomically persist the receipt, audit and fenced job completion. Retain synchronous `/search` for compatibility, reserving IDs across both paths. No provider calls or additional service.

**Tech stack:** Go, sqlc/pgx, existing job dispatcher, React 19/Chakra, disposable PostgreSQL/Chromium test harness.

- [x] Add migration and sqlc queries; test queue idempotency, tenant boundaries and limits.
- [x] Add fenced worker completion, cancellation and explicit bounded retry. Prove crash/lease recovery, stale attempt rejection, audit rollback and promotion replay.
- [x] Add queued API and progress UI with polling, cancellation and retry controls; preserve existing receipts and browser workflows.
- [x] Extend API/browser acceptance, run complete release gate and review changes.
- [x] Update architecture, developer guide, README, roadmap and test documentation. Leave uncommitted until requested.

## Operational decisions

Three automatic attempts, 30-second leases and a 10-second local search deadline; failed runs may receive two explicitly requested three-attempt extensions (nine attempts total). Cancelled runs are terminal. One active job per hunt, 100 retained run IDs per hunt, and 100 outstanding Hunt jobs per tenant. Persisted stages describe actual work, not fabricated percentages. Retry requests carry the observed attempt count to prevent lost-response replay from repeatedly extending the budget. A successful run is immutable and promotion remains keyed by tenant/hunt/run/finding.

Rollback: stop enqueues and drain/cancel outstanding Hunt jobs before reverting workers; keep the additive mapping table and existing receipts. Existing synchronous clients remain supported. No live integration or model quality claim.
