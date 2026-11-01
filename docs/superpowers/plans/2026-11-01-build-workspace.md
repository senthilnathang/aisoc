# Build workspace implementation plan

> Execute inline with existing React/Chakra and Go/sqlc/pgx patterns.

**Reference:** Public 7AI platform “Build on 7AI” links to Skills. Verified skills library/editor screenshots and workflow canvas under Response; no standalone Build screenshot verified. `/build` is an AISOC composition of those established patterns, not a claimed vendor replica.
**Goal:** A real tenant-scoped Build asset library linking existing authoring/integration workflows, preserving every existing route and safety boundary.

- [x] Add a read-only sqlc projection over skills, workflow/runbook plans, API sources and connectors. Whitelist metadata; never serialize keys/config/credentials. Bounded filters/pagination, consistent totals and stable ordering. No migration.
- [x] Add `/build` as Build's first submenu with toolkit launch cards, asset-type filters/search, persisted catalog, metadata inspector and links to existing editors/managers. Preserve API sources/streams/connector routes. Do not create a duplicate orchestrator or enable external execution.
- [x] Verify tenant isolation, source expiry/revocation precedence, filtered totals beyond page boundaries, literal search, empty datasets, credential omission and strict HTTP contracts; test navigation, inspector and responsive browser layouts. Independent review.
- [x] Run isolated PostgreSQL/full Go race suite, sqlc drift/vet, frontend lint/build/tests; update README/architecture/developer/API/data/test/roadmap/navigation docs and commit.

## Boundaries
Catalog states are persisted configuration, not live provider health. Workflow and skill authoring reuse their existing approval/versioning contracts. Source creation/key rotation remains only in the existing source manager. Runbooks and workflows stay owned by Respond; Skills stays owned by Skills. No infrastructure, schema changes, credential discovery, production actions or model activation.

## Execution record

Implemented with no schema changes. Isolated PostgreSQL integration tests and full Go race suite passed; sqlc drift check and focused vet passed. Frontend lint/build and 9 navigation suites passed. Browser checks passed for page totals, metadata, read-only connectors, search, stale replies, desktop/mobile, errors/retry and manager navigation. Live local API returned 200 and 10 persisted assets, all rendered. Independent review identified the create-only Cribl wizard; all connector catalog entries now remain inspect-only. Existing Vite bundle-size warning remains; no new runtime errors observed during the final checks. Documentation updated across README, architecture, development, data, API, navigation, roadmap and tests.
