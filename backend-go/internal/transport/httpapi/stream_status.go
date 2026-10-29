package httpapi

import (
	"context"
	"errors"
	"net/http"
	"time"

	"aisoc/backend/internal/modules/telemetry"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func streamRespond(fn func(*http.Request) (any, int, error)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		respond(fn)(w, r)
	}
}

func streamStatus(ctx context.Context, pool *pgxpool.Pool, b telemetry.Binding, processor string) (map[string]any, []map[string]any, error) {
	worker := map[string]any{"status": "not_seen"}
	var last time.Time
	var age float64
	var code string
	err := pool.QueryRow(ctx, `SELECT last_seen,GREATEST(0,extract(epoch FROM clock_timestamp()-last_seen)),error_code FROM stream_worker_status WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 AND processor=$4 ORDER BY last_seen DESC LIMIT 1`, b.TenantID, b.ConnectorID, b.Source, processor).Scan(&last, &age, &code)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, nil, err
	}
	if err == nil {
		state := "running"
		if age > 15 {
			state = "stale"
		} else if code != "" {
			state = "retrying"
		}
		worker = map[string]any{"status": state, "last_seen": last, "age_seconds": age, "error_code": code}
	}
	rows, err := pool.Query(ctx, `SELECT f.investigation_id,f.finding_id,COALESCE(e.state,'awaiting_mock_inference'),COALESCE(e.job_id::text,''),COALESCE(e.note_id,''),COALESCE(c.version,'') FROM stream_findings f LEFT JOIN l1_escalations e ON e.tenant_id=f.tenant_id AND e.investigation_id=f.investigation_id LEFT JOIN mock_soar_cases c ON c.tenant_id=e.tenant_id AND c.connector_id=e.connector_id AND c.external_id=e.external_id WHERE f.tenant_id=$1 AND f.connector_id=$2 AND f.source=$3 ORDER BY f.created_at DESC,f.finding_id LIMIT 25`, b.TenantID, b.ConnectorID, b.Source)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	cases := []map[string]any{}
	for rows.Next() {
		var incident, finding, state, job, note, version string
		if err = rows.Scan(&incident, &finding, &state, &job, &note, &version); err != nil {
			return nil, nil, err
		}
		cases = append(cases, map[string]any{"investigation_id": incident, "finding_id": finding, "state": state, "job_id": job, "note_id": note, "source_version": version})
	}
	return worker, cases, rows.Err()
}
