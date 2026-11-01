-- name: GetImportBatch :one
SELECT * FROM local_import_batches WHERE tenant_id=$1 AND id=$2;
-- name: CountImportBatches :one
SELECT count(*) FROM local_import_batches WHERE tenant_id=$1;
-- name: InsertImportBatch :exec
INSERT INTO local_import_batches(tenant_id,id,scope_id,name,request_hash,actor) VALUES($1,$2,$3,$4,$5,$6);
-- name: InsertImportItem :exec
INSERT INTO local_import_batch_items(tenant_id,batch_id,case_key,profile_id,name,document,state,error_code) VALUES($1,$2,$3,$4,$5,$6,$7,$8);
-- name: ImportItems :many
SELECT * FROM local_import_batch_items WHERE tenant_id=$1 AND batch_id=$2 ORDER BY case_key;
-- name: ClaimImportItem :one
UPDATE local_import_batch_items SET state='running',claim_token=$4,lease_until=now()+interval '60 seconds',attempts=attempts+1,updated_at=now()
WHERE tenant_id=$1 AND batch_id=$2 AND case_key=$3 AND version=$5 AND (state IN ('pending','failed') OR (state='running' AND lease_until<now())) RETURNING *;
-- name: FinishImportItem :one
UPDATE local_import_batch_items SET state=$5,error_code=$6,accepted_inserted=$7,lease_until=NULL,updated_at=now()
WHERE tenant_id=$1 AND batch_id=$2 AND case_key=$3 AND claim_token=$4 RETURNING *;
-- name: ListImportBatches :many
SELECT id,scope_id,name,actor,created_at FROM local_import_batches WHERE tenant_id=$1 ORDER BY created_at DESC,id LIMIT 200;
-- name: ImportItemProgress :one
SELECT jsonb_build_object(
 'accepted_events',(SELECT count(*) FROM stream_events ev WHERE ev.tenant_id=$1 AND ev.connector_id=$2 AND source='qradar-siem'),
 'processed_events',(SELECT count(*) FROM stream_inbox si WHERE si.tenant_id=$1 AND si.connector_id=$2 AND source='qradar-siem' AND processor='build-login-v1'),
 'cases',coalesce((SELECT jsonb_agg(jsonb_build_object('investigation_id',f.investigation_id,'state',CASE WHEN e.state='draft' AND e.review_required AND e.reviewed_by IS NULL THEN 'awaiting_review' ELSE coalesce(e.state,'awaiting_mock_inference') END,'note_id',e.note_id)) FROM stream_findings f LEFT JOIN l1_escalations e ON e.tenant_id=f.tenant_id AND e.investigation_id=f.investigation_id WHERE f.tenant_id=$1 AND f.connector_id=$2),'[]'::jsonb));
-- name: LockImportItem :one
SELECT * FROM local_import_batch_items WHERE tenant_id=$1 AND batch_id=$2 AND case_key=$3 FOR UPDATE;
-- name: RepairImportItem :one
UPDATE local_import_batch_items SET name=$4,document=$5,state=$6,error_code=$7,version=version+1,updated_at=now()
WHERE tenant_id=$1 AND batch_id=$2 AND case_key=$3 RETURNING *;
