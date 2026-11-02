# Hunt Workspace Implementation Plan

> Use superpowers:executing-plans for native implementation and a fresh review before completion.

**Goal:** Implement the four public threat-hunting screenshots using real local evidence.
**Architecture:** Preserve legacy hunt CRUD/simulation for compatibility; the new UI uses a separate bounded literal-search endpoint with durable receipts. Go owns tenant-scoped search and audit; no external queries or LLM calls.
**Stack:** React/Chakra, Go, PostgreSQL, sqlc/pgx.
**Reference:** https://7ai.com/platform/threat-hunting; registry, TI table, detail Entities and Findings images reviewed 2026-11-01.

- [x] Add typed local search receipt and analyst-note persistence, idempotency and tenant isolation tests.
- [x] Add sqlc queries and Go HTTP search/workspace/note endpoints; preserve legacy simulation boundaries.
- [x] Replace sample Hunt dashboard with registry/TI table and routed three-panel workspace; real filters, creation, notes, entities/findings and evidence links.
- [x] Add breadcrumbs, responsive browser checks, database race/contract tests and documentation; commit tested changes.

Review focus: empty data must stay empty; missing matches are inconclusive; old simulation counts never appear as verified findings; concurrent edits/retries preserve snapshots; tenant identity comes from auth; evidence text is never executable; scans and returned results are bounded and visible.

## Execution record

Completed in the existing checkout. Ruling: preserve the legacy simulation API for compatibility but remove its generated findings and sample metrics from the new screens. New search is explicitly bounded literal evidence matching; conversation is analyst notes, not an unconfigured LLM. Screenshot report metadata absent from the schema is not invented.

Verification: isolated PostgreSQL race suite passed across detection/routing/investigations/intake/response/hunts/navigation/HTTP; sqlc drift and Go vet passed; frontend lint/build and nine frontend test files passed; browser fixture checks passed at 1440 and 390 pixels. Review identified historical query misattribution; selected receipt phrase is now displayed beside results and tested after query changes and historical selection. Production bundle retains the existing size warning. No production execution, provider queries or model calls enabled.
