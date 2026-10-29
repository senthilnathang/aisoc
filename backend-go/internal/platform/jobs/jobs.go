package jobs

import (
	pb "aisoc/backend/internal/gen/worker/v1"
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Store struct {
	Pool    *pgxpool.Pool
	Plugins []string
}

var ErrStale = errors.New("job attempt no longer owns a valid lease")

func ID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	b[6] = (b[6] & 15) | 64
	b[8] = (b[8] & 63) | 128
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[:4], b[4:6], b[6:8], b[8:10], b[10:])
}

// Enqueue uses the caller's domain transaction: it cannot commit business work separately.
func Enqueue(ctx context.Context, tx pgx.Tx, tenant, id, plugin string, input []byte) error {
	_, err := tx.Exec(ctx, `INSERT INTO jobs(tenant_id,id,plugin_id,plugin_version,input) VALUES($1,$2,$3,'1',$4)`, tenant, id, plugin, input)
	return err
}
func (s Store) Claim(ctx context.Context) (*pb.ExecuteRequest, error) {
	// Exhausted crashed attempts must not remain running forever.
	if _, err := s.Pool.Exec(ctx, `UPDATE jobs SET state='failed',error_code='ATTEMPTS_EXHAUSTED',lease_until=NULL,updated_at=now() WHERE state='running' AND lease_until<now() AND attempts>=max_attempts`); err != nil {
		return nil, err
	}
	r := &pb.ExecuteRequest{AttemptId: ID()}
	err := s.Pool.QueryRow(ctx, `WITH candidate AS (
 SELECT tenant_id,id FROM jobs WHERE plugin_id=ANY($2::text[]) AND attempts<max_attempts AND
 ((state='queued' AND available_at<=now()) OR (state='running' AND lease_until<now()))
 ORDER BY available_at,created_at,id FOR UPDATE SKIP LOCKED LIMIT 1)
 UPDATE jobs j SET state='running',attempt_id=$1,attempts=attempts+1,lease_until=now()+interval '30 seconds',updated_at=now()
 FROM candidate c WHERE j.tenant_id=c.tenant_id AND j.id=c.id
 RETURNING j.tenant_id,j.id::text,j.plugin_id,j.plugin_version,j.input`, r.AttemptId, s.Plugins).Scan(&r.TenantId, &r.JobId, &r.PluginId, &r.PluginVersion, &r.Input)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return r, err
}
func (s Store) Complete(ctx context.Context, r *pb.ExecuteRequest, output []byte) error {
	tag, err := s.Pool.Exec(ctx, `UPDATE jobs SET state='completed',output=$4,error_code=NULL,lease_until=NULL,updated_at=now()
 WHERE tenant_id=$1 AND id=$2 AND attempt_id=$3 AND state='running' AND lease_until>now()`, r.TenantId, r.JobId, r.AttemptId, output)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return ErrStale
	}
	return nil
}
func (s Store) Retry(ctx context.Context, r *pb.ExecuteRequest) error {
	tag, err := s.Pool.Exec(ctx, `UPDATE jobs SET state=CASE WHEN attempts>=max_attempts THEN 'failed' ELSE 'queued' END,
 error_code='PLUGIN_EXECUTION_FAILED',lease_until=NULL,available_at=now()+interval '2 seconds'*attempts,updated_at=now()
 WHERE tenant_id=$1 AND id=$2 AND attempt_id=$3 AND state='running' AND lease_until>now()`, r.TenantId, r.JobId, r.AttemptId)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return ErrStale
	}
	return nil
}
func (s Store) Cancel(ctx context.Context, tenant, id string) error {
	tag, err := s.Pool.Exec(ctx, `UPDATE jobs SET state='cancelled',lease_until=NULL,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND state IN ('queued','running')`, tenant, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return ErrStale
	}
	return nil
}
