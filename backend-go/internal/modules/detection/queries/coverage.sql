-- name: CoverageInputs :one
SELECT jsonb_build_object(
 'as_of',statement_timestamp(),
 'rules',(SELECT COALESCE(jsonb_agg(jsonb_build_object('id',r.id,'name',COALESCE(NULLIF(r.document->>'name',''),r.id),'enabled',r.document->'enabled'='true'::jsonb,'version',r.version,'techniques',CASE WHEN jsonb_typeof(r.document->'mitre_techniques')='array' THEN r.document->'mitre_techniques' ELSE '[]'::jsonb END) ORDER BY r.id),'[]'::jsonb) FROM detection_rules r WHERE r.tenant_id=sqlc.arg(tenant_id)::text),
 'assessments',(SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY technique_id),'[]'::jsonb) FROM detection_coverage_assessments a WHERE a.tenant_id=sqlc.arg(tenant_id)::text AND a.reference_version=sqlc.arg(reference_version)::text)
);

-- name: SaveCoverageAssessment :one
INSERT INTO detection_coverage_assessments(tenant_id,technique_id,reference_version,state,evidence_ref,notes,rule_id,rule_version,reviewer,reviewed_at,expires_at,version)
SELECT sqlc.arg(tenant_id)::text,sqlc.arg(technique_id)::text,sqlc.arg(reference_version)::text,sqlc.arg(state)::text,sqlc.arg(evidence_ref)::text,sqlc.arg(notes)::text,sqlc.arg(rule_id)::text,sqlc.arg(rule_version)::integer,sqlc.arg(reviewer)::text,now(),sqlc.arg(expires_at)::timestamptz,1
WHERE sqlc.arg(expected_version)::integer=0 OR EXISTS(SELECT 1 FROM detection_coverage_assessments WHERE tenant_id=sqlc.arg(tenant_id)::text AND technique_id=sqlc.arg(technique_id)::text AND reference_version=sqlc.arg(reference_version)::text)
ON CONFLICT(tenant_id,reference_version,technique_id) DO UPDATE SET
 state=EXCLUDED.state,evidence_ref=EXCLUDED.evidence_ref,notes=EXCLUDED.notes,rule_id=EXCLUDED.rule_id,rule_version=EXCLUDED.rule_version,
 reviewer=EXCLUDED.reviewer,reviewed_at=EXCLUDED.reviewed_at,expires_at=EXCLUDED.expires_at,version=detection_coverage_assessments.version+1
WHERE detection_coverage_assessments.version=sqlc.arg(expected_version)::integer
RETURNING version;
