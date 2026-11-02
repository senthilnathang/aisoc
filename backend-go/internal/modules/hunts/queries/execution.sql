-- name: InsertHuntExecution :exec
INSERT INTO hunt_executions(tenant_id,hunt_id,run_id,job_id,query,expected_updated_at,actor) VALUES($1,$2,$3,$4,$5,$6,$7);
-- name: HuntExecution :one
SELECT e.run_id,e.job_id::text,e.query,e.expected_updated_at,e.actor,e.phase,e.created_at,j.state,j.attempts,j.max_attempts,j.error_code,j.available_at,j.updated_at
FROM hunt_executions e JOIN jobs j ON j.tenant_id=e.tenant_id AND j.id=e.job_id
WHERE e.tenant_id=$1 AND e.hunt_id=$2 AND e.run_id=$3;
-- name: HuntExecutions :many
SELECT e.run_id,e.job_id::text,e.query,e.expected_updated_at,e.actor,e.phase,e.created_at,j.state,j.attempts,j.max_attempts,j.error_code,j.available_at,j.updated_at
FROM hunt_executions e JOIN jobs j ON j.tenant_id=e.tenant_id AND j.id=e.job_id
WHERE e.tenant_id=$1 AND e.hunt_id=$2 ORDER BY e.created_at DESC,e.run_id LIMIT 100;
-- name: HuntExecutionCount :one
SELECT count(*) FROM (SELECT r.id FROM hunt_search_runs r WHERE r.tenant_id=$1 AND r.hunt_id=$2 UNION SELECT e.run_id FROM hunt_executions e WHERE e.tenant_id=$1 AND e.hunt_id=$2) r;
-- name: ActiveHuntExecutions :one
SELECT count(*) FROM hunt_executions e JOIN jobs j ON j.tenant_id=e.tenant_id AND j.id=e.job_id WHERE e.tenant_id=$1 AND ($2::text='' OR e.hunt_id=$2) AND j.state IN ('queued','running');
-- name: HuntJobInput :one
SELECT hunt_id,run_id,query,expected_updated_at,actor FROM hunt_executions WHERE tenant_id=$1 AND job_id=$2;
-- name: LockHuntJob :one
SELECT state,attempts,max_attempts,COALESCE(attempt_id::text,'') AS attempt_id,lease_until FROM jobs WHERE tenant_id=$1 AND id=$2 FOR UPDATE;
-- name: HuntExecutionPhase :execrows
UPDATE hunt_executions e SET phase=$4 FROM jobs j WHERE e.tenant_id=$1 AND e.job_id=$2 AND j.tenant_id=e.tenant_id AND j.id=e.job_id AND j.state='running' AND j.attempt_id=$3 AND j.lease_until>now();
-- name: RetryHuntExecution :execrows
UPDATE jobs SET state='queued',max_attempts=max_attempts+3,available_at=now(),error_code=NULL,updated_at=now()
WHERE tenant_id=$1 AND id=$2 AND state='failed' AND attempts=$3 AND max_attempts<9;
-- name: LockHuntTenant :exec
SELECT id FROM tenants WHERE id=$1 FOR NO KEY UPDATE;
