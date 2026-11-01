# Skills workspace implementation plan

> Use superpowers:executing-plans to implement inline.

**Goal:** Reproduce the library and authoring layouts at https://7ai.com/platform/skills, preserving working AISOC guidance.
**Architecture:** React/Chakra UI, Go, PostgreSQL, sqlc/pgx. Preserve matching, material versioning, suggestions and outcomes. No new infrastructure, inference or privileged execution.
**Reference:** skills-1-main.png shows app.sevenai.com/skills; skills-2-okta-oauth.png and skills-3-mfa-fatigue.png show skill-specific editors. Other behavior is AISOC implementation, not verified vendor behavior.

- [x] Add sqlc library pagination/origin filters/totals and strict HTTP validation; atomic version-guarded save/publish and desired enablement. Preserve legacy routes.
- [x] Rework library and editor: custom/augmented tabs, filters/pagination/switches/import; metadata strip and files/instructions/relevance columns, safe preview, preserved materials/templates/outcomes.
- [x] Test tenant isolation, concurrent/stale edits, protected fields, audit rollback, page boundaries; run isolated PostgreSQL race suite, Go tests/vet, sqlc drift, frontend lint/build/tests and browser flows/mobile checks. Independent final review.
- [x] Update architecture/API/data/developer/test/navigation/roadmap/README documentation and commit.

## Review focus and rulings
Stale editors cannot overwrite newer instructions. Published edits update current guidance, not a separate draft; label clearly. Imports cannot change identity/origin/version. Empty/error libraries have no invented data. Delayed save cannot navigate after leaving. Import is bounded Markdown/text, not ZIP; safe text preview never executes HTML. Augmented means existing environment-generated drafts, not model activation. Existing autonomous authorization applies; retain current checkout.

## Execution record

Implemented on the existing checkout. All three public screenshots were inspected. No schema migration or infrastructure added. PostgreSQL race suite (including Skills/materials/applications), full Go race suite, final targeted Go tests/vet, sqlc drift, frontend lint/build and nine frontend test files passed. Browser checks passed for pagination, desired enablement, safe preview, atomic save, conflict form preservation, text import, failed-publish retry, unmounted save navigation, empty data and 1440/390px overflow. Local library API returned 200.

Independent review found a partial create/publish retry issue: fixed duplicate publish revisions and navigation to persisted draft on failure. Material revision changes deliberately retain conflict detection; explicit reload warns about losing unsaved edits. Existing frontend bundle warning remains (~909 KB minified). Browser validation was rerun after an initial run overlapped the owned backend restart; domain writes remained intercepted.
