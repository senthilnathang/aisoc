# ADR 003: Replacement contract and runtime decisions

Status: implementation decisions for the local AISOC replacement, 2026-10-29.

The replacement preserves supported frontend workflows, domain state, tenant IDs,
history, credential behavior, source intake, immutable Skills/response snapshots
and the legacy local simulations. Compatibility is evaluated on parsed JSON
documents; object key order and whitespace in serialized JSON fields are not a
byte-for-byte promise. Array order and source-mapping field validation order are
preserved where they carry behavior.

The following differences are deliberate and covered by focused fixtures or
storage checks, rather than attempts to reproduce permissive SQLite failures:

- Tenant-qualified provider and relationship joins prevent foreign-tenant
  enrichment. The legacy unqualified provider join is not retained.
- Malformed numeric/boolean/date bindings are rejected with client errors instead
  of storing invalid PostgreSQL values or reproducing SQLite's generic server error.
  Supported legacy scalar conversions have explicit shared fixtures.
- Missing parent resources receive a domain error rather than a raw foreign-key
  failure. Mutations still roll back their data, history and audit writes together.
- Timestamp ties have deterministic insertion or ID ordering. Legacy queries
  without a tie-breaker do not define a portable order.
- Credential PATCH accepts strings; arbitrary JavaScript object-to-string
  conversion is not a supported secret format. Connector secrets are encrypted
  with tenant/record-bound authenticated envelopes and never returned publicly.
- Stored HTTPS reference links are recorded without fetching remote content.
  Unsupported/malformed URLs and file types are rejected. Reference materials
  do not gain remote execution or server-side file access.

ASCII search retains the existing SQLite-oriented behavior. Exotic Unicode
case-folding and malformed input differences are documented limitations, not a
claim of exact JavaScript/SQLite emulation for every possible input.

The first embedded WASM transformation uses pinned Wasmi with fuel, a one-page
memory ceiling and no host imports. This replaces the earlier proposed Wasmtime
choice for the small interpreter-only foundation. Rust still has no database
authority. The Python sample runs as a bounded child process without inherited
database or RPC credentials; it is trusted allowlisted code, not a general-purpose
untrusted-code sandbox. The [plugin manifest](../../contracts/plugins.json)
records these boundaries.

These decisions do not enable live containment, external hunt queries, provider
adapters, arbitrary plugin upload or new autonomous agent behavior. Those remain
separate product work.
