# Enterprise Insights implementation plan

> Use superpowers:executing-plans inline; preserve existing services.

**Goal:** Replace the sample-backed Memory investigation browser with the three public Enterprise Insights layouts and persisted tenant-scoped context.
**Reference:** https://7ai.com/platform/enterprise-insights, `insights-1-active.png`, `insights-2-7ai-generated.png`, `insights-3-prevalence-suggestions.png`; all show `/insight/enterprise-insights`. Keep AISOC `/memory` navigation.
**Architecture:** Add migration 040, Go insights module/sqlc projections, transactional CRUD/audit, immutable application snapshots through existing investigation Skills entrypoints. React/Chakra table/cards/dialogs. No model/service additions.

- [x] Persist insights with entity type/value, context, advisory determination, validity, origin and version. Version-guard edit/archive; tenant lock and atomic audit. Tests for validation, isolation, concurrency and audit rollback.
- [x] Implement summary, paginated active registry, deterministic case-context cards, reviewed-case prevalence suggestions, related-case use and audit. All counters sourced from stored data; no fabricated AI suggestions.
- [x] Apply active exact-entity matches during existing investigation guidance recording; retain immutable snapshots and idempotency by case/insight/version. Never change case verdict or execute actions. Test expiry/archive/foreign/duplicate behavior.
- [x] Build reference-based metrics/type distribution/use chart, tabbed table/cards, create/edit/archive/review dialogs and usage drilldown. Remove fallback Memory data. Test real browser flows and responsive layouts.
- [x] Run Go race/integration, sqlc drift/vet, frontend lint/build/tests; independent review; update README/architecture/developer/API/data/testing/roadmap/navigation docs and commit.

## Scope decisions
Generated cards are explicitly deterministic case summaries, not AI inference. AI Suggestions honestly reports no configured model. Prevalence requires at least two reviewed cases and analyst review before saving. Matching is exact case-insensitive trimmed entity text, not wildcards or fuzzy identity resolution. Insight hints are advisory. Archive preserves history. Existing historical cases are not retroactively marked as having used context. No production actions or infrastructure.

## Execution record

Reviewed all three public images and implemented the table/cards/prevalence layouts on `/memory`. Migration 040 was applied to the owned local foundation; no infrastructure added. The local API returned 200 for active/generated/prevalence/audit. There are 11 generated entity summaries from existing demo cases and no seeded insights.

Verification passed: full Go race suite; isolated PostgreSQL race suite with snapshots, replay, tenant isolation, exact-value matching, concurrent archive lock and audit rollback; sqlc drift and Go vet; frontend lint/build and nine frontend test files; browser fixtures covering 12 workflow/layout/error cases at 1440/390px. Domain browser writes were intercepted. Existing minified bundle warning remains (~915 KB).

Independent review found evidence types/labels were initially mixed with actual entity values. Added dedicated `InsightEntities` plumbing and regression tests; reviewer verified the fix. Final browser assertions use accessible textbox roles (required-field labels include decorative markers). React lint identified a render-local accumulator in the type-chart calculation; replaced it with a pure projection. Visual QA fixed selected-tab contrast and preserved zero-use days in the histogram.
