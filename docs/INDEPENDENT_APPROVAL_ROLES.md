# Independent approval roles — local/mock

Go now separates authenticated proposer, approver and executor permissions across
Respond, Skills and Memory. No live provider or production response is enabled.
Role checks apply to HTTP mutation routes; transactional domain checks enforce
independence, tenant ownership, revisions and existing audit/rollback rules.

## Permissions

| Operation | Role | Independence / effect |
|---|---|---|
| Author Skills, materials, Memory or outcome-learning proposals | `proposer` | Saves drafts; Memory is pending and excluded from matching |
| Publish a saved Skill, publish staged edits, reapprove guidance, approve Memory | `approver` | Original creator and every contributor to the pending revision are denied |
| Enable/disable Skills; configure sandbox execution gate or workflow policy | `approver` | Cannot grant a missing response approval; enabling still checks authorship |
| Archive guidance or discard staged edits | `proposer` | Stops reuse/discards drafts; never grants execution |
| Propose sandbox session revocation / attach a runbook | `proposer` | Stores authenticated requester and immutable target/evidence or plan revision |
| Approve sandbox response | `approver` | Must differ from stored proposer; five-minute expiry remains |
| Preview/execute sandbox response | `executor` | Must differ from both proposer and approver; scope grant, freshness, kill switch and source revision still apply |
| Update a case runbook checklist | `approver` | Approval-required completion rejects requester and pinned-plan author; checklist completion never executes a provider |

An operator may be configured with multiple roles, but this never permits
self-approval or combining proposer/approver/executor identities on one response.
Prefer one role per human. An operator identity represents a person: distributing
several identities to the same person does not provide organizational separation.
These roles cover the listed workflows, not a complete platform-wide RBAC/SSO system.

## Configuration and local usage

`AISOC_GO_OPERATORS_FILE` contains an array of trusted operator entries:

```json
[{"id":"reviewer-a","tenant_id":"demo","token_hash":"<SHA-256 of a random operator token>","roles":["approver"]}]
```

Accepted roles are exactly `proposer`, `approver`, `executor`; duplicates/unknown
roles are rejected at startup. Omitted roles grant no protected mutations. Tenant
and roles come from server configuration, never a request body or header. The
reserved anonymous identity `local-development` cannot be configured as an operator.

`./run.sh start backend` provisions three random local development credentials in
ignored, mode-0600 `.run/go-dev/operators-local.json`, and hashes in
`.run/go-dev/operators.json`. Tokens are not printed, shipped to Python/Rust,
committed, or stored in browser local/session storage. Existing response grants
are copied to role-specific scopes for the same local binding; no new provider or
source privilege is enabled. Use **Sign in as operator** in the frontend, then the
appropriate token locally. Sign out before the next operator signs in.

Local anonymous browsing/drafting remains available as `proposer`. Cookie login
now takes precedence over the anonymous local fallback. Cookie mutations require
CSRF even in local mode. The header displays tenant, operator and configured roles.
UI button restrictions are advisory; direct API calls receive the same server checks.

## Saved guidance and API changes

- `POST /investigations/{id}/learning` now creates disabled draft Skills and/or
  pending Memory, with `proposed_by` / `proposed_at` provenance. It does not approve
  the author’s text. Existing source-version/hash replay and atomic audit remain.
- Initial Skill publication uses `POST /skills/{id}/publish` with `expected_version` on saved content.
  Combined `save-publish` is rejected; save as proposer, then review/publish as an
  independent approver. Staged publication still uses the versioned lifecycle API.
- `POST /enterprise-insights/{id}/lifecycle` accepts `operation: "approve"`,
  `expected_version`, `confirm: true` and a review `rationale`. It verifies source
  freshness, expiry and authorship under the resource lock, then activates that
  revision. Any subsequent edit puts Memory back into pending review. Historical
  snapshots remain unchanged; pending Memory is excluded from new cases/hunts.
- Reapproval after source changes does not bypass pending content approval.
- `approval` metadata records approver, timestamp, revision, creator and pending
  contributors; versioned Skill/Memory snapshots preserve the approval context.
- Case sandbox lists include source binding so independently granted operators
  can address the same action using their own scope IDs.
- The old one-click remediation execution alias returns
  `APPROVAL_WORKFLOW_REQUIRED`; use case-linked sandbox response instead. It cannot
  manufacture a response receipt or perform a provider action.

Errors include `ROLE_REQUIRED` (403), `SELF_APPROVAL_DENIED` (403),
`INDEPENDENT_OPERATOR_REQUIRED` (403), `PROPOSER_REQUIRED` (409), and existing
revision/source/expiry conflicts. Refresh before resubmitting; the frontend does
not automatically retry a denied mutation.

## Persistence and rollout

Migration **048** adds sandbox proposer/executor identities and a pending-Memory
matching guard. Migration **049** places existing nonarchived Memory without an
approval state into pending review; it preserves content, audit and prior snapshots.
Legacy sandbox actions without requester provenance fail closed and require a new
proposal. Existing published Skills remain available; their earlier publication is
not retroactively certified as independent. Future edits/publication/reapproval
follow the new boundary. Legacy runbook assignments lacking recorded provenance
cannot complete approval-required steps; attach a newly versioned/copied runbook.

Deploy Go and frontend together. Configure roles before resuming protected writes.
Keep migrations and audit history on rollback. Older binaries bypass these guards:
stop approval/response writes and disable affected guidance before reverting;
do not remove pending flags or rewrite audit history to make a rollback pass.

## Verification

- Role matrix: proposer/approver/executor/read-only; forged role headers, local
  anonymous restrictions, cookie identity and CSRF enforcement.
- Database: self-approval, multiple pending contributors, unknown authorship,
  foreign tenant, stale versions, edited Memory requiring reapproval, staged Skill
  release and preserved application snapshots.
- Respond: three configured operators, requester self-approval denial, expiring
  approval, stopped gate, source conflict, audit rollback, concurrent replay and
  exactly one local revocation/mock note. Legacy aliases cannot bypass this flow.
- Frontend: local drafting, pending/disabled approval controls, session-role display,
  lint, production build and existing frontend regression tests.

Run `python3 scripts/framework/acceptance.py --runs 1` for the disposable full
workflow, `go test ./internal/platform/auth ./internal/platform/config` in
`backend-go`, and `node --test tests/frontend/*.test.mjs`. Reports live under ignored
`output/platform-acceptance/` and `output/backend-framework/`.

External IAM/SSO provisioning, organizational identity assurance, live actions,
production hosting and real-model quality evaluation remain separate work.

### Validation — 2026-11-01

- Full disposable Detect-to-Build acceptance: **passed**, one run, 249.96 seconds,
  local/mock only (`output/platform-acceptance/report.json`). This run includes
  Go race tests, API role/tenant checks and authenticated independent approval and
  execution flows. The report identifies the base commit plus a dirty worktree;
  these changes were not committed by this validation step.
- Frontend lint and production build passed; all **12 frontend test files** passed.
  Vite still reports the existing large main-bundle warning (approximately 993 KB).
- `make -C backend-go sqlc-check`, Python syntax checks and `git diff --check` passed.
- Final browser smoke on the refreshed local backend passed: pending Memory,
  disabled author approval, forged-role denial, blocked self-publication, invalid
  login rejection and 390px mobile layout; no page errors. Repeat with
  `scripts/framework/approval-browser.js`. It creates synthetic draft records.
- Authenticated role handoffs are covered by local API tests. Browser testing
  deliberately uses no real operator credentials: automatic approval review
  rejected transferring local credentials to the browser automation process.
  Positive authenticated browser handoffs remain outside this browser smoke test.

The normal local foundation was refreshed with migrations through 049. Existing
Memory without an approval state now requires explicit review before matching;
historical snapshots remain intact.

```mermaid
sequenceDiagram
    participant P as Proposer
    participant G as Go auth and transactional stores
    participant A as Independent approver
    participant X as Independent executor
    participant D as PostgreSQL
    P->>G: Save draft / propose response
    G->>D: Revision, authorship, evidence and audit
    A->>G: Approve saved revision
    G->>D: Check distinct authors, freshness and revision; record approval
    Note over G,D: Skill / Memory becomes eligible for controlled reuse
    X->>G: Execute approved sandbox response
    G->>D: Check three identities, grant, expiry and kill switch
    G->>D: Atomic mock revocation, receipt, note and audit
```

## OIDC identity integration — November 2026

Independent approval controls also apply to mapped OIDC operators. Browser/API tests use synthetic identities to verify author denial, independent publication and approval loss after role downgrade. Active mappings feed handoff candidates; role or tenant claims from the IdP grant no application privilege. See [local OIDC configuration and limits](OIDC_SSO.md).
