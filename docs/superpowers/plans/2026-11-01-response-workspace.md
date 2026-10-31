# Response Workspace Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement task-by-task.

**Goal:** Adapt the Cases, Remediation Actions, workflow canvas and Runbooks screens from https://7ai.com/platform/response to AISOC's real records and local-only response boundary.

**Architecture:** Preserve the existing versioned response plans, case edits, approvals and runbook assignments. Add tenant-scoped policy configuration and a deterministic workflow preview; never execute instructions or provider calls from workflow text.

**Tech Stack:** React 19, Chakra UI, Go, pgx/sqlc, PostgreSQL.

**Spec:** The user-requested Response screenshots, reviewed on 2026-11-01. Four distinct screens; the two workflow screenshots show the same canvas.

## Global Constraints
- Local-only operation; no privileged response activation.
- Keep recorded actions and policy configuration distinct.
- Version checks and authenticated tenant scope on writes.
- Show only actual data; label previews and simulations explicitly.

## Review Focus
- Cases without remediation records must remain visible.
- Concurrent policy edits must conflict rather than overwrite.
- Archived or changed plans must not silently retain eligible policies.
- Workflow instructions are untrusted text, never executable code.
- JSON imports must use the existing validated creation API.

### Task 1: Policy and preview backend
- [x] Add migration 037 and sqlc queries for version-bound sandbox policies.
- [x] Add tests for validation, tenant isolation, concurrent writes and deterministic preview.
- [x] Implement policy GET/PATCH and workflow preview endpoints using existing authenticated response routes.
- [x] Run response package and HTTP tests, sqlc drift checks.

### Task 2: Cases and policy screens
- [x] Build board/list from paginated case API, including cases without actions.
- [x] Provide search, severity filtering, case creation and existing guarded status editing.
- [x] Add policy table at /respond/remediation-actions with connector, calling mode and conditions; preserve /respond/actions records.
- [x] Test loading/error/empty states and navigation.

### Task 3: Workflow canvas and runbook table
- [x] Add a canvas in the existing workflow detail drawer, reflecting saved steps and approval gates, with editable details and version history.
- [x] Add deterministic dry-run preview from the backend; no provider effects.
- [x] Replace library cards with searchable runbook table and bounded JSON import.
- [x] Preserve existing CRUD, archive/restore, duplicate and pinned case assignment flows.

### Task 4: Verification and documentation
- [x] Run isolated PostgreSQL integration tests, frontend checks, build and browser flows.
- [x] Update architecture, developer, roadmap, README and testing documentation with actual limits.
- [x] Review changes and commit the tested implementation.

## Execution record

Implemented the plan in the existing checkout. Ruling: preserve the existing linear step schema and represent the implemented eligibility check as the canvas policy gate; do not imply a general-purpose branch executor. The screenshot is a visual reference, not authorization to activate provider execution. Cases use the existing paginated API with explicitly page-local counts; closed cases are not archived.

Verification: serial isolated PostgreSQL race suite passed across detection, routing, investigations, intake, response and HTTP; frontend lint/build and nine frontend test files passed; sqlc drift and Go vet passed; browser fixture flows passed at 1440 and 390 pixels. Concurrent migration startup initially timed out; serial package scheduling resolved contention without changing application timeouts or durability. Fresh review found stale preview UI scope, corrected with case resets/request-generation invalidation and tested with delayed responses. Case PATCH timestamp advancement was made monotonic to prevent same-millisecond stale writes.
