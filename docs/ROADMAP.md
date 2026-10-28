# Delivery Roadmap

Current implementation and remaining platform work are tracked in
[AI SOC Feature Roadmap](FEATURE_ROADMAP.md). Skills library/authoring, material
versions, environment suggestions, runtime matching, outcomes, detection registry
and intelligence, hybrid intake, auth modes, and the local alert pipeline are
implemented. API tests cover the core Skills CRUD, publish, tenant-scope, material
version/archive, type, and size paths; Skills suggestion/runtime/feedback/outcome
end-to-end combinations still need dedicated coverage. Detection queries and
external security actions remain local configuration/simulations until provider
adapters ship.

The longer-term AI SOC capability plan, implementation order, metrics provenance,
and UI/compatibility guardrails are in [AI SOC Feature Roadmap](FEATURE_ROADMAP.md).

## Skills slice 1 — library and scoped authoring

- [x] Tenant-scoped skill CRUD, searchable library, and starter templates.
- [x] Plain-language content, tags, and relevance scopes.
- [x] Draft, publish, enable/disable, and audit history.
- [x] Generate reviewable suggestions only from repeated closed/resolved analyst-labeled cases.
- [x] Linked Markdown/text/JSON/CSV references, checklists, examples, and HTTPS links.
- [x] Material type and size limits, archive behavior, and per-material snapshots.
- [x] Runtime matching for cases and hunts with matched version/rationale recorded.
- [x] Context-reference matching, analyst helpfulness ratings, and labeled-case outcomes.

Coverage follow-up: add focused tests for generated-suggestion eligibility and
accept/dismiss behavior; matching a published skill to case and hunt context;
feedback updates; and consistency of per-skill outcome totals. These features
are implemented, but are not covered by the current `skills.test.ts` cases.

## Detection step 1 — registry and rule workspace

- [x] Server-side tenant-scoped search, source/status/severity filters, sorting, pagination, and totals.
- [x] Live counts from stored alerts and linked cases; unassessed FPR stays unknown.
- [x] Disabled rule cloning, transactional configuration versions, stale-write conflict protection.
- [x] Compact registry, desktop inspector, mobile/full-page details, editable logic/routing, versions and audit history.
- [x] Existing catalog metadata available through the create-rule template selector.
- [x] API tests for filters, isolation, counts, references, persistence, and conflicting saves.

Coverage and tuning demonstrations are superseded in the active registry by real
rule data. Calculated ATT&CK coverage, routing policies, and evidence-based tuning
remain separate implementation steps.

## Detection step 2 — detection intelligence

- [x] Tenant-scoped alert inventory with 7/30/90-day window and exact source/severity filters.
- [x] Daily severity trend, source volume, routing outcomes, and linked case determinations.
- [x] Recent alerts link directly to rule details and investigations; empty periods remain explicit.
- [x] API-source alerts aggregate under their configured provider label.

Counts use received alert rows and distinct linked investigations. Legacy manual
cases are not in alert intake and therefore do not appear in this inventory.

## Hybrid API intake — implemented

- [x] Tenant-bound operator authentication and browser sessions with CSRF protection.
- [x] Provider-neutral sources bound to detection rules, with scoped ingestion keys.
- [x] One-time key display, hashed storage, expiration, immediate rotation/revocation.
- [x] API source management screen and normalized-alert ingestion endpoint.
- [x] Authentication, tenant boundary, key lifecycle, and expiry integration tests.

Next: configurable mapping of native provider payloads into the normalized alert
contract. Vendor polling, external tools, SSO, and granular operator roles remain
future work; the current worker still performs deterministic local analysis.

## Alert-to-investigation pipeline — implemented sequentially

- [x] Validated alert ingestion with tenant/source/external-ID deduplication and conflict detection.
- [x] Atomic alert, rule-counter, investigation, job, and audit persistence.
- [x] Rule routing: investigate, escalate for analyst review, deterministic 10% sample, or suppress.
- [x] Durable local worker: record supplied evidence → compare local indicators → record review outcome.
- [x] Phase rollback on failure, explicit retry, restart recovery, and protection from concurrent analyst outcome edits.
- [x] Live investigation queue, alert intake form, received-alert view, case progress polling, and recorded tool I/O.
- [x] API tests for duplicate retries, scope isolation, routing, restart, failure recovery, and background completion.

This is a working local pipeline. A completed run leaves the case open for analyst
review; it does not establish benign or malicious behavior. Real security-provider
adapters remain future deployment work. Token-based tenant claims are implemented.

## October 27, 2026 implementation pass

The earlier completion labels below describe UI scaffolding and local simulations,
not live security-engine integrations. This pass implements and checks the
following sequence against the public 7AI investigations/detection references:

1. Inspect AgentGuard's launcher and adapt its start/stop/status/logs interface.
2. Start this workspace's backend and frontend through `run.sh`.
3. Capture each public investigation and detection reference image separately.
4. Add a non-destructive SQLite migration for rule query/schedule/routing,
   case transcripts/feedback, and tenant-scoped audit events.
5. Connect detection creation, catalog import, editing, routing, and history.
6. Replace shared investigation fixtures with case-specific summary, artifacts,
   transcript, tool I/O, feedback, determination, and review history.
7. Validate persistence/isolation through API tests, then verify browser workflows
   and capture the resulting screens.

Implemented: the launcher, migration, persisted detection/case workflows, audit
records for service mutations, and case-specific evidence views. Catalog entries
remain templates; imported rules are disabled until an analyst configures them.

Still required for a live platform: enterprise identity integration, real
SIEM query execution, external investigation tools, grounded AI chat, connector adapters,
real remediation, graph relationships, and live detection tuning/coverage. Existing
coverage/tuning dashboards are demonstrations. Transcripts include supplied-alert
processing and local indicator comparisons; no external tool worker is connected.

Visual evidence: `output/playwright/reference-*.png`, `after-*.png`, and
`verified-*.png`. The public site is a product reference, not an API specification.

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

## Historical phase 6 - Extended Product Workflows (superseded)

- [ ] Artifacts/entity graph CRUD and visualization
- [x] Investigation transcript and feedback records (API-backed)
- [ ] Case management and task tables
- [ ] Connector-specific form schemas (beyond Cribl)
- [x] Audit history for detection, investigation, API source, pipeline and Skills mutations
- [ ] Pagination, sorting, bulk actions, optimistic UI
- [ ] Hunt dashboard with live query execution
- [ ] Memory/knowledge base with search and tagging

## Phase 7 - Production Security (remaining)

- [ ] Descope JWT verification and RBAC
- [x] Enforced tenant claims in token mode; local mode still accepts the development tenant header
- [ ] Secret manager integration
- [ ] Rate limiting, idempotency keys, request correlation IDs
- [ ] Structured audit logs and OpenTelemetry

## Phase 8 - Production Transport and Scale (remaining)

- [ ] ConnectRPC/Protobuf contracts matching domain packages
- [ ] WebSocket or SSE progress streams
- [ ] PostgreSQL repository adapter
- [ ] Queue/workflow engine for hunts and remediations
- [ ] Object storage for large evidence payloads

## Phase 9 - Operations (remaining)

- [ ] Container images and health/readiness checks
- [ ] Database backups and migration automation
- [ ] CI checks: lint, typecheck, tests, contract compatibility
- [ ] SLO dashboards and alerting
