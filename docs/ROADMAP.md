# Delivery Roadmap

## Phase 1 - Local Modular Monolith ✅ COMPLETE

- [x] SQLite schema v2 (9 tables) and deterministic seed data
- [x] CRUD for investigations, rules, hunts, connectors, remediations
- [x] Dashboard projection endpoint
- [x] React API client with mock fallback
- [x] Integration tests (health, CRUD, tenant isolation, threat intel)
- [x] Threat intel reports and indicators (tables, API, frontend)
- [x] PlatformService layer with cross-resource aggregation

## Phase 2 - Complete Detection Platform ✅ COMPLETE

- [x] MITRE ATT&CK coverage matrix with technique drill-down
- [x] Detection rule catalog (10 deployable rules from community/7AI)
- [x] Noisy-rule tuning recommendations with FPR analysis
- [x] Alert routing modal (rule → connector destination mapping)
- [x] Detection rule detail view (4 tabs: overview, logic, history, settings)
- [x] Detection rule toggle (enable/disable) with API integration

## Phase 3 - Investigation & Response ✅ COMPLETE

- [x] Investigation detail with 5-tab layout (Summary, Artifacts, Transcript, I/O, Debug)
- [x] Enhanced transcript view with expandable steps, queries, timing, verdict panel
- [x] Reinvestigate action with replay count tracking
- [x] Determination workflow (unknown → benign/suspicious/malicious/mitigated)
- [x] Response center with bulk execute and confirmation modal
- [x] Connector setup wizard (4-step carousel for Cribl)

## Phase 4 - Threat Intelligence ✅ COMPLETE

- [x] Threat intel feed dashboard with summary metrics
- [x] Threat intel report detail with IOC table
- [x] Launch hunt from threat intel reports
- [x] Threat intel dashboard API (aggregated stats by source)
- [x] IOC types: IP, domain, hash (SHA256/MD5), URL, email, CVE

## Phase 5 - UI/UX Polish ✅ COMPLETE

- [x] SVG icon system (30+ inline icons replacing text Unicode characters)
- [x] Proper navigation icons (bell, user avatar initials, chevron dropdowns)
- [x] Breadcrumb with grid icon and chevron separator
- [x] Tool rail with grid, plus, message, settings icons
- [x] Detection table sort arrows, filter funnel, search magnifier
- [x] Responsive CSS: tablet breakpoint (1024px), improved mobile (760px)
- [x] Removed aggressive `!important` CSS overrides
- [x] Fixed button hover jumpiness (translateY → opacity)

## Phase 6 - Extended Product Workflows (NEXT)

- [ ] Artifacts/entity graph CRUD and visualization
- [ ] Investigation transcript and feedback records (API-backed)
- [ ] Case management and task tables
- [ ] Connector-specific form schemas (beyond Cribl)
- [ ] Audit events for every mutation/action
- [ ] Pagination, sorting, bulk actions, optimistic UI
- [ ] Hunt dashboard with live query execution
- [ ] Memory/knowledge base with search and tagging

## Phase 7 - Production Security

- [ ] Descope JWT verification and RBAC
- [ ] Enforced tenant claims instead of caller-provided tenant defaults
- [ ] Secret manager integration
- [ ] Rate limiting, idempotency keys, request correlation IDs
- [ ] Structured audit logs and OpenTelemetry

## Phase 8 - Production Transport and Scale

- [ ] ConnectRPC/Protobuf contracts matching domain packages
- [ ] WebSocket or SSE progress streams
- [ ] PostgreSQL repository adapter
- [ ] Queue/workflow engine for hunts and remediations
- [ ] Object storage for large evidence payloads

## Phase 9 - Operations

- [ ] Container images and health/readiness checks
- [ ] Database backups and migration automation
- [ ] CI checks: lint, typecheck, tests, contract compatibility
- [ ] SLO dashboards and alerting
