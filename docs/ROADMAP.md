# Delivery Roadmap

## Phase 1 - Local Modular Monolith

- SQLite schema and deterministic seed data
- CRUD for investigations, rules, hunts, connectors, remediations
- Dashboard projection endpoint
- React API client with mock fallback
- Integration tests and local scripts

## Phase 2 - Complete Product Workflows

- Artifacts/entity graph CRUD
- Investigation transcript and feedback records
- Case management and task tables
- Connector-specific form schemas
- Audit events for every mutation/action
- Pagination, sorting, bulk actions, optimistic UI

## Phase 3 - Production Security

- Descope JWT verification and RBAC
- Enforced tenant claims instead of caller-provided tenant defaults
- Secret manager integration
- Rate limiting, idempotency keys, request correlation IDs
- Structured audit logs and OpenTelemetry

## Phase 4 - Production Transport and Scale

- ConnectRPC/Protobuf contracts matching domain packages
- WebSocket or SSE progress streams
- PostgreSQL repository adapter
- Queue/workflow engine for hunts and remediations
- Object storage for large evidence payloads

## Phase 5 - Operations

- Container images and health/readiness checks
- Database backups and migration automation
- CI checks: lint, typecheck, tests, contract compatibility
- SLO dashboards and alerting
