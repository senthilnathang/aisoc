# Configurable local OIDC/SSO foundation

Preserve local/token auth; add opt-in OIDC authorization-code + PKCE login via a maintained verifier. Validate issuer, audience, signature, expiry, nonce and single-use browser-bound state. Keep provider tokens server-side and issue the existing opaque CSRF-protected application cookie.

A private trusted mapping file binds exact provider subject to stable operator ID, tenant, roles and revocation generation. Ignore provider role/tenant/email claims. Reload mappings on authorization; changed/removed/disabled mappings invalidate existing sessions, and new sessions use current roles. Reuse existing self-approval, three-party response and scoped-grant checks. Add logout-all for the current identity, with CSRF protection.

Use a separate loopback-only mock identity provider with throwaway signing keys, PKCE and one-time authorization codes. It is test/development infrastructure only, not enabled in production. Exercise protocol negatives in Go tests and full browser sign-in, tenant isolation, role changes, disablement/revocation and independent approval against disposable Go/PostgreSQL services. Integrate results into the release gate and its backup dataset. No live identity provider, response provider, schema rewrite or main-demo migration.

Session storage remains process-local: restart revokes all sessions; multi-replica sessions, provider back-channel logout, SCIM and live IdP certification remain explicit production follow-ups. Document configuration, trust boundaries and test evidence.
