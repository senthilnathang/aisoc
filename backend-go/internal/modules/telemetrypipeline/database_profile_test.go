package telemetrypipeline

import (
	"context"
	"encoding/json"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// This probe records aggregate counters and wait names, never SQL arguments,
// connection strings or other sessions' query text.
type databaseProfile struct {
	Before     map[string]any `json:"before"`
	After      map[string]any `json:"after"`
	Samples    []waitSample   `json:"wait_samples"`
	IntervalMS int            `json:"sample_interval_ms"`
	Limits     string         `json:"limits"`
}
type waitSample struct {
	ElapsedMS int64            `json:"elapsed_ms"`
	Counts    map[string]int64 `json:"active_backends_by_wait"`
}

func databaseCounters(ctx context.Context, pool *pgxpool.Pool) (map[string]any, error) {
	var raw []byte
	err := pool.QueryRow(ctx, `SELECT json_build_object('commits',xact_commit,'rollbacks',xact_rollback,'blocks_read',blks_read,'blocks_hit',blks_hit,'read_ms',blk_read_time,'write_ms',blk_write_time,'temp_bytes',temp_bytes,'deadlocks',deadlocks,'stats_reset',stats_reset,'track_io_timing',current_setting('track_io_timing')) FROM pg_stat_database WHERE datname=current_database()`).Scan(&raw)
	if err != nil {
		return nil, err
	}
	var result map[string]any
	err = json.Unmarshal(raw, &result)
	if err != nil {
		return nil, err
	}
	err = pool.QueryRow(ctx, `SELECT json_build_object('records',wal_records,'full_page_images',wal_fpi,'bytes',wal_bytes,'buffers_full',wal_buffers_full,'writes',wal_write,'syncs',wal_sync,'write_ms',wal_write_time,'sync_ms',wal_sync_time,'stats_reset',stats_reset,'track_wal_io_timing',current_setting('track_wal_io_timing')) FROM pg_stat_wal`).Scan(&raw)
	if err != nil {
		return nil, err
	}
	var wal map[string]any
	err = json.Unmarshal(raw, &wal)
	result["wal_cluster"] = wal
	return result, err
}

func startDatabaseProfile(ctx context.Context, pool *pgxpool.Pool) (func() (databaseProfile, error), error) {
	before, err := databaseCounters(ctx, pool)
	if err != nil {
		return nil, err
	}
	result := databaseProfile{Before: before, IntervalMS: 250, Limits: "Wait samples cover active aisoc_stream_probe clients only; sampling can miss short waits. Database counters include monitoring and other disposable test-database clients, may lag, and are not server CPU or physical memory measurements. Compare before/after only when stats_reset matches."}
	sampleCtx, cancel := context.WithCancel(ctx)
	var wg sync.WaitGroup
	var sampleErr error
	began := time.Now()
	wg.Add(1)
	go func() {
		defer wg.Done()
		ticker := time.NewTicker(250 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-sampleCtx.Done():
				return
			case <-ticker.C:
			}
			rows, err := pool.Query(sampleCtx, `SELECT COALESCE(wait_event_type,'CPU_or_runnable'),COALESCE(wait_event,'none'),count(*) FROM pg_stat_activity WHERE datname=current_database() AND application_name='aisoc_stream_probe' AND state='active' AND pid<>pg_backend_pid() GROUP BY 1,2`)
			if err != nil {
				if sampleCtx.Err() == nil {
					sampleErr = err
				}
				return
			}
			sample := waitSample{ElapsedMS: time.Since(began).Milliseconds(), Counts: map[string]int64{}}
			for rows.Next() {
				var kind, event string
				var count int64
				if err = rows.Scan(&kind, &event, &count); err != nil {
					break
				}
				sample.Counts[kind+":"+event] = count
			}
			if err == nil {
				err = rows.Err()
			}
			rows.Close()
			if err != nil {
				if sampleCtx.Err() == nil {
					sampleErr = err
				}
				return
			}
			result.Samples = append(result.Samples, sample)
		}
	}()
	return func() (databaseProfile, error) {
		cancel()
		wg.Wait()
		if sampleErr != nil {
			return result, sampleErr
		}
		endCtx, endCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer endCancel()
		result.After, err = databaseCounters(endCtx, pool)
		return result, err
	}, nil
}
