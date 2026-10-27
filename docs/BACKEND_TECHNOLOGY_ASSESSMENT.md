# Production Backend Technology Assessment

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

Use a modular TypeScript service:

- Fastify for HTTP routing and JSON schema validation
- Node 24 built-in `node:sqlite` for the first persistence adapter
- TypeScript domain modules aligned to production protobuf packages
- REST/JSON first for rapid React integration
- Transport-neutral service functions so ConnectRPC can be added later
- Tenant-scoped repositories from day one

This choice optimizes local delivery without pretending to know the production language.
It preserves the production architecture's observable boundaries and provides a direct
path to PostgreSQL, Descope verification, ConnectRPC, and WebSockets.
