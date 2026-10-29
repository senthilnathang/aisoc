# Backend migration phase-zero record

Historical milestone, superseded by the completed 2026-10-29
[release status](RELEASE_STATUS.md). Node is no longer the active release backend.

Phase zero established 97 route contracts, the 26-table migration map, real-HTTP
functional/auth fixtures, 16 API-backed journey mappings and baseline/lifecycle
comparison tooling. Later phases completed domain implementations, Skills,
browser verification, specialist runtimes, migration/reverse export, controlled
performance/soak, operations and cutover. Earlier pending-domain notes are closed.

Route probing is not exhaustive behavioral equivalence. Malformed JavaScript/SQLite
inputs and exotic Unicode remain bounded by [ADR 003](../adr/003-replacement-contract-decisions.md).
See [testing](../TESTING.md) for current verification and remaining opportunities.

References: [endpoint matrix](ENDPOINT_MATRIX.md), [migration map](DATA_MIGRATION_MAP.md),
[historical Node baseline](NODE_BASELINE.md), [current performance](PERFORMANCE.md).
