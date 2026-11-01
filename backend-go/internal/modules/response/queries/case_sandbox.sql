-- name: CaseSandboxLink :one
SELECT investigation_id,document,receipt FROM case_sandbox_responses WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 AND action_id=$4;
-- name: CaseSandboxActionExists :one
SELECT EXISTS(SELECT 1 FROM sandbox_session_actions WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 AND id=$4);
-- name: InsertCaseSandboxLink :exec
INSERT INTO case_sandbox_responses(tenant_id,investigation_id,connector_id,source,action_id,document) VALUES($1,$2,$3,$4,$5,$6);
-- name: CaseSandboxActions :many
SELECT (l.document || jsonb_build_object('connector_id',a.connector_id,'source',a.source,'state',a.state,'approved_by',a.approved_by,'approval_expires_at',a.approval_expires_at,'approval_fresh',COALESCE(a.approval_expires_at>clock_timestamp(),false),'approval_comment',l.approval_comment,'executed_at',a.executed_at,'receipt',l.receipt,'stopped',p.stopped))::jsonb AS document
FROM case_sandbox_responses l JOIN sandbox_session_actions a ON (a.tenant_id,a.connector_id,a.source,a.id)=(l.tenant_id,l.connector_id,l.source,l.action_id)
JOIN sandbox_response_policy p ON (p.tenant_id,p.connector_id,p.source)=(a.tenant_id,a.connector_id,a.source)
WHERE l.tenant_id=$1 AND (sqlc.arg(case_id)::text='' OR l.investigation_id=sqlc.arg(case_id))
ORDER BY l.created_at DESC,l.action_id LIMIT 100;
-- name: CaseSandboxTarget :one
SELECT c.connector_id,c.external_id,c.version,c.status FROM l1_escalations e JOIN mock_soar_cases c ON (c.tenant_id,c.connector_id,c.external_id)=(e.tenant_id,e.connector_id,e.external_id)
WHERE e.tenant_id=$1 AND e.job_id=$2 AND e.investigation_id=$3 AND e.state='synced' FOR UPDATE OF c;
-- name: CaseSandboxSourceVersion :one
SELECT version FROM mock_soar_cases WHERE tenant_id=$1 AND connector_id=$2 AND external_id=$3 FOR UPDATE;
-- name: CaseSandboxApprovalComment :exec
UPDATE case_sandbox_responses SET approval_comment=$5 WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 AND action_id=$4;
-- name: CaseSandboxReceipt :exec
UPDATE case_sandbox_responses SET receipt=$5 WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 AND action_id=$4;
-- name: InsertCaseSandboxNote :exec
INSERT INTO mock_soar_response_notes(tenant_id,connector_id,external_id,id,investigation_id,body) VALUES($1,$2,$3,$4,$5,$6);
-- name: BumpCaseSandboxSourceVersion :exec
UPDATE mock_soar_cases SET previous_version=version,version=$4 WHERE tenant_id=$1 AND connector_id=$2 AND external_id=$3;
