# Respond workspace

Implemented locally on 2026-11-01 from the five public images on [7AI Response](https://7ai.com/platform/response). The images show four distinct screens: Cases, Remediation Actions, two views of the same workflow canvas, and Runbooks. AISOC retains its own branding, existing versioned procedures, case records and approval boundaries.

## Screens and actual behavior

| Reference screen / browser path | AISOC entry | Behavior |
|---|---|---|
| `app.sevenai.com/respond/cases` | `/respond/cases` | Three-column Open/In progress/Closed board, list layout, server search/severity filter, page-local priority sort, create case, guarded status update and open investigation |
| `/respond/remediation-actions` | `/respond/remediation-actions` | Workflow policy table with enabled status, description, local sandbox connector, confirmation/automatic-dry-run calling, exact severity/source conditions and version-checked save |
| `/respond/workflows/phishing-blast-radius` | `/respond/workflows` → Open workflow | Full-width canvas with Start, policy gate, ordered saved steps, approval indicators, end, zoom, dry-run case selection and preview history; existing editor and version history remain available |
| `/respond/runbooks` | `/respond/runbooks` | Searchable table with domain labels, timestamps, version/state; JSON upload; existing create/edit/duplicate/archive/restore and version-pinned case assignment |

The Cases board includes cases with no actions. It displays 100 cases per page from the existing case API. Column counts and priority sorting are explicitly page-local, not global totals. `open` maps to Open; `investigating`/`contained` to In progress; `resolved`/`closed` to Closed. Closed is not an archive or deletion. A status change records local case state, not provider containment or SOAR synchronization.

Recorded actions remain at `/respond/actions`; approvals, activity and sandbox session-response controls are preserved. Policy settings do not change existing action records or grant provider permissions.

## Policy and preview contracts

Tenant and actor derive from the existing authenticated principal; clients cannot select another tenant through policy bodies. All new SQL uses sqlc/pgx from `backend-go/internal/modules/response/queries/workspace.sql`.

| Endpoint | Contract |
|---|---|
| GET `/api/v1/response-workflow-policies` | Tenant's stored policies, joined client-side to the existing plan list; absent policy means disabled |
| GET `/api/v1/response-plans/{id}/policy` | Workflow-only configuration, default version 0 / disabled |
| PATCH `/api/v1/response-plans/{id}/policy` | `expected_version`, `plan_version`, `enabled`, `connector`, `calling`, `severity`, `source`; unknown fields rejected |
| POST `/api/v1/response-plans/{id}/preview` | `expected_version`, `case_id`; records the evaluated case/title, plan/policy version, actor, eligibility/reason and per-step outcomes |
| GET `/api/v1/response-plans/{id}/previews` | Latest 50 persisted previews for the authenticated tenant/workflow |

Only `connector=local-sandbox` is accepted. Calling is `confirmation` or `automatic_dry_run`. **Neither setting schedules work or executes provider calls.** Automatic dry run describes how a manual preview labels steps. `severity` and `source` are optional exact-match AND conditions; source is trimmed at save time and compared case-sensitively. There is no arbitrary expression evaluation.

Policy writes take the existing plan row lock, compare both policy and plan versions, and atomically append a policy audit snapshot. Plan edits or archive/restore increment the plan version, making old policies ineligible until reviewed and saved again. Archived plans cannot receive policy changes. A changed plan makes a preview request with an old version fail with 409.

Preview evaluation is deterministic: archived, disabled, stale or unmatched policy blocks every step. A matching policy yields `approval_required` for confirmation mode or individual approval-gated steps; other steps are `would_run`. All results have `dry_run=true`. Instructions are displayed as untrusted text and never parsed as code, sent to a model, or executed. Preview writes create a history receipt only; no remediation or case status is changed. Repeated clicks create separate receipts rather than pretending to execute an idempotent external action.

The current canvas implements a **policy gate followed by linear procedure steps**. It is not a general branching/drag-and-drop workflow engine. Arbitrary conditional branches, real connector bindings, execution scheduler, customer approvals and provider runs are future work. The screenshot's example workflow slug is not a seeded AISOC workflow; use actual stored plans. The case selector shows up to 500 recent cases. Preview reads show the latest 50 receipts; storage does not yet have an automatic expiry policy.

Case PATCH now optionally accepts `expected_updated_at`. The board supplies the last displayed timestamp; stale updates return 409. The existing worker-in-progress guard and atomic case audit remain in force. PATCH timestamps advance by at least one millisecond even for same-clock writes. Older clients can continue without this optional guard.

## Runbook import

Upload a UTF-8 JSON file, at most 128 KiB in the browser, matching the existing plan input:

```json
{"kind":"runbook","title":"Suspicious login review","description":"Review source evidence before requesting response","domain":"Identity","trigger":"Suspicious login","steps":[{"title":"Confirm scope","instructions":"Verify the account, device and source evidence.","approval_required":true}]}
```

The browser selects only input fields; IDs, state/version and arbitrary extra properties are not imported. The Go API validates required strings, length limits and 1–50 typed steps. Imports create new independent version-1 runbooks; they never overwrite another plan. Archive replaces destructive deletion, preserving pinned case assignments. Domain labels are existing schema fields, not a new free-form tagging system. Actor attribution remains available in version history rather than fabricated names in legacy table rows.

```mermaid
sequenceDiagram
 participant UI as Respond UI
 participant API as Go response module
 participant DB as PostgreSQL
 UI->>API: Save policy (expected policy + plan versions)
 API->>DB: Lock tenant workflow; compare versions
 API->>DB: Policy + immutable history snapshot (one transaction)
 UI->>API: Preview owned case against expected workflow version
 API->>DB: Lock workflow; read tenant case and policy
 API->>API: Evaluate eligibility and approval gates
 API->>DB: Store preview receipt
 API-->>UI: dry_run=true; blocked / approval_required / would_run
 Note over API,DB: No provider calls, response jobs or case mutation
```

## Persistence, rollout and rollback

Additive migration `037_response_workspace.sql` adds `response_workflow_policies`, `response_workflow_policy_history` and `response_workflow_previews`. Each has a composite tenant/workflow foreign key; authorized workflow deletion cascades, although the UI archives instead. Include these tables in database backups/access/retention governance; receipts contain case titles and actor identities. Existing plan documents and case assignments remain compatible.

Run normal Go migration/startup before using the new frontend. Rollback is code-only: restore the previous frontend/backend and retain the additive tables. Do not delete audit/history rows to roll back. No Redis, Python, Rust, RisingWave or provider configuration changes are required.

## Verification

- Go unit tests: reject unsupported connectors/calling/severity; disabled, stale, archived and mismatched policies fail closed; approval-step outcomes.
- Isolated PostgreSQL race tests: tenant isolation, missing cases, policy compare-and-swap under concurrent writers, audit-failure rollback, stale plan handling, persisted preview history, no case/action effects, stale case updates.
- HTTP tests: malformed/null version/enable fields, forged tenant fields and live connector/calling values rejected.
- Frontend lint, production build and navigation regressions.
- Browser checks: Cases board/list/create/status request, policy save request, workflow preview/history and stale-result clearing, runbook table/import, desktop/mobile overflow. Mutations are intercepted fixtures; database behavior is tested separately in the disposable cluster.

Commands: `python3 scripts/framework/check_detection_intelligence.py`, `make -C backend-go sqlc-check`, `npm --prefix frontend run lint`, `npm --prefix frontend run build`, `node --test tests/frontend/*.test.mjs`. The database harness runs packages serially against its shared disposable cluster to avoid concurrent migration-lock timeouts; race detection remains enabled.

## Platform review (2026-11-01)

Action records, Approvals and Activity now use server status/search filters and 25-row pages. Search covers titles/descriptions. Overview counts are tenant-wide through /remediations/summary; list counts describe only the visible page. Approval remains local simulation only. See [review and verification](PLATFORM_REVIEW_2026-11-01.md).
