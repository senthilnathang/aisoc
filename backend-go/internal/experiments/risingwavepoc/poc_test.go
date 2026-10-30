package risingwavepoc

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"net/netip"
	"os"
	"sort"
	"strings"
	"testing"
	"time"

	"aisoc/backend/internal/modules/qradarmock"
	"aisoc/backend/internal/modules/telemetry"
	"github.com/jackc/pgx/v5"
)

//go:embed schema.sql
var schema string

type sample struct {
	Binding telemetry.Binding
	Events  []telemetry.Event
}
type edge struct{ Tenant, Connector, Source, Success, Failure string }

func fixtures(t testing.TB) []sample {
	t.Helper()
	result := []sample{}
	for _, b := range []telemetry.Binding{
		{TenantID: "rw-a", ConnectorID: "qradar", Source: "qradar-siem"},
		{TenantID: "rw-b", ConnectorID: "qradar", Source: "qradar-siem"},
		{TenantID: "rw-c", ConnectorID: "qradar", Source: "qradar-siem"},
		{TenantID: "rw-a", ConnectorID: "other", Source: "qradar-siem"},
	} {
		events, err := qradarmock.LoginPage(b)
		if err != nil {
			t.Fatal(err)
		}
		switch {
		case b.TenantID == "rw-b":
			events = events[:3] // success and only two failures
		case b.TenantID == "rw-c":
			events = events[1:] // failures only
		case b.ConnectorID == "other":
			events = events[:1] // cannot borrow other connector's failures
		default:
			events[1].Projection.SourceIP = "::ffff:192.0.2.10"
			// Older in-window, out-of-window and equal-success-time failures
			// must not displace the three most recent strictly preceding failures.
			for i, at := range []string{"2026-10-29T09:59:30Z", "2026-10-29T09:57:00Z", "2026-10-29T10:03:00Z"} {
				e := events[1]
				e.SourceEventID = fmt.Sprintf("boundary-%d", i)
				e.EventID = e.SourceEventID
				e.EventTime = at
				events = append(events, e)
			}
		}
		result = append(result, sample{b, events})
	}
	return result
}

func ordered(edges []edge) string {
	sort.Slice(edges, func(i, j int) bool {
		a, _ := json.Marshal(edges[i])
		b, _ := json.Marshal(edges[j])
		return string(a) < string(b)
	})
	raw, _ := json.Marshal(edges)
	return string(raw)
}

func oracle(t testing.TB, samples []sample) []edge {
	t.Helper()
	result := []edge{}
	for _, s := range samples {
		findings, err := telemetry.SuspiciousLogins(s.Binding, s.Events, time.Date(2026, 10, 29, 11, 0, 0, 0, time.UTC))
		if err != nil {
			t.Fatal(err)
		}
		for _, f := range findings {
			for _, key := range f.EventKeys[:len(f.EventKeys)-1] {
				result = append(result, edge{f.TenantID, f.ConnectorID, f.Source, f.EventKeys[len(f.EventKeys)-1], key})
			}
		}
	}
	return result
}

func TestGoReferenceFixtures(t *testing.T) {
	all := fixtures(t)
	got := oracle(t, all)
	if len(got) != 3 {
		t.Fatalf("want one three-edge finding, got %d", len(got))
	}
	for _, e := range got {
		if e.Tenant != "rw-a" || e.Connector != "qradar" {
			t.Fatal("scope leakage")
		}
	}
	original := ordered(got)
	all[0].Events = append(all[0].Events, all[0].Events[1])
	if ordered(oracle(t, all)) != original {
		t.Fatal("duplicate changed evidence")
	}
	forged := all[0].Events[0]
	forged.TenantID = "rw-b"
	if forged.Validate(all[0].Binding) == nil {
		t.Fatal("forged tenant accepted")
	}
	conflict := all[0].Events[0]
	conflict.Projection.AssetRef = "changed"
	if _, err := telemetry.SuspiciousLogins(all[0].Binding, append(all[0].Events, conflict), time.Now()); err == nil {
		t.Fatal("conflicting replay accepted")
	}
	t.Log("Go fixtures passed; RisingWave execution is a separate opt-in test")
}

func TestRisingWaveParity(t *testing.T) {
	addr := os.Getenv("AISOC_RISINGWAVE_ADDR")
	if addr == "" {
		t.Skip("set AISOC_RISINGWAVE_ADDR to a dedicated loopback RisingWave endpoint")
	}
	report := map[string]any{"scope": "finite synthetic SQL correlation parity; not broker/retention/HA/1M EPS validation", "risingwave_executed": false, "production_ready": false}
	if path := os.Getenv("AISOC_RISINGWAVE_REPORT"); path != "" {
		if err := os.WriteFile(path, []byte("{\"passed\":false,\"status\":\"running\",\"risingwave_executed\":false}\n"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	durations := []float64{}
	t.Cleanup(func() {
		report["passed"] = !t.Failed()
		report["phase_insert_to_observed_ms"] = durations
		if path := os.Getenv("AISOC_RISINGWAVE_REPORT"); path != "" {
			raw, _ := json.MarshalIndent(report, "", "  ")
			if err := os.WriteFile(path, append(raw, '\n'), 0600); err != nil {
				t.Error(err)
			}
		}
	})
	endpoint, err := netip.ParseAddrPort(addr)
	if err != nil || !endpoint.Addr().IsLoopback() {
		t.Fatal("require literal loopback IP:port")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()
	cfg, err := pgx.ParseConfig("postgres://root@127.0.0.1:4567/dev?sslmode=disable")
	if err != nil {
		t.Fatal(err)
	}
	cfg.Host = endpoint.Addr().String()
	cfg.Port = endpoint.Port()
	cfg.Password = "" // Never inherit application PGPASSWORD into this synthetic development probe.
	cfg.ConnectTimeout = 5 * time.Second
	cfg.DefaultQueryExecMode = pgx.QueryExecModeExec
	conn, err := pgx.ConnectConfig(ctx, cfg)
	if err != nil {
		t.Fatal("cannot connect to isolated RisingWave endpoint")
	}
	defer conn.Close(context.Background())
	var version string
	if err = conn.QueryRow(ctx, "SELECT version()").Scan(&version); err != nil || !strings.Contains(strings.ToLower(version), "risingwave") {
		t.Fatal("refusing non-RisingWave endpoint")
	}
	report["risingwave_executed"] = true
	report["server_version"] = version
	name := fmt.Sprintf("aisoc_rw_poc_%x", time.Now().UnixNano())
	if _, err = conn.Exec(ctx, "CREATE SCHEMA "+name); err != nil {
		t.Fatal(err)
	}
	defer func() {
		cleanup, done := context.WithTimeout(context.Background(), 10*time.Second)
		defer done()
		if _, err := conn.Exec(cleanup, "DROP SCHEMA "+name+" CASCADE"); err != nil {
			t.Errorf("cleanup failed for %s", name)
		}
	}()
	if _, err = conn.Exec(ctx, "SET search_path TO "+name); err != nil {
		t.Fatal(err)
	}
	// Every statement is checked independently; no server-side multi-statement transaction assumed.
	for _, sql := range strings.Split(schema, ";") {
		if strings.TrimSpace(sql) != "" {
			if _, err = conn.Exec(ctx, sql); err != nil {
				t.Fatal(err)
			}
		}
	}
	seen := map[string]string{}
	insert := func(s sample, e telemetry.Event) {
		t.Helper()
		if err := e.Validate(s.Binding); err != nil {
			t.Fatal(err)
		}
		if hash, ok := seen[e.Identity()]; ok && hash != e.ContentHash() {
			t.Fatal("conflicting replay rejected before SQL")
		}
		seen[e.Identity()] = e.ContentHash()
		ip, _ := netip.ParseAddr(e.Projection.SourceIP)
		at, _ := time.Parse(time.RFC3339Nano, e.EventTime)
		_, err := conn.Exec(ctx, `INSERT INTO auth_events VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, s.Binding.TenantID, s.Binding.ConnectorID, s.Binding.Source, e.Identity(), e.EventType, at, e.Projection.PrincipalRef, e.Projection.AssetRef, ip.Unmap().String())
		if err != nil {
			t.Fatal(err)
		}
	}
	observe := func(want []edge) {
		t.Helper()
		deadline := time.Now().Add(15 * time.Second)
		for {
			rows, err := conn.Query(ctx, "SELECT tenant_id,connector_id,source,success_key,failure_key FROM finding_edges")
			if err != nil {
				t.Fatal(err)
			}
			got := []edge{}
			for rows.Next() {
				var e edge
				if err := rows.Scan(&e.Tenant, &e.Connector, &e.Source, &e.Success, &e.Failure); err != nil {
					rows.Close()
					t.Fatal(err)
				}
				got = append(got, e)
			}
			err = rows.Err()
			rows.Close()
			if err != nil {
				t.Fatal(err)
			}
			if ordered(got) == ordered(want) {
				return
			}
			if time.Now().After(deadline) {
				t.Fatalf("correlation mismatch: got %s want %s", ordered(got), ordered(want))
			}
			time.Sleep(100 * time.Millisecond)
		}
	}
	all := fixtures(t)
	partial := fixtures(t)
	partial[0].Events = partial[0].Events[:3]
	for _, s := range partial {
		for _, e := range s.Events {
			insert(s, e)
		}
	}
	if _, err = conn.Exec(ctx, "FLUSH"); err != nil {
		t.Fatal(err)
	}
	observe(oracle(t, partial))
	began := time.Now()
	insert(all[0], all[0].Events[3])
	observe(oracle(t, all))
	durations = append(durations, float64(time.Since(began).Microseconds())/1000)
	began = time.Now()
	for _, s := range all {
		for _, e := range s.Events {
			insert(s, e)
		}
	}
	if _, err = conn.Exec(ctx, "FLUSH"); err != nil {
		t.Fatal(err)
	}
	observe(oracle(t, all))
	durations = append(durations, float64(time.Since(began).Microseconds())/1000)
	report["finding_count"] = 1
	report["phases"] = []string{"out_of_order_partial_no_finding", "late_failure_completes_finding", "identical_replay_no_duplicate"}
}

func BenchmarkGoReference(b *testing.B) {
	all := fixtures(b)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if len(oracle(b, all)) != 3 {
			b.Fatal("unexpected reference finding")
		}
	}
}
