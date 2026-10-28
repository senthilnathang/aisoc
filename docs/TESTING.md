# Testing Strategy

## Current workflow coverage

Latest local run: **27 tests passed, 0 failed**. Backend typecheck, launcher syntax,
and `git diff --check` passed. The frontend production build passed with Vite's
existing chunk-size advisory.

The suite uses Node's built-in test runner, Fastify `inject()`, and in-memory
SQLite. Run `npm --prefix backend test`; use the typecheck, frontend build, launcher
syntax and whitespace checks in the [developer guide](DEVELOPMENT.md) as well.

`backend/test/skills.test.ts` covers scoped skill creation and filtering, tenant
isolation, publish state and audit history, material version snapshots and
archive behavior, HTTPS-only references, supported file types, and the 128 KiB
content limit. Other test files cover the normalized intake/auth pipeline,
detection registry, investigation persistence and the core resource API.

Browser screenshots and Playwright artifacts in `output/` are local verification
artifacts and are excluded from source control. Browser coverage is manual; this
repository does not currently have an installed automated frontend E2E suite.

## Detection registry step 1

The earlier detection-registry verification recorded **24 passing tests**. New detection-registry
tests cover tenant-scoped filters/source choices, stable pagination, literal
search, live metrics with duplicate/suppressed alerts, immutable version snapshots,
stale-write rejection, restart persistence, disabled cloning, and deletion guards.
Backend type checking and the frontend build pass (existing large-chunk advisory).

Browser verification created, edited, cloned, enabled, and deleted temporary
rules; checked version snapshots and saved-query reload persistence; paged through
11 test rules; and filtered by a bound provider. Temporary records were removed.
Registry and detail pages were checked at 1920, 1024, 768, and 390px without
document overflow. Mobile navigation and all four rule tabs passed. Screenshots:
`output/playwright/detection-step1-desktop.png`, `detection-step1-versions.png`,
and `detection-step1-{registry,detail}-{width}.png`.

## Authenticated hybrid intake verification

The earlier auth/intake verification recorded **21 passing backend tests**. `auth-intake.test.ts`
covers fail-closed token mode, credential-bound tenants, session CSRF/origin checks,
logout and expiry, source scope, one-time key responses, rotation, and revocation.
Type checking and the frontend production build also pass; Vite retains its
large-chunk advisory. The older counts below describe earlier milestones.

`output/playwright/verify-auth.mjs` is a standalone local browser verification
script. Set `PLAYWRIGHT_PACKAGE` to an installed Playwright package.json path.
It reads the private operator token from disk without logging credentials or
recording traces, creates a labeled demo source, submits an alert, rotates and
revokes its key, and checks session reload and sign-out. It retains the revoked
source and resulting investigation for review. Screenshots are `auth-01-sign-in.png`
through `auth-04-investigations.png` in `output/playwright/`.

## Alert pipeline verification

The earlier pipeline verification recorded 17 backend tests. `backend/test/alert-pipeline.test.ts`
covers duplicate submissions, conflicting retries, invalid/disabled/foreign rules,
retained suppression, stable sampling, restart recovery, phase rollback and
explicit retry, tenant-isolated local indicator matching, active-run outcome
protection, and the enabled background worker's lifecycle. A low-severity no-match
case stays unknown rather than being mislabeled benign.

Browser verification submitted an example through the alert form, observed live
progress to completion, checked the transcript, reloaded the case, and ran it
again. The second run produced six total steps and retained two distinct artifacts.
Identical resubmission returned 200, conflicting content returned 409, and a foreign
tenant read returned 404. The labeled demo case is retained for review:
`INV-01ed88c4-54ba-4fbb-8257-c91760c48864`. Screenshots are
`output/playwright/pipeline-01-alert-intake.png` through
`pipeline-05-history.png`. Local indicator matches depend on the current tenant's
stored feed; the browser demo had no match and stayed suspicious based on its
high source severity. The isolated backend test separately verifies a positive match.

Run the existing typecheck, backend test, and frontend build commands below.
The earlier 10-test receipts describe the previous implementation pass.

## October 27 workflow verification

Commands: `npm --prefix backend run typecheck`, `npm --prefix backend test`,
`npm --prefix frontend run build`, `bash -n run.sh`, and `git diff --check`.

The earlier implementation pass contained 10 passing tests. Its
`backend/test/investigation-workflow.test.ts` covers disk-backed restart persistence,
migration idempotency, rule configuration validation, tenant-scoped history,
case evidence/feedback, case deletion, and reinvestigation preserving evidence.

Playwright browser checks exercised creation and saving of a detection rule,
query/schedule/routing edits, reload persistence, enable/disable, and audit history.
Case checks exercised artifact attachment, feedback, reload persistence,
determination changes, reinvestigation, and history. Temporary test records were
deleted after verification. These are manual browser verification receipts, not
an installed automated end-to-end test suite.

Browser checks found and fixed a shared client bug: empty-body POST actions must
not send `Content-Type: application/json`. Detection and investigation screens now
show loading/error states instead of silently presenting fallback case/rule data.
The production build passes with Vite's existing large-chunk advisory.

Screenshots live under `output/playwright/`; `reference-*` captures the public
product images, `after-*` captures local pages, and `verified-*` captures persisted
workflow results. The remaining sections describe the earlier test strategy.

## Overview

The project uses Node.js built-in test runner (`node:test`) with `node:assert/strict`
for backend integration tests. The frontend uses Vite build verification as its primary
correctness check since it is a single-file SPA with static fixtures as fallback data.

## Running Tests

```bash
# Backend integration tests (requires Node 22+ for node:sqlite)
cd backend
npm test

# Frontend build verification
cd frontend
npx vite build

# Backend type checking
cd backend
npm run typecheck
```

## Backend Test Suite

**File**: `backend/test/api.test.ts`

All tests use in-memory SQLite (`:memory:`) and Fastify's `inject()` for zero-setup,
zero-teardown execution. Each test creates its own app instance.

### Existing Tests

| Test | What it verifies |
|---|---|
| Health and seeded dashboard | `/health` returns 200 with `database: "sqlite"`; `/dashboard` returns seeded investigation count > 0 |
| Investigation CRUD + tenant isolation | POST creates with tenant-a; GET from tenant-b returns 404; reinvestigate increments `replay_count` |
| Connector test + remediation execution | POST connector with config; `/test` returns `operational`; `/execute` transitions remediation to `completed` |
| Validation and secret redaction | POST with missing fields returns 400 + `VALIDATION_ERROR`; connector secrets are never returned in responses |
| Search across all resources | GET with `?search=test` returns 200 for all 5 original resource types |
| Threat intel report CRUD + launch hunt | POST creates report; GET detail includes empty indicators array; `/launch-hunt` sets `hunt_status: "hunting"` |
| Threat indicator CRUD + report linkage | POST creates indicator linked to report; GET detail includes indicator in `indicators` array |
| Threat intel dashboard aggregation | Dashboard returns `totalReports`, `totalIndicators`, `reportsBySource` with correct counts |
| Detection rule toggle | POST `/toggle` flips `enabled` state from `true` to `false` and back |

### Test Patterns

- **Tenant isolation**: Every CRUD test verifies cross-tenant reads return 404.
- **State transitions**: Action endpoints (reinvestigate, execute, toggle, launch-hunt) verify the expected state change.
- **Input validation**: TypeBox schemas reject payloads missing required fields.
- **Secret redaction**: Connector secrets are never exposed in API responses.

## Frontend Verification

The frontend is verified through:

1. **Vite production build** — catches import errors, JSX syntax errors, missing exports
2. **TypeBox schema alignment** — backend validates all payloads, so frontend fetch errors surface quickly
3. **Static fixture fallback** — each screen has hardcoded fallback data when the API is unreachable, ensuring the UI always renders

## Test Coverage Plan

### Phase 1 (Current) ✅
- API integration tests for all resource CRUD
- Tenant isolation verification
- State transition tests for all domain actions
- Threat intel endpoints and aggregation
- Input validation and error handling

### Phase 2 (Next)
- [ ] Hunt execution and findings count verification
- [ ] Bulk remediation execution
- [ ] Pagination and offset query parameters
- [ ] Concurrent tenant operations
- [ ] Database migration idempotency

### Phase 3 (Future)
- [ ] Frontend component tests with React Testing Library
- [ ] End-to-end tests with Playwright
- [ ] Visual regression tests for responsive breakpoints
- [ ] API contract tests against OpenAPI spec
- [ ] Load testing for concurrent tenant operations
