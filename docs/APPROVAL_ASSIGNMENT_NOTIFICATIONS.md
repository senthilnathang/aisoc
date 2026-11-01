# Approval assignment and in-app notifications

Respond → Approval inbox (`/respond/inbox`) supports claim, reassignment and release across pending Skills, Memory and case-linked mock response actions. Integrations remain local/mock. Ownership coordinates work; it does not grant permission or reserve exclusive approval authority. Existing guarded workflow APIs remain authoritative.

## Operator workflow

1. Preview the saved proposal and its evidence. The ownership panel lists the current owner, assignment version, expiry and latest handoff reason.
2. Enter a reason and claim eligible work, or assign it to an eligible configured operator. Ownership lasts 15–240 minutes, capped by a future underlying proposal/approval expiry.
3. After an approval or proposal revision changes, refresh the inbox. Existing ownership shows **Revision changed**; it must be explicitly renewed or reassigned against the current revision. Expired ownership can be reclaimed.
4. The old and new owners receive in-app notifications. Open **Notifications** in the workspace bar, mark a notice read, or follow its link to the current review. Notices are historical; completed work may no longer appear in the inbox.
5. Use the existing independent approval, dry-run and sandbox execution flow. An approver who owns a response can hand it to an eligible executor after approval, but cannot execute their own approved action.

Eligible independent reviewers may still approve work owned by another reviewer. A proposer/contributor with proposer permission can coordinate a handoff but cannot claim their own independent review. Expired Memory is repair work: a proposer may claim it to correct validity before independent reapproval. Ownership expiry and approval/context expiry are separate indicators.

## Authorization and consistency

- Tenant and actor come from authenticated context. Targets come from the server-side operator configuration for that tenant; the browser cannot supply roles or grants.
- Response targets require a matching connector/source sandbox-response grant. Authors and contributors cannot approve; response approvers cannot execute their own approval.
- Current owners retaining a workflow role and applicable response scope may hand off after a stage transition. Removed or unscoped identities cannot use old ownership as authority.
- Assignment mutations lock the source row, compare a revision token and ownership version, and atomically save assignment, audit and notifications.
- The revision token hashes the saved document, stage, expiry and linked source-investigation revision. Stale requests return 409. Source updates can invalidate advisory ownership; underlying workflow APIs independently recheck safety and freshness.
- The latest identical request can be replayed without duplicate audit/notifications. A superseded request conflicts; this is not an unlimited request-history store.
- Notifications are queried and marked read using both tenant and recipient. Another operator cannot read or acknowledge a recipient's notices. Notification bodies contain handoff metadata, not evidence payloads or credentials.

## API

| Endpoint | Contract |
|---|---|
| `GET /api/v1/approvals/assignment` | `kind`, `id`; Respond also requires `connector_id`, `source`. Returns current item/token, assignment, eligible operator IDs/required role and actor capabilities. |
| `POST /api/v1/approvals/assignment` | Same identity plus `operation` (`claim`, `reassign`, `release`), `owner_id` (reassign only), `expected_version`, `work_token`, `request_id`, `reason`, `minutes`. |
| `GET /api/v1/notifications` | `limit` 1–50 (default 25), `offset` 0–1,000,000. Returns recipient-scoped items, total and unread count. |
| `POST /api/v1/notifications/:id/read` | Idempotently mark the authenticated recipient's notice read; foreign/missing IDs return 404. |

Reasons must contain 10–1000 bytes after minimum-length trimming; request IDs use 8–80 letters, digits or hyphens. The inbox projection now includes `work_token` and assignment state (`unassigned`, `owned`, `expired`, `revision_changed`). No assignment endpoint approves or executes a response.

## Architecture and source map

```mermaid
sequenceDiagram
    participant UI as React inbox
    participant Go as Go ownership API
    participant PG as PostgreSQL/sqlc
    participant N as Recipient notification center
    UI->>Go: Read pending revision and eligible operators
    Go->>PG: Tenant-scoped work and assignment
    UI->>Go: Claim/reassign/release + version + token
    Go->>Go: Validate actor, target, independence and scope
    Go->>PG: Lock source; compare revision/version
    Go->>PG: Commit assignment + audit + notifications
    N->>Go: Poll own notifications / mark read
    Go->>PG: Tenant + recipient-scoped query/update
    N->>UI: Open current review
```

- `backend-go/migrations/051_approval_assignments.sql`: shared pending-work view, ownership and notification tables/index.
- `backend-go/internal/modules/approvals/assignments.go`: eligibility, concurrency, replay, audit and recipient scope.
- `backend-go/internal/platform/auth/approval_operators.go`: tenant-scoped configured-operator directory without credentials.
- `backend-go/internal/modules/investigations/queries/approval_assignments.sql`: parameterized sqlc queries.
- `backend-go/internal/transport/httpapi/approval_assignment.go`: authenticated endpoints and strict contracts.
- `frontend/src/ApprovalOwnership.jsx`, `NotificationCenter.jsx`, `approvalOwnership.js`: ownership controls, indicators, historical notices and local review links.

The UI polls notifications every 30 seconds while visible and refreshes after local ownership mutations. This uses existing Go/PostgreSQL services; no push service, external notification connector or background expiry scheduler is added. Inbox/ownership refresh is explicit. Notification and assignment history currently remain retained; production retention, large-directory search and load testing are future work.

## Migration, rollback and validation

Migration051 is additive and introduces no new approval state machine. Apply through the standard Go migration runner before using these APIs. To roll back the application, deploy the prior application version and retain the additive view/tables and audit history; do not drop data as part of an application rollback.

The disposable acceptance suite covers concurrent claim exclusion, stale versions/revisions, replay, atomic rollback on audit failure, reassignment, expiry/reclaim, source completion, tenant/recipient isolation, self-approval denial and response reviewer-to-executor handoff. Frontend helper tests cover expiry boundaries and safe composite links. Browser coverage uses synthetic local records without operator credentials; authenticated role flows run in API acceptance.

Run `python3 scripts/framework/acceptance.py --runs 1`, `npm --prefix frontend run lint`, `npm --prefix frontend run build`, `node --test tests/frontend/*.test.mjs` and `make -C backend-go sqlc-check`. Browser regression: `scripts/framework/approval-ownership-browser.js` via Playwright. Browser fixtures remain as synthetic local demo records.

## Verified local results — 2026-11-01

- Full disposable Detect-to-Build acceptance passed in **215.55 seconds** (one run), including database-backed Go race tests and authenticated API/tenant-negative checks. Report: `output/platform-acceptance/report.json`; base commit `a41ac65` plus this uncommitted working tree.
- Frontend lint and production build passed; **15 frontend test files passed**. The existing Vite main-bundle size warning remains (approximately 1,035 KB before gzip).
- sqlc generated-query consistency and whitespace checks passed.
- Credential-free browser regression passed: assign/release, author self-claim and self-approval denial, expired Memory proposer repair claim, notification read/deep-link, desktop and 390px mobile layout, zero page errors. Screenshots are under ignored `output/playwright/`.
- Local Go service restarted with migration051. No production provider, external notification delivery or production performance was enabled or certified.
