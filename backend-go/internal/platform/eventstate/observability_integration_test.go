package eventstate

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"aisoc/backend/internal/modules/telemetry"
)

func TestSnapshotMixedStatesAndProcessorIsolation(t *testing.T) {
	s, b, template := setup(t)
	ctx := context.Background()
	events := make([]telemetry.Event, 4)
	for i := range events {
		events[i] = template
		events[i].SourceEventID = fmt.Sprintf("mixed-%d", i)
	}
	accept(t, s, b, Checkpoint{}, "mixed", events...)
	t.Cleanup(func() {
		if _, err := s.Pool.Exec(ctx, `DELETE FROM stream_consumer_work WHERE tenant_id=$1`, b.TenantID); err != nil {
			t.Error(err)
		}
	})
	for i := 0; i < 2; i++ {
		if _, err := s.Pool.Exec(ctx, `INSERT INTO stream_inbox(tenant_id,connector_id,source,processor,event_key,content_hash,disposition) VALUES($1,$2,$3,'accounting',$4,$5,'filtered')`, b.TenantID, b.ConnectorID, b.Source, events[i].Identity(), events[i].ContentHash()); err != nil {
			t.Fatal(err)
		}
	}
	// Event 1 has both historical dead work and a committed disposition;
	// completed takes precedence. Event 2 is dead without a disposition.
	for _, i := range []int{1, 2, 3} {
		processor := "accounting"
		if i == 3 {
			processor = "other-processor"
		}
		if _, err := s.Pool.Exec(ctx, `INSERT INTO stream_consumer_work(tenant_id,connector_id,source,processor,work_key,state,max_attempts) VALUES($1,$2,$3,$4,$5,'dead',3)`, b.TenantID, b.ConnectorID, b.Source, processor, "event:"+events[i].Identity()); err != nil {
			t.Fatal(err)
		}
	}
	// Quarantined deliveries and dead work without an accepted event must not
	// create accepted/dead counts or multiply the joined event rows.
	for _, key := range []string{"event:" + strings.Repeat("f", 64), "delivery:123-0"} {
		if _, err := s.Pool.Exec(ctx, `INSERT INTO stream_consumer_work(tenant_id,connector_id,source,processor,work_key,state,max_attempts) VALUES($1,$2,$3,'accounting',$4,'dead',3)`, b.TenantID, b.ConnectorID, b.Source, key); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.Pool.Exec(ctx, `UPDATE stream_events SET created_at=now()-interval '1 hour' WHERE tenant_id=$1`, b.TenantID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Pool.Exec(ctx, `UPDATE stream_events SET created_at=now()-interval '30 seconds' WHERE tenant_id=$1 AND event_key=$2`, b.TenantID, events[3].Identity()); err != nil {
		t.Fatal(err)
	}
	r, err := s.Snapshot(ctx, b, "accounting")
	if err != nil {
		t.Fatal(err)
	}
	if r.Accepted != 4 || r.Completed != 2 || r.Dead != 1 || r.Pending != 1 || r.Accepted != r.Completed+r.Dead+r.Pending {
		t.Fatal(r)
	}
	if r.OldestPendingSeconds < 30 || r.OldestPendingSeconds >= 300 {
		t.Fatal("wrong pending age", r)
	}
	other, err := s.Snapshot(ctx, b, "other-processor")
	if err != nil || other.Completed != 0 || other.Dead != 1 || other.Pending != 3 {
		t.Fatal(other, err)
	}
	for _, empty := range []telemetry.Binding{
		{TenantID: b.TenantID, ConnectorID: b.ConnectorID, Source: "other-source"},
		{TenantID: b.TenantID, ConnectorID: "other-connector", Source: b.Source},
		{TenantID: "other-tenant", ConnectorID: b.ConnectorID, Source: b.Source},
	} {
		r, err := s.Snapshot(ctx, empty, "accounting")
		if err != nil || r != (Snapshot{}) {
			t.Fatal("scope isolation", r, err)
		}
	}
}
