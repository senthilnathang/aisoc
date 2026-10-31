-- name: Enqueue :exec
INSERT INTO jobs(tenant_id,id,plugin_id,plugin_version,input) VALUES($1,$2,$3,'1',$4);

-- name: ExpireAttempts :exec
UPDATE jobs SET state='failed',error_code='ATTEMPTS_EXHAUSTED',lease_until=NULL,updated_at=now() WHERE state='running' AND lease_until<now() AND attempts>=max_attempts AND plugin_id=ANY($1::text[]);

-- name: ClaimTenant :one
SELECT d.tenant_id FROM job_dispatch_tenants d
WHERE EXISTS (SELECT 1 FROM jobs j WHERE j.tenant_id=d.tenant_id
 AND j.plugin_id=ANY(sqlc.arg(plugins)::text[]) AND j.attempts<j.max_attempts
 AND ((j.state='queued' AND j.available_at<=now()) OR (j.state='running' AND j.lease_until<now())))
AND (SELECT count(*) FROM jobs j WHERE j.tenant_id=d.tenant_id AND j.state='running' AND j.lease_until>now()) < sqlc.arg(tenant_limit)::int
ORDER BY d.last_claimed_at,d.tenant_id FOR UPDATE OF d SKIP LOCKED LIMIT 1;

-- name: MarkTenantClaimed :exec
UPDATE job_dispatch_tenants SET last_claimed_at=clock_timestamp() WHERE tenant_id=$1;

-- name: Claim :one
WITH candidate AS (
 SELECT id FROM jobs WHERE tenant_id=sqlc.arg(tenant_id)::text
 AND plugin_id=ANY(sqlc.arg(plugins)::text[]) AND attempts<max_attempts
 AND ((state='queued' AND available_at<=now()) OR (state='running' AND lease_until<now()))
 AND (SELECT count(*) FROM jobs running WHERE running.tenant_id=sqlc.arg(tenant_id)::text AND running.state='running' AND running.lease_until>now()) < sqlc.arg(tenant_limit)::int
 ORDER BY available_at,created_at,id FOR UPDATE SKIP LOCKED LIMIT 1)
 UPDATE jobs j SET state='running',attempt_id=sqlc.arg(attempt_id)::uuid,attempts=attempts+1,lease_until=now()+interval '30 seconds',updated_at=now()
 FROM candidate c WHERE j.tenant_id=sqlc.arg(tenant_id)::text AND j.id=c.id
 RETURNING j.tenant_id,j.id::text AS job_id,j.plugin_id,j.plugin_version,j.input;

-- name: Complete :execrows
UPDATE jobs SET state='completed',output=$4,error_code=NULL,lease_until=NULL,updated_at=now()
 WHERE tenant_id=$1 AND id=$2 AND attempt_id=$3 AND state='running' AND lease_until>now();

-- name: Retry :execrows
UPDATE jobs SET state=CASE WHEN attempts>=max_attempts THEN 'failed' ELSE 'queued' END,
 error_code='PLUGIN_EXECUTION_FAILED',lease_until=NULL,available_at=now()+interval '2 seconds'*attempts,updated_at=now()
 WHERE tenant_id=$1 AND id=$2 AND attempt_id=$3 AND state='running' AND lease_until>now();

-- name: Cancel :execrows
UPDATE jobs SET state='cancelled',lease_until=NULL,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND state IN ('queued','running');
