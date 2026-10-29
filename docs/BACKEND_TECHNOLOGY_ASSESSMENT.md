# Production Backend Technology Assessment

The public-client observations below are historical reference findings from the
original assessment, not a fresh verification of the vendor's current system.
AISOC's own active architecture is Go/PostgreSQL with optional Rust/WASM and
Python runtimes as of 2026-10-29. See [architecture](ARCHITECTURE.md).

## Confidence Levels

### Confirmed From Public Client Assets

| Area | Evidence | Confidence |
|---|---|---|
| Schema format | Generated `proto3` types from `@bufbuild` | High |
| Service domains | `investigation.v2`, `incident.v2`, `artifact.v2`, `connector.v1`, `flow_service.v2`, `org_context.v1` | High |
| JSON API | BFF requests under `{apiUrl}/api`; control-plane requests under `/api/tenants/{tenantId}` | High |
| Authentication | Descope SDK, bearer JWTs, `/auth/session/logout` | High |
| Tenant isolation | `X-Tenant-Id` plus tenant-scoped paths | High |
| Realtime | `wss://ws.{region}.prod.sevenai.com`; JWT in connection query; reconnect queue | High |
| Region routing | `https://api.{region}.prod.sevenai.com`; default region `use2` | High |
| Client cache | React Query patterns | High |

### Not Observable From Browser Assets

- Server implementation language and framework
- Primary production database
- Message broker or workflow engine
- Internal service topology
- Kubernetes/cloud deployment details

The protobuf contracts make Go, Java, TypeScript, Rust, and Python equally possible.
Claiming a specific production server language would be speculation.

## Local Technology Decision

The original local prototype used the following TypeScript stack. It was replaced
after the gates in [ADR 002](adr/002-go-backend-replacement.md) and the
[completed migration plan](GO_BACKEND_MIGRATION_PLAN.md) passed. It remains a
comparison/recovery reference, not the active backend.

Historical prototype:

- Fastify for HTTP routing and JSON schema validation
- Node 24 built-in `node:sqlite` for the first persistence adapter
- TypeScript domain modules aligned to production protobuf packages
- REST/JSON first for rapid React integration
- Transport-neutral service functions so ConnectRPC can be added later
- Tenant-scoped repositories from day one

The active Go choice was verified independently of assumptions about the vendor's
implementation language. Enterprise identity, live provider execution and realtime
transport remain product/deployment work; see [roadmap](ROADMAP.md).
