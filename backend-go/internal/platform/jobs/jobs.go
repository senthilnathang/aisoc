package jobs

import (
	pb "aisoc/backend/internal/gen/worker/v1"
	"aisoc/backend/internal/platform/jobs/jobsql"
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Store struct {
	Pool        *pgxpool.Pool
	Plugins     []string
	TenantLimit int32
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
	return jobsql.New(tx).Enqueue(ctx, jobsql.EnqueueParams{TenantID: tenant, ID: id, PluginID: plugin, Input: input})
}

// Claim serializes admission per tenant, not execution. All dispatchers must use
// the same tenant limit. Leases and fair-turn state commit atomically.
func (s Store) Claim(ctx context.Context) (*pb.ExecuteRequest, error) {
	limit := s.TenantLimit
	if limit == 0 {
		limit = 1
	}
	if limit < 1 || limit > 4 {
		return nil, errors.New("tenant limit must be 1..4")
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	q := jobsql.New(tx)
	if err := q.ExpireAttempts(ctx, s.Plugins); err != nil {
		return nil, err
	}
	tenant, err := q.ClaimTenant(ctx, jobsql.ClaimTenantParams{Plugins: s.Plugins, TenantLimit: limit})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, tx.Commit(ctx)
	}
	if err != nil {
		return nil, err
	}
	attempt := ID()
	row, err := q.Claim(ctx, jobsql.ClaimParams{AttemptID: attempt, Plugins: s.Plugins, TenantID: tenant, TenantLimit: limit})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, tx.Commit(ctx)
	}
	if err != nil {
		return nil, err
	}
	if err = q.MarkTenantClaimed(ctx, tenant); err != nil {
		return nil, err
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &pb.ExecuteRequest{TenantId: row.TenantID, JobId: row.JobID, AttemptId: attempt, PluginId: row.PluginID, PluginVersion: row.PluginVersion, Input: row.Input}, nil
}
func affected(n int64, err error) error {
	if err != nil {
		return err
	}
	if n != 1 {
		return ErrStale
	}
	return nil
}
func (s Store) Complete(ctx context.Context, r *pb.ExecuteRequest, output []byte) error {
	return affected(jobsql.New(s.Pool).Complete(ctx, jobsql.CompleteParams{TenantID: r.TenantId, ID: r.JobId, AttemptID: r.AttemptId, Output: output}))
}
func (s Store) Retry(ctx context.Context, r *pb.ExecuteRequest) error {
	return affected(jobsql.New(s.Pool).Retry(ctx, jobsql.RetryParams{TenantID: r.TenantId, ID: r.JobId, AttemptID: r.AttemptId}))
}
func (s Store) Cancel(ctx context.Context, tenant, id string) error {
	return affected(jobsql.New(s.Pool).Cancel(ctx, jobsql.CancelParams{TenantID: tenant, ID: id}))
}
