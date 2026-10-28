# AI SOC Feature Roadmap

This roadmap translates the supplied 7AI capability list into incremental work
for AISOC. It extends existing routes and data models while preserving current
workflows and responsive behavior. Local development remains login-free by
default; optional token authentication is available for validating secured flows.
Each phase adds to the current UI rather than replacing it.

## Current foundation

- **Cases and investigations:** case detail, evidence, free-form analyst comments,
  history, durable alert-to-case processing, and a queue exist. Processing is
  local and deterministic, without external investigation tools or autonomous
  reasoning. Structured true-positive/false-positive labels are still planned.
- **Detection:** a searchable, paginated rule registry, versioned edits, alert
  metrics, and a detection intelligence dashboard exist. Counts reflect stored
  ingested alerts; false-positive rate remains unassessed without explicit labels.
  Stored rule queries do not run against external systems; ATT&CK coverage and
  evidence-based tuning need real data.
- **Response:** local response/remediation flows exist, but do not perform actions
  against endpoint, identity, cloud, or network products.
- **Hunting and intelligence:** hunt definitions, local simulations, threat
  intelligence reports, and indicators exist. Cross-source querying and actual
  IOC extraction need integrations and a query layer.
- **Provider intake:** generic normalized-alert API sources and configurable
  native JSON field mapping with sample preview exist. Provider polling and
  provider action APIs remain future work.
- **Skills:** tenant-scoped strategy/content library, drafts and publishing,
  relevance scopes, linked/versioned materials, deterministic case-pattern
  suggestions, case/hunt application snapshots, analyst ratings, and sample-count
  outcomes exist. Matching records advisory guidance; it does not execute it.
- **Identity and tenancy:** local mode and token mode are implemented. Operator
  browser sessions are memory-backed; enterprise SSO, granular roles, managed
  secrets, and customer identity lifecycle are not implemented.

## Delivery status and next work

The local prototype foundation is implemented: cases, evidence and history;
detection registry and alert intelligence; normalized alert intake, source-key
lifecycle and durable local processing; and Skills authoring, materials, matching,
suggestions and outcomes. `docs/TESTING.md` lists the specific automated API
coverage. The current suite does not yet have automated UI or end-to-end tests.

Next work, in dependency order:

1. Complete one real, read-only provider adapter after a test tenant and API
   credentials are available. Connector health now stays `untested` unless a
   live adapter verifies it; seeded integrations no longer claim to be
   operational. The next slice is secure credential storage and a CrowdStrike
   OAuth/read-only alerts adapter, followed by bounded alert sync, freshness,
   provenance and tenant-isolation validation.
2. Add source-backed read-only case tools and evidence citations to the existing
   transcript. Preserve the deterministic worker as a fallback and keep plans
   observable for analysts.
3. Add explicit analyst true-positive/false-positive labels, then use those
   labeled samples for detection tuning and Skills outcome comparisons.
4. Replace simulated response actions only after provider action previews,
   authorization, confirmation, audit, retry and recovery behavior are defined.

Do not count stored rule queries, local indicator checks, seed fixtures, or
vendor-reported claims as provider execution or measured product results.

The [AppSecSanta 7AI review](https://appsecsanta.com/7ai) adds details about
parallel specialist agents, dynamic strategy selection, unified alert-to-case
correlation, organization-specific context, coexistence with existing SOAR,
monitor-first rollout, and customer-reported outcomes. These are planning inputs;
the review is a secondary source and its performance figures remain attributed
claims.

## Phased delivery

### 1. Data foundation and provider connectors — normalized intake and mapping shipped; provider adapters planned

- Define provider-neutral schemas for alerts, entities, evidence, cases, actions,
  query results, and connector health. Keep the normalized alert contract stable.
- Build a connector framework with typed capabilities, tenant-scoped credentials,
  health checks, rate limits, cursor-based incremental sync, retries, and audit logs.
- Add integration adapters incrementally: begin with one endpoint security source,
  one SIEM, one identity source, and one cloud/email source. Prioritize CrowdStrike,
  Splunk, Okta, AWS, and Microsoft 365 from the supplied list after validating API
  access and a test tenant. Expand the catalog toward 50+ as adapters are proven.
- Preserve API sources for webhook-based ingestion. Native-to-normalized dot-path
  field mappings and sample preview are implemented; mapped events use a separate
  scoped endpoint while direct normalized intake stays supported.

**Done when:** a configured connector can securely sync a bounded sample, map it
to the common schema, show freshness and errors, and link the events to existing
investigations. Secrets never appear in responses, logs, or screenshots.

### 2. Evidence-backed investigations and human feedback — local workflows shipped; provider tools planned

- Extend the current investigation worker with pluggable read-only tools: search
  alerts, query a connected provider, inspect entities, and retrieve related cases.
- Save every tool request, response, source, timestamp, and evidence reference in
  the existing transcript. Show citations from each finding back to source data.
- Add analyst labels for true positive, false positive, benign, and inconclusive;
  retain the existing determination workflow and record who changed each value.
- Add an investigation strategy record that states the next question, selected
  tools, evidence gaps, and reason for each step. Start with deterministic rules
  and make the plan visible and editable by the analyst.
- Let independent, read-only domain capabilities work in parallel when their
  evidence requirements do not depend on one another. Show their findings and
  conflicts together in the existing transcript; bound concurrency and cancel
  remaining work when a case closes or an analyst stops the run.
- Correlate related alerts into a unified case with explicit join evidence (shared
  identity, device, indicator, or time window). Keep auto-correlation suggestions
  reviewable so unrelated alerts do not silently merge.

**Done when:** a case can be replayed from its recorded inputs, every conclusion
is tied to evidence, analyst corrections persist, and new analysis never erases
prior transcript or feedback.

### 3. Detection coverage and tuning — registry/intelligence shipped; labeled tuning planned

- Replace demo ATT&CK counts with a versioned technique catalog and mappings from
  active rules. Distinguish mapped coverage from tested effectiveness and show
  the rules supporting each technique.
- Compute alert volume, case outcomes, and false-positive rates only from explicit
  analyst labels, with sample counts, time windows, and confidence/insufficient-data
  states. Unknown cases never count as false positives.
- Generate scoped recommendations as reviewable query diffs, with rationale,
  supporting examples, estimated impact clearly marked as an estimate, and
  validate/query-preview actions where the connected engine supports them.
- Require an authorized analyst to approve changes. Save versions and audit the
  proposal, approval, application result, and rollback path.

**Done when:** an analyst can trace every coverage score and tuning proposal to
its rule, mapped technique, observation window, and source evidence; no rule is
changed without explicit approval.

### 4. Dynamic reasoning and specialized agent capabilities — planned

- Define a common agent contract: scoped inputs, allowed tools, outputs, evidence
  references, budgets, timeout, retry policy, and human-approval requirements.
- Implement and evaluate a small set of capabilities first, such as endpoint
  process review, identity sign-in analysis, cloud audit review, email investigation,
  network activity correlation, and cross-domain entity enrichment.
- Select capabilities at runtime from the case evidence and connected integrations.
  The agent should explain its investigation plan and adapt when a query returns
  no data, an error, or contradictory evidence.
- Add offline scenario evaluation, replay, quality metrics, and safe fallback to
  analyst review before expanding the library. Grow toward the vendor-described
  60+ specialized agents only when each has a tested capability and clear scope.
- Introduce an observe-only rollout mode: generate plans and determinations for
  analyst comparison without triggering response actions. Preserve existing SOAR
  or connector workflows; allow teams to adopt agent-assisted triage alongside
  current automation before enabling approved response capabilities.

**Done when:** each agent is independently testable, tenant-scoped, bounded,
observable, and unable to perform unapproved response actions.

### 5. Human-approved response actions — local simulation exists; provider actions planned

- Replace simulated connector actions with explicit provider capabilities for
  endpoint isolation, account disablement, and IP blocking, where supported.
- Add an action preview with target, reason, evidence, expected impact, reversibility,
  provider, and exact requested operation. Require authorization and confirmation.
- Track requested, approved, running, succeeded, failed, and rolled-back states;
  preserve provider response IDs and an immutable audit trail.
- Add dry-run mode, idempotency, timeouts, retries safe for each action, and
  compensating actions where a provider supports recovery.

**Done when:** high-impact actions require a human approval, every transition is
audited, and failed/uncertain provider responses are visible without reporting
success prematurely.

### 6. Cross-system threat hunting and IOC extraction — local simulation exists; federation planned

- Build a federated query interface over connected sources, beginning with a
  bounded set of query types and a common result schema.
- Add saved hunts, time/source filters, query previews, execution progress, result
  limits, and durable findings linked to cases and entities.
- Extract candidate IOCs from reports and investigation evidence with provenance,
  confidence, deduplication, expiry, and analyst review before promoting them into
  shared intelligence or matching them against alerts.
- Keep the current local hunt simulation available until a real query adapter is
  configured; label simulated and provider-backed results clearly.

**Done when:** analysts can run and replay a scoped hunt across at least two
connected sources and trace every finding to its source event.

### 7. Enterprise context, dashboards, and reporting — partial local context exists; enterprise data planned

- Add an entity graph for people, accounts, hosts, applications, indicators, and
  cases with tenant-scoped relationships and source provenance.
- Add organization-managed context such as approved software, trusted service
  accounts, user roles, internal domains, and asset criticality. Keep each item
  sourced, scoped, dated, and editable; show which context influenced an
  investigation or recommendation.
- Build live operational views from persisted data: alert throughput, response
  times, investigation outcomes, connector freshness, coverage, and action state.
- Add configurable time ranges, filters, exports, scheduled reports, and a
  board-ready summary with metric definitions and data freshness.
- Separate operational measures from estimates and vendor claims; show data
  coverage and denominators beside every rate.

**Done when:** dashboard totals reconcile with underlying records, exports use
the same filters as the screen, and each metric includes its definition and period.

### 8. Cloud deployment and scale — planned

- Add production identity and role-based access, tenant provisioning, managed
  secret storage, HTTPS, rate limiting, database backups, and restore procedures.
- Move long-running work to a durable queue/worker with cancellation, concurrency
  limits, retries, backpressure, and workload isolation.
- Add load tests and capacity targets before making claims about multi-million
  alert processing. Partition or move persistence to PostgreSQL when measurements
  require it; archive large evidence in object storage.
- Add service health/readiness, request correlation, audit export, metrics, alerts,
  and operational runbooks.

**Done when:** restore, tenant isolation, worker recovery, and target throughput
are demonstrated in a production-like environment before enabling cloud onboarding.

## Vendor claims and metrics

The following are claims supplied by the user and attributed to 7AI. They are not
independently verified results for this application and must not be presented as
product performance or acceptance targets:

| Supplied claim | How to treat it during development |
|---|---|
| 60+ specialized agents | Vendor-reported capability count; expand our agents only with tested, distinct capabilities. |
| 95–99% false-positive reduction | Vendor-reported; define baseline, labeled sample, period, and calculation before evaluating locally. |
| 5M+ alerts; 732,910+ analyst hours saved | Vendor-reported cumulative counters; do not use as local system capacity or savings measurements. |
| Minutes instead of hours per investigation | Vendor-reported; instrument local start/end times and compare matched case types before making a claim. |
| $42.1M reclaimed value | Vendor-reported estimate; do not display as measured customer value. |
| 50+ integrations | Vendor-reported; our integration count includes only adapters that pass credential, sync, error, and isolation checks. |
| 80% reduction in Tier 1 analyst time; 95% fewer tickets needing human analysis (DXC) | Customer outcomes reported in the secondary review; not independently verified here. Establish a matched baseline before comparing local results. |
| 10× security-team capacity without added headcount (BigID) | Customer outcome reported in the secondary review; not a measured capacity result for this application. |

Local product metrics should include a definition, period, source, sample size, and
clear measured-versus-estimated status. Never seed live dashboards with these
vendor numbers.

## UI and compatibility guardrails

- Keep current `/investigations`, `/detect/rules`, `/detect/intelligence`, API
  source, response, hunt, and threat-intelligence routes working as phases ship.
- Add fields through backward-compatible migrations with safe defaults; keep old
  normalized alert payloads readable.
- Extend existing screens in place where workflows belong. Add new routes only
  for distinct workflows. Preserve filters, deep links, keyboard use, and narrow
  screen layouts.
- For each feature, deliver the data model and API first, then the UI, then
  representative desktop/mobile screenshots and regression checks before starting
  the next phase.

## Skills delivery slices

The [7AI Skills reference](https://7ai.com/platform/skills) describes reusable
plain-language investigation and hunting strategies, an authoring library,
published/draft states, and relevance scopes.

1. **Library and authoring (current):** tenant-scoped CRUD, searchable My Skills
   and starter template views, plain-language instructions, tags, module/alert/
   connector/entity/context scopes, draft/publish/enable controls, and audit history.
2. **Skill materials (current):** attach Markdown/text/JSON/CSV references,
   checklists, examples, and HTTPS links. Enforce 128 KB per text file and 10
   active materials per skill; edits create retrievable material snapshots.
3. **Environment-generated skills (current):** derive deterministic suggestions
   only from at least two closed/resolved cases with analyst determinations,
   grouped by observed alert source and category. Analysts can inspect, accept as
   an editable draft, or dismiss. This is pattern generation, not an AI claim.
4. **Runtime application (current):** match enabled published skills to incoming
   cases and hunt runs by module, connector, alert type/category, entities, and
   supplied enterprise context references. Store the matched version, snapshot,
   and rationale in the case transcript or hunt record. No match leaves normal
   handling unchanged.
5. **Context references and feedback (current):** case intake, case creation,
   and hunts accept context reference IDs; analyst ratings attach to an applied
   skill version. Report applications, ratings, and closed-case labels with
   sample counts. Do not infer causal improvement from these records.

Each slice adds a route under Skills and leaves existing investigation, hunt, and
detection workflows intact. Current runtime matching records guidance snapshots
and reasons for analysts; it does not inject instructions into an autonomous
agent planner or execute response actions.
