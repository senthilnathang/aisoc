# Detection Rules

Implemented 2026-10-31 from the reviewed [Detection Rules screenshot](https://47518862.fs1.hubspotusercontent-na1.net/hubfs/47518862/03-rules-browser.png). Uses the existing React/Chakra UI and Go backend; no new infrastructure, schema migration, provider activation or automated response.

## UI and navigation

Open http://localhost:8080/detect/rules. `/detect/detection-rules` is an alias matching the pictured route. Existing `/detect/rules/{id}` full-page details still work.

The workspace has registry-rule, triggered-alert and mapped-rule KPIs; search and filters; Detection Rules/Catalog tabs; Name, MITRE, Execution, Status, Detections, Investigations and FP share columns; and a selected-rule inspector. The inspector contains 7/30/90-day metrics, determination distribution, Rule Details, Recommendations, History and Versions. Existing version-checked editing, enable/disable, disabled cloning, guarded deletion and audit history are retained. Query/schedule fields are registry configuration, not an external query engine deployment.

Selection and filters persist in the URL, for example:

```text
/detect/rules?rule=mock-stream-login&days=30&tab=history&search=login
```

Supported panel tabs: `details`, `recommendations`, `history`, `versions`. Catalog uses `catalog=true`. Search, severity, enabled, source, sort, direction, limit and offset are query parameters. Closing the inspector preserves filters; reload and browser Back restore selection/tab. On mobile the inspector appears above the registry and receives focus/scroll on selection. The table scrolls horizontally within its container. Changing metrics periods preserves unsaved form edits.

## Metrics and screenshot differences

- Registry Rules counts **all rules matching the filters**, independent of pagination.
- Triggered Alerts counts received alerts for those rules within the chosen rolling UTC window. Future timestamps are excluded.
- Detections is the per-rule alert count. Investigations and determination distribution count **distinct tenant-owned linked cases**, even when multiple alerts refer to the same case. A case linked to different rules can appear in each rule's metrics.
- Daily average is detections / selected number of 24-hour days, rounded to one decimal.
- **Rules with MITRE mappings** is the percentage of matching rules carrying technique tags. This is not ATT&CK technique coverage or measured detection effectiveness. See [Coverage](DETECTION_COVERAGE.md) for explicit evidence-backed assessments.
- Period FP share now uses explicit analyst labels; it stays null/Not assessed until reviewed. Benign determinations are not false-positive labels. The legacy all-time API remains unchanged.
- [Recommendations](RULE_RECOMMENDATIONS.md) now provides persisted local proposals, syntax/replay receipts and guarded apply/dismiss. Provider validation/synchronization remains future work.
- The Catalog exposes ten existing local starter metadata templates through Go. They are not downloaded vendor detections or production-ready queries. Use template populates the normal create form; query starts empty and creation is disabled by default.
- Source filters select rules with a matching provider binding or historical source; their metrics include all of the selected rules' alerts in the requested window. Source bindings/history in the inspector remains explicitly all-time.

The UI keeps AISOC navigation and branding. It does not copy the reference's example counts, vendor labels, measured FPR or unverified coverage percentage.

## Backend contracts

| API | Behavior |
|---|---|
| `GET /api/v1/detection-registry?days=30` | Optional `days` is an integer 1–90. Returns period-specific rule items, `summary`, `days`, `as_of`, `window_start`, total/limit/offset and source choices. Existing search/severity/enabled/source/sort/direction/pagination filters remain supported. |
| `GET /api/v1/detection-registry` | Omitted `days` preserves the existing all-time response and sorting behavior for older consumers. |
| `GET /api/v1/detection-rules/{id}/metrics?days=30` | Defaults to 30 days; returns one rule's window projection. Missing/foreign rule is 404. Only days is accepted. |
| `GET /api/v1/detection-catalog?search=...` | Versioned read-only local metadata catalog. Literal case-insensitive search; no customer data. Only search is accepted. |
| Existing rule detail/CRUD/history endpoints | Remain compatible, including expected-version conflicts, audit transactions, clone-disabled defaults and reference guards. |

The window projection is one sqlc/pgx statement in `backend-go/internal/modules/detection/queries/registry_window.sql`. It uses authenticated tenant predicates on rules, alerts, cases and source bindings; a consistent snapshot/time cutoff; typed parameters; allowlisted sort branches; deterministic ID tie-breaking; and server-side pagination (1–100). New period search uses PostgreSQL case folding and literal substring matching; legacy all-time search retains ASCII compatibility. The detail metadata and window metrics are fetched separately; their timestamps are not a single cross-request transaction.

`summary` contains `registry_rules`, `triggered_alerts`, `mapped_rules`, `mitre_coverage: null`. Per-rule window items contain `daily_average`, `period: "30_days"` (or selected days), actual counts and outcomes. Catalog metadata is embedded from `catalog.json`, carries catalog/entry versions and `kind: metadata_only`. Created rules are ordinary editable rules; template identity is not separately persisted.

## Verification and release

- `python3 scripts/framework/check_detection_intelligence.py`: disposable PostgreSQL, race-enabled detection and HTTP tests. Covers old/future timestamps, shared-case deduplication, page-independent summaries, source/search filters, tenant isolation, legacy API compatibility, version conflicts, disabled clone, referenced delete guard, catalog shape, and existing audit rollback tests.
- `node --test tests/frontend/*.test.mjs`: includes query-state round trips, bounded defaults, compiler/build and existing frontend tests.
- `scripts/framework/detection-rules-browser-check.js`: live read-only API checks, deep-link reload/Back, catalog form defaults (POST intercepted), 1440/768/375px layouts, unsaved-edit preservation and failure/retry.
- Existing breadcrumb browser suite exercises rule navigation and intercepted rename refresh after these changes.
- Run frontend lint/build, sqlc diff, Go vet and the compiled-preview browser suite before release.

No demo records are changed by browser validation. No scalability/throughput claim is made for this dashboard. The existing application-wide build warning for large chunks remains. Rollback is restoring previous Go/frontend binaries. The subsequent Recommendations extension adds migration 034; retain its evidence tables on application rollback.

### Verified result (2026-10-31)

Passed: disposable PostgreSQL detection tests with race detection, new HTTP query tests, seven frontend test files, ESLint, production build, sqlc generated-code diff, and Go vet. The new browser suite passed on development and compiled preview builds at 1440/768/375px; the existing breadcrumb suite passed including intercepted rule rename. Independent review identified draft loss on period change; separate metrics loading fixed it and the regression is included in browser checks. Visual inspection also corrected pagination button contrast on the dark footer.
