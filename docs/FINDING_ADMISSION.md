# Durable finding admission (S06)

`intake.Store.AdmitFinding` connects the bounded S05 rule to the existing alert,
investigation, audit and `investigation_jobs` transaction. It does not add another
orchestrator or Redis investigation queue. This is an internal opt-in entry point;
no HTTP endpoint, live provider connector or continuous ingestion scheduler is enabled.

## Validation and atomicity

Trusted control-plane configuration supplies the tenant/source binding, an existing
enabled detection rule with `Escalate` routing, and positive admission budgets.
No rule is created or enabled automatically. Findings must be the allowlisted
four-observation suspicious-login pattern, with `requires_review` disposition.

Admission retrieves each envelope and hash from PostgreSQL, verifies provenance,
rejects ambiguous source revisions, and recomputes the deterministic rule. It never
accepts caller-supplied evidence content. The source checkpoint lock serializes this
validation against new acceptance. Source revisions arriving after admission remain
new evidence requiring future reconciliation; existing analyst decisions are not
overwritten. The revision lookup scans retained source envelopes, a bounded sandbox
approach to measure/index before high-volume deployment.

Migration 022 adds `stream_findings` (canonical finding plus alert/case/job receipt)
and `stream_admission_tenants` (admission/scheduling lock and last-dispatch time).
The finding receipt commits in the same transaction as existing intake effects.
Concurrent exact replay returns the same IDs. Reusing the receipt with a different
configured rule fails. Invalid, missing or revised evidence fails before creating
another case. No finding is reported accepted when capacity rejects it: callers
must retain/recompute pending candidates from durable evidence and retry explicitly.

The existing intake path creates the case as open/unknown with analyst ownership.
Its local three-phase worker records supplied evidence, compares local indicators
and leaves the case open for review. No Python inference, source fetch or response
action occurs in this milestone. Python investigation/QA is S07.

## Bounded admission and scheduling

- `MaxActive` limits queued/running stream-admitted jobs per tenant across connectors
  (1–1,000). `MaxRetained` caps all retained receipts (up to 100,000). Duplicate
  receipts remain replayable at capacity. These are trusted service settings, not
  per-request choices exposed to callers; deployments must use consistent values.
  The cap gates new automatic admissions. Existing analyst-requested reinvestigation
  remains available and can increase queued work beyond that admission cap; its
  jobs still use the same tenant concurrency lock and count against new admissions.
- Existing `ProcessNext` chooses stream tenants by oldest dispatch time and uses
  `FOR UPDATE SKIP LOCKED` on the tenant row. One phase per stream tenant can execute
  at a time across worker processes. Other tenants can progress concurrently.
- Older ordinary intake work gets a turn when its update time precedes the stream
  tenant's last dispatch. The ordinary selection excludes stream receipts so it
  cannot bypass their tenant concurrency lock. Existing worker process counts still
  bound global concurrency; this does not bound future asynchronous model calls.
  Scheduling follows investigation identity so new analyst retry job IDs cannot
  bypass the stream tenant lane. Receipts retain the original admission job ID.
- Locks and work roll back on crash. Last-dispatch state commits with the phase.
  There is no retained-data auto-deletion, global storage quota, cross-tenant HTTP
  intake rate limiter or production latency guarantee in this change.

## Verification and release

Run `python3 scripts/framework/check.py --with-streams` for disposable verification.
Admission integration tests cover concurrent replay, distinct-finding capacity races,
transaction rollback on receipt failure, retained limits, active-capacity release,
foreign tenants, forged time ranges, unsafe routing, ambiguous revisions and tenant
rotation/concurrency, ordinary intake progress and analyst retry scheduling.
The existing S05 PostgreSQL/Redis test now admits the finding
twice and requires identical case/job IDs. Existing HTTP and worker recovery tests
remain in the full suite.

Source now has 22 migrations and 37 tables. Migration 022 is additive and tested
only on disposable databases. Running release/foundation remain on migration 019.
Do not deploy a new worker against that older schema without the normal migration
and rollout process. Rollback stops optional admission and retains receipts/cases/
jobs for reconciliation. Avoid starting an older worker against admitted work if
its scheduling bypasses the new tenant limits; drain or pause that work first.

Next: [S07](IMPLEMENTATION_TASKS.md), evidence tools, Python investigation contracts,
QA and budgets. Real QRadar lifecycle reconciliation and write-back remain S08/S11.
