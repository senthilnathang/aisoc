# Mock QRadar flow (S05)

This milestone supplies synthetic SIEM input, a pure SOAR revision reducer and a
deterministic Go suspicious-login rule. It does not implement IBM wire payloads,
live polling, a background scheduler or SOAR write-back. Installed vendor versions,
permissions and replay guarantees still need verification in S11.

Run the offline demonstration from `backend-go`:

```bash
go run ./cmd/qradar-mock
```

Expected result: four synthetic authentication events, one `requires_review`
finding with four evidence references, mock SOAR states open → closed → reopened,
and zero response actions. This command uses no network, database or model.
It demonstrates separate components; it does not claim to synchronize that finding
to a SOAR case. The report includes an explicit mock label.

## Detection semantics

`telemetry.SuspiciousLogins` accepts at most 100 observations in an authoritative
snapshot. Three distinct failures must strictly precede a success within five
minutes, inclusive at the lower boundary. Principal, asset and canonical IP must
match. It uses the latest three failures, with identity as a deterministic tie
breaker. Input ordering and exact redelivery do not change the result.

The caller supplies an event-time completeness watermark. Successes beyond it are
not evaluated. There is no wall-clock timeout pretending missing data is complete.
Late evidence requires reevaluation of an authoritative snapshot. Revised evidence
may produce a different finding identity; S06 must persist lineage/admission rather
than silently replacing an analyst decision. Multiple revisions of the same source
observation are rejected for explicit source reconciliation. Opaque revision tokens
are never sorted lexically. Conflicting content under one identity is rejected.

This rule establishes a review candidate, not account compromise, unusual-IP
reputation or a benign verdict. No finding means only that this pattern did not
match. Missing IAM/EDR context remains investigation work in S07. Evidence references
are opaque mock identifiers, never instructions or URLs to fetch.

## SOAR boundary

`qradarmock.ApplyCase` models optimistic updates with an explicit previous-version
token. That field is a sandbox convention, not a claim about QRadar APIs. Duplicate
current revisions are no-ops; stale/conflicting revisions and cross-tenant/source
updates fail. A closed case must explicitly reopen before becoming active again.
The reducer is pure and keeps no durable case history. S06/S08 supply durable case
admission and conflict-aware reconciliation; SIEM telemetry never carries SOAR state.

## Verification and rollback

`python3 scripts/framework/check.py --with-streams` includes a real disposable
PostgreSQL/Redis test: accept the mock SIEM page, replay it with zero new events,
publish/read/ACK via S04, reconstruct committed observations and reproduce one
review finding. Its extra setup observation does not match the mock asset. Finding
generation follows a completed bounded snapshot. The S06 extension now admits that
finding durably and verifies replay returns the same case/job receipt; see
[finding admission](FINDING_ADMISSION.md).

Unit tests cover permutations, duplicates, foreign tenants, IP normalization,
asset/principal separation, window boundaries, equal timestamps, watermark limits,
conflicting revisions, and SOAR duplicate/update/reopen conflicts. Existing S04
failure tests remain in the suite. No throughput or production durability is claimed.

No schema, deployment or core startup change is required. Rollback removes use of
the optional mock/rule; existing services and stored data are unaffected.
S06 adds durable finding/case/job admission with bounded tenant scheduling.
Next: [S07](IMPLEMENTATION_TASKS.md), Python investigation and QA.
