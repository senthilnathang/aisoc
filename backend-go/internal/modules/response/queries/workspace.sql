-- name: WorkflowPolicy :one
SELECT document FROM response_workflow_policies WHERE tenant_id=$1 AND plan_id=$2;
-- name: SaveWorkflowPolicy :exec
INSERT INTO response_workflow_policies(tenant_id,plan_id,version,document) VALUES($1,$2,$3,$4)
ON CONFLICT(tenant_id,plan_id) DO UPDATE SET version=excluded.version,document=excluded.document,updated_at=now();
-- name: AuditWorkflowPolicy :exec
INSERT INTO response_workflow_policy_history(tenant_id,plan_id,version,actor,document) VALUES($1,$2,$3,$4,$5);
-- name: InsertWorkflowPreview :exec
INSERT INTO response_workflow_previews(tenant_id,plan_id,id,actor,document) VALUES($1,$2,$3,$4,$5);
-- name: WorkflowPreviews :many
SELECT document FROM response_workflow_previews WHERE tenant_id=$1 AND plan_id=$2 ORDER BY created_at DESC,id LIMIT 50;
-- name: WorkflowPreviewCase :one
SELECT id,title,severity,source FROM investigations WHERE tenant_id=$1 AND id=$2 FOR SHARE;
-- name: WorkflowPolicies :many
SELECT plan_id,document FROM response_workflow_policies WHERE tenant_id=$1 ORDER BY plan_id;

-- name: PlanVersionAuthor :one
SELECT actor FROM response_plan_versions WHERE tenant_id=$1 AND plan_id=$2 AND version=$3;
