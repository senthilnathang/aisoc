# Testing Strategy

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
