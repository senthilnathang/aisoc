# Threat Intel → Hunt → Investigate

Implemented and locally verified on 2026-11-01. React 19/Chakra screens use the Go
API and PostgreSQL. No external feed, model call or response action is enabled by
this workflow.

## Analyst workflow

1. Open **Threat Intel → Reports → Import JSON**. Upload or paste the
   [example document](../examples/threat-intel/local-login.json).
2. Select **Validate JSON**. Review canonical indicators and duplicate counts;
   editing the document clears validation. Select **Import validated JSON**.
3. In the report's **Indicators** tab, select **Create local hunt** for an IOC.
4. Select **Run local search**. Review the saved query, scope, findings and source
   evidence case. Search is a case-insensitive literal substring match over the
   latest 500 tenant cases and 500 artifacts, returning at most 100 matches.
5. Select **Promote to investigation**, enter a 10–2000-character review comment
   and explicitly confirm. Promotion creates an **open / unknown** investigation
   with an immutable evidence snapshot, source links, actor and audit records.
6. Open the promoted investigation. Its Summary links back to the hunt, original
   evidence case and intelligence report. Existing investigation review features
   remain available. Promotion itself does not run an AI investigation or grant
   response authorization.

A match is a review signal, not proof of compromise. An empty search is
inconclusive. This bounded local search does not query QRadar or search every
retained telemetry event. Imported text remains untrusted data.

## JSON contract and deduplication

Schema `"1"` requires source, external_id, title, severity, published_at and
1–200 indicators. Summary and tags are optional. Request/file limit: 1 MiB.
Published time must be RFC3339 with a timezone and is stored in UTC. Source is
bounded to 100 characters, external ID to 128, title to 200, summary to 8000,
and tags to 20 items of at most 50 characters.

Supported types: `ip`, `domain`, `url`, `hash_sha256`, `hash_md5`. Values are
bounded to 200 bytes to remain compatible with local hunt queries. IPs use
canonical address notation; domains are lowercase ASCII with a trailing dot
removed (use punycode for international names); hashes are lowercase hex. URLs
must be HTTP(S), have a valid host and port, and contain no embedded credentials.
Host/scheme/default ports are normalized, fragments removed, path/query case
preserved. URLs are **not fetched**. Wildcards, defanged values, unsupported types,
invalid hashes and address zones are rejected. The legacy manual indicator
editor is unchanged; these stricter rules apply to the JSON import path.

Duplicates within a report collapse by normalized `(type,value)`; the highest
severity wins. Tags and indicators are sorted before hashing. Tenant comes from
authentication, never JSON. `(tenant,source,external_id)` identifies an import:
identical canonical content returns its existing report; different content
returns `409 IMPORT_CONFLICT`. Use a new external ID for revisions. Identical
IOCs in different reports retain separate provenance. Replaying an import does
not overwrite subsequent analyst edits. Original counts/hash remain in the
import receipt even if the report is edited later.

## Architecture and atomicity

```mermaid
sequenceDiagram
    participant UI as React UI
    participant Go as Go API
    participant DB as PostgreSQL
    UI->>Go: Validate JSON (no write)
    Go-->>UI: Canonical preview and duplicate counts
    UI->>Go: Import JSON
    Go->>DB: Report + IOCs + receipt + audit (transaction)
    UI->>Go: Create IOC hunt and run local search
    Go->>DB: Tenant-scoped saved run and evidence matches
    UI->>Go: Promote stored run/finding + comment + confirmation
    Go->>DB: Lock hunt; check promotion receipt
    Go->>DB: Case + artifact snapshot + receipt + audits (transaction)
    Go-->>UI: Open/unknown investigation with provenance
```

Go owns validation, tenancy, replay and transaction boundaries. New queries use
sqlc/pgx. Case creation reuses `investigations.CreateTx`, including normal skill
snapshots and audit. No broker, Redis or worker dependency was added.

Promotion identity is `(tenant,hunt,run,finding_kind,record_id)`. Concurrent
retries return the original case/comment/actor. A different run is a new review
context and may create another investigation. Only findings actually stored in
the tenant's run can be promoted. Up to 100 promotions per hunt are allowed.
Report/target deletion leaves a receipt tombstone; replay returns `410` instead
of resurrecting data. Evidence snapshots survive source case/hunt/report edits
or deletion; source navigation may then show not found. Tenant deletion tooling
must explicitly handle retained receipts and retention policy.

## API and implementation

| Endpoint | Purpose |
|---|---|
| `POST /api/v1/threat-intel/import/preview` | Strict validation and canonical preview |
| `POST /api/v1/threat-intel/import` | Atomic report/IOC import or replay |
| `POST /api/v1/hunts/{id}/promote` | `{run_id,record_id,kind,comment,confirm:true}` |
| `GET /api/v1/investigations/{id}/hunt-origin` | Tenant-scoped immutable provenance |

Report workspace adds `imports`; hunt workspace adds `intel` and `promotions`.
Existing APIs remain compatible. Migration **044** adds `threat_json_imports`
and `hunt_promotions`; it does not rewrite existing tables. Rollback: deploy the
previous application, leave the additive tables/receipts intact. Do not drop
receipt data to retry imports or promotions.

Code: `backend-go/internal/modules/threatintel/import.go`,
`backend-go/internal/modules/hunts/promotion.go`, module `queries/` and generated
sqlc packages; `internal/transport/httpapi/intel_hunt_flow.go`;
`frontend/src/IntelHuntFlow.jsx` and the three existing workspace components.

## Verification and demo

- `python3 scripts/framework/check_detection_intelligence.py`: disposable PostgreSQL,
  race-enabled module/HTTP suite; concurrent deduplication, identity conflicts,
  tenant boundaries, fabricated finding rejection, confirmation requirement,
  atomic rollback on audit failure, saved artifacts and deletion tombstones.
- `go vet ./internal/modules/... ./internal/transport/httpapi` and `make sqlc-check`
  from `backend-go`; frontend lint/build and nine Node frontend checks.
- `scripts/framework/intel-hunt-demo-browser.js`: real local UI/API flow; creates
  a clearly labeled synthetic source case, imports the example, runs a hunt and
  promotes evidence. Requires local development auth/demo tenant. This script
  deliberately retains data and creates a new hunt when rerun.
- `scripts/framework/intel-hunt-regression-browser.js`: run after the demo script;
  discovers its retained records. Tests invalid JSON/credential URL rejection,
  preview invalidation, real API import replay/conflict, late response after
  closing the modal, promotion failure/retry (intercepted), and mobile layout.
- Browser screenshots in ignored `output/playwright/intel-*.png`. Tested at
  1440px and 390px; evidence is local validation, not provider certification.

Retained showcase: [report](http://localhost:8080/threat-intel/TIR-a67a7f37-0689-46a5-8f34-2a97efd1120e),
[hunt](http://localhost:8080/hunt/threat-hunting/HUNT-d2275847-a77f-4aec-8737-a7c2774ac9d4),
[investigation](http://localhost:8080/investigations/INV-8d6b3501). These IDs belong
to this local installation, not a fresh checkout.

Next scope: live/configurable feed synchronization, exact IOC matching and
broader source searches, cross-run investigation correlation, production retention
for provenance receipts, and separately evaluated model-assisted investigation.
