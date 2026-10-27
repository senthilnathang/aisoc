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
    database.ts        SQLite adapter, schema v2 (9 tables), migrations, seeds
    errors.ts          API error mapping
    routes.ts          all resource CRUD + custom action routes
    services/
      platform-service.ts   use cases, aggregation, cross-resource logic
    repositories/
      store.ts              generic tenant-scoped CRUD for all resource tables
    types/
      domain.ts             severity, status, determination, threat intel types
  data/sqlite.db       local data, ignored from source control
  test/
    api.test.ts        integration tests (health, CRUD, tenant isolation, threat intel)
```

## Frontend Structure

```text
frontend/
  src/
    main.jsx           Single-file SPA (~3500 lines)
                        ├── Icon system (30+ inline SVG icons)
                        ├── TopNav, ToolRail, Breadcrumb, Shell (layout)
                        ├── Operations queue dashboard
                        ├── InvestigationDetail (5 tabs, transcript, verdict)
                        ├── DetectionRules (MITRE matrix, catalog, tuning, routing)
                        ├── DetectionRuleDetail (4 tabs, edit mode)
                        ├── HuntDashboard (ad-hoc hunts, mode toggle)
                        ├── RespondCenter (bulk execute, confirmation modal)
                        ├── ThreatIntelFeed + ThreatIntelDetail
                        ├── MemoryStore
                        ├── ConnectorSetupLive (4-step wizard)
                        └── App (client-side router via pushState)
    api.js             API client with all endpoints
    theme.js           Chakra UI theme with `ui` color tokens
    app.css            Animations, responsive breakpoints (760px mobile, 1024px tablet)
```

## Domain Modules

| Module | Responsibility | Production analogue |
|---|---|---|
| Investigations | Triage lifecycle, determination, status, replay | `investigation.v2` |
| Incidents | Alert/case records and aggregate statistics | `incident.v2` |
| Artifacts | Evidence and entity graph | `artifact.v2` |
| Detection Rules | Rule CRUD, toggle, MITRE techniques, recommendations | detections control plane |
| Hunts | Hunt definitions, executions, findings | threat-hunt BFF routes |
| Connectors | Definitions, instances, configuration health | `connector.v1` |
| Remediations | Proposed actions, approval, execution status | investigation actions/flow service |
| Threat Intel Reports | Intelligence reports, IOC tracking, hunt launching | threat intel BFF |
| Threat Indicators | IOC values (IP, domain, hash, CVE), hit counts | indicator store |
| Dashboard | Read-only aggregate projections | BFF aggregation |

## SVG Icon System

The frontend uses an inline SVG icon system (`Icon` namespace in `main.jsx`) instead of an
icon library. Each icon is a pure functional component accepting `size`, `color`, and spread
props. This avoids external font/icon dependencies and keeps bundle size minimal.

Available icons: `search`, `filter`, `bell`, `chevronDown`, `chevronRight`, `chevronLeft`,
`arrowLeft`, `sort`, `grid`, `plus`, `settings`, `user`, `star`, `clock`, `play`, `refresh`,
`eye`, `shield`, `zap`, `activity`, `alertCircle`, `check`, `x`, `externalLink`,
`messageSquare`, `clipboard`, `calendar`, `target`, `layers`, `compass`.

## CSS Architecture

- **Page transitions**: `.page-enter` class with `enter` keyframe animation (0.18s fade+slide)
- **Focus ring**: Violet (`#6056e8`) focus-visible ring on buttons, inputs, selects
- **Responsive**: Tablet breakpoint at 1024px (narrower tool rail), mobile at 760px (hide tool rail + account nav, horizontal table scroll)
- **Custom scrollbars**: `.thin-scroll` for narrow 5px scrollbar tracks
- **Metric typography**: `.metric-number` uses Review Condensed font for dashboard numbers

## Request Lifecycle

1. React calls the API client (`api.js`).
2. The client sends `X-Tenant-Id`; local default is `demo`.
3. A Fastify route validates parameters/body via TypeBox schemas.
4. `PlatformService` enforces state transitions and invokes the generic `Store`.
5. The `Store` always scopes reads/writes by `tenant_id`.
6. SQLite commits the transaction synchronously.
7. The route returns a stable JSON resource or action result.

## Future Production Adapters

- Replace SQLite repository with PostgreSQL without changing service APIs.
- Add Descope JWT verification as a Fastify authentication plugin.
- Generate ConnectRPC handlers from `.proto` files for service-to-service parity.
- Add WebSocket/SSE event transport for investigation and hunt progress.
- Move long-running actions to a workflow engine and queue.
