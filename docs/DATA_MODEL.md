# Data Model

PostgreSQL is the active datastore; current foundation schema status is 2026-10-31. The authoritative physical
schema is in `backend-go/migrations/` (31 migrations, 49 tables including streaming and specialist dispatcher state). Foundation startup applies all source migrations. The separate release remains
on migration 019 with 28 tables. The entity catalog
below retains legacy JSON-column names to explain the preserved HTTP/recovery
contract. Go uses typed columns and JSONB documents, composite tenant keys and
transactional audits; artifacts/feedback share `case_records`. Migration converts
all 26 legacy tables and preserves IDs, history, credential hashes and job state.
Connector secrets use authenticated encryption with a separately retained key.

Operational records are tenant-scoped. Mutable resource tables generally carry
`created_at` and `updated_at`; immutable version/application snapshots use their
creation timestamp only. Operator credentials are file-backed and browser
sessions are held in backend memory, not in the domain database.

## Specialist dispatcher state

Migration 031 adds `job_dispatch_tenants(tenant_id, last_claimed_at)`, backfills old
jobs after installing a write-fencing trigger, and indexes running job leases by
tenant. This coordinates fair claims and per-tenant limits across Go processes;
job state/effects remain in `jobs`. See [dispatch details](WORKER_DISPATCH_SECURITY.md).

## Entities

### investigations

- `id` text; physical primary key is `(tenant_id, id)`
- `tenant_id` text
- `title`, `summary`, `source`, `category`
- `severity`: low, medium, high, critical
- `status`: open, investigating, contained, resolved, closed
- `determination`: unknown, benign, suspicious, malicious, mitigated
- `risk_score` integer 0–100
- `owner`, `primary_entity`
- `replay_count` integer
- `insight_refs_json`: supplied organization-context references

### artifacts

- `id`, `investigation_id`, `tenant_id`
- `type`, `value`, `label`, `metadata_json`

### detection_rules

- `id`, `tenant_id`, `name`, `description`
- `mitre_techniques_json`, `execution_mode`
- `enabled`, `severity`
- `detections`, `investigations`, `false_positive_rate`
- `recommendation_status`, `last_activity_at`
- `query`, `schedule`, `lookback_window`, `routing` (added by migration)

### detection_rule_versions

- tenant and rule IDs, monotonically increasing `version`, immutable
  `snapshot_json`, and `created_at`

### hunts

- `id`, `tenant_id`, `name`, `query`, `source`
- `status`: draft, running, completed, failed
- `verdict`, `findings_count`, `last_run_at`
- `insight_refs_json`: supplied organization-context references

### connectors

- `id`, `tenant_id`, `type`, `name`, `description`
- `workspace_url`, `client_id`, `secret_ciphertext`
- `config_json`, `status`, `last_tested_at`

### remediations

- `id`, `tenant_id`, `investigation_id`
- `action_type`, `title`, `description`, `connector`
- `status`: pending, approved, running, completed, failed
- `executed_at`

### threat_intel_reports

- `id`, `tenant_id`, `title`, `summary`
- `source`: originating feed or organization
- `report_type`: threat_report, advisory, ioc_feed, hunt_pack
- `severity`: low, medium, high, critical
- `status`: new, reviewing, actionable, archived
- `ioc_count` integer
- `tags_json`: array of string tags
- `published_at`: original publication date
- `hunt_status`: not_started, hunting, completed, no_findings
- `hunts_launched` integer
- `findings_count` integer

### threat_indicators

- `id`, `tenant_id`, `report_id` (FK to threat_intel_reports)
- `indicator_type`: ip, domain, hash_sha256, hash_md5, url, email, cve
- `value`: the IOC value itself
- `severity`: low, medium, high, critical
- `status`: active, mitigated, expired, false_positive
- `hits` integer (environment match count)

### Investigation evidence and audit

- `investigation_steps`: tenant/case IDs, title, conclusion, tool, request and
  response JSON, timestamps. Pipeline and Skills steps record local processing
  and applied guidance; they are not evidence of an external tool call.
- `investigation_feedback`: tenant/case IDs, analyst comment and timestamps.
- `audit_events`: tenant, resource/resource ID, action, details JSON, timestamps.
  This records workflow changes; it is not a complete audit export.

### Alert intake and processing

- `alerts`: tenant, source, provider-side `external_id`, rule and optional case
  IDs, title/severity, routing/disposition, normalized payload JSON and SHA-256
  payload hash, timestamps. `(tenant_id, source, external_id)` is unique. An
  identical retry is idempotent; changed content with the same key conflicts.
- `investigation_jobs`: tenant/case/alert IDs, queued/running/completed/failed
  status, durable phase number, error/result JSON, timestamps. A partial unique
  index permits one active job per case. Processing is local and deterministic.
- `api_sources`: tenant, name/provider, bound detection rule, hashed source key,
  `mapping_json`, expiration/revocation, timestamps. Plain keys are returned once
  during create or rotation and are not stored in readable form. The mapping
  stores normalized target fields and provider JSON dot paths, not event samples.

### Skills and related records (additive migrations)

- `skills`: tenant, name/type, description, apply conditions and Markdown
  guidance; JSON arrays for modules, connectors, alert types/categories, source
  and runtime entities, Enterprise Insights references and tags; origin,
  draft/published state, enabled flag, version and author timestamps.
- `skill_materials`: tenant and skill IDs, name/kind/file type, HTTPS URL or text
  content, version and archive timestamp. Active materials are limited to 10 per
  skill; content files are limited to 128 KiB.
- `skill_material_versions`: immutable JSON snapshots of material metadata and
  content, keyed by tenant, material and version.
- `skill_suggestions`: deterministic source/category patterns from at least two
  closed/resolved analyst-determined cases, sample case IDs, generated draft and
  pending/accepted/dismissed state.
- `skill_applications`: applied skill ID/version and guidance/material snapshot,
  target case/hunt, match rationale, and tenant scope. Matching requires an
  enabled published skill and every configured scope dimension to match.
- `skill_application_feedback`: operator rating and optional comment per
  application; ratings may be revised by the same operator.
- `audit_events`: skill/material lifecycle mutations and actor metadata.

Case transcript entries and hunt run records preserve application snapshots so a
later edit does not rewrite past guidance. These relationships are tenant-scoped.

## Seed and sample data

The migrated release's `demo` tenant contains legacy seeded cases, rules, connectors, remediations, threat reports,
indicators, artifacts, and investigation steps for local UI review. These are
examples, not live customer telemetry or validated performance metrics. New
Skills are tenant-created; starter templates are frontend drafts until saved.
Environment suggestions require at least two closed/resolved cases with analyst
determinations from the same observed source and category. Suggestions are
pattern-based drafts, not AI findings.

Fresh Go databases do not automatically seed the legacy demo dataset. The legacy
SQLite seed process belongs to comparison fixtures; migration imports existing
records without reseeding or duplicating templates.

## Physical PostgreSQL additions

The migration-019 baseline of 28 tables includes 27 declared in SQL migrations plus
`schema_migrations`, maintained by the migration runner. Legacy `artifacts` and
`investigation_feedback` are represented by typed `case_records` rows with JSONB
documents, rather than separate Go tables. `investigations.insight_refs` is JSONB;
the `_json` names above describe the preserved legacy representation.

`tenants` anchors domain ownership. `jobs` is the separate specialist lease/attempt
queue, not `investigation_jobs`. `migration_imports` records snapshot provenance.
Response definitions/versions and pinned case runbooks/events preserve immutable
snapshots and checklist history. Composite foreign keys prevent cross-tenant
relationships. See the [legacy-to-Go map](migration/DATA_MIGRATION_MAP.md) and
the SQL migrations for exact types, indexes and deletion rules.

## Migration Notes

- JSON text columns become PostgreSQL `jsonb`.
- IDs remain application-generated strings to ease offline fixtures/imports.
- Every future unique constraint includes `tenant_id` unless globally scoped.
- External secret-manager integration is a future extension; Go currently stores
  authenticated encrypted envelopes, with the key outside PostgreSQL.

## Migrations 028–029

Migration 028 adds `sandbox_response_policy`, `sandbox_sessions` and
`sandbox_session_actions`, scoped by tenant, connector and source. Policy defaults
to stopped; revocation and audit commit together. These records are simulations.
Migration 029 adds `stream_event_archives`. Verified files replace eligible hot
payloads while event identities, hashes and dedup receipts remain durable. Archive
files must accompany database backups and be restored at their recorded paths.

## Migration 030 and demo imports

`stream_payload_budgets` stores derived per-source identity count, hot-event count
and hot bytes. Statement triggers maintain counters on insert/update/delete and
rollback; archive pointers do not spend the hot-payload budget. Event identities
are immutable. The foundation has 30 migrations and 48 tables; the preserved
release is not automatically upgraded by changing profiles.

Demo imports use the same Go acceptance transaction as mock intake, committing
source checkpoints, events and outbox intent together. JSON files never bypass
tenant/source binding or write directly to PostgreSQL. Reimport preserves identity
and content-hash conflict semantics; it is not a bulk overwrite operation.
