# Data Model

All mutable tables include `tenant_id`, `created_at`, and `updated_at`.

## Entities

### investigations

- `id` text primary key
- `tenant_id` text
- `title`, `summary`, `source`, `category`
- `severity`: low, medium, high, critical
- `status`: open, investigating, contained, resolved, closed
- `determination`: unknown, benign, suspicious, malicious, mitigated
- `risk_score` integer 0–100
- `owner`, `primary_entity`
- `replay_count` integer

### artifacts

- `id`, `investigation_id`, `tenant_id`
- `type`, `value`, `label`, `metadata_json`

### detection_rules

- `id`, `tenant_id`, `name`, `description`
- `mitre_techniques_json`, `execution_mode`
- `enabled`, `severity`
- `detections`, `investigations`, `false_positive_rate`
- `recommendation_status`, `last_activity_at`

### hunts

- `id`, `tenant_id`, `name`, `query`, `source`
- `status`: draft, running, completed, failed
- `verdict`, `findings_count`, `last_run_at`

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

### Skills and related records (additive migrations)

- `skills`: tenant, name/type, plain-language guidance, scope arrays, origin,
  draft/published state, enabled flag, version and author timestamps.
- `skill_materials`: tenant and skill IDs, name/kind/file type, HTTPS URL or text
  content, version and archive timestamp. Active materials are limited to 10 per
  skill; content files are limited to 128 KiB.
- `skill_material_versions`: immutable JSON snapshots of material metadata and
  content, keyed by tenant, material and version.
- `skill_suggestions`: deterministic source/category patterns from at least two
  closed/resolved analyst-determined cases, sample case IDs, generated draft and
  pending/accepted/dismissed state.
- `skill_applications`: applied skill ID/version and guidance snapshot, target
  case/hunt, match rationale, and tenant scope.
- `skill_application_feedback`: operator rating and optional comment per
  application; ratings may be revised by the same operator.
- `audit_events`: skill/material lifecycle mutations and actor metadata.

Case transcript entries and hunt run records preserve application snapshots so a
later edit does not rewrite past guidance. These relationships are tenant-scoped.

## Migration Notes

- JSON text columns become PostgreSQL `jsonb`.
- IDs remain application-generated strings to ease offline fixtures/imports.
- Every future unique constraint includes `tenant_id` unless globally scoped.
- Connector secrets move to a secrets manager; SQLite stores local placeholders only.
