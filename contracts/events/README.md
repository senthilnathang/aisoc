# Streaming event contracts — milestone S01

These are new sandbox contracts, not the existing source HTTP API and not literal
QRadar vendor payloads. An adapter must map verified vendor data into these types.
No Redis service or live provider connector is introduced by these files.

- `telemetry-v1.schema.json`: projected authentication failure/success only.
- `finding-v1.schema.json`: suspicious-login investigation candidate requiring review.
- `fixtures/authentication-failed.json`: synthetic source observation, not production evidence.

Go enforcement is in `backend-go/internal/modules/telemetry`. `Decode` and
`DecodeFinding` reject unknown/duplicate fields, oversized envelopes, malformed
timestamps and source-binding mismatches. Binding must come from authenticated
connector configuration, never from the envelope being validated. Both envelopes
are limited to 16 KiB. JSON Schema consumers must enable format validation; byte
size, duplicate JSON keys, binding, evidence membership and deterministic identity
also require application checks.

Use UTC timestamps ending in `Z` (1970 onward). Source clock skew and event-time
lateness need explicit correlation policy in S05; they are not silently corrected
here. Evidence references are opaque, restricted identifiers, not permission to
fetch a URL. Resolve evidence through Go with source/tenant authorization.

`Identity()` hashes a JSON array containing tenant, connector, source, source event
ID, event type and opaque source revision. `ContentHash()` excludes delivery event
ID, ingestion time and trace ID, and normalizes equivalent times/IP addresses.
Identity and hashes are used only after validation. Same identity/different content
must fail as a conflict at the persistence layer. Exact replay must not create a
new effect. A revision change is a separate observation; do not compare revisions
lexically or assume source revision is a monotonically increasing integer.

Finding identity includes rule ID/version and sorted source event keys. Evidence
validation requires the supplied Go-owned source events, matching tenant/source,
all corresponding evidence references and an enclosing time range. This validates
provenance, not whether a detection rule fired. S05 supplies a bounded snapshot
rule in `telemetry.SuspiciousLogins`; see the
[mock flow](../../docs/MOCK_QRADAR_FLOW.md) for watermark and revision semantics.
Neither finding confidence nor action execution fields are allowed in this contract.

SOAR case state, reopenings, updates and conflict-aware write-back need their own
source contract. They must not be forced into authentication telemetry v1 or weaken
existing HTTP intake conflict checks. Extend versioned schemas deliberately; do
not silently accept arbitrary projections or unknown event families.

Run from `backend-go`:

```bash
go test -race ./internal/modules/telemetry
go test ./internal/modules/telemetry -run '^$' -fuzz FuzzDecode -fuzztime 10s -parallel 2
go vet ./internal/modules/telemetry
```

See [the implementation tasks](../../docs/IMPLEMENTATION_TASKS.md) and
[ADR 005](../../docs/adr/005-redis-streams-boundary.md).
