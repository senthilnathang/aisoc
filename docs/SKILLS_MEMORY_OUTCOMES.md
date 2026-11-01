# Investigation outcomes → Skills and Memory

Current approval contract: [independent proposer, approver and executor roles](INDEPENDENT_APPROVAL_ROLES.md). Outcome learning saves proposals; Memory requires independent approval before reuse, and responses require three distinct operators.

Implemented and locally verified on 2026-11-01. The Go control plane reuses existing
Skills and Enterprise Insights stores, matching and immutable application snapshots.
No model, external provider, new service or response authorization is introduced.

## Analyst workflow

1. Resolve or close a case with a reviewed `benign`, `suspicious`, `malicious` or
   `mitigated` determination, a primary entity and at least one stored artifact.
2. Open the case **Summary** or **Review → Outcome learning → Capture outcome learning**.
3. Select 1–10 supporting artifacts and write a review rationale. Choose either or both:
   - **Draft Skill:** name and reusable guidance. Initially disabled and scoped to
     investigations for the source case's primary entity. Publish through the
     existing Skills editor after reviewing its content and scope.
   - **Pending Memory:** analyst-written context, entity kind and expiry. A different operator’s explicit
     approval activates advisory context for the exact case entity. No benign/
     malicious hint is copied from the historical outcome; the hint is `none`.
4. Confirm the outcome, evidence and reuse scope, then **Save learning proposals**.
5. Follow the receipt to Skills or Memory. Both show source-case provenance; the
   expandable snapshot retains the original evidence, guidance/context and rationale.
6. Subsequent matching investigations record existing versioned application snapshots.
   Use **Transcript → Applied Skills → Helpful / Not helpful** and Memory's
   **investigations** usage link to review actual application and feedback.

This is manual, analyst-approved authoring from one reviewed case. It does not
replace or relax the existing two-case deterministic suggestion/prevalence gates.
An outcome is not automatically transferable to a later case. Matching records
context and guidance; it does not change a determination or execute an action.

## Reuse and boundaries

- `skills.MutateTx` and `insights.SaveTx` reuse validation, revision handling and
  audit within the owning proposal transaction. Ordinary store methods preserve
  their existing public contracts and own their transactions.
- `skills.Apply` continues to call `insights.Apply` for investigations. Memory
  matches the case's actual primary entity, ignoring case/surrounding spaces;
  published/enabled Skills use their existing scope matcher.
- New Skill application snapshots include `learning_origin`; Memory application
  snapshots already retain the full approved context document. Prior snapshots do
  not change when guidance is edited, disabled, deleted, archived or expires.
- New outcome-derived Skills are scoped to `investigations`, not automatically to
  hunts. Existing hunt Skill matching is unchanged. Memory/hunt application and
  model-assisted reasoning remain separate work.
- Approval now requires a separate configured approver and denies authors.
  Production identity provisioning remains an acceptance gate.

## Atomic approval and replay

```mermaid
sequenceDiagram
    participant UI as Investigation Review
    participant Go as Go learning module
    participant DB as PostgreSQL
    participant Match as Existing Skills/Memory matcher
    UI->>Go: Case revision + artifact IDs + authored text + explicit proposal
    Go->>DB: Lock tenant case; check immutable receipt
    Go->>DB: Verify reviewed outcome, current revision and case-owned evidence
    Go->>DB: Create disabled draft Skill and/or pending expiring Memory
    Go->>DB: Attach provenance + receipt + audit in the same transaction
    Go-->>UI: Saved receipt and output links
    UI->>Go: Independent operator publishes Skill / approves Memory
    Note over Go,Match: Later investigation creation/intake uses existing application path
    Match->>DB: Match entity/scope and record versioned snapshots
    Match-->>UI: Guidance/context and existing feedback/usage views
```

Migration **045** adds `case_learning`, keyed by
`(tenant_id, investigation_id, source_version)`. The canonical case revision and
sorted selected evidence IDs are part of the request hash. Identical retries
return the original receipt; altered content for an approved revision returns
`409 LEARNING_CONFLICT`. Changed case state before approval returns `409 CASE_CHANGED`.
No half-created outputs survive a failed audit or receipt transaction.

Source case and evidence are read from the authenticated tenant, not submitted
snapshots. Selected artifacts retain ID, bounded type/label/value and SHA-256 of
the stored JSON. The receipt retains case title, outcome, entity, revision,
approver, time, rationale and original authored outputs. It has no cascading
source/output foreign keys: source deletion or output deletion must not defeat
replay protection. Replaying after deletion returns the historical receipt and
never recreates output records; following a deleted record's link may return 404.

Reopening/changing/deleting the source case does **not** automatically revoke
previously approved outputs. Analysts must review and disable the Skill or archive
Memory when old conclusions are invalidated. Approval of a new case revision can
create new outputs; overlapping context from separate cases is not globally deduplicated.

## API contracts and limits

| Endpoint | Behavior |
|---|---|
| `GET /api/v1/investigations/{id}/learning` | Tenant-bound case, eligibility, latest 100 artifacts and latest 50 approval receipts |
| `POST /api/v1/investigations/{id}/learning` | Strict approval contract; atomically creates requested outputs and receipt |

POST fields: `expected_updated_at`, `evidence_ids`, `confirm: true`, `rationale`,
`create_skill`, `name`, `guidance`, `create_memory`, `memory_kind`, `context`,
`valid_until`. Unknown fields (including caller-provided tenant/provenance) are
rejected. Unselected output fields must be empty/omitted. Limits:

- Rationale 10–2000 characters; Skill name 1–200; guidance/context 10–8000.
- 1–10 distinct artifact IDs, all belonging to the source case; primary entity
  must be nonblank and at most 200 characters.
- Memory kind `user`, `network`, `software` or `other`; RFC3339 expiry after now
  and within one year. UI defaults to 30 days. Existing Memory editing/archiving
  controls remain authoritative after capture and may revise its validity range.
- HTTP body at most 1 MiB. Evidence excerpts are bounded to 2000 characters;
  the hash covers the complete stored artifact document.
- Registry/read windows are bounded, but approval receipts are not automatically
  pruned. Production retention and tenant deletion tooling must account for them.

Implementation: `backend-go/internal/modules/learning/learning.go`, existing
Skills/Insights transaction helpers, `investigations/queries/learning.sql` and
sqlc output, `internal/transport/httpapi/learning.go`, and
`frontend/src/OutcomeLearning.jsx`. Skills, Memory and Investigation screens share
provenance display. No additional queue, inference or orchestration path exists.

## Tests and local showcase

- `python3 scripts/framework/check_detection_intelligence.py`: disposable
  PostgreSQL race suite across modules/HTTP. New learning tests cover validation,
  concurrent replay, conflicting input, stale/foreign/fabricated evidence,
  ineligible outcomes, expiry bounds, final-audit failure rollback, draft gating,
  published matching, unrelated-entity exclusion, unchanged verdicts, archived
  Memory exclusion, immutable snapshots and deletion replay.
- `go vet ./internal/modules/... ./internal/transport/httpapi` and `make sqlc-check`
  from `backend-go`; frontend lint/build and all nine frontend Node checks.
- `scripts/framework/outcome-learning-demo-browser.js` exercises real local UI/API
  approval, draft publication, subsequent case snapshots, Helpful feedback and
  Memory usage links. It deliberately creates uniquely scoped synthetic cases,
  Memory and a published Skill, retaining them for demonstration. Local auth/demo
  tenant only; no live provider/model/response calls.
- `scripts/framework/outcome-learning-regression-browser.js` requires the demo
  case and intercepts approval writes. Covers failure/retry identity, stale-case
  conflict preservation, late response after closing, ineligible outcomes and
  keyboard/mobile approval controls.
- Desktop 1440px and mobile 390px browser checks; screenshots under ignored
  `output/playwright/outcome-learning-*.png`. Existing large frontend bundle warning
  remains; no production performance claim is made.

Retained local demo:
[source outcome](http://localhost:8080/investigations/INV-e3f93ab7?tab=review),
[follow-up application](http://localhost:8080/investigations/INV-5ce49359?tab=transcript),
[derived Skill](http://localhost:8080/skills/SK-1e466071-e9d5-4bc4-9563-4b6ad9e5d432).
Memory entity: `learning-demo-1793527157151`; insight
`EI-4d49a6d4-57ea-4014-8c14-a4074b7e9eba`. IDs belong to this installation.

## Rollout and rollback

Normal local startup applies additive migration 045. Deploy Go/frontend together.
Roll back application code while retaining the table, generated outputs and audits;
do not drop receipts to retry approval. Existing Skills/Memory APIs can still manage
outputs. Do not remove migration history or production data to undo this feature.

Staged revisions, source-change review and explicit reapproval/archive are now implemented; see [Skills/Memory lifecycle](SKILLS_MEMORY_LIFECYCLE.md).

Remaining: independent approver roles, Memory context for hunts, broader entity resolution, model/RAG quality evaluation and production retention.
