# Detection Coverage implementation plan

Approved scope: screenshot's 14-tactic radar, chart/table toggle, tactic/technique drill-down, and rule creation; real tenant-scoped assessment state, never sample percentages.

- [x] Pin official Enterprise ATT&CK v17.1 (14-tactic screenshot-compatible reference, not claimed latest); vendor only IDs/names/tactic mappings plus provenance/hash/license and reproducible extraction script.
- [x] Add assessment table with versioned optimistic writes, authenticated reviewer, evidence reference, optional validated rule/version, review expiry and atomic audit. Add sqlc read/write contracts and Go projection. Verified coverage requires current enabled mapped rule at assessed version, evidence and unexpired review. Accepted risk/alternative control are not detections.
- [x] Build Chakra radar/table/detail UI and assessment form; preserve existing rule flows and add Coverage navigation + pictured alias. Unknown/expired/stale states stay visible; no fabricated denominator or inherited parent/sub-technique coverage.
- [x] Verify isolated PostgreSQL writes/conflicts/isolation/audit and projection edge cases, frontend geometry and browser interactions at desktop/mobile, production build; review and update docs.

Denominator: all active pinned technique/sub-technique entries for a tactic, minus currently reviewed not-applicable entries. Unassessed/expired/stale entries remain in denominator. No current assessments means unknown, not a zero-percent efficacy claim. This conservative catalog-relative measure is not environmental ATT&CK applicability or an automated test result.

No external containment or rule activation. Additive migration only; rollback restores app binaries while retaining new table. Reference upgrade requires deliberate review, never automatic live fetch.
