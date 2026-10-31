# Detection Rules implementation plan

Approved scope: reproduce reviewed Rules screenshot using existing Go/React/Chakra architecture. Preserve CRUD, versions, audit, source bindings and local-only operation. Recommendations execution and assessed ATT&CK coverage are later screens.

- [x] Add sqlc registry window projection and rule metrics endpoint with tenant predicates, literal search, bounded pagination, parameterized sorting and explicit 7/30/90-day periods. Keep omitted-days all-time compatibility. Test old/future alerts, distinct cases, sparse rules, foreign tenants, filters and page-independent summaries.
- [x] Serve versioned metadata catalog from Go; template selection opens existing disabled-rule create form. No executable query or detection-engine deployment claim.
- [x] Rebuild table/KPI layout and inspector; retain edit/clone/delete/history. Persist selection, panel tab and filters in query parameters; add pictured route alias. Show FPR and efficacy as unknown, label mapped-rule percentage distinctly.
- [x] Test API and browser interactions, mobile/deep links/Back, error states and existing breadcrumb workflow; run production build and review. Update docs with contracts, limitations, test results and rollback.

Files: detection/queries/registry_window.sql, registry_window.go, catalog.go/json; HTTP detection.go/detection_registry.go; DetectionRegistry.jsx, ruleNavigation.js, detection-rules.css, CreateDetectionRule.jsx; integration/browser tests and docs/DETECTION_RULES.md. No migrations or infrastructure additions. Rollback restores binaries/static assets; stored rules remain compatible.
