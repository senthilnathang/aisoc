package telemetrypipeline

import (
	"aisoc/backend/internal/modules/telemetry"
	"context"
	"encoding/json"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"math"
	"os"
	"runtime"
	"runtime/debug"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"testing"
	"time"
)

func TestStreamLoadReport(t *testing.T) {
	path := os.Getenv("AISOC_STREAM_LOAD_REPORT")
	if path == "" {
		t.Skip("opt-in --stream-load measurement")
	}
	workload, err := parseLoadConfig(os.Getenv)
	if err != nil {
		t.Fatal(err)
	}
	count := int64(workload.events)
	interval := time.Duration(100) * time.Second / time.Duration(workload.eps)
	batches := workload.events / 100
	schedule := make([]time.Duration, batches+1)
	for i := 0; i < batches; i++ {
		step := interval
		if i >= batches/3 && i < 2*batches/3 {
			step /= time.Duration(workload.burstMultiplier)
		}
		schedule[i+1] = schedule[i] + step
	}
	pauseAt := schedule[batches/2]
	pauseDuration := time.Duration(workload.pauseSeconds) * time.Second
	r, a, template := setup(t)
	r.Store.MaxEvents = count + 1
	r.Store.MaxPayloadBytes = 64 << 20 // Disposable capacity probe only; production limits are unchanged.
	r.MaxEntries = count + 1
	r.MaxRecoveryRecords = count + 1
	noop := func(context.Context, pgx.Tx, telemetry.Event) error { return nil }
	publish(t, r)
	if err := r.Poll(context.Background(), "filtered", noop); err != nil {
		t.Fatal(err)
	}
	profile := &queryProfile{}
	diagnosticsPool := r.Store.Pool
	config := r.Store.Pool.Config()
	config.ConnConfig.Tracer = profile
	config.ConnConfig.RuntimeParams["application_name"] = "aisoc_stream_probe"
	profiledPool, err := pgxpool.NewWithConfig(context.Background(), config)
	if err != nil {
		t.Fatal(err)
	}
	defer profiledPool.Close()
	r.Store.Pool = profiledPool
	ctx, cancel := context.WithTimeout(context.Background(), 240*time.Second)
	defer cancel()
	stopDatabaseProfile, err := startDatabaseProfile(ctx, diagnosticsPool)
	if err != nil {
		t.Fatal(err)
	}
	var starts sync.Map
	var durations sync.Map
	var scheduled sync.Map
	var scheduledDurations sync.Map
	var pausedWorkers atomic.Int64
	var maxScheduleLag atomic.Int64
	var finished atomic.Int64
	var publisherFinished atomic.Bool
	var completionNanos atomic.Int64
	var inserted atomic.Int64
	var payloadBytes atomic.Int64
	var wg sync.WaitGroup
	errs := make(chan error, 8)
	var cpuBefore, cpuAfter syscall.Rusage
	syscall.Getrusage(syscall.RUSAGE_SELF, &cpuBefore)
	began := time.Now()
	markCompletion := func() {
		n := time.Since(began).Nanoseconds()
		for old := completionNanos.Load(); n > old; old = completionNanos.Load() {
			if completionNanos.CompareAndSwap(old, n) {
				break
			}
		}
	}
	wg.Add(1)
	go func() {
		defer wg.Done()
		ctx := context.WithValue(ctx, profileKey("stage"), "accept")
		cp, err := r.Store.Checkpoint(ctx, r.Binding)
		if err != nil {
			errs <- err
			cancel()
			return
		}
		for batch := 0; batch < workload.events/100; batch++ {
			due := began.Add(schedule[batch])
			delay := time.Until(due)
			if delay > 0 {
				select {
				case <-time.After(delay):
				case <-ctx.Done():
					return
				}
			}
			events := make([]telemetry.Event, 100)
			now := time.Now()
			if lag := now.Sub(due).Microseconds(); lag > maxScheduleLag.Load() {
				maxScheduleLag.Store(lag)
			}
			for i := range events {
				e := template
				e.SourceEventID = fmt.Sprintf("load-%04d", batch*100+i)
				e.EventID = e.SourceEventID
				e.EvidenceRef = "mock:" + e.SourceEventID
				events[i] = e
				starts.Store(e.Identity(), now)
				scheduled.Store(e.Identity(), due)
				raw, _ := json.Marshal(e)
				payloadBytes.Add(int64(len(raw)))
			}
			accepted, err := r.Store.Accept(ctx, r.Binding, cp, fmt.Sprintf("batch-%d", batch), events)
			if err != nil {
				errs <- err
				cancel()
				return
			}
			inserted.Add(int64(accepted.Inserted))
			cp = accepted.Checkpoint
		}
	}()
	wg.Add(1)
	go func() {
		defer wg.Done()
		published := int64(0)
		ctx := context.WithValue(ctx, profileKey("stage"), "publish")
		for published < count {
			if ctx.Err() != nil {
				return
			}
			n, err := r.PublishBatch(ctx, 100)
			if err != nil {
				errs <- err
				cancel()
				return
			}
			if n > 0 {
				published += int64(n)
			} else {
				select {
				case <-time.After(time.Duration(workload.idlePollMS) * time.Millisecond):
				case <-ctx.Done():
					return
				}
			}
		}
		markCompletion()
		publisherFinished.Store(true)
	}()
	for worker := 0; worker < 2; worker++ {
		wg.Add(1)
		go func(worker int) {
			defer wg.Done()
			local := r
			ctx := context.WithValue(ctx, profileKey("stage"), "process")
			local.ConsumerName = fmt.Sprintf("load-%d", worker)
			paused := false
			for ctx.Err() == nil {
				if !paused && pauseDuration > 0 && time.Since(began) >= pauseAt {
					paused = true
					pausedWorkers.Add(1)
					select {
					case <-time.After(pauseDuration):
					case <-ctx.Done():
						return
					}
				}
				ds, err := local.Consumer.Read(ctx, r.Binding, r.Processor, local.ConsumerName, workload.consumerBatch, 100*time.Millisecond)
				if err != nil {
					if ctx.Err() == nil {
						errs <- err
						cancel()
					}
					return
				}
				if err = local.ProcessBatch(ctx, ds, "filtered", noop); err != nil {
					if ctx.Err() == nil {
						errs <- err
						cancel()
					}
					return
				}
				for _, d := range ds {
					start, ok := starts.Load(d.Key)
					if !ok {
						errs <- fmt.Errorf("untracked delivery")
						cancel()
						return
					}
					if _, loaded := durations.LoadOrStore(d.Key, float64(time.Since(start.(time.Time)).Microseconds())/1000); !loaded {
						due, _ := scheduled.Load(d.Key)
						scheduledDurations.Store(d.Key, float64(time.Since(due.(time.Time)).Microseconds())/1000)
						finished.Add(1)
						markCompletion()
					}
				}
			}
		}(worker)
	}
	peakPending := int64(0)
	peakAge := float64(0)
	for (finished.Load() < count || !publisherFinished.Load()) && ctx.Err() == nil {
		snapshot, err := r.Store.Snapshot(ctx, r.Binding, r.Processor)
		if err != nil {
			if ctx.Err() == nil {
				errs <- err
				cancel()
			}
			break
		}
		if snapshot.Pending > peakPending {
			peakPending = snapshot.Pending
		}
		if snapshot.OldestPendingSeconds > peakAge {
			peakAge = snapshot.OldestPendingSeconds
		}
		time.Sleep(time.Duration(workload.monitorMS) * time.Millisecond)
	}
	elapsed := time.Since(began)
	cancel()
	wg.Wait()
	databaseProfile, profileErr := stopDatabaseProfile()
	if profileErr != nil {
		t.Fatal(profileErr)
	}
	close(errs)
	for err := range errs {
		t.Fatal(err)
	}
	if finished.Load() != count || inserted.Load() != count {
		t.Fatal("incomplete load", inserted.Load(), finished.Load())
	}
	if pauseDuration > 0 && pausedWorkers.Load() != 2 {
		t.Fatal("consumer pause was not exercised", pausedWorkers.Load())
	}
	syscall.Getrusage(syscall.RUSAGE_SELF, &cpuAfter)
	snapshot, err := r.Store.Snapshot(context.Background(), r.Binding, r.Processor)
	if err != nil || snapshot.Pending != 0 || snapshot.Completed != count+1 {
		t.Fatal(snapshot, err)
	}
	pending, err := r.Consumer.Pending(context.Background(), r.Binding, r.Processor)
	if err != nil || pending != 0 {
		t.Fatal("unacked deliveries", pending, err)
	}
	samples := []float64{}
	durations.Range(func(_, v any) bool { samples = append(samples, v.(float64)); return true })
	sort.Float64s(samples)
	percentile := func(p float64) float64 { return samples[int(math.Ceil(p*float64(len(samples))))-1] }
	cpu := func(v syscall.Timeval) float64 { return float64(v.Sec) + float64(v.Usec)/1e6 }
	redisMemory := map[string]int64{}
	info, err := a.Info(context.Background(), "memory").Result()
	if err != nil {
		t.Fatal(err)
	}
	for _, line := range strings.Split(info, "\n") {
		pair := strings.SplitN(strings.TrimSpace(line), ":", 2)
		if len(pair) == 2 {
			switch pair[0] {
			case "used_memory", "used_memory_rss", "used_memory_peak":
				n, _ := strconv.ParseInt(pair[1], 10, 64)
				redisMemory[pair[0]] = n
			}
		}
	}
	race := "unknown"
	if build, ok := debug.ReadBuildInfo(); ok {
		race = "false"
		for _, setting := range build.Settings {
			if setting.Key == "-race" {
				race = setting.Value
			}
		}
	}
	report := map[string]any{"schema_version": 1, "workload": "1000 projected authentication events in 10 batches, 100ms apart; bounded overload probe, not sustained capacity", "offered_eps": 1000, "events": count, "payload_bytes": payloadBytes.Load(), "accepted": inserted.Load(), "completed": finished.Load(), "unacked": pending, "elapsed_seconds": elapsed.Seconds(), "achieved_eps": float64(count) / elapsed.Seconds(), "accept_start_to_committed_ack_ms": map[string]float64{"p50": percentile(.5), "p95": percentile(.95), "p99": percentile(.99)}, "sampled_peak_pending": peakPending, "sampled_peak_pending_age_seconds": peakAge, "go_cpu_seconds": cpu(cpuAfter.Utime) + cpu(cpuAfter.Stime) - cpu(cpuBefore.Utime) - cpu(cpuBefore.Stime), "go_process_peak_rss_kib": cpuAfter.Maxrss, "redis_memory_bytes": redisMemory, "logical_cpus": runtime.NumCPU(), "gomaxprocs": runtime.GOMAXPROCS(0), "go_version": runtime.Version(), "race": race, "publisher_workers": 1, "consumer_workers": 2, "postgres_snapshot_including_one_setup_event": snapshot, "limits": "No live provider, finding/LLM latency, PostgreSQL CPU/RSS, cluster failover, sustained SLO or production capacity measured. Full suite tests crashes and transport faults separately; optional cooperative consumer pause is reported explicitly."}
	report["correctness_passed"] = true
	report["last_commit_or_ack_seconds"] = time.Duration(completionNanos.Load()).Seconds()
	report["commit_ack_eps"] = float64(count) / time.Duration(completionNanos.Load()).Seconds()
	report["elapsed_notes"] = "elapsed_seconds includes backlog-monitor wakeup; last_commit_or_ack_seconds ends at final publication commit or consumer ACK, whichever is later"
	report["postgres_diagnostics"] = databaseProfile
	report["workload"] = "bounded paced synthetic authentication workload; 100-event batches; no production capacity claim"
	report["offered_eps"] = workload.eps
	report["consumer_batch_limit"] = workload.consumerBatch
	report["scheduled_input_seconds"] = schedule[batches].Seconds()
	report["burst"] = map[string]any{"multiplier": workload.burstMultiplier, "peak_offered_eps": workload.eps * workload.burstMultiplier, "start_seconds": schedule[batches/3].Seconds(), "end_seconds": schedule[2*batches/3].Seconds(), "scope": "middle third of event batches; offered schedule, not achieved throughput"}
	report["max_producer_schedule_lag_ms"] = float64(maxScheduleLag.Load()) / 1000
	report["consumer_pause"] = map[string]any{"after_seconds": pauseAt.Seconds(), "duration_seconds_per_worker": pauseDuration.Seconds(), "workers_paused": pausedWorkers.Load(), "scope": "cooperative pause before next read; not crash, Redis restart or network partition"}
	scheduledSamples := []float64{}
	scheduledDurations.Range(func(_, v any) bool { scheduledSamples = append(scheduledSamples, v.(float64)); return true })
	sort.Float64s(scheduledSamples)
	report["scheduled_start_to_committed_ack_ms"] = map[string]float64{"p50": scheduledSamples[int(math.Ceil(.5*float64(len(scheduledSamples))))-1], "p95": scheduledSamples[int(math.Ceil(.95*float64(len(scheduledSamples))))-1], "p99": scheduledSamples[int(math.Ceil(.99*float64(len(scheduledSamples))))-1]}
	report["publisher_claim_batch_size"] = 100
	report["backlog_monitor_interval_ms"] = workload.monitorMS
	report["publisher_empty_claim_delay_ms"] = workload.idlePollMS
	report["database_client_profile"] = profile.snapshot()
	for _, row := range profile.snapshot() {
		if row.Stage == "" && strings.HasPrefix(row.SQL, "WITH states AS") {
			// Compare both shapes against the same retained fixture outside the timed
			// drain, reversing order on the second pair to expose warm-cache effects.
			if strings.Contains(row.SQL, "AS MATERIALIZED (") {
				comparison := []map[string]any{}
				for _, materialized := range []bool{false, true, true, false} {
					query := row.SQL
					if !materialized {
						query = strings.Replace(query, "AS MATERIALIZED (", "AS (", 1)
					}
					var raw []byte
					if err := diagnosticsPool.QueryRow(context.Background(), "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) "+query, r.Binding.TenantID, r.Binding.ConnectorID, r.Binding.Source, r.Processor).Scan(&raw); err != nil {
						t.Fatal(err)
					}
					var plans []map[string]any
					if err := json.Unmarshal(raw, &plans); err != nil {
						t.Fatal(err)
					}
					root := plans[0]["Plan"].(map[string]any)
					comparison = append(comparison, map[string]any{"materialized": materialized, "execution_ms": plans[0]["Execution Time"], "shared_hit_blocks": root["Shared Hit Blocks"], "shared_read_blocks": root["Shared Read Blocks"], "temp_written_blocks": root["Temp Written Blocks"]})
				}
				report["snapshot_query_comparison"] = comparison
			}
			var plan []byte
			if err := diagnosticsPool.QueryRow(context.Background(), "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) "+row.SQL, r.Binding.TenantID, r.Binding.ConnectorID, r.Binding.Source, r.Processor).Scan(&plan); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(path+".snapshot-plan.json", plan, 0600); err != nil {
				t.Fatal(err)
			}
		}
		if row.Stage == "publish" && strings.HasPrefix(row.SQL, "WITH candidate AS") {
			tx, err := diagnosticsPool.Begin(context.Background())
			if err != nil {
				t.Fatal(err)
			}
			_, err = tx.Exec(context.Background(), `UPDATE stream_outbox SET state='queued',published_at=NULL,message_id=NULL,attempts=0,attempt_id=NULL,available_at=now() WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 AND event_key=(SELECT event_key FROM stream_outbox WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 ORDER BY event_key OFFSET 500 LIMIT 1)`, r.Binding.TenantID, r.Binding.ConnectorID, r.Binding.Source)
			if err != nil {
				tx.Rollback(context.Background())
				t.Fatal(err)
			}
			var plan []byte
			err = tx.QueryRow(context.Background(), "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) "+row.SQL, r.Binding.TenantID, r.Binding.ConnectorID, r.Binding.Source, 1).Scan(&plan)
			rollbackErr := tx.Rollback(context.Background())
			if err != nil {
				t.Fatal(err)
			}
			if rollbackErr != nil {
				t.Fatal(rollbackErr)
			}
			if err = os.WriteFile(path+".claim-plan.json", plan, 0600); err != nil {
				t.Fatal(err)
			}
		}
	}
	report["profile_notes"] = "Client elapsed SQL includes transport, lock and server time; not server CPU. Concurrent query totals overlap; pool-acquire and batch totals must not be added to statement totals. No SQL argument values recorded."
	report["achieved_at_least_offered_eps"] = float64(count)/elapsed.Seconds() >= float64(workload.eps)
	report["production_ready"] = false
	raw, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(path, append(raw, '\n'), 0600); err != nil {
		t.Fatal(err)
	}
}
