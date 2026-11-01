# Investigate → Detect feedback

Implemented for local/mock integrations on 2026-11-01. Analysts can review source alerts in an investigation, save explicit labels, and follow the associated rule into the existing recommendation, validation, replay and guarded local-application workflow.

## Analyst workflow

1. Open an investigation's Summary or Review tab, then **Detection feedback**.
2. Inspect each alert's source, entity, summary, rule and existing reviewer/rationale. Labels are independent of the case determination: a benign case is not automatically a false-positive alert.
3. Select **Review source alert label**, choose true positive, false positive or unreviewed, supply rationale and explicitly confirm review. Save uses the displayed label version. Conflicts preserve the draft; cancel and refresh before reconsidering a newer version.
4. Follow **Review rule recommendations**. The existing engine needs explicit TP and FP evidence and protects unreviewed alerts. Generate, validate and replay a proposal.
5. Only a disabled, provider-unbound local rule can accept a fresh passing replay. **Apply locally** requires another confirmation, creates a rule version and leaves the rule disabled. Provider synchronization remains unavailable.

This changes local query metadata, not an active telemetry filter or deployed provider query. Replay covers up to 500 stored triggered alerts; it cannot estimate missed attacks outside the sample. Changing labels, evidence or the rule invalidates the corresponding frozen replay; regenerate against current evidence. Receipts expire after 24 hours.

Cases without linked source alerts (including some manually created or hunt-promoted cases) show an empty state. They do not fabricate alert/rule relationships. The UI pages 25 alerts; the API supports up to 100 per request.

```mermaid
sequenceDiagram
    actor Analyst
    participant Case as Investigation UI
    participant Go as Go API
    participant PG as PostgreSQL
    participant Rule as Existing recommendations
    Analyst->>Case: Review source evidence + confirm label
    Case->>Go: PUT case/alert label + expected_version
    Go->>PG: Verify tenant/case/alert; lock rule then alert
    Go->>PG: Atomic label + rule audit + case audit
    Go-->>Case: New label version; refresh case history
    Analyst->>Rule: Generate, validate, replay
    Rule->>PG: Frozen evidence/label versions and receipt
    Analyst->>Rule: Confirm local apply
    Rule->>PG: Recheck guards; new disabled rule version + audit
```

## API and implementation

- `GET /api/v1/investigations/{id}/detection-feedback?limit=25&offset=0` returns `{case,items,total,limit,offset}` from a consistent read transaction. Limit 1–100, offset 0–1,000,000; unknown or duplicate query parameters are rejected.
- `PUT /api/v1/investigations/{id}/detection-feedback/{alert}` accepts only `label`, `rationale`, `expected_version` and `confirm`. Confirmation must be true and version explicitly supplied (0 for an unreviewed alert without a label row). Concurrent stale writes return 409. Repeating a saved version does not silently overwrite it.
- Tenant and reviewer come from authenticated context. Rule identity is derived from the tenant/case-bound source alert, never supplied by the caller. Foreign or unrelated alerts are rejected.
- `backend-go/internal/modules/detection/case_feedback.go` uses sqlc queries in `queries/case_feedback.sql`, generated into `detectionsql/case_feedback.sql.go`.
- `recommendations.go` shares validation and the transactional label mutation with the original rule endpoint. Both audits and the label commit together; any audit failure rolls back all effects.
- `frontend/src/CaseDetectionFeedback.jsx` reuses `AlertLabelReview` from `RuleRecommendations.jsx`. Successful saves refresh case history; requests completing after navigation cannot update an obsolete panel.
- No migration, infrastructure addition or worker changes. Existing migration 034 tables and source-alert indexes are reused. No Python model, external provider or privileged action is invoked by labelling.

## Validation and local demonstration

`python3 scripts/framework/check_detection_intelligence.py` runs disposable PostgreSQL module/HTTP tests. New tests cover tenant and case ownership, pagination, explicit approval/version validation, concurrent label conflicts, audit rollback, unchanged case verdicts, stale replay after label edits, successful local apply and idempotent application. Existing recommendation tests continue to cover provider bindings, enabled rules and expired/stale receipts.

Run `scripts/framework/case-detection-feedback-browser-check.js` with the Playwright browser code tool on the local app. It intercepts mutations and checks explicit confirmation, 503/409 draft preservation, scoped versioned requests, pagination and desktop/mobile overflow. Run `rule-recommendations-browser-check.js` for the existing replay/apply regression. Both passed, as did frontend lint/build, nine frontend tests and the disposable database suite. The existing large frontend bundle warning remains.

A real local API/browser demonstration retained three synthetic JSON alerts (one FP, one TP, one unreviewed):

- Case: `/investigations/INV-06a345e6-e6c3-4a2b-a807-0f2da716af04?tab=review`
- Rule: `/detect/rules/RULE-71ec782c?tab=recommendations`
- Replay: 3 alerts; 1/1 FP removed; 0 TP and 0 unreviewed removed. Confirmed application produced disabled version 3. These IDs are local demo data, not portable fixtures or evidence of live-provider behavior.

## Rollback and remaining boundaries

Revert the case panel/routes and shared-helper refactor to remove this entry point without dropping stored labels or audit history. Use existing rule version history for an explicitly reviewed local query restoration. Do not delete audit records or enable a rule as part of rollback.

Production provider deployment, calibrated detection-quality evaluation and investigation-model validation remain separate work. No automatic tuning, auto-labelling from verdicts, provider write-back or production containment is enabled by this slice.

## Repeatable browser coverage

This workflow is now included in the fresh-fixture local/mock browser release gate, alongside API acceptance and backup recovery. See [critical workflow actions, assertions and verified results](BROWSER_RELEASE_GATE.md#critical-workflow-stages). No live provider execution is enabled.
