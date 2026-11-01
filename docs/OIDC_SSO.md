# Local OIDC/SSO foundation

OIDC is opt-in (`AISOC_GO_AUTH_MODE=oidc`). Existing local/token auth remains available. This delivery uses a disposable loopback mock identity provider and does not activate live SSO or production hosting. Production configuration currently rejects OIDC mode; remove that gate only after the separate deployment/security review and live-provider validation.

## Login and trust boundaries

Go uses `coreos/go-oidc` v3.21.0 and OAuth2 authorization code flow with PKCE S256. Discovery must match the configured issuer. Authorization/token endpoints and JWKS HTTP traffic must stay on that issuer's origin; redirects are not followed by the backend client. Only RS256 ID tokens are accepted. Signature, issuer, audience, expiry, nonce, issued-at plausibility and authorized-party binding are checked. State expires after five minutes, is single-use and bound to an HttpOnly browser transaction cookie. The transaction store is bounded to 1,000 entries.

The browser receives an opaque application cookie and CSRF token, never the provider's ID/access tokens. Application sessions expire at the earlier of configured session TTL or ID-token expiry; there is no refresh-token storage. The transaction cookie uses SameSite=Lax for the top-level provider return; the application cookie retains SameSite=Strict and Path=/api. HTTPS uses secure cookies when configured; HTTP is permitted only for explicitly configured loopback mock endpoints.

Exact provider subject maps to an operator, tenant and allowed roles in a private server-owned JSON file. Provider email, groups, `tenant_id` and role claims grant no authority. One subject and one stable operator ID per mapping are required; aliases cannot circumvent self-approval. Existing tenant guards, independent guidance approval, three-party response execution and scope grants still apply. OIDC mode disables operator bearer-token login; source-specific ingestion credentials retain their existing independent boundary.

```mermaid
sequenceDiagram
  participant B as Browser
  participant G as Go auth
  participant I as Local mock IdP
  participant M as Trusted identity mappings
  B->>G: Start SSO
  G-->>B: Bound transaction cookie; state, nonce, PKCE challenge
  B->>I: Select synthetic identity
  I-->>B: Single-use authorization code
  B->>G: Callback with code and state
  G->>I: Code exchange with PKCE verifier
  I-->>G: Signed ID token
  G->>G: Verify token and browser transaction
  G->>M: Map exact subject to operator/tenant/roles
  G-->>B: Opaque app session; redirect to workspace
  B->>G: Approval request with CSRF token
  G->>M: Recheck current mapping and session fingerprint
  G->>G: Enforce role, tenant, authorship and resource policy
```

## Configuration

Copy `config/examples/oidc.local.example.json` and `oidc-mappings.example.json` to private local files, set absolute paths and restrict permissions (`chmod 600`). Mapping/config files are bounded to 1 MiB, must be regular files and must not be group/world writable. Unknown fields, duplicate subjects/operators and unknown roles fail closed. A mapping requires a positive `generation`.

For a directly launched local Go API, add these to its existing database/worker configuration:

```text
AISOC_GO_AUTH_MODE=oidc
AISOC_GO_OIDC_FILE=/absolute/private/path/oidc.json
AISOC_GO_APP_ORIGINS=http://127.0.0.1:8080
```

Vite preview forwards HTML document requests under `/api/` to Go before SPA fallback; this includes SSO start and callback redirects. `tests/frontend/oidc-proxy.test.mjs` protects that boundary.

The callback must be exactly `/api/v1/auth/oidc/callback` on an allowlisted application origin. Configure the frontend proxy to that API. `run.sh all` continues to use its stored runtime authentication configuration; merely exporting `AISOC_GO_AUTH_MODE` does not override the managed runtime's `auth_mode`. This change does not rewrite the active demo's runtime settings. Existing response-scope operator IDs must match the mapped IDs; tenant/role mapping does not create connector grants.

The mock provider is a separate binary:

```bash
cd backend-go
go build -o bin/oidc-mock ./cmd/oidc-mock
AISOC_MOCK_OIDC_ENABLE=true \
AISOC_MOCK_OIDC_ADDR=127.0.0.1:9100 \
AISOC_MOCK_OIDC_REDIRECT=http://127.0.0.1:8080/api/v1/auth/oidc/callback \
./bin/oidc-mock
```

Its client ID is `aisoc-local`. It deliberately has **no real authentication**: it allows synthetic identity selection, signs tokens with an ephemeral RSA key and enforces PKCE and one-use codes. It requires explicit enablement, loopback binding and a non-production environment. Do not use it to authorize real users. It has no remote provider or containment connection.

A confidential provider can reference `client_secret_file` in OIDC configuration (the current adapter uses `client_secret_post`); do not put secret values in JSON, logs or browser code. Live providers and cross-origin discovery endpoints have not been certified by this local slice.

## Revocation and permission changes

- **Sign out** removes the current application session.
- **Sign out all sessions** (`POST /api/v1/auth/logout-all`) removes sessions for the current operator/tenant in this Go process. It requires an existing session and CSRF token. Another operator's sessions are unaffected.
- Update the trusted mapping file atomically. Provider/client settings and connector grants require an API restart; only identity mappings reload on requests. Any change to a mapping fingerprint, deletion or disablement makes existing sessions unusable on their next request. A role change requires a fresh login with current roles; old browser controls cannot bypass the Go check.
- Increment `generation` for deliberate revocation, disablement, reenablement or identity/permission changes. Never decrease/reuse generations: this prevents an unobserved disable/reenable cycle from making an old session's mapping valid again.
- A missing, malformed or insecure mapping file fails closed. Approval-assignment candidates use current active mappings. Reads parse the bounded file on each authorization; scale optimization must preserve revocation semantics.
- Go emits structured `auth_session_event` logs for OIDC login, session invalidation and logout-all using operator/tenant IDs. These are operational logs, not a new durable authentication-audit table. Resource approval/action audit remains in PostgreSQL.

Already authorized in-flight requests are not retroactively cancelled. Session/transaction state remains process-local: restart revokes sessions, and logout-all applies to that process. Shared multi-replica sessions, durable centralized revocation, IdP back-channel logout, SCIM, emergency operator recovery and live MFA assurance remain production work. App logout does not revoke the provider's own session or tokens.

## Verification

```bash
python3 scripts/framework/release_gate.py --chromium-executable /opt/google/chrome/chrome
cd backend-go
go test -race ./internal/platform/auth ./internal/platform/config
```

The existing four release stages now have a required fifth `identity` report. The harness creates a separate temporary Go API, Vite preview, mock IdP, signing key and private mapping file against the disposable database; all are cleaned up. The browser allows application and mock-provider origins only. Fresh pending Skills exercise independent approval, self-approval denial even when the author has an approver role, and loss of approval permission after role downgrade. Other checks cover tenant mismatch/foreign access, CSRF, logout-all across two sessions, unaffected other users, disabled identity login denial and malformed-file failure. Desktop/mobile sign-in screenshots are retained. The subsequent backup stage includes these synthetic records.

Go protocol tests reject signature/issuer/audience/expiry/nonce/authorized-party errors and implausibly future issued-at values, replayed or expired state, cross-browser callbacks, wrong PKCE and unmapped subjects. Configuration tests cover unsafe HTTP origins, mismatched callback origins, duplicate mappings, invalid roles and insecure file permissions. This is local interoperability and regression evidence, not certification of a live IdP or production identity lifecycle.

Primary references: [OpenID Connect Core](https://openid.net/specs/openid-connect-core-1_0.html), [Go OIDC verifier](https://pkg.go.dev/github.com/coreos/go-oidc/v3/oidc).

## Verified local result

The combined release gate `cebf76ec2d154dec9548d7e177d167f7` passed all five stages in 490.11 seconds. Identity checks passed in real Chrome with no page errors or external requests; the full existing API/browser workflows and backup recovery passed as well. See [test evidence](BROWSER_RELEASE_GATE.md#oidc-extension). The mock remains opt-in and the active demo configuration was not changed.

## Rollback

Restore the previous managed runtime auth configuration and restart the API to use local/token mode. Keep existing operator credentials private; no token-mode configuration or schema is migrated. Stop the explicitly started mock process. Restart invalidates all process-local SSO sessions; resource approvals and audit records remain intact.
