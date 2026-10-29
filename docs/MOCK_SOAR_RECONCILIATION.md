# Human escalation and mock SOAR reconciliation (S08)

`internal/modules/soarsync` consumes completed mock investigation jobs and produces
audited L2-review records and note-only drafts. It never invokes a provider, sends a
message to an analyst, or enables containment. All SOAR effects are explicit sandbox
database records. No public API or background sync loop is enabled by this change.

## Escalation boundary

`Stage` requires the trusted tenant, completed job ID and an explicit mock SOAR
connector/case/version mapping. It checks the allowlisted plugin, task/case/attempt
identity and result contract again, using the recorded job completion time for
historical validation. This does not represent a new inference or fresh evidence.
Cancelled/unfinished jobs and unsupported verdicts or citations cannot be staged.

The case must originate from finding admission. The transaction creates one
`l1_escalations` receipt, one existing `case_records` feedback item marked
`l2_review_required`, and an audit event. It does not overwrite the analyst's case
status, determination, assignment or summary. Replay returns the existing receipt;
changed output or a different source mapping conflicts. Feedback is a durable
review item, not evidence that a human has received or acknowledged a notification.

The draft text is Go-owned: explicit MOCK/INCONCLUSIVE labels, human review,
missing IAM/MFA and endpoint context, evidence references and job ID. Model text
cannot specify a write operation, destination, status change or response action.

## Synthetic source and reconciliation

Migration 024 adds three tables: `mock_soar_cases`, `l1_escalations` and
`mock_soar_notes`. `ObserveMockCase` durably applies the S05 mock revision contract:
versions are opaque, predecessor tokens must match, same-version content changes
fail, and reopen is explicit. Source status, owner and analyst notes are separate
from AI-generated notes. These fields are sandbox conventions, not IBM API claims.

`SyncMock` locks the draft and source case, compares the expected version and
appends one note identified by job ID and origin `aisoc-mock-l1`. It advances the
mock source version and records the sync audit/receipt atomically. It never changes
source status, owner or analyst notes, including when the source case is closed.
Concurrent replay and a lost caller response after commit return the same note.

A version mismatch records `conflict` and an audit event without a note. Automatic
retry cannot bypass this state. After reviewing the source, an explicit
`RebaseMock` call with the current version and trusted actor records the decision
and returns the draft to ready state. A further analyst update causes another
conflict. This internal actor parameter is not a public authentication mechanism
or authorization for production writes.

An echoed current source revision is a no-op; source observation never generates
a new outbound note. Closed/reopened source updates preserve the existing note
and receipt. Automatic case reopening or reinvestigation is not enabled here.

## Guarantees and limits

The mock provider effect and receipt share one PostgreSQL transaction. This tests
conflict handling, idempotency and rollback, not the uncertainty of a remote SOAR
write succeeding while its network response is lost. A live adapter still needs
verified API/version scopes, provider idempotency or effect lookup, bounded retry,
leases, reconciliation and outage tests before rollout. No actual SOAR credentials
are stored or used. Artifacts, tasks and status write-back are not allowlisted yet.

Source mappings and review actors come from trusted Go callers. There is no new
user-facing approval workflow or tenant-wide retention scheduler. Historical job
output is preserved; this path does not certify evidence freshness or propagate
late corrections automatically. S10 must budget and test retention/backlog limits.

## Verification and rollback

`python3 scripts/framework/check.py --with-streams` runs four PostgreSQL integration
tests covering concurrent escalation/sync replay, foreign identity, analyst edits,
version conflict, explicit rebase, closed/reopened snapshots, echo suppression,
audit-failure rollback, and cancelled/stale/invalid outputs. Test setup builds an
admitted finding and completes a QA-valid synthetic job through the existing job
store; S07 separately verifies real Python RPC and dispatcher execution.

Source now has 24 migrations and 40 tables. Migration 024 has been applied only to
disposable databases. Running release/foundation services remain on 019. Rollback
disables these optional operations and retains drafts, notes, audit and receipts;
do not drop them or replay drafts blindly. Live SOAR writes remain a separate gate.

Next: [S09](IMPLEMENTATION_TASKS.md), tenant-aware caching for a justified bounded
enrichment use case. See [S07 investigation](L1_INVESTIGATION.md) for output limits.
