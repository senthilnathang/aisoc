# Build local integration management

Scope: local/mock UI configuration, JSON import/validation and evidence preview, with a usable path into the existing suspicious-login pipeline. No live provider endpoints or secrets.

Design: a versioned PostgreSQL draft stores name, parent authorized mock scope, four login events and optional IAM/EDR bundle. Preview validates strict typed JSON and shows server-normalized identity, findings and context. Save repeats validation with optimistic concurrency. Explicit import seals the draft, then performs replay-safe event acceptance; a failed/uncertain import can be retried but sealed evidence cannot be edited. A new generated child connector ID isolates every profile. Existing Go/Redis/Python runtime methods process sealed profiles under an operator's existing reviewed mock grant, with bounded scheduling. Dynamic scopes permit only note approval and read/reconciliation operations; no response grants. No browser writes to startup grant files and no arbitrary HTTP/provider calls. Freshness is historical and no validated fixture is advertised as a live connection test.

- [x] Strict preview and draft persistence, additive migration/sqlc and isolation/concurrency tests.
- [x] Authorized API and recoverable import/discovery through existing workers; approval projection.
- [x] Build integration editor, file input, preview and status/case navigation; responsive and failure behavior.
- [x] Full framework and browser tests, retained local walkthrough, independent review.
- [x] Architecture/API/developer/testing/roadmap documentation.
