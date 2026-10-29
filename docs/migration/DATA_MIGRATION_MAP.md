# Backend Data Migration Map

Generated from a fresh migrated SQLite database, including response schema version 12.
This is the legacy source inventory. Type hints below are historical candidates, not the active physical schema.
All 26 legacy tables reconciled at cutover; see [release status](RELEASE_STATUS.md).
Authoritative PostgreSQL DDL is in [Go migrations](../../backend-go/migrations/); see [the data model](../DATA_MODEL.md).
SQL definitions, composite foreign keys, and index metadata are in [the inventory](../../contracts/current-backend.json).

Applied migrations: 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12. Tables: 26.

## alerts

| Column | SQLite type | Required | Primary key order | Default | PostgreSQL candidate |
|---|---|---|---|---|---|
| id | TEXT | Yes | 2 |  | text; review timestamps separately |
| tenant_id | TEXT | Yes | 1 |  | text; review timestamps separately |
| source | TEXT | Yes |  |  | text; review timestamps separately |
| external_id | TEXT | Yes |  |  | text; review timestamps separately |
| rule_id | TEXT | Yes |  |  | text; review timestamps separately |
| investigation_id | TEXT | No |  |  | text; review timestamps separately |
| title | TEXT | Yes |  |  | text; review timestamps separately |
| severity | TEXT | Yes |  |  | text; review timestamps separately |
| routing | TEXT | Yes |  |  | text; review timestamps separately |
| disposition | TEXT | Yes |  |  | text; review timestamps separately |
| payload_json | TEXT | Yes |  |  | jsonb after round-trip review |
| payload_hash | TEXT | Yes |  |  | text; review timestamps separately |
| created_at | TEXT | Yes |  |  | text; review timestamps separately |
| updated_at | TEXT | Yes |  |  | text; review timestamps separately |

Foreign keys: tenant_id → investigations.tenant_id (delete RESTRICT); investigation_id → investigations.id (delete RESTRICT); tenant_id → detection_rules.tenant_id (delete RESTRICT); rule_id → detection_rules.id (delete RESTRICT).

Migration status: implemented and reconciled for the local release; physical representation may combine legacy tables.

## api_sources

| Column | SQLite type | Required | Primary key order | Default | PostgreSQL candidate |
|---|---|---|---|---|---|
| id | TEXT | No | 1 |  | text; review timestamps separately |
| tenant_id | TEXT | Yes |  |  | text; review timestamps separately |
| name | TEXT | Yes |  |  | text; review timestamps separately |
| provider | TEXT | Yes |  |  | text; review timestamps separately |
| rule_id | TEXT | Yes |  |  | text; review timestamps separately |
| key_hash | TEXT | No |  |  | text; review timestamps separately |
| expires_at | TEXT | Yes |  |  | text; review timestamps separately |
| revoked_at | TEXT | No |  |  | text; review timestamps separately |
| created_at | TEXT | Yes |  |  | text; review timestamps separately |
| updated_at | TEXT | Yes |  |  | text; review timestamps separately |
| mapping_json | TEXT | Yes |  | '{"fields":{}}' | jsonb after round-trip review |

Foreign keys: tenant_id → detection_rules.tenant_id (delete RESTRICT); rule_id → detection_rules.id (delete RESTRICT).

Migration status: implemented and reconciled for the local release; physical representation may combine legacy tables.

## artifacts

| Column | SQLite type | Required | Primary key order | Default | PostgreSQL candidate |
|---|---|---|---|---|---|
| id | TEXT | Yes | 2 |  | text; review timestamps separately |
| tenant_id | TEXT | Yes | 1 |  | text; review timestamps separately |
| investigation_id | TEXT | Yes |  |  | text; review timestamps separately |
| type | TEXT | Yes |  |  | text; review timestamps separately |
| value | TEXT | Yes |  |  | text; review timestamps separately |
| label | TEXT | Yes |  | '' | text; review timestamps separately |
| metadata_json | TEXT | Yes |  | '{}' | jsonb after round-trip review |
| created_at | TEXT | Yes |  |  | text; review timestamps separately |
| updated_at | TEXT | Yes |  |  | text; review timestamps separately |

Foreign keys: tenant_id → investigations.tenant_id (delete CASCADE); investigation_id → investigations.id (delete CASCADE).

Migration status: implemented and reconciled for the local release; physical representation may combine legacy tables.

## audit_events

| Column | SQLite type | Required | Primary key order | Default | PostgreSQL candidate |
|---|---|---|---|---|---|
| id | TEXT | Yes | 2 |  | text; review timestamps separately |
| tenant_id | TEXT | Yes | 1 |  | text; review timestamps separately |
| resource | TEXT | Yes |  |  | text; review timestamps separately |
| resource_id | TEXT | Yes |  |  | text; review timestamps separately |
| action | TEXT | Yes |  |  | text; review timestamps separately |
| details_json | TEXT | Yes |  | '{}' | jsonb after round-trip review |
| created_at | TEXT | Yes |  |  | text; review timestamps separately |
| updated_at | TEXT | Yes |  |  | text; review timestamps separately |

Foreign keys: none declared.

Migration status: implemented and reconciled for the local release; physical representation may combine legacy tables.

## case_runbook_events

| Column | SQLite type | Required | Primary key order | Default | PostgreSQL candidate |
|---|---|---|---|---|---|
| tenant_id | TEXT | Yes | 1 |  | text; review timestamps separately |
| assignment_id | TEXT | Yes | 2 |  | text; review timestamps separately |
| version | INTEGER | Yes | 3 |  | bigint; review flags separately |
| document_json | TEXT | Yes |  |  | jsonb after round-trip review |

Foreign keys: tenant_id → case_runbooks.tenant_id (delete CASCADE); assignment_id → case_runbooks.id (delete CASCADE).

Migration status: implemented and reconciled for the local release; physical representation may combine legacy tables.

## case_runbooks

| Column | SQLite type | Required | Primary key order | Default | PostgreSQL candidate |
|---|---|---|---|---|---|
| tenant_id | TEXT | Yes | 1 |  | text; review timestamps separately |
| id | TEXT | Yes | 2 |  | text; review timestamps separately |
| investigation_id | TEXT | Yes |  |  | text; review timestamps separately |
| plan_id | TEXT | Yes |  |  | text; review timestamps separately |
| document_json | TEXT | Yes |  |  | jsonb after round-trip review |

Foreign keys: tenant_id → response_plans.tenant_id (delete NO ACTION); plan_id → response_plans.id (delete NO ACTION); tenant_id → investigations.tenant_id (delete CASCADE); investigation_id → investigations.id (delete CASCADE).

Migration status: implemented and reconciled for the local release; physical representation may combine legacy tables.

## connectors

| Column | SQLite type | Required | Primary key order | Default | PostgreSQL candidate |
|---|---|---|---|---|---|
| id | TEXT | Yes | 2 |  | text; review timestamps separately |
| tenant_id | TEXT | Yes | 1 |  | text; review timestamps separately |
| type | TEXT | Yes |  |  | text; review timestamps separately |
| name | TEXT | Yes |  |  | text; review timestamps separately |
| description | TEXT | Yes |  | '' | text; review timestamps separately |
| workspace_url | TEXT | Yes |  | '' | text; review timestamps separately |
| client_id | TEXT | Yes |  | '' | text; review timestamps separately |
| secret_ciphertext | TEXT | Yes |  | '' | text; review timestamps separately |
| config_json | TEXT | Yes |  | '{}' | jsonb after round-trip review |
| status | TEXT | Yes |  | 'untested' | text; review timestamps separately |
| last_tested_at | TEXT | No |  |  | text; review timestamps separately |
| created_at | TEXT | Yes |  |  | text; review timestamps separately |
| updated_at | TEXT | Yes |  |  | text; review timestamps separately |

Foreign keys: none declared.

Migration status: implemented and reconciled for the local release; physical representation may combine legacy tables.

## detection_rule_versions

| Column | SQLite type | Required | Primary key order | Default | PostgreSQL candidate |
|---|---|---|---|---|---|
| tenant_id | TEXT | Yes | 1 |  | text; review timestamps separately |
| rule_id | TEXT | Yes | 2 |  | text; review timestamps separately |
| version | INTEGER | Yes | 3 |  | bigint; review flags separately |
| snapshot_json | TEXT | Yes |  |  | jsonb after round-trip review |
| created_at | TEXT | Yes |  |  | text; review timestamps separately |

Foreign keys: tenant_id → detection_rules.tenant_id (delete CASCADE); rule_id → detection_rules.id (delete CASCADE).

Migration status: implemented and reconciled for the local release; physical representation may combine legacy tables.

## detection_rules

| Column | SQLite type | Required | Primary key order | Default | PostgreSQL candidate |
|---|---|---|---|---|---|
| id | TEXT | Yes | 2 |  | text; review timestamps separately |
| tenant_id | TEXT | Yes | 1 |  | text; review timestamps separately |
| name | TEXT | Yes |  |  | text; review timestamps separately |
| description | TEXT | Yes |  | '' | text; review timestamps separately |
| mitre_techniques_json | TEXT | Yes |  | '[]' | jsonb after round-trip review |
| execution_mode | TEXT | Yes |  | 'scheduled' | text; review timestamps separately |
| enabled | INTEGER | Yes |  | 1 | bigint; review flags separately |
| severity | TEXT | Yes |  |  | text; review timestamps separately |
| detections | INTEGER | Yes |  | 0 | bigint; review flags separately |
| investigations | INTEGER | Yes |  | 0 | bigint; review flags separately |
| false_positive_rate | REAL | Yes |  | 0 | double precision |
| recommendation_status | TEXT | Yes |  | 'not_analyzed' | text; review timestamps separately |
| last_activity_at | TEXT | No |  |  | text; review timestamps separately |
| created_at | TEXT | Yes |  |  | text; review timestamps separately |
| updated_at | TEXT | Yes |  |  | text; review timestamps separately |
| query | TEXT | Yes |  | '' | text; review timestamps separately |
| schedule | TEXT | Yes |  | 'Every 5 minutes' | text; review timestamps separately |
| lookback_window | TEXT | Yes |  | '15 minutes' | text; review timestamps separately |
| routing | TEXT | Yes |  | 'Investigate' | text; review timestamps separately |

Foreign keys: none declared.

Migration status: implemented and reconciled for the local release; physical representation may combine legacy tables.

## hunts

| Column | SQLite type | Required | Primary key order | Default | PostgreSQL candidate |
|---|---|---|---|---|---|
| id | TEXT | Yes | 2 |  | text; review timestamps separately |
| tenant_id | TEXT | Yes | 1 |  | text; review timestamps separately |
| name | TEXT | Yes |  |  | text; review timestamps separately |
| query | TEXT | Yes |  |  | text; review timestamps separately |
| source | TEXT | Yes |  | 'ad_hoc' | text; review timestamps separately |
| status | TEXT | Yes |  | 'draft' | text; review timestamps separately |
| verdict | TEXT | No |  |  | text; review timestamps separately |
| findings_count | INTEGER | Yes |  | 0 | bigint; review flags separately |
| last_run_at | TEXT | No |  |  | text; review timestamps separately |
| created_at | TEXT | Yes |  |  | text; review timestamps separately |
| updated_at | TEXT | Yes |  |  | text; review timestamps separately |
| insight_refs_json | TEXT | Yes |  | '[]' | jsonb after round-trip review |

Foreign keys: none declared.

Migration status: implemented and reconciled for the local release; physical representation may combine legacy tables.

## investigation_feedback

| Column | SQLite type | Required | Primary key order | Default | PostgreSQL candidate |
|---|---|---|---|---|---|
| id | TEXT | Yes | 2 |  | text; review timestamps separately |
| tenant_id | TEXT | Yes | 1 |  | text; review timestamps separately |
| investigation_id | TEXT | Yes |  |  | text; review timestamps separately |
| comment | TEXT | Yes |  |  | text; review timestamps separately |
| created_at | TEXT | Yes |  |  | text; review timestamps separately |
| updated_at | TEXT | Yes |  |  | text; review timestamps separately |

Foreign keys: tenant_id → investigations.tenant_id (delete CASCADE); investigation_id → investigations.id (delete CASCADE).

Migration status: implemented and reconciled for the local release; physical representation may combine legacy tables.

## investigation_jobs

| Column | SQLite type | Required | Primary key order | Default | PostgreSQL candidate |
|---|---|---|---|---|---|
| id | TEXT | Yes | 2 |  | text; review timestamps separately |
| tenant_id | TEXT | Yes | 1 |  | text; review timestamps separately |
| investigation_id | TEXT | Yes |  |  | text; review timestamps separately |
| alert_id | TEXT | Yes |  |  | text; review timestamps separately |
| status | TEXT | Yes |  |  | text; review timestamps separately |
| phase | INTEGER | Yes |  | 0 | bigint; review flags separately |
| error | TEXT | No |  |  | text; review timestamps separately |
| result_json | TEXT | Yes |  | '{}' | jsonb after round-trip review |
| created_at | TEXT | Yes |  |  | text; review timestamps separately |
| updated_at | TEXT | Yes |  |  | text; review timestamps separately |

Foreign keys: tenant_id → alerts.tenant_id (delete RESTRICT); alert_id → alerts.id (delete RESTRICT); tenant_id → investigations.tenant_id (delete CASCADE); investigation_id → investigations.id (delete CASCADE).

Migration status: implemented and reconciled for the local release; physical representation may combine legacy tables.

## investigation_steps

| Column | SQLite type | Required | Primary key order | Default | PostgreSQL candidate |
|---|---|---|---|---|---|
| id | TEXT | Yes | 2 |  | text; review timestamps separately |
| tenant_id | TEXT | Yes | 1 |  | text; review timestamps separately |
| investigation_id | TEXT | Yes |  |  | text; review timestamps separately |
| title | TEXT | Yes |  |  | text; review timestamps separately |
| conclusion | TEXT | Yes |  | '' | text; review timestamps separately |
| tool | TEXT | Yes |  |  | text; review timestamps separately |
| request_json | TEXT | Yes |  | '{}' | jsonb after round-trip review |
| response_json | TEXT | Yes |  | '{}' | jsonb after round-trip review |
| created_at | TEXT | Yes |  |  | text; review timestamps separately |
| updated_at | TEXT | Yes |  |  | text; review timestamps separately |

Foreign keys: tenant_id → investigations.tenant_id (delete CASCADE); investigation_id → investigations.id (delete CASCADE).

Migration status: implemented and reconciled for the local release; physical representation may combine legacy tables.

## investigations

| Column | SQLite type | Required | Primary key order | Default | PostgreSQL candidate |
|---|---|---|---|---|---|
| id | TEXT | Yes | 2 |  | text; review timestamps separately |
| tenant_id | TEXT | Yes | 1 |  | text; review timestamps separately |
| title | TEXT | Yes |  |  | text; review timestamps separately |
| summary | TEXT | Yes |  | '' | text; review timestamps separately |
| source | TEXT | Yes |  |  | text; review timestamps separately |
| category | TEXT | Yes |  | 'other' | text; review timestamps separately |
| severity | TEXT | Yes |  |  | text; review timestamps separately |
| status | TEXT | Yes |  |  | text; review timestamps separately |
| determination | TEXT | Yes |  |  | text; review timestamps separately |
| risk_score | INTEGER | Yes |  | 0 | bigint; review flags separately |
| owner | TEXT | Yes |  | 'AISOC Agent' | text; review timestamps separately |
| primary_entity | TEXT | Yes |  | '' | text; review timestamps separately |
| replay_count | INTEGER | Yes |  | 0 | bigint; review flags separately |
| created_at | TEXT | Yes |  |  | text; review timestamps separately |
| updated_at | TEXT | Yes |  |  | text; review timestamps separately |
| insight_refs_json | TEXT | Yes |  | '[]' | jsonb after round-trip review |

Foreign keys: none declared.

Migration status: implemented and reconciled for the local release; physical representation may combine legacy tables.

## remediations

| Column | SQLite type | Required | Primary key order | Default | PostgreSQL candidate |
|---|---|---|---|---|---|
| id | TEXT | Yes | 2 |  | text; review timestamps separately |
| tenant_id | TEXT | Yes | 1 |  | text; review timestamps separately |
| investigation_id | TEXT | Yes |  |  | text; review timestamps separately |
| action_type | TEXT | Yes |  |  | text; review timestamps separately |
| title | TEXT | Yes |  |  | text; review timestamps separately |
| description | TEXT | Yes |  | '' | text; review timestamps separately |
| connector | TEXT | Yes |  | '' | text; review timestamps separately |
| status | TEXT | Yes |  | 'pending' | text; review timestamps separately |
| executed_at | TEXT | No |  |  | text; review timestamps separately |
| created_at | TEXT | Yes |  |  | text; review timestamps separately |
| updated_at | TEXT | Yes |  |  | text; review timestamps separately |

Foreign keys: tenant_id → investigations.tenant_id (delete CASCADE); investigation_id → investigations.id (delete CASCADE).

Migration status: implemented and reconciled for the local release; physical representation may combine legacy tables.

## response_plan_versions

| Column | SQLite type | Required | Primary key order | Default | PostgreSQL candidate |
|---|---|---|---|---|---|
| tenant_id | TEXT | Yes | 1 |  | text; review timestamps separately |
| plan_id | TEXT | Yes | 2 |  | text; review timestamps separately |
| version | INTEGER | Yes | 3 |  | bigint; review flags separately |
| snapshot_json | TEXT | Yes |  |  | jsonb after round-trip review |
| action | TEXT | Yes |  |  | text; review timestamps separately |
| actor | TEXT | Yes |  |  | text; review timestamps separately |
| created_at | TEXT | Yes |  |  | text; review timestamps separately |

Foreign keys: tenant_id → response_plans.tenant_id (delete NO ACTION); plan_id → response_plans.id (delete NO ACTION).

Migration status: implemented and reconciled for the local release; physical representation may combine legacy tables.

## response_plans

| Column | SQLite type | Required | Primary key order | Default | PostgreSQL candidate |
|---|---|---|---|---|---|
| tenant_id | TEXT | Yes | 1 |  | text; review timestamps separately |
| id | TEXT | Yes | 2 |  | text; review timestamps separately |
| document_json | TEXT | Yes |  |  | jsonb after round-trip review |

Foreign keys: none declared.

Migration status: implemented and reconciled for the local release; physical representation may combine legacy tables.

## schema_migrations

| Column | SQLite type | Required | Primary key order | Default | PostgreSQL candidate |
|---|---|---|---|---|---|
| version | INTEGER | No | 1 |  | bigint; review flags separately |
| applied_at | TEXT | Yes |  |  | text; review timestamps separately |

Foreign keys: none declared.

Migration status: implemented and reconciled for the local release; physical representation may combine legacy tables.

## skill_application_feedback

| Column | SQLite type | Required | Primary key order | Default | PostgreSQL candidate |
|---|---|---|---|---|---|
| id | TEXT | Yes | 2 |  | text; review timestamps separately |
| tenant_id | TEXT | Yes | 1 |  | text; review timestamps separately |
| application_id | TEXT | Yes |  |  | text; review timestamps separately |
| rating | TEXT | Yes |  |  | text; review timestamps separately |
| comment | TEXT | Yes |  | '' | text; review timestamps separately |
| created_by | TEXT | Yes |  |  | text; review timestamps separately |
| created_at | TEXT | Yes |  |  | text; review timestamps separately |
| updated_at | TEXT | Yes |  |  | text; review timestamps separately |

Foreign keys: tenant_id → skill_applications.tenant_id (delete CASCADE); application_id → skill_applications.id (delete CASCADE).

Migration status: implemented and reconciled for the local release; physical representation may combine legacy tables.

## skill_applications

| Column | SQLite type | Required | Primary key order | Default | PostgreSQL candidate |
|---|---|---|---|---|---|
| id | TEXT | Yes | 2 |  | text; review timestamps separately |
| tenant_id | TEXT | Yes | 1 |  | text; review timestamps separately |
| skill_id | TEXT | Yes |  |  | text; review timestamps separately |
| target_type | TEXT | Yes |  |  | text; review timestamps separately |
| target_id | TEXT | Yes |  |  | text; review timestamps separately |
| skill_version | INTEGER | Yes |  |  | bigint; review flags separately |
| reason | TEXT | Yes |  |  | text; review timestamps separately |
| snapshot_json | TEXT | Yes |  |  | jsonb after round-trip review |
| created_at | TEXT | Yes |  |  | text; review timestamps separately |

Foreign keys: tenant_id → skills.tenant_id (delete CASCADE); skill_id → skills.id (delete CASCADE).

Migration status: implemented and reconciled for the local release; physical representation may combine legacy tables.

## skill_material_versions

| Column | SQLite type | Required | Primary key order | Default | PostgreSQL candidate |
|---|---|---|---|---|---|
| tenant_id | TEXT | Yes | 1 |  | text; review timestamps separately |
| material_id | TEXT | Yes | 2 |  | text; review timestamps separately |
| version | INTEGER | Yes | 3 |  | bigint; review flags separately |
| snapshot_json | TEXT | Yes |  |  | jsonb after round-trip review |
| created_by | TEXT | Yes |  |  | text; review timestamps separately |
| created_at | TEXT | Yes |  |  | text; review timestamps separately |

Foreign keys: tenant_id → skill_materials.tenant_id (delete CASCADE); material_id → skill_materials.id (delete CASCADE).

Migration status: implemented and reconciled for the local release; physical representation may combine legacy tables.

## skill_materials

| Column | SQLite type | Required | Primary key order | Default | PostgreSQL candidate |
|---|---|---|---|---|---|
| id | TEXT | Yes | 2 |  | text; review timestamps separately |
| tenant_id | TEXT | Yes | 1 |  | text; review timestamps separately |
| skill_id | TEXT | Yes |  |  | text; review timestamps separately |
| name | TEXT | Yes |  |  | text; review timestamps separately |
| kind | TEXT | Yes |  |  | text; review timestamps separately |
| file_type | TEXT | Yes |  |  | text; review timestamps separately |
| source_url | TEXT | No |  |  | text; review timestamps separately |
| content | TEXT | Yes |  | '' | text; review timestamps separately |
| version | INTEGER | Yes |  | 1 | bigint; review flags separately |
| archived_at | TEXT | No |  |  | text; review timestamps separately |
| created_by | TEXT | Yes |  |  | text; review timestamps separately |
| created_at | TEXT | Yes |  |  | text; review timestamps separately |
| updated_at | TEXT | Yes |  |  | text; review timestamps separately |

Foreign keys: tenant_id → skills.tenant_id (delete CASCADE); skill_id → skills.id (delete CASCADE).

Migration status: implemented and reconciled for the local release; physical representation may combine legacy tables.

## skill_suggestions

| Column | SQLite type | Required | Primary key order | Default | PostgreSQL candidate |
|---|---|---|---|---|---|
| id | TEXT | Yes | 2 |  | text; review timestamps separately |
| tenant_id | TEXT | Yes | 1 |  | text; review timestamps separately |
| signature | TEXT | Yes |  |  | text; review timestamps separately |
| name | TEXT | Yes |  |  | text; review timestamps separately |
| explanation | TEXT | Yes |  |  | text; review timestamps separately |
| source | TEXT | Yes |  |  | text; review timestamps separately |
| category | TEXT | Yes |  |  | text; review timestamps separately |
| case_count | INTEGER | Yes |  |  | bigint; review flags separately |
| feedback_count | INTEGER | Yes |  | 0 | bigint; review flags separately |
| sample_case_ids_json | TEXT | Yes |  |  | jsonb after round-trip review |
| draft_json | TEXT | Yes |  |  | jsonb after round-trip review |
| status | TEXT | Yes |  | 'pending' | text; review timestamps separately |
| accepted_skill_id | TEXT | No |  |  | text; review timestamps separately |
| created_at | TEXT | Yes |  |  | text; review timestamps separately |
| updated_at | TEXT | Yes |  |  | text; review timestamps separately |

Foreign keys: none declared.

Migration status: implemented and reconciled for the local release; physical representation may combine legacy tables.

## skills

| Column | SQLite type | Required | Primary key order | Default | PostgreSQL candidate |
|---|---|---|---|---|---|
| id | TEXT | Yes | 2 |  | text; review timestamps separately |
| tenant_id | TEXT | Yes | 1 |  | text; review timestamps separately |
| name | TEXT | Yes |  |  | text; review timestamps separately |
| skill_type | TEXT | Yes |  |  | text; review timestamps separately |
| description | TEXT | Yes |  | '' | text; review timestamps separately |
| apply_when | TEXT | Yes |  | '' | text; review timestamps separately |
| content_markdown | TEXT | Yes |  | '' | text; review timestamps separately |
| modules_json | TEXT | Yes |  | '[]' | jsonb after round-trip review |
| connectors_json | TEXT | Yes |  | '[]' | jsonb after round-trip review |
| alert_types_json | TEXT | Yes |  | '[]' | jsonb after round-trip review |
| alert_categories_json | TEXT | Yes |  | '[]' | jsonb after round-trip review |
| source_entities_json | TEXT | Yes |  | '[]' | jsonb after round-trip review |
| runtime_entities_json | TEXT | Yes |  | '[]' | jsonb after round-trip review |
| insight_refs_json | TEXT | Yes |  | '[]' | jsonb after round-trip review |
| tags_json | TEXT | Yes |  | '[]' | jsonb after round-trip review |
| origin | TEXT | Yes |  | 'user' | text; review timestamps separately |
| state | TEXT | Yes |  | 'draft' | text; review timestamps separately |
| enabled | INTEGER | Yes |  | 0 | bigint; review flags separately |
| version | INTEGER | Yes |  | 1 | bigint; review flags separately |
| created_by | TEXT | Yes |  |  | text; review timestamps separately |
| created_at | TEXT | Yes |  |  | text; review timestamps separately |
| updated_at | TEXT | Yes |  |  | text; review timestamps separately |

Foreign keys: none declared.

Migration status: implemented and reconciled for the local release; physical representation may combine legacy tables.

## threat_indicators

| Column | SQLite type | Required | Primary key order | Default | PostgreSQL candidate |
|---|---|---|---|---|---|
| id | TEXT | Yes | 2 |  | text; review timestamps separately |
| tenant_id | TEXT | Yes | 1 |  | text; review timestamps separately |
| report_id | TEXT | Yes |  |  | text; review timestamps separately |
| indicator_type | TEXT | Yes |  |  | text; review timestamps separately |
| value | TEXT | Yes |  |  | text; review timestamps separately |
| severity | TEXT | Yes |  | 'medium' | text; review timestamps separately |
| status | TEXT | Yes |  | 'active' | text; review timestamps separately |
| hits | INTEGER | Yes |  | 0 | bigint; review flags separately |
| last_seen_at | TEXT | No |  |  | text; review timestamps separately |
| created_at | TEXT | Yes |  |  | text; review timestamps separately |
| updated_at | TEXT | Yes |  |  | text; review timestamps separately |

Foreign keys: tenant_id → threat_intel_reports.tenant_id (delete CASCADE); report_id → threat_intel_reports.id (delete CASCADE).

Migration status: implemented and reconciled for the local release; physical representation may combine legacy tables.

## threat_intel_reports

| Column | SQLite type | Required | Primary key order | Default | PostgreSQL candidate |
|---|---|---|---|---|---|
| id | TEXT | Yes | 2 |  | text; review timestamps separately |
| tenant_id | TEXT | Yes | 1 |  | text; review timestamps separately |
| title | TEXT | Yes |  |  | text; review timestamps separately |
| summary | TEXT | Yes |  | '' | text; review timestamps separately |
| source | TEXT | Yes |  | 'AISOC' | text; review timestamps separately |
| report_type | TEXT | Yes |  | 'threat_report' | text; review timestamps separately |
| severity | TEXT | Yes |  |  | text; review timestamps separately |
| status | TEXT | Yes |  | 'new' | text; review timestamps separately |
| ioc_count | INTEGER | Yes |  | 0 | bigint; review flags separately |
| hunt_status | TEXT | Yes |  | 'not_started' | text; review timestamps separately |
| hunts_launched | INTEGER | Yes |  | 0 | bigint; review flags separately |
| findings_count | INTEGER | Yes |  | 0 | bigint; review flags separately |
| tags_json | TEXT | Yes |  | '[]' | jsonb after round-trip review |
| published_at | TEXT | Yes |  |  | text; review timestamps separately |
| created_at | TEXT | Yes |  |  | text; review timestamps separately |
| updated_at | TEXT | Yes |  |  | text; review timestamps separately |

Foreign keys: none declared.

Migration status: implemented and reconciled for the local release; physical representation may combine legacy tables.
