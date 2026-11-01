# Investigation workspace

**Outcome learning** on Summary/Review now connects reviewed cases to [Skills and Memory](SKILLS_MEMORY_OUTCOMES.md), using selected stored artifacts, explicit approval and retained provenance. It does not execute inference or response actions.

The [Threat Intel → Hunt → Investigate extension](INTEL_HUNT_INVESTIGATE.md) adds JSON import, IOC validation/deduplication, saved-finding promotion and retained source provenance (2026-11-01, migration 044). Existing local workspace behavior below remains available.

Implemented locally on 2026-11-01 after reviewing the five images on [7AI Investigations](https://7ai.com/platform/investigations). This is a presentation and local evidence workflow upgrade, not a claim to implement the vendor's private agent algorithms or live containment.

## Screenshot review and mapping

All five images display `app.sevenai.com/investigate/investigations/bridge-rock-resources`. They are views of a single case, not separate applications. AISOC keeps `/investigations/{id}` and supports `/investigate/investigations/{id}` as an alias using real stored case IDs. Tabs persist as `?tab=summary`, `report`, `remediation` or `artifacts`; browser Back/reload preserves them. The existing investigation queue remains the entry point.

| Reference | Visible screen | Implemented behavior |
|---|---|---|
| [Summary](https://47518862.fs1.hubspotusercontent-na1.net/hubfs/47518862/investigations-phishing-summary-browser.png) | Source-alert/conclusion rail, case verdict and connected entities | Stored alert cards, case determination, membership-based evidence tree and analyst determination control |
| [Report](https://47518862.fs1.hubspotusercontent-na1.net/hubfs/47518862/investigations-phishing-report-browser-2.png) | Step timeline, input/tool results/conclusion, artifact quicklinks | Actual stored step request/response/conclusion; artifact links open inspector |
| [Remediation](https://47518862.fs1.hubspotusercontent-na1.net/hubfs/47518862/investigations-phishing-remediation-browser-3.png) | Action cards with target, reason and completed state | Existing response records and explicitly labelled local simulation, audit navigation; no external completion claim |
| [Artifacts](https://47518862.fs1.hubspotusercontent-na1.net/hubfs/47518862/investigations-phishing-artifacts-browser-4.png) | Graph/table, left selected-artifact inspector, zoom | Typed case-membership graph, keyboard-selectable nodes, graph/table toggle, search, pagination, provenance and values |
| [Copilot](https://47518862.fs1.hubspotusercontent-na1.net/hubfs/47518862/investigations-phishing-chat-browser-5.png) | Case conversation drawer, grounded answer and evidence | Private persisted local literal evidence lookup with citation snapshots, abstention and retry idempotency |

The remediation screenshot highlights Report; the artifacts image highlights Remediation. AISOC's tab labels follow the actual content. The chat image also shows login content inside a phishing case; AISOC does not reproduce that inconsistency or copy example verdicts into live data.

## Existing capabilities preserved

The first four tabs match the reviewed screens. Review, Runbooks, Transcript, I/O, History and Feedback remain available. Analyst determination, artifact attachment, feedback, reinvestigation/retry, skill feedback and existing response simulations use their existing APIs. Running/failed worker progress remains visible; completed phase details appear under Review. The L1 review remains below Summary and on Review, with mock/model labels, hypotheses, evidence references and escalation limitations intact.

Add Alert Insight opens the Artifacts workspace and attachment form. Open alert card exposes stored source records under I/O. Detection-rule links select the existing rule inspector. Source payloads and tool results are rendered as text/JSON, never executable HTML or automatically opened external URLs.

## Backend projection

`GET /api/v1/investigations/{id}/workspace` returns:

- `case`: the existing case detail shape, using one repeatable-read snapshot, with bounded latest alerts/steps.
- `nodes`: typed IDs, kind, label, value, record ID and provenance.
- `edges`: explicit `received_alert`, `attached_evidence` or `primary_entity` membership from the case node.
- `scope`: the projection's limits and interpretation.

Nodes do not imply causal relationships, attacker paths, verified reputation or a finding of compromise. No entity intelligence is fabricated. Missing provenance is explicitly marked. The workspace includes up to 100 latest alerts, 100 artifacts ordered by update time, and 100 latest tool steps displayed chronologically; jobs/history/other case records keep their existing bounds. The legacy detail endpoint retains its previous alert/step behavior. Graph pages keep the case root visible and paginate 24 children; selection is accessible in the inspector and table. Large values/labels are bounded for graph display; original stored records remain available through existing case data.

Code: `backend-go/internal/modules/investigations/workspace.go`, the shared detail reader in `cases.go`, and `alert_context.go`. New lookup queries use generated sqlc/pgx in `investigationsql`; edit `queries/workspace.sql`, then run `make -C backend-go sqlc`.

## Copilot boundary and persistence

No general conversational model is configured for this feature. The drawer explicitly identifies **local evidence lookup**, using bounded literal matching rather than an LLM. It searches stored case title/summary/source/entity/determination, the same latest 100 artifacts as the workspace, and the same latest 100 steps. Raw tool request/response blobs are not sent to a model or searched by the copilot. Up to eight matching excerpts are returned; no match produces explicit abstention. Summary queries retrieve stored case fields, not a newly reasoned conclusion.

Retrieved instructions are untrusted text. The lookup cannot dispatch tools, modify determination, authorize a response or call an external provider. Citation excerpts are source statements, not endorsements. An analyst must assess evidence quality.

| API | Contract |
|---|---|
| GET `/api/v1/investigations/{id}/evidence-chat` | Latest 50 messages for this authenticated tenant/case/actor, returned chronologically |
| POST `/api/v1/investigations/{id}/evidence-chat` | `{id, question}`; bounded message ID and question (3–500 bytes); returns mode, summary, citations and capture time |

Actor and tenant are derived from existing authentication. Conversations are private to that actor; users do not browse others' conversations. In local demo auth, users sharing the same configured actor share that identity. Message IDs make retries idempotent: identical content returns the original answer; changed content under the same key is 409. The case row lock serializes inserts and deletion. Message and audit commit together. The local limit is 500 messages per case/actor; this is a bounded demo facility, not unbounded chat storage.

Migration `036_investigation_evidence_chat.sql` adds `investigation_evidence_messages`, with a tenant/case foreign key and cascade on authorized case deletion. Questions and citation snapshots are durable case-related content: include them in backup/access/retention governance. Excerpts remain snapshots even if evidence later changes. If a citation leaves the current bounded report/artifact window, the drawer keeps the excerpt visible and reports that the source is outside the displayed window.

```mermaid
sequenceDiagram
 participant UI as React investigation workspace
 participant Go as Go investigation API
 participant DB as PostgreSQL
 UI->>Go: GET workspace (authenticated tenant + case)
 Go->>DB: Repeatable-read case / evidence / steps / actions
 Go-->>UI: Case + provenance nodes + membership edges
 UI->>Go: POST evidence-chat (message ID + question)
 Go->>DB: Lock owned case; check actor-scoped idempotency
 Go->>DB: Read bounded case evidence via sqlc
 Go->>Go: Literal matching; quote sources or abstain
 Go->>DB: Atomic message + citation snapshot + audit
 Go-->>UI: Local lookup response; no tool/action execution
```

## Verification and rollout

- `python3 scripts/framework/check_detection_intelligence.py` now also runs investigation package tests in disposable PostgreSQL with race detection. Includes actor/tenant isolation, idempotent concurrent send, conflict detection, audit rollback, membership-only graph, injection-as-text/abstention and 101-step current-citation/legacy-order regression.
- `node --test tests/frontend/*.test.mjs`: tab parsing, aliases/navigation-related regression suites and existing compiler/build checks.
- `scripts/framework/investigation-workspace-browser-check.js`: real read-only API/foreign-tenant checks, report deep link/reload/I/O, graph/table/inspector/zoom, graph-page connectivity, remediation/audit navigation, intercepted lookup retry/citation/plain-text handling, and four views at 1440/768/375px. No demo case mutations persist.
- Existing `investigation-review-browser-check.js` verifies L1 mock/failure/missing evidence/citation states; run against a completed mock showcase case. Frontend ESLint/build, Go vet and sqlc diff are required.

Roll back application binaries while retaining the additive message table and audit. Existing case endpoints remain available; no worker architecture or provider activation changes are required. No raw vendor sample data, malicious determination, external remediation completion or model answer was imported. The pre-existing large-bundle build warning remains. Future work: configured model-backed conversation with validated citations/tool authorization, explicit cross-actor conversation sharing, and larger-case pagination/retention policies.

### Verified result (2026-11-01)

Passed: disposable PostgreSQL/race suites including investigation lookup concurrency/isolation/audit rollback and the 101-step citation regression; nine frontend test files; ESLint; production build; sqlc generated-code diff; Go vet. The new workspace browser suite passed on development and compiled preview, including graph page-two connectivity and viewport-fixed copilot. Existing L1 review browser regressions passed on the compiled build for real mock review, citations, queued/failed/invalid/missing states, literal unsafe text and stale-refresh warnings. Independent review prompted aligned report/lookup record windows and a persistent graph root on every page. Migration 036 is applied locally; testing preserved demo case records.
