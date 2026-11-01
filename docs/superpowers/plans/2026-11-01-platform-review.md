# Detect-to-Build verification plan

Scope: existing local React/Chakra screens and Go/PostgreSQL APIs. Preserve local-only operation and sandbox responses; no live providers or new infrastructure.

- [x] Inventory every primary/submenu route and detail route. Run live read-only desktop/mobile checks, record API errors and layout failures.
- [x] Run workspace interaction fixtures plus isolated PostgreSQL integration tests and full Go race suite. Expand missing regression coverage where failures expose gaps.
- [x] Reproduce defects, trace their cause, add regression checks, fix minimally, then independently review changes.
- [x] Rebuild and verify corrected local flows. Update test report, developer/architecture/README/roadmap documentation with measured scope and remaining external dependencies.
- [x] Commit and push the current branch without force; verify remote head.

## Execution record

32 live routes × two viewports passed; all workspace interaction suites, navigation, breadcrumbs and six cross-workspace regressions passed. Isolated PostgreSQL, full Go race/vet/sqlc checks, frontend lint/build/nine test files and documentation links passed. Final Redis/Go/Python/Rust framework run passed after updating stale Skills audit and Detection Intelligence contract fixtures; initial cache-availability failure is documented in the review report. Independent review found no remaining blocking issues. Local services use the final code. Commit and non-force push target the existing codex/react-19-migration branch.
