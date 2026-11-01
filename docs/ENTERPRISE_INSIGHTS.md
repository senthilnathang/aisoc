# Memory — Enterprise Insights

The [outcome learning extension](SKILLS_MEMORY_OUTCOMES.md) creates explicitly approved, expiring advisory context for the source case entity. Existing application snapshots, archive and usage screens are reused and retain source provenance.

## Public reference and screens

Reviewed [7AI Enterprise Insights](https://7ai.com/platform/enterprise-insights) on 2026-11-01. The three public screenshots show the same browser URL, `app.sevenai.com/insight/enterprise-insights`:

| Screenshot | Visible screen | AISOC route |
| --- | --- | --- |
| `insights-1-active.png` | Metrics, type distribution, usage histogram, active insight table and actions | `/memory`, Active Insights |
| `insights-2-7ai-generated.png` | Generated entity cards with history and summaries | `/memory`, AISOC Generated |
| `insights-3-prevalence-suggestions.png` | Repeated artifacts, counts, dates, past determinations and Add Insight | `/memory`, Prevalence Suggestions |

Images are hosted under `https://47518862.fs1.hubspotusercontent-na1.net/hubfs/47518862/`. No create/edit dialog, usage modal or audit screen screenshot was provided by that page; those controls are AISOC extensions. Branding and the existing Memory navigation are preserved; the submenu is now Enterprise Insights. The previous fallback investigation browser is removed.

## Implemented behavior

- **Active Insights:** persisted, nonarchived context with artifact/type, narrative, advisory determination, author, validity, version and real application counts. Expired/future entries remain visible with “Not currently active”. Create and edit require explicit human-authored text. Archive stops future matching while retaining the record and history.
- **AISOC Generated:** deterministic summaries grouped by normalized primary entity from investigations created in the last 30 days. Cards show actual case counts, dates, determination counts and up to five case links. These are neither model-generated conclusions nor saved active insights. Counts describe investigations, not alerts.
- **Prevalence Suggestions:** the same entity grouping, restricted to closed/resolved cases with benign/suspicious/malicious/mitigated determinations; requires at least two cases in 30 days and no nonarchived insight for the artifact. The analyst reviews/edits a draft. Go rechecks eligibility and serializes acceptance so concurrent submissions cannot create duplicate accepted suggestions. Archived artifacts may become eligible again; expired but nonarchived insights still suppress a suggestion.
- **AI Suggestions:** an explicit unconfigured state. No invented model output, silent inference activation or fabricated cases.
- **Audit Log:** persisted authoring, archive and application events. Usage drilldown shows the latest 100 versioned application snapshots and links to their investigations.

The type chart describes nonarchived insights. Global 30-day usage counts distinct investigations with application records, not matches inferred from historical artifacts. Row counts deduplicate investigation IDs in the same window; daily UTC bars deduplicate per day, so summing bars need not equal the global distinct count. The histogram preserves intervening zero-use days and includes the partial first/current UTC days of the rolling 30-day window. Source system logs and historical cases are not bulk reclassified.

## Persistence and matching

Migration `040_enterprise_insights.sql` adds:

- `enterprise_insights`: composite tenant/ID key, JSON authored context/provenance, normalized artifact key, integer version, archive flag, optional validity timestamps and creation/update times.
- `enterprise_insight_applications`: tenant/insight/investigation/version uniqueness, immutable JSON snapshot and application timestamp. Insight records are archived, not deleted. Deleting an investigation cascades its application rows under the existing case-deletion contract; audit history remains. Retention/backup policies must account for that distinction.

Go `internal/modules/insights` owns validation, authoring, exact matching and snapshots. SQL lives in `queries/workspace.sql`, generated into `insightsql` with sqlc/pgx. Authoring uses a tenant advisory lock plus a row/version check and atomic audit. Applications take shared insight row locks, so an edit/archive waits for the in-flight snapshot transaction. Projections use repeatable-read snapshots for coherent counts/rows.

The existing `skills.Apply` investigation entrypoint invokes insight matching before skill matching. The new `skills.Context.InsightEntities` contains **only actual values**: case primary entity, alert evidence values and runtime indicator values. Skill scope metadata (evidence types, labels and indicator types) is deliberately excluded. Known insight IDs become available to existing insight-scoped skill rules in that transaction.

Matching is case-insensitive trimmed exact text; no wildcard, substring, fuzzy identity resolution or graph traversal. Type is a display classification, not an identity namespace. Active validity is checked at transaction time. A matching application creates a visible investigation step with its context snapshot and an audit event. Replaying the same insight version on a case is a no-op for snapshots/steps/audit; a newer version may be recorded separately.

Applications occur during case creation and existing intake/processing guidance calls. They are not retroactively inserted merely because an insight was created, nor automatically reapplied for every ad-hoc edit to an existing case. Hunt integration and retrieval into Python model prompts are not added by this change.

**Policy boundary:** stored context and suggested determinations are untrusted advisory data. Matching never changes case verdicts, status, approvals or response actions. A suspicious hint does not declare compromise; a benign hint cannot close a case. No model or privileged executor is activated.

```mermaid
sequenceDiagram
 participant UI as Memory workspace
 participant Go as Go Insights API
 participant PG as PostgreSQL
 participant Case as Existing investigation transaction
 UI->>Go: Create/edit/archive (tenant + revision)
 Go->>PG: Lock, validate, write context and audit
 Go-->>UI: Saved version
 Case->>PG: Match actual entity values against active context
 PG-->>Case: Shared-locked insight versions
 Case->>PG: Immutable application + visible step + audit
 Note over Case,PG: Same transaction; unique case/insight/version prevents replay duplication
 UI->>Go: Registry / generated / prevalence / usage
 Go->>PG: Tenant-scoped sqlc projections
 Go-->>UI: Recorded facts, counts and provenance
```

## API contracts

All routes are under `/api/v1`, with tenant and actor supplied by authentication.

| Route | Behavior |
| --- | --- |
| `GET /enterprise-insights` | `tab=active\|generated\|prevalence\|ai\|audit`, `search` ≤200 characters, `limit=1..100` (default 25), `offset=0..1000000`. Returns `items,total,summary,limit,offset`; rejects unknown/duplicate filters. |
| `POST /enterprise-insights` | Required client request ID `EI-` plus 8–80 ASCII letters/digits/hyphens, `artifact` ≤300, `kind=user\|network\|software\|other`, `content` ≤8000; optional `hint=none\|benign\|suspicious\|malicious`, ISO8601 `valid_from/valid_until`, boolean `from_prevalence`. |
| `PUT /enterprise-insights/:id` | Full authored fields plus positive `expected_version`. Stale writes return 409 `INSIGHT_CONFLICT`. Identity/origin cannot be supplied or modified. |
| `POST /enterprise-insights/:id/archive` | Required `expected_version`; archives atomically with audit. |
| `GET /enterprise-insights/:id/uses` | Latest 100 retained versioned applications in the authenticated tenant. A missing/foreign ID yields an empty list without disclosing existence. |

Create retries with the same tenant/ID/actor and original input fingerprint return the existing record without another audit entry. Reusing the ID for changed input returns 409; preserve the modal's request ID after uncertain delivery. Opening a new form creates a new request ID and can create another analyst-authored fact. Manual insights may share artifacts; deduplication of prevalence acceptance is stricter.

Forms retain text on conflicts/errors, use safe React text rendering and ignore completion callbacks after closing. Closing a saving modal does not cancel a request already sent; refresh to see a late commit. There is no rich HTML execution or remote URL fetch.

## Verification and rollout

- Isolated PostgreSQL race suite: create replay/collision, tenant filters/writes/matching, concurrent revisions, immutable snapshots, expiry/archive exclusion, repeat application, prevalence acceptance/dedup, pagination totals, actual entity versus metadata, shared-lock archive coordination, authoring/application audit rollback.
- HTTP contracts: invalid filters, pagination, unknown fields, dates, required revisions and strict booleans.
- Browser fixture suite `scripts/framework/enterprise-insights-browser-check.js`: active table, usage snapshots, conflict preservation, cards with provenance, honest AI empty state, suggestion review/save, audit, archive, late completion, empty registry and 1440/390px overflow. Domain writes are intercepted and do not alter demo data.
- Go full race suite and vet, sqlc drift, frontend lint/build and nine frontend test files. The existing bundle-size warning remains.

Apply migration 040 before running the new Go API; normal local startup does this. Local API remains 3003 and frontend 8080. Roll back binaries/UI while retaining the additive tables and audit/snapshot data. Do not drop migration 040 to roll back code.

Remaining work: model-backed suggestions and evaluated RAG consumption; entity canonicalization beyond trimmed case folding; configurable expiry/retention and sensitive-context redaction; hunt-context applications; scalable aggregate materialization/load benchmarks; explicit bulk re-evaluation of historical cases. No performance or autonomous-response claims are made by these screens.
