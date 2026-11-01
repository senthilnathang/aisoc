# Detect-to-Build end-to-end review — 2026-11-01

## Scope

Reviewed the local React 19/Chakra UI and Go/PostgreSQL application across Detect, Investigate, Respond, Hunt, Threat Intel, Skills, Memory and Build. Live browser reads used the existing demo tenant. Mutation/error/race tests used browser-local intercepts or disposable databases. No production services, real containment or external-provider validation was enabled.

## Fixes

| Issue | Change | Regression evidence |
| --- | --- | --- |
| Detect Overview mixed successful API totals with fabricated activity, health, reports and workload reduction | New Overview component shows only tenant dashboard counts and recent persisted investigation links; explicit loading/error/empty states and retry; no sample fallback | Empty-tenant browser fixture rejects the old sample facts |
| Respond fetched 100 actions then filtered locally, hiding older pending approvals | Server-side status/title-description search, 25-row pages; toolbar stays mounted during refresh | Browser requests pending status and next-page offset; continuous typing preserves focus |
| Response metrics described a truncated page | New tenant-scoped sqlc summary query counts all pending/completed actions, distinct cases with actions and active workflows | Database regression with 126 actions and a foreign tenant |
| Source creation could only select first 100 rules | Server search and 25-row paging for rule selection | Browser finds a rule beyond the initial registry page |
| Source list had no page traversal | Validated API limit/offset and parameterized tenant query; 25-row UI pages | Database nonoverlapping pages and tenant-isolation test; HTTP bounds tests |
| Cribl wizard promised automatic live validation | Clearly describes encrypted configuration storage and unsupported live checks; clears secret and returns to Build after save; no automatic test request | Browser rejects the old heartbeat/credential-acceptance promises |
| Navigation check assumed seven Respond links | Checks all eight named links instead | Desktop/mobile selection, Back/reload, focus restoration passed |
| HTTP parity fixture assumed legacy Skills deletion produced no audit | Go assertion now requires exactly one deletion audit; legacy Node expectation stays separate | Disposable HTTP authoring scenario |
| Detection Intelligence HTTP fixture rejected additive fields and dynamic timestamps | Preserve shared-field checks, explicitly assert Go linked/escalated counts and isolation, and exclude only read-window timestamps from restart equality | Disposable intelligence and restart scenarios |

Independent review caught and corrected source paging across the frontend/backend boundary and the search-focus regression. Final code review found no blocking issues.

## Browser coverage

The live sweep checks 32 routes at 1440px and 390px: **64 successful route/layout checks**, zero page exceptions, zero failed domain API reads, and zero document horizontal overflow.

| Area | Live routes and interaction coverage |
| --- | --- |
| Detect | Overview, registry/detail, intelligence, coverage, routing; recommendations, label/version conflicts, mapping gates, safe apply |
| Investigate | List/detail; report, graph, artifact inspector, evidence chat, worker review, citation navigation, failure states |
| Respond | Overview, cases, remediation policies, action records, approvals, workflows, runbooks, activity; policy previews, case edits, local imports |
| Hunt | Ad hoc and intelligence lists, detail; local search, findings/entities, notes and report ingestion |
| Threat Intel | Reports/detail; relevance and metadata revisions, indicator editing, hunt creation, navigation races |
| Skills | Library, templates, suggestions, outcomes, create/detail; versioned save/publish, import draft preservation, enablement, empty state |
| Memory | Enterprise Insights active/generated/prevalence/audit views; versioned authoring, usage, conflicts, archive and safe text |
| Build | Catalog, API sources, stream operations, Cribl setup; filters, inspector, paging, source rule search, unsupported-provider boundary |

Run scripts/framework/platform-live-browser-check.js with the browser on `http://127.0.0.1:8080/?reviewBatch=N`, for N=0,1,2,3. Each batch covers up to eight routes at both widths. Available persisted IDs are selected through read APIs; the recorded run included all five detail types. The script is read-only. Workspace scripts separately exercise interactions with intercepted writes, so their success is not a claim of live provider execution.

## Backend and tooling

Expanded the disposable database harness to all domain modules, including connector credential tests. Its bounded timeout is now 600 seconds because the full suite exceeded the prior 180-second budget on this host. Full Go race tests, vet, sqlc drift, frontend lint/build and nine frontend test files passed. No schema migration; schema remains 040. The Vite bundle-size warning remains.

The final `python3 scripts/framework/check.py --with-streams` run passed with exit code 0. It verified disposable PostgreSQL/Redis integration, shared HTTP scenarios, restart persistence, worker recovery, typed Go/Python investigation RPC and QA, Rust processing, credential rejection and the configured JSON inference-adapter contract. This does not assess actual model quality. The machine-readable local result is output/backend-framework/report.json. An initial run returned cache unavailable and failed the strict cache-hit scenario; a subsequent run passed that scenario without changing production timeouts. Subsequent runs exposed the stale Skills deletion-audit and Detection Intelligence response-shape assertions above. These intermediate failures are recorded rather than counted as successful runs.

## Limits

This validates local product flows and sandbox contracts. Live QRadar/Sentinel/Cribl connectivity, real-model quality, production durability/scale and authorized provider execution still require their own configured environments and release gates. No throughput or production-readiness claim is made. Offset pagination is not a cross-request snapshot; records may move under concurrent updates, so refresh before reviewing current state.

## Final local smoke

The final backend returned source pages of 1 and 0 records for limit=1 offsets 0 and 1, rejected limit=0 with 400, and returned response summary counts of one case, one completed simulation, zero pending actions and zero active workflows for the existing demo tenant. No demo fixtures were added by this review. The browser regression suite also verified connector configuration save without a provider-test call and Overview failure/retry recovery.
