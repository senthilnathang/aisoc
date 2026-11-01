# Workspace navigation

Updated 2026-10-31. The application opens at [localhost:8080](http://localhost:8080) with **Detect → Overview** selected. Overview is the first Detect submenu, not a separate main-menu section and not part of Respond.

| Main menu | Submenu | Route |
| --- | --- | --- |
| Detect | Overview | `/` |
| Detect | Rule registry | `/detect/rules` |
| Detect | Intelligence | `/detect/intelligence` |
| Investigate | Investigations | `/investigations` |
| Respond | Overview | `/respond` |
| Respond | Cases | `/respond/cases` |
| Respond | Actions | `/respond/actions` |
| Respond | Approvals | `/respond/approvals` |
| Respond | Workflows | `/respond/workflows` |
| Respond | Runbooks | `/respond/runbooks` |
| Respond | Activity | `/respond/activity` |
| Hunt | Hunt workspace | `/hunt` |
| Threat Intel | Reports | `/threat-intel` |
| Skills | Library | `/skills` |
| Skills | Starter templates | `/skills/templates` |
| Skills | Environment suggestions | `/skills/suggestions` |
| Skills | Outcomes | `/skills/outcomes` |
| Memory | Enterprise Insights | `/memory` |
| Build | Workspace | `/build` |
| Build | API sources | `/build/api-sources` |
| Build | Stream operations | `/build/stream-operations` |
| Build | Connectors | `/build/connectors/cribl` |

## Behavior

Desktop displays the main sections in the header and the current section's submenu below it. Small screens use a **Menu** button opening a scrollable drawer containing every section and child link. The current submenu remains visible below the header.

Links retain normal browser behavior, including modified-click/new-tab access. Ordinary clicks navigate within the application. Direct URLs, reloads and browser Back retain the correct selection. Closing the mobile drawer with Escape returns focus to the Menu button; choosing a link closes the drawer.

Investigation, detection-rule, threat-report and skill detail views keep their parent section selected. Skill creation belongs to Skills → Library. The legacy `/build-operations` URL still resolves to Build → Stream operations.

Menu availability describes navigation, not authorization. Go API authorization, tenant isolation and response approval policies remain unchanged. Response tools remain within the previously configured local/mock scope.

## Implementation and tests

- [navigation.js](../frontend/src/navigation.js) defines labels, paths and detail-view parent mapping.
- [Navigation.jsx](../frontend/src/Navigation.jsx) renders the responsive header, submenus and drawer.
- [main.jsx](../frontend/src/main.jsx) uses the shared route map and matching breadcrumbs.
- [navigation.test.mjs](../tests/frontend/navigation.test.mjs) checks home ownership, parent selection and unique menu routes.
- [navigation-browser-check.js](../scripts/framework/navigation-browser-check.js) checks active selections, response submenus, deep-link reload, Back, mobile links, Escape/focus restoration and viewport bounds without API writes.

Validation passed against both the development app and a local production preview: 1440px desktop and 375px mobile. Build, Hooks lint, frontend Node tests and Markdown links passed. The temporary preview was stopped after validation; normal access remains port 8080.

See [developer instructions](DEVELOPMENT.md), [test guide](TESTING.md) and [React migration notes](REACT_19_MIGRATION.md).

See [clickable breadcrumbs and tenant-scoped resource labels](BREADCRUMBS.md) for frontend/backend behavior and regression coverage.

### Detection Intelligence screenshot implementation (2026-10-31)

Source/rule treemap, coverage and escalation views, search, linked-case drill-down, and responsive summary panels now use the tenant-scoped Go sqlc/pgx projection. Existing `/detect/intelligence` links remain valid; `/detect/detection-intelligence` is an alias. Coverage means linked alerts, not completed investigations. See [implementation, API, metric definitions and verification](DETECTION_INTELLIGENCE.md). Local Rule Recommendations and Detection Routing are now implemented; provider synchronization remains future work.

### Detection Rules workspace (2026-10-31)

The Rules screenshot layout now uses Go/sqlc period-specific metrics, a backend-served local catalog, and URL-persisted inspector selection, filters and tabs. Existing CRUD, audit and all-time APIs are retained. FP share now uses explicit analyst labels; assessed coverage and local recommendations have separate evidence-backed workflows. See [UI, API contracts, test workflow and rollback](DETECTION_RULES.md).

### Detection Coverage (2026-10-31)

The Coverage workspace now provides a pinned ATT&CK radar/table, technique drill-down and tenant-scoped, versioned analyst assessments. Migration 033 is additive; sqlc writes and audit commit together. Verified coverage excludes stale/expired reviews and non-detection decisions. The old Overview coverage example now links to the real workspace. See [reference provenance, denominator, APIs, testing and rollback](DETECTION_COVERAGE.md).

### Rule Recommendations (2026-10-31)

The Rules inspector now provides explicit analyst labels, deterministic proposals, local query validation, bounded replay receipts and version-checked apply/dismiss. Apply is limited to disabled, unbound local rules; provider sync remains unavailable. Migration 034 adds tenant-scoped labels and proposals with atomic audit. See [workflow, API, architecture, tests and rollback](RULE_RECOMMENDATIONS.md).

### Detection Routing (2026-11-01)

The Routing workspace adds ordered universal policies, per-rule defaults, entity lists/exceptions and audit history. Go previews bounded stored evidence before active changes and applies the same evaluator during local intake, preserving protected escalation and duplicate decisions. Migration 035 is additive; no quarantine or external provider actions are enabled. See [workflow, architecture, APIs, tests and rollback](DETECTION_ROUTING.md).

### Investigation workspace (2026-11-01)

The investigation detail now provides screenshot-inspired Summary, Report, Remediation, Artifacts graph/table and a private case evidence-lookup drawer. Existing L1 review, runbooks, feedback and action simulations remain available. Go supplies bounded provenance projections; migration 036 stores actor-scoped idempotent lookup messages with atomic audit. No model-backed conversation or external containment is implied. See [screens, APIs, architecture, limits, tests and rollback](INVESTIGATION_WORKSPACE.md).


## Respond additions

Cases uses `/respond/cases`; workflow policy configuration uses `/respond/remediation-actions` (Remediation policies). Existing execution records remain `/respond/actions` (Action records). Workflows and Runbooks retain `/respond/workflows` and `/respond/runbooks`; the canvas opens from a stored workflow. Breadcrumbs and active submenu ownership follow the shared menu configuration.


## Hunt routes

`/hunt/threat-hunting` is the registry (`/hunt` alias); `/hunt/threat-intelligence` is the report hunting table; `/hunt/threat-hunting/{id}` opens the detail workspace. Hunt detail remains under the Threat hunting submenu. Breadcrumb labels use authenticated tenant-scoped `hunts` metadata.


## Shared Threat Intel registry

`/threat-intel` and `/hunt/threat-intelligence` use the shared ThreatIntelWorkspace registry. Report details remain `/threat-intel/{id}` with the existing tenant-scoped breadcrumb. IOC-created local hunts open `/hunt/threat-hunting/{id}` only when creation completes while the initiating screen remains mounted.

## Skills workspace routes

`/skills` contains custom and augmented tabs within the existing Library submenu. `/skills/new` accepts create/template/text-import drafts; `/skills/:id` uses the file/instructions/relevance editor. Templates, environment suggestions and outcomes keep their current submenu routes. Delayed save completion does not force navigation after leaving. See [Skills screens](SKILLS_WORKSPACE.md).

## Memory workspace

Memory → Enterprise Insights remains `/memory`; Active Insights, AISOC Generated, AI Suggestions, Prevalence Suggestions and Audit Log are in-page tabs. Insight use and generated cards link to existing investigation routes. Create/edit/archive and usage use accessible dialogs. See [screen mapping](ENTERPRISE_INSIGHTS.md).

## Build workspace (2026-11-01)

Build → Workspace (/build) is the first submenu. Existing API sources, Stream operations and Cribl creation paths remain. Skills open exact editors; workflow/runbook/source actions open list managers; connector rows are inspect-only. See [Build](BUILD_WORKSPACE.md).
