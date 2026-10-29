package l1

import (
	"aisoc/backend/internal/modules/telemetry"
	"aisoc/backend/internal/platform/eventstate"
	"aisoc/backend/internal/platform/jobs"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"google.golang.org/protobuf/proto"
	"time"
)

const Plugin = "python.investigate_mock"

// QueueMock explicitly requests one mock investigation per admitted finding/version.
// It reuses the durable specialist queue; no automatic fan-out from raw events.
func QueueMock(ctx context.Context, pool *pgxpool.Pool, b telemetry.Binding, findingID string, maxActive int) (string, error) {
	if maxActive < 1 || maxActive > 100 {
		return "", ErrInvalid
	}
	key, _ := json.Marshal([]string{b.TenantID, b.ConnectorID, b.Source, findingID, Plugin, "1"})
	sum := sha256.Sum256(key)
	id := fmt.Sprintf("%x-%x-%x-%x-%x", sum[:4], sum[4:6], sum[6:8], sum[8:10], sum[10:16])
	task, err := LoadTask(ctx, pool, b, findingID, id, "pending", time.Now().Add(10*time.Second))
	if err != nil {
		return "", err
	}
	task.AttemptId = ""
	task.DeadlineUnixMs = 0
	raw, err := proto.Marshal(task)
	if err != nil {
		return "", err
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)
	var tenant string
	if err = tx.QueryRow(ctx, `SELECT tenant_id FROM stream_admission_tenants WHERE tenant_id=$1 FOR UPDATE`, b.TenantID).Scan(&tenant); err != nil {
		return "", err
	}
	var prior []byte
	var plugin string
	err = tx.QueryRow(ctx, `SELECT input,plugin_id FROM jobs WHERE tenant_id=$1 AND id=$2`, tenant, id).Scan(&prior, &plugin)
	if err == nil {
		if plugin != Plugin || !bytes.Equal(prior, raw) {
			return "", eventstate.ErrConflict
		}
		return id, tx.Commit(ctx)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", err
	}
	var active int
	if err = tx.QueryRow(ctx, `SELECT count(*) FROM jobs WHERE tenant_id=$1 AND plugin_id=$2 AND state IN ('queued','running')`, tenant, Plugin).Scan(&active); err != nil {
		return "", err
	}
	if active >= maxActive {
		return "", eventstate.ErrCapacity
	}
	if err = jobs.Enqueue(ctx, tx, tenant, id, Plugin, raw); err != nil {
		return "", err
	}
	return id, tx.Commit(ctx)
}
