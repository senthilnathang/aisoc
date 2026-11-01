-- name: LockReview :one
SELECT e.investigation_id,e.review_required,coalesce(e.reviewed_by,'') AS reviewed_by,coalesce(e.review_comment,'') AS review_comment
FROM l1_escalations e JOIN stream_findings f ON f.tenant_id=e.tenant_id AND f.investigation_id=e.investigation_id
WHERE e.tenant_id=$1 AND e.job_id=$2 AND f.connector_id=$3 AND f.source=$4
FOR UPDATE OF e;
-- name: ApproveReview :exec
UPDATE l1_escalations SET reviewed_by=$3,review_comment=$4,reviewed_at=now() WHERE tenant_id=$1 AND job_id=$2 AND review_required AND reviewed_by IS NULL;
