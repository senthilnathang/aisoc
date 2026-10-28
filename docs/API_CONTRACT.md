# HTTP API Contract

## Skills

Skills are tenant-scoped. The API stores plain-language guidance and relevance
scopes; matching records a snapshot for analyst review and does not run the text
as instructions. Fields include `name`, `skill_type`, `description`, `apply_when`,
`content_markdown`, `modules`, `connectors`, `alert_types`, `alert_categories`,
`source_entities`, `runtime_entities`, `insight_refs`, and `tags`.

| Method | URL | Purpose |
|---|---|---|
| GET/POST | `/skills` | Search/filter/paginate or create a draft |
| GET/PATCH/DELETE | `/skills/:id` | Read, edit/version, or delete an editable skill |
| POST | `/skills/:id/publish` | Publish and enable guidance |
| POST | `/skills/:id/toggle` | Enable or disable a published skill |
| GET | `/skills/:id/history` | Audit history |
| GET | `/skills/suggestions?status=pending` | Review deterministic environment suggestions |
| POST | `/skills/suggestions/:id/accept` | Convert suggestion to editable draft |
| POST | `/skills/suggestions/:id/dismiss` | Dismiss a pending suggestion |
| GET | `/skills/outcomes` | Application, feedback and labeled-case counts |
| POST | `/skills/applications/:id/feedback` | Rate applied guidance `helpful` or `not_helpful` |

List filters include literal `search`, `state=draft|published`, `module`, `limit`
(1–100, default 25) and `offset` (default 0). Skill edits and lifecycle actions
increment the version and write audit history. Starter templates are frontend
draft starters and do not become active until saved/published.

## Skill materials

- `GET /api/v1/skills/:id/materials` returns active material metadata.
- `POST /api/v1/skills/:id/materials` creates a reference, checklist, or example.
  Provide `filename` plus UTF-8 `content` for `.md`, `.markdown`, `.txt`, `.json`,
  or `.csv`; or provide an `https` `source_url` for a link. File contents are
  limited to 128 KiB and each skill can have at most 10 active materials.
- `GET /api/v1/skills/:id/materials/:materialId` returns the material and content.
- `PATCH /api/v1/skills/:id/materials/:materialId` edits it and creates the next
  material version. `GET .../:materialId/versions` returns the immutable snapshots.
- `DELETE /api/v1/skills/:id/materials/:materialId` archives the item. Archived
  materials are omitted from the active list and their versions remain available.

Material mutations are tenant-scoped, bump the parent skill version, and write
an audit event. The Skills editor reads and updates material text but does not
fetch external URLs or execute attached guidance.

- `GET /api/v1/skills/suggestions` refreshes and returns pending suggestions.
  Candidates require at least two closed/resolved investigations with analyst
  determinations from the same observed source and category. They are pattern
  based and never claim measured effectiveness. `POST .../suggestions/:id/accept`
  creates an editable generated draft; `POST .../dismiss` records a dismissal.
- `GET /api/v1/skills/outcomes` reports application counts, analyst ratings, and
  closed-case labels with sample counts; it does not infer causal improvement.
- `POST /api/v1/skills/applications/:id/feedback` accepts `helpful` or
  `not_helpful` and an optional comment. Re-rating by the same operator updates
  their prior rating.
- Alert intake accepts optional `category`, `alert_type`, and `insight_refs`.
  Case and hunt records also accept `insight_refs`; exact enabled-skill scope
  matches are snapshotted with a reason. Investigation applications appear in
  the transcript; hunt applications are returned by run and hunt-detail APIs.

Base URL: `http://localhost:3002/api/v1`

In token mode, domain requests require an operator Bearer token or a browser
session. Tenant identity comes from the credential; conflicting `X-Tenant-Id`
returns 403. Only local development mode accepts an untrusted tenant header.

## Authentication and hybrid API intake

Local development defaults to login-free mode for app validation. Initialize
credentials using `npm --prefix backend run auth:init` if not already initialized.
To enable login, restart with `AUTH_MODE=token ./run.sh start backend`. For
direct server startup, set `AUTH_MODE=token` and `AUTH_OPERATORS_FILE` to that
JSON file. It contains an array of `{id, tenant_id, token_hash}` records, where
`token_hash` is the SHA-256 hex digest of a high-entropy token. The bootstrap
command creates private files and refuses to overwrite existing credentials.

| Method | URL (relative to `/api/v1`) | Access / purpose |
|---|---|---|
| GET | `/auth/session` | Public session metadata; no token returned |
| POST | `/auth/login` | Operator Bearer token → HttpOnly session cookie and CSRF token |
| POST | `/auth/logout` | Authenticated; invalidates session |
| GET/POST | `/api-sources` | Operator: list sources / issue source and key |
| GET | `/api-sources/:id` | Operator: source metadata, never the key |
| PATCH | `/api-sources/:id/mapping` | Operator: save native field mapping |
| POST | `/api-sources/:id/mapping/preview` | Operator: validate sample and preview normalized event |
| POST | `/api-sources/:id/rotate-key` | Operator: invalidate old key and return replacement once |
| POST | `/api-sources/:id/revoke` | Operator: revoke key; retain historical records |
| POST | `/intake/:id/alerts` | Source Bearer key only; normalized alert intake |
| POST | `/intake/:id/events` | Source Bearer key only; map a native event using saved mapping |

Mappings require `fields.external_id`, `fields.title`, and `fields.severity`.
Each value is a safe dot path into the event JSON (for example `alert.id`).
Optional targets are `summary`, `category`, `alert_type`, `primary_entity`,
`evidence`, and `insight_refs`. `severity_map` translates provider values to
`low|medium|high|critical`. The preview accepts `{mapping, sample}` and returns
`{valid, errors, normalized_alert}` without saving or ingesting the sample. Saving
uses `{mapping}` and writes an audit event. Native events are limited to 128 KiB.
The existing `/intake/:id/alerts` normalized contract remains unchanged and can
be used regardless of whether a native mapping is configured.

Create source body: `{ "name": "Hybrid SIEM", "provider": "custom",
"rule_id": "RULE-001", "expires_in_days": 30 }`. Validity is 1–365 days,
default 30. Create/rotate returns `{source, api_key}` with `Cache-Control: no-store`.
Rotation optionally accepts `expires_in_days`. Revoked sources may issue a new
key through rotation. Referenced detection rules cannot be deleted.

Send `Authorization: Bearer <source-key>` and `Content-Type: application/json`
to the returned `source.intake_path`:

```json
{
  "external_id": "native-event-001",
  "title": "Unusual outbound connection",
  "severity": "high",
  "primary_entity": "workstation-01",
  "evidence": [{ "type": "domain", "value": "example.test" }]
}
```

The credential fixes tenant, source identity, and detection rule; payload fields
cannot override them. New intake returns 201, identical retries 200, conflicting
reuse of an external ID 409. Missing, expired, rotated, or revoked keys return
401. Intake bodies are limited to 128 KiB. Provider labels are descriptive:
senders must normalize vendor payloads themselves; no vendor polling is implied.

Browser mutations require `X-CSRF-Token` from session metadata. Sessions expire
after eight hours and are invalidated by logout or backend restart. Deploy the
browser and `/api` under the same origin. Production requires `NODE_ENV=production`,
token mode, HTTPS termination, and exact HTTPS `APP_ORIGINS` (comma separated).
Operator credentials grant workspace administration; enterprise SSO and granular
operator roles are not implemented. Change operator hashes and restart to revoke
operator access and existing sessions. Source-key revocation requires no restart.

## Platform

| Method | URL | Purpose |
|---|---|---|
| GET | `/health` | Liveness, database status, version |
| GET | `/api/v1/dashboard` | Queue metrics and recent activity |

## Investigations

| Method | URL | Purpose |
|---|---|---|
| GET | `/investigations` | List; supports `search`, `status`, `severity`, `limit`, `offset` |
| POST | `/investigations` | Create |
| GET | `/investigations/:id` | Detail with artifacts and remediations |
| PATCH | `/investigations/:id` | Update editable fields |
| DELETE | `/investigations/:id` | Delete local record |
| POST | `/investigations/:id/reinvestigate` | Reset lifecycle and increment replay count |
| POST | `/investigations/:id/determination` | Set determination and workflow state |

## Detection Intelligence and Rules

`GET /detection-intelligence?days=7&source=<source>&severity=<severity>` returns
tenant-scoped alert totals, source/severity/routing/disposition groups, daily
severity counts, linked-case determinations, and the latest 50 matching alerts.
`days` accepts 1–90 (default 7). Source matches an exact alert source or configured
provider label; API-source events display and group under their provider. The date
window uses UTC. Only ingested alerts are counted; legacy manual cases are not
included.

The detection registry now uses `GET /detection-registry`, returning
`{items,total,limit,offset,sources}`. Filters: `search` (literal substring of name,
description, or ID), `severity`, `enabled=true|false`, and `source` (exact received
source or bound API-source provider). Sorting: `sort=name|updated_at|severity|detections`
and `direction=asc|desc`. Page size is 1–100, default 25; offset defaults to zero.
All filters, totals, and source choices are tenant scoped. Ties sort by rule ID.

Registry and rule detail metrics use all stored alerts and distinct linked cases,
not the historical seed counters. `outcomes` groups current case determinations;
`false_positive_rate` is null until explicit false-positive labeling exists.
Rule detail also returns source bindings, version snapshots, and audit history.

`POST /detection-rules/:id/clone` creates a disabled copy of configuration only,
with version 1, zero received alerts, and no source bindings. PATCH optionally
accepts `expected_version`; a stale version returns 409 without changing the rule.
Actual configuration changes create immutable snapshots transactionally. Existing
rules begin at version 1; older edits before this feature cannot be reconstructed.
Creation, toggle, edit, and clone remain audited. Deleting unreferenced rules
removes their snapshots; references from alerts/API sources prevent deletion.

| Method | URL | Purpose |
|---|---|---|
| GET/POST | `/detection-rules` | List/create |
| GET/PATCH/DELETE | `/detection-rules/:id` | Read/update/delete |
| POST | `/detection-rules/:id/toggle` | Enable or disable |

## Hunts

| Method | URL | Purpose |
|---|---|---|
| GET/POST | `/hunts` | List/create hunt definitions |
| GET/PATCH/DELETE | `/hunts/:id` | Read/update/delete |
| POST | `/hunts/:id/run` | Create a deterministic local execution |

## Connectors

| Method | URL | Purpose |
|---|---|---|
| GET/POST | `/connectors` | List/create configured connectors |
| GET/PATCH/DELETE | `/connectors/:id` | Read/update/delete |
| POST | `/connectors/:id/test` | Run a live provider check when an adapter is available; otherwise retain `untested` and return a `test_result` explaining `unsupported` or `not_configured` |

Secrets are accepted for local testing but are never returned by list/detail endpoints.

## Remediations

| Method | URL | Purpose |
|---|---|---|
| GET/POST | `/remediations` | List/create; filter by `investigationId` |
| GET/PATCH/DELETE | `/remediations/:id` | Read/update/delete |
| POST | `/remediations/:id/execute` | Transition `pending` to `completed` |

## Threat Intel Reports

| Method | URL | Purpose |
|---|---|---|
| GET/POST | `/threat-intel-reports` | List/create reports; filter by `search`, `severity` |
| GET/PATCH/DELETE | `/threat-intel-reports/:id` | Read (includes indicators)/update/delete |
| POST | `/threat-intel-reports/:id/launch-hunt` | Launch or re-launch a hunt from report IOCs |

## Threat Indicators

| Method | URL | Purpose |
|---|---|---|
| GET/POST | `/threat-indicators` | List/create indicators; filter by `reportId` |
| GET/PATCH/DELETE | `/threat-indicators/:id` | Read/update/delete |

## Threat Intel Dashboard

| Method | URL | Purpose |
|---|---|---|
| GET | `/threat-intel/dashboard` | Aggregated stats: total reports, indicators, hits, active hunts, by-source breakdown |

## Error Envelope

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Investigation not found",
    "details": null
  }
}
```
# Persisted detection and investigation additions (2026-10-27)

- Detection create/patch accepts `query`, `schedule`, `lookback_window`, and
  `routing` (`Investigate`, `Sample (10%)`, `Suppress`, `Escalate`). Rule responses
  expose boolean `enabled`; invalid enum values are rejected.
- `GET /api/v1/detection-rules/:id/history` and
  `GET /api/v1/investigations/:id/history` return `{ items: [...] }`, newest first,
  limited to 100 events. Unknown or foreign resources return 404.
- `POST /api/v1/investigations/:id/artifacts` accepts `type`, `value`, optional
  `label` and `metadata`. The route binds the parent case and tenant; clients
  cannot choose another parent through the request body.
- `POST /api/v1/investigations/:id/feedback` accepts a nonblank `comment` of at
  most 4,000 characters. Both case-record endpoints return 201.
- Investigation detail additionally includes `steps`, `feedback`, and `history`.
  Each step contains its persisted tool name, request, response, and conclusion.
  New cases have no invented steps or evidence. Demo seed records identify their
  provenance. Deleting a case cascades its artifacts, feedback, and steps.
- Record mutations and their audit writes share a SQLite transaction. Historical
  audit events survive resource deletion; current-resource history routes return
  404 after deletion. Audit details include changed field names, not connector
  secret values.

These APIs store local workflow state. They do not execute detection queries or
external tools. No-body actions must omit a JSON content-type header.

## Alert ingestion and processing

`POST /api/v1/alerts` accepts a maximum 128 KiB body:

```json
{
  "source": "Local demo",
  "external_id": "sensor-event-001",
  "rule_id": "RULE-001",
  "title": "Unusual outbound connection",
  "severity": "high",
  "primary_entity": "workstation-demo-01",
  "summary": "Source sensor reported an outbound connection.",
  "evidence": [{ "type": "domain", "value": "crx-update.cloudgateway.cc" }]
}
```

`source`, `external_id`, `rule_id`, `title`, and `severity` are required. Evidence
is limited to 50 entries (entity, ip, domain, file, email, url); it is supplied
data, not independently verified evidence. This endpoint receives detections;
it does not evaluate a detection rule's query.

- New alert: **201**, `{ duplicate: false, alert: {...} }`.
- Identical normalized retry: **200**, `{ duplicate: true, alert: {...} }`.
- Same tenant/source/external ID with changed content: **409 ALERT_CONFLICT**.
  Whitespace around string fields is trimmed, absent optional fields receive
  explicit defaults, and object key order is irrelevant. Evidence array order
  remains significant.
- Missing/foreign rule: **404**. Disabled rule: **409 RULE_DISABLED**.
  Exact retries return the original alert even after the rule changes.
- Investigate/Escalate creates one investigation and queued job. Escalate assigns
  analyst review; it does not send a notification. Suppress retains the alert
  with `investigation_id: null`. Sample uses SHA-256 of the tenant/source/external
  ID tuple modulo 10; unsampled alerts are retained without a case. The received
  rule's routing decision is persisted and never changed by retry.

`GET /api/v1/alerts?limit=100&offset=0` returns the latest alerts for the tenant.
`GET /api/v1/alerts/:id` returns one alert; foreign alerts return 404.
`GET /api/v1/investigation-queue` returns the latest 100 investigations with their
latest job status and tenant-scoped counts (received alerts, active runs, open cases).
Investigation details include `alerts` and the latest 20 `jobs`, newest first.

The worker advances one local phase per 1.5-second tick, inside a SQLite write
transaction. Each phase and its transcript/audit commit together. Restart resumes
the next uncommitted phase. A failed phase rolls back its partial writes and marks
the run failed; it is not automatically retried. Reinvestigate queues a new run,
preserving existing steps and deduplicating imported artifacts. An active run
rejects concurrent outcome changes or reinvestigation with 409.

Local outcomes are `suspicious` for high/critical source severity or an exact
active local indicator match, otherwise `unknown`. No external requests are made;
the case remains open for analyst review. A no-match result is not a benign verdict.
The worker does not compute a risk score. Manual cases without alerts keep their
earlier manual reinvestigation behavior.

Alerts retain references to their rules/cases for durable deduplication. Deleting
a referenced rule or case returns **409 ALERT_REFERENCE_EXISTS**; disable the rule
or close the case instead. `X-Tenant-Id` is still a local-development selector,
not authenticated tenant authority. Do not expose intake as a production webhook.
