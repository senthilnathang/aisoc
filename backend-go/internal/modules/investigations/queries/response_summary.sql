-- name: ResponseSummary :one
SELECT
 (SELECT count(*) FROM remediations r WHERE r.tenant_id=$1 AND document->>'status'='pending')::bigint AS pending,
 (SELECT count(*) FROM remediations r WHERE r.tenant_id=$1 AND document->>'status'='completed')::bigint AS completed,
 (SELECT count(DISTINCT investigation_id) FROM remediations r WHERE r.tenant_id=$1)::bigint AS cases,
 (SELECT count(*) FROM response_plans p WHERE p.tenant_id=$1 AND document->>'kind'='workflow' AND document->>'state'='active')::bigint AS workflows;
