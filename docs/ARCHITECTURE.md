# Application Architecture

## Context

```text
┌──────────────────────┐      HTTP/JSON       ┌─────────────────────────┐
│ React + Chakra UI    │ ───────────────────▶ │ Fastify API             │
│ :8080                │ ◀─────────────────── │ :3002                   │
└──────────────────────┘                      └────────────┬────────────┘
                                                         │
                                              Domain services/repositories
                                                         │
                                              ┌──────────▼──────────┐
                                              │ SQLite: sqlite.db   │
                                              └─────────────────────┘
```

## Backend Structure

```text
backend/
  src/
    app.ts             Fastify composition root
    server.ts          process lifecycle
    config.ts          environment parsing
    database.ts        SQLite adapter, schema, migrations, seeds
    errors.ts          API error mapping
    routes/            transport controllers by domain
    services/          use cases and action orchestration
    repositories/      tenant-scoped persistence
    types/             domain and API contracts
  data/sqlite.db       local data, ignored from source control
  test/                API integration tests
```

## Domain Modules

| Module | Responsibility | Production analogue |
|---|---|---|
| Investigations | Triage lifecycle, determination, status, replay | `investigation.v2` |
| Incidents | Alert/case records and aggregate statistics | `incident.v2` |
| Artifacts | Evidence and entity graph | `artifact.v2` |
| Detection rules | Rule CRUD, state, recommendation metrics | detections control plane |
| Hunts | Hunt definitions, executions, findings | threat-hunt BFF routes |
| Connectors | Definitions, instances, configuration health | `connector.v1` |
| Remediations | Proposed actions, approval, execution status | investigation actions/flow service |
| Dashboard | Read-only aggregate projections | BFF aggregation |

## Request Lifecycle

1. React calls the API client.
2. The client sends `X-Tenant-Id`; local default is `demo`.
3. A Fastify route validates parameters/body.
4. A service enforces state transitions and invokes a repository.
5. The repository always scopes reads/writes by `tenant_id`.
6. SQLite commits the transaction.
7. The route returns a stable JSON resource or action result.

## Future Production Adapters

- Replace SQLite repository with PostgreSQL without changing service APIs.
- Add Descope JWT verification as a Fastify authentication plugin.
- Generate ConnectRPC handlers from `.proto` files for service-to-service parity.
- Add WebSocket/SSE event transport for investigation and hunt progress.
- Move long-running actions to a workflow engine and queue.
