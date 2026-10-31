# Rule Recommendations

Implemented locally on 2026-10-31 from the reviewed [reference screenshot](https://47518862.fs1.hubspotusercontent-na1.net/hubfs/47518862/04-recommendations-browser.png). React/Chakra renders the selected rule inspector; Go owns generation, validation, replay and writes through sqlc/pgx. No model inference, provider query execution, synchronization or response activation is implied.

## Open and use

Open `http://localhost:8080/detect/rules?rule=mock-stream-login&tab=recommendations`. The pictured `/detect/detection-rules/recommendations?rule=mock-stream-login` alias selects the same tab. Recommendations remains inside Rules rather than becoming a separate main menu.

1. Review alert evidence and explicitly label true positives and false positives with a rationale. Existing demo alerts remain unreviewed; case verdicts never manufacture labels.
2. Select a 7/30/90-day period. Generate suggestions derives up to three deterministic exact-match exclusions from reviewed source/entity values. At least one true-positive baseline must exist, at least one false positive must be removed, and no true-positive or unreviewed alert may be removed.
3. Inspect the original query, proposed local predicate, explanation, base version and frozen window. Validate Query checks only the local dialect. Test Query replays stored triggered alerts and records counts and a receipt.
4. Apply locally requires explicit confirmation, a disabled rule with no API-source binding, an unchanged rule version and evidence snapshot, and a passing receipt under 24 hours old. It creates a rule version and snapshot but leaves the rule disabled. Dismiss closes a pending proposal. Both terminal actions are idempotent.

Disable before generating a proposal intended for application: enable/disable changes the rule version. Changed versions or labels require regeneration. Expired receipts require another replay. A previously applied local exclusion requires a new provider-supported baseline before further tuning. Provider-bound rules cannot use local Apply; Sync Now remains disabled.

## Metrics and scope

FP share is `explicit false positives / (explicit false positives + explicit true positives)` among received triggered alerts in the selected rolling UTC window. It is not the statistical false-positive rate `FP / (FP + TN)`. No reviewed alerts means null/Not assessed. Confidence is Not calibrated. Source severity is rule metadata. Registry and period metrics use the same labels; the legacy all-time registry contract remains unchanged.

Generation freezes at most 500 alerts, ordered by received time and ID. Over-budget windows are rejected, never silently sampled for generation. The UI shows up to 500 alerts, ten per page, and the latest 30 proposals. API windows support 1–90 days. A sample hash includes normalized alert metadata, label versions, reviewers and rationale. Test/apply reread the frozen window and reject evidence changes. Later alerts outside that window are not part of the receipt.

Replay treats stored triggered alerts as the baseline; it does not execute the original provider query or measure missed attacks outside that sample. Suggestions are deterministic and sensitive to analyst label quality, not AI diagnoses. The local query is configuration for this replay harness only:

```json
{"dialect":"aisoc-exclusion-v1","field":"source","value":"reviewed-scanner"}
```

Only `source` and `primary_entity` literal equality exclusions are supported. SQL/KQL/AQL, additional fields and trailing JSON are rejected. Applying replaces the local query with this predicate; the original query remains in proposal and version history. No provider receives the query.

## API and persistence

All paths below are under `/api/v1/detection-rules/{id}`. Tenant and actor originate in existing auth middleware. Unknown fields/query parameters are rejected.

| Method/path | Input/result |
|---|---|
| GET `/recommendations?days=30` | Owned rule, period statistics, bounded alerts, proposal metadata/receipts, current version, dialect and unsupported sync marker |
| PUT `/alert-labels/{alert}` | `label`, nonempty `rationale` (max 2,000 bytes), `expected_version` (0 initially); optimistic label update |
| POST `/recommendations/generate` | `days`, `expected_version`; deduplicated immutable proposals and count created |
| POST `/recommendations/{recommendation}/{validate,test,apply,dismiss}` | Empty JSON object; authenticated action, guard failures return 409 |

Migration `034_rule_recommendations.sql` adds tenant-keyed `detection_alert_labels` and `detection_rule_recommendations`. Proposals store base query/version, bounded evidence snapshot/hash, window, actor, status and receipts. Unique generation keys include tenant, rule, base version, sample hash and proposed query. Rule row locking serializes label changes and recommendation mutations with existing rule edits. Apply updates rule/version, version snapshot, proposal status and audit in one PostgreSQL transaction. An audit failure rolls back all changes. Applied/dismissed retries return idempotent success without another audit/version.

```mermaid
sequenceDiagram
  participant UI as React rule inspector
  participant Go as Go detection module
  participant PG as PostgreSQL via sqlc/pgx
  UI->>Go: Explicit labels + rationale + expected version
  Go->>PG: Lock owned rule; CAS label + audit
  UI->>Go: Generate for current rule version/window
  Go->>PG: Freeze bounded sample; store safe proposals + audit
  UI->>Go: Validate / Test Query
  Go->>PG: Check evidence hash; store replay receipt + audit
  UI->>Go: Confirm local apply
  Go->>PG: Lock; check receipt, version, disabled/unbound
  Go->>PG: Atomic query/version/snapshot/status/audit commit
  Go-->>UI: Applied locally, still disabled
```

Code: `frontend/src/RuleRecommendations.jsx`, `rule-recommendations.css`; `backend-go/internal/modules/detection/recommendation_engine.go`, `recommendations.go`, `queries/recommendations.sql`; `backend-go/internal/transport/httpapi/rule_recommendations.go`. Generated SQL belongs in `detectionsql`; edit SQL source and run `make -C backend-go sqlc`.

## Verification and rollback

- `python3 scripts/framework/check_detection_intelligence.py`: disposable PostgreSQL with race detection. Tests tenant isolation, label CAS, denominator semantics, generation dedup/cap, unknown/TP preservation, stale labels/rules, disabled/unbound guards, receipt expiry, audit rollback and concurrent idempotent apply.
- `node --test tests/frontend/*.test.mjs`, frontend ESLint/build, `make -C backend-go sqlc-check`, and Go vet.
- `scripts/framework/rule-recommendations-browser-check.js`: real read-only API/foreign-tenant checks plus intercepted mutations for label conflict/draft preservation, syntax/replay/apply confirmation, dismissal, disabled Sync and 1440/768/375px layouts. Run through Playwright on local 8080 and compiled preview 8084. Demo data is not changed by this browser suite.
- Existing Rules browser regression covers registry, catalog, routing state and unsaved edit preservation.

Migration is additive. Roll back application binaries while retaining tables and audit; do not drop evidence to roll back the UI. Applied local queries can be restored through existing version-checked rule editing using their saved original query; keep the rule disabled. Applying a new version can invalidate prior coverage assessments, requiring re-review.

No new infrastructure or throughput claims. Pending: provider-specific validators/replay and authorized sync, calibrated model-assisted drafting, larger sample evaluation and a dedicated proposal/evidence retention policy. Current evidence snapshots remain in PostgreSQL; include them in existing database backup/retention governance. The pre-existing large frontend bundle warning remains.

### Verified result (2026-11-01)

Passed: race-enabled disposable PostgreSQL detection/HTTP tests, eight frontend test files, ESLint, production build, sqlc generated-code diff and Go vet. Recommendation workflow and existing Rules browser suites passed on the local development and compiled preview builds. Browser mutations were intercepted; database mutation tests ran in the disposable cluster. Independent review prompted explicit UI guards for expired receipts and provider-bound rules, now covered by the browser suite. Additive migration 034 is applied to the local backend.
