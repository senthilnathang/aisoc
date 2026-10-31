# Detection Coverage

Implemented 2026-10-31 from the reviewed [Coverage screenshot](https://47518862.fs1.hubspotusercontent-na1.net/hubfs/47518862/02-coverage-browser.png). Open http://localhost:8080/detect/coverage, or the pictured `/detect/detection-coverage` alias. Detect → Overview remains the first submenu. The Overview card now links here instead of presenting its old static 78% example.

## Screen and workflow

The white coverage workspace contains a 14-axis radar, radar/table toggle, verified-coverage/mapping selector and Create detection rule action. Select a tactic to inspect its technique/sub-technique entries, filter assessment states, open mapped rules, create a disabled mapped rule, or record an assessment. The table provides exact counts and an accessible alternative to the radar. On narrow screens the chart/table scroll within their containers.

The reference is **Enterprise ATT&CK v17.1**, deliberately pinned to the screenshot's 14-tactic layout, not asserted to be the latest release. It contains 679 active technique/sub-technique entries. Raw STIX comes from [MITRE's official repository](https://github.com/mitre-attack/attack-stix-data/blob/master/enterprise-attack/enterprise-attack-17.1.json). Revoked/deprecated entries are excluded, and tactic relationships/order come from that snapshot. No parent/sub-technique coverage is inherited. Unknown rule tags are reported and excluded from calculations.

## What percentages mean

For each tactic:

- `total`: all active pinned technique/sub-technique entries associated with that tactic. A technique may belong to multiple tactics, so do not sum tactic totals as unique techniques.
- `eligible`: total minus **current** not-applicable decisions. This is a conservative catalog-relative denominator, not a tailored inventory of threats applicable to the environment.
- `covered`: current analyst-verified entries with evidence reference and the same enabled, exactly mapped rule version that was reviewed.
- `coverage_percent`: covered / eligible × 100, rounded to one decimal. Null when no current assessments exist for that tactic, or eligible is zero. Unassessed, expired and stale entries stay in the denominator.
- `mapping_percent`: entries with at least one enabled exactly mapped rule / total × 100. This is independent of assessment/applicability and is **not verified detection coverage**. Duplicate tags and multiple matching rules do not double-count a technique.

The radar uses dashes for unknown scores and does not draw a filled polygon through unknown axes. No default fixture percentages are inserted. A new tenant normally shows **No current assessments**. Accepted risk and alternative controls never increase the verified count. Marking a technique not applicable excludes it only while its review is current; that decision requires a rationale and evidence/approval reference.

## Assessments and security boundary

States: `unassessed`, `gap`, `covered`, `accepted_risk`, `alternative_control`, `not_applicable`. Derived states `expired` and `stale` are computed on reads, not written by callers. Assessments have a reviewer, timestamp, expiry, evidence/approval reference, rationale, reference version and optimistic version. A covered assessment also binds one rule ID and exact version.

`covered` requires an enabled tenant-owned rule with the exact technique tag at the submitted version. The Go transaction locks that rule during validation. Any later rule version change, disablement, deletion or removal of the tag makes coverage stale on the next read. Metadata-only rule changes conservatively require re-review too. Review expiry must be in the future and within 366 days. The form suggests 90 days for new assessments; editing preserves the original expiry until explicitly changed.

Evidence references are **manual analyst attestations**, stored as text. They are not fetched, authenticated, or automatically replayed. This workflow does not prove that the referenced test passed, grant response authorization, or implement a separate risk-approval system. Accepted-risk references should point to the organization's existing approval record.

Authenticated operator identity supplies the reviewer; callers cannot choose it in the body. Existing local/token/session authorization governs access; this change adds no separate reviewer role hierarchy. All reads, mappings, writes and history are tenant-scoped. Assessment upsert and audit event commit atomically. A stale expected version returns 409; the UI keeps the draft and offers an explicit reload. Audit retains state, reference, rule version, evidence, rationale, actor and expiry.

## APIs and persistence

| Endpoint | Contract |
|---|---|
| `GET /api/v1/detection-coverage` | Reference provenance/license, snapshot timestamp, tactic aggregates, technique rows/mappings/assessments, unrecognized tags. No query parameters. |
| `PUT /api/v1/detection-coverage/{technique_id}` | Strict body below; returns the saved version. New assessment uses expected_version=0; updates require the current version. |
| `GET /api/v1/detection-coverage/{technique_id}/history` | Existing tenant-scoped resource audit representation for the pinned reference. |

```json
{
  "reference_version": "17.1",
  "state": "covered",
  "evidence_ref": "test-report:example",
  "notes": "Analyst observed the expected alert in the sandbox test.",
  "rule_id": "RULE-example",
  "rule_version": 3,
  "expected_version": 0,
  "expires_at": "2027-01-29T23:59:59Z"
}
```

This is illustrative, not a live assessment. Non-covered states clear the rule binding. Rationale is required except for unassessed; evidence/approval reference is required for covered, accepted risk, alternative control and not applicable.

Additive migration `033_detection_coverage.sql` adds `detection_coverage_assessments`, keyed by tenant + reference version + technique. No existing records are rewritten. sqlc queries in `detection/queries/coverage.sql` provide a single-snapshot read and CAS upsert; Go computes deterministic status and tactic projections from the embedded reference. Tenant creation and audit follow existing transaction patterns.

## Reference maintenance and attribution

`backend-go/internal/modules/detection/reference/enterprise-17.1.json` is a reduced, embedded snapshot of IDs, names, URLs, tactic relationships and sub-technique flags. The original source SHA-256 is `0d1c347a4d584cf7e11ef46556c33b7689341443bf86299188d46c307274323b`. The adjacent MITRE license is embedded and available in the UI's Reference provenance section.

Reproduce using `python3 scripts/framework/extract_attack_reference.py INPUT_STIX OUTPUT_JSON`. The extractor checks the collection version and exact pinned input hash. It performs no network access. Updating the reference requires explicit dataset/provenance review and a new assessment-version boundary; do not silently relabel old assessments or fetch live data on requests.

## Tests and rollback

- `python3 scripts/framework/check_detection_intelligence.py`: disposable PostgreSQL with race detection, migration, assessment persistence, optimistic conflicts, foreign rule/tenant rejection, required evidence, expiry bounds, integer bounds, atomic audit rollback and existing detection regression tests.
- Projection tests: 14/679 reference counts, duplicate/exact mappings, unknown tags, null unassessed scores, stale rule changes, disabled rules, expiry, accepted risk/alternative exclusion and not-applicable denominator.
- `node --test tests/frontend/*.test.mjs`: radar geometry and existing frontend tests.
- `scripts/framework/detection-coverage-browser-check.js`: read-only local browser workflow; PUT intercepted. Covers pinned data, isolation, mapping gate, conflicts, disabled-rule form, desktop/tablet/mobile and error/retry. Actual writes are verified only in disposable PostgreSQL.
- Frontend lint/build, sqlc diff, Go vet and compiled-preview browser verification.

Rollback restores prior Go/frontend binaries while retaining the additive table and audit history. Do not drop assessment data to roll back the UI. No production actions, automatic rule enablement, or throughput claims are introduced. Large deployments may need measured projection caching/pagination; this local foundation returns the complete pinned matrix.

### Verified result (2026-10-31)

Passed: disposable PostgreSQL migration/assessment suite with race detection, HTTP validation tests, eight frontend test files, ESLint, production build, sqlc generated-code diff and Go vet. Browser workflows passed on development and compiled preview builds at 1440/768/375px, including a filled-radar fixture, unassessed tenant isolation, conflict handling, exact expiry preservation, create-rule defaults and failure/retry. Independent review found no blocking issues; its expiry-renewal observation was corrected and covered by a browser regression. MITRE reference extraction reproduces the committed JSON byte-for-byte. The existing application-wide JavaScript chunk-size warning remains.
