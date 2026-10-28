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
    database.ts        SQLite adapter, schema migrations and seeds
    auth.ts            local/token authentication, sessions, CSRF, tenant identity
    pipeline-schema.ts additive schema for pipeline, detection and Skills domains
    errors.ts          API error mapping
    routes.ts          all resource CRUD + custom action routes
    services/
      platform-service.ts   investigations, detection, hunts and projections
      alert-pipeline.ts     normalized intake, routing, durable local worker
      api-sources.ts        tenant-bound source keys and lifecycle
      skills.ts             authoring, materials, matching and outcomes
    repositories/
      store.ts              generic tenant-scoped CRUD for all resource tables
    types/
      domain.ts             severity, status, determination, threat intel types
  data/sqlite.db       local data, ignored from source control
  test/                integration tests by domain workflow
```

## Frontend Structure

```text
frontend/
  src/
    main.jsx           App shell, navigation and client-side route selection
                        ├── Icon system (30+ inline SVG icons)
                        ├── TopNav, ToolRail, Breadcrumb, Shell (layout)
                        ├── Operations queue dashboard
                        ├── InvestigationQueue + InvestigationCase
                        ├── DetectionRegistry + DetectionIntelligence
                        ├── Skills library, authoring, references and outcomes
                        ├── HuntDashboard (ad-hoc hunts, mode toggle)
                        ├── RespondCenter (bulk execute, confirmation modal)
                        ├── ThreatIntelFeed + ThreatIntelDetail
                        ├── MemoryStore
                        ├── ConnectorSetupLive (4-step wizard)
                        └── App (client-side router via pushState)
    api.js             API client with all endpoints
    Skills.jsx         Skills library, editor, materials and outcomes
    DetectionRegistry.jsx searchable registry and rule inspector
    InvestigationQueue.jsx / InvestigationCase.jsx case workflows
    ApiSources.jsx     hybrid intake source management
    theme.js           Chakra UI theme with `ui` color tokens
    app.css            Animations, responsive breakpoints (760px mobile, 1024px tablet)
```

## Domain Modules

| Module | Responsibility | Production analogue |
|---|---|---|
| Investigations | Triage lifecycle, determination, status, replay | `investigation.v2` |
| Incidents | Alert/case records and aggregate statistics | `incident.v2` |
| Artifacts | Evidence and entity graph | `artifact.v2` |
| Detection Rules | Versioned rule configuration, registry, alert metrics, routing | detections control plane |
| Hunts | Hunt definitions, executions, findings | threat-hunt BFF routes |
| Connectors | Definitions, instances, configuration health | `connector.v1` |
| Remediations | Proposed actions, approval, execution status | investigation actions/flow service |
| Threat Intel Reports | Intelligence reports, IOC tracking, hunt launching | threat intel BFF |
| Threat Indicators | IOC values (IP, domain, hash, CVE), hit counts | indicator store |
| Dashboard | Read-only aggregate projections | BFF aggregation |
| Alert pipeline | Normalized intake, deduplication, routing and resumable local processing | ingestion workflow |
| API sources | Tenant-bound key issuance, expiry, rotation and revocation | integration gateway |
| Skills | Versioned guidance, references, scope matching, feedback and outcomes | playbooks/knowledge |

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

1. React calls the API client (`api.js`) through the same-origin `/api` proxy.
2. Local mode uses the configured development tenant header. Token mode derives
   tenant identity from operator credentials or browser session; source keys are
   restricted to alert intake.
3. A Fastify route validates parameters/body via TypeBox schemas.
4. Fastify routes to `PlatformService`, `AlertPipeline`, `ApiSources`, or `Skills`.
5. Services scope records by tenant and transact related SQLite writes.
6. The durable local alert worker resumes queued jobs after restart.
7. Skills matching snapshots published guidance and rationale into case transcripts
   or hunt records. It records guidance for analyst review; it does not execute it.
8. The route returns a stable JSON resource or action result.

## Future Production Adapters

- Replace SQLite repository with PostgreSQL without changing service APIs.
- Add enterprise SSO and granular operator roles to existing token/session auth.
- Generate ConnectRPC handlers from `.proto` files for service-to-service parity.
- Add WebSocket/SSE event transport for investigation and hunt progress.
- Move long-running actions to a workflow engine and queue.
