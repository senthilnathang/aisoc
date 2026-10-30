package eventstate

import (
	"aisoc/backend/internal/modules/telemetry"
	"context"
	"errors"
	"fmt"
	"sync"
	"testing"
)

func TestBatchClaimReconcilesExhaustedAlongsideFreshWork(t *testing.T) {
	s, b, e := setup(t)
	ctx := context.Background()
	accepted := accept(t, s, b, Checkpoint{}, "first", e)
	old, err := s.Claim(ctx, b)
	if err != nil || old == nil {
		t.Fatal("initial lease", err)
	}
	if _, err := s.Pool.Exec(ctx, `UPDATE stream_outbox SET attempts=max_attempts,lease_until=now()-interval '1 second' WHERE tenant_id=$1 AND event_key=$2`, b.TenantID, old.EventKey); err != nil {
		t.Fatal(err)
	}
	e.SourceEventID = "fresh-event"
	accept(t, s, b, accepted.Checkpoint, "second", e)
	leases, err := s.ClaimBatch(ctx, b, 2)
	if err != nil || len(leases) != 1 || leases[0].EventKey == old.EventKey || leases[0].Attempts != 1 {
		t.Fatal("fresh claim", leases, err)
	}
	var state, code string
	if err := s.Pool.QueryRow(ctx, `SELECT state,error_code FROM stream_outbox WHERE tenant_id=$1 AND event_key=$2`, b.TenantID, old.EventKey).Scan(&state, &code); err != nil {
		t.Fatal(err)
	}
	if state != "failed" || code != "ATTEMPTS_EXHAUSTED" {
		t.Fatal(state, code)
	}
	if err := s.MarkPublished(ctx, b, *old, "1-0"); !errors.Is(err, ErrLease) {
		t.Fatal("exhausted lease accepted", err)
	}
}

func TestBatchAdmissionAndUniqueConcurrentLeases(t *testing.T) {
	s, b, template := setup(t)
	ctx := context.Background()
	events := make([]telemetry.Event, 100)
	for i := range events {
		events[i] = template
		events[i].SourceEventID = fmt.Sprintf("batch-%d", i)
	}
	accepted := accept(t, s, b, Checkpoint{}, "batch", events...)
	if accepted.Inserted != 100 {
		t.Fatal(accepted)
	}
	replay := accept(t, s, b, accepted.Checkpoint, "replay", events...)
	if replay.Inserted != 0 {
		t.Fatal(replay)
	}
	if _, err := s.ClaimBatch(ctx, b, telemetry.MaxBatchEvents+1); !errors.Is(err, ErrInvalid) {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	out := make(chan []Lease, 4)
	errs := make(chan error, 4)
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); ls, err := s.ClaimBatch(ctx, b, 25); out <- ls; errs <- err }()
	}
	wg.Wait()
	close(out)
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	keys, attempts := map[string]bool{}, map[string]bool{}
	leases := []Lease{}
	for batch := range out {
		if len(batch) != 25 {
			t.Fatal("short batch", len(batch))
		}
		for _, l := range batch {
			if keys[l.EventKey] || attempts[l.AttemptID] || l.Attempts != 1 {
				t.Fatal("duplicate claim", l)
			}
			keys[l.EventKey] = true
			attempts[l.AttemptID] = true
			leases = append(leases, l)
		}
	}
	if len(keys) != 100 {
		t.Fatal(len(keys))
	}
	forged := leases[0]
	forged.AttemptID = leases[1].AttemptID
	if err := s.MarkPublished(ctx, b, forged, "1000-1"); !errors.Is(err, ErrLease) {
		t.Fatal("cross-event fence", err)
	}
	if err := s.MarkPublished(ctx, b, leases[0], "1000-1"); err != nil {
		t.Fatal(err)
	}
}

func TestBatchDuplicateConflictAndCapacityRollback(t *testing.T) {
	s, b, e := setup(t)
	ctx := context.Background()
	changed := e
	changed.Projection.AssetRef = "conflicting"
	if _, err := s.Accept(ctx, b, Checkpoint{}, "conflict", []telemetry.Event{e, changed}); !errors.Is(err, ErrConflict) {
		t.Fatal(err)
	}
	counts(t, s, b, 0, 0, 0)
	other := e
	other.SourceEventID = "second"
	s.MaxEvents = 1
	if _, err := s.Accept(ctx, b, Checkpoint{}, "overflow", []telemetry.Event{e, other}); !errors.Is(err, ErrCapacity) {
		t.Fatal(err)
	}
	counts(t, s, b, 0, 0, 0)
	accepted := accept(t, s, b, Checkpoint{}, "duplicates", e, e)
	if accepted.Inserted != 1 {
		t.Fatal(accepted)
	}
}

func TestBatchReceiptFencingIsAtomic(t *testing.T) {
	s, b, e := setup(t)
	ctx := context.Background()
	other := e
	other.SourceEventID = "second"
	accept(t, s, b, Checkpoint{}, "batch", e, other)
	ls, err := s.ClaimBatch(ctx, b, 2)
	if err != nil || len(ls) != 2 {
		t.Fatal(ls, err)
	}
	if _, err = s.Pool.Exec(ctx, `UPDATE stream_outbox SET lease_until=now()-interval '1 second' WHERE tenant_id=$1 AND event_key=$2`, b.TenantID, ls[1].EventKey); err != nil {
		t.Fatal(err)
	}
	err = s.MarkPublishedBatch(ctx, b, []PublicationReceipt{{Lease: ls[0], MessageID: "1000-1"}, {Lease: ls[1], MessageID: "1000-2"}})
	if !errors.Is(err, ErrLease) {
		t.Fatal(err)
	}
	var published int
	if err = s.Pool.QueryRow(ctx, `SELECT count(*) FROM stream_outbox WHERE tenant_id=$1 AND state='published'`, b.TenantID).Scan(&published); err != nil || published != 0 {
		t.Fatal("partial batch receipt", published, err)
	}
	if err = s.MarkPublished(ctx, b, ls[0], "1000-1"); err != nil {
		t.Fatal(err)
	}
}

func TestBatchReceiptConcurrentMapping(t *testing.T) {
	s, b, template := setup(t)
	ctx := context.Background()
	events := make([]telemetry.Event, 100)
	for i := range events {
		events[i] = template
		events[i].SourceEventID = fmt.Sprintf("receipt-%03d", i)
	}
	accept(t, s, b, Checkpoint{}, "receipts", events...)
	leases, err := s.ClaimBatch(ctx, b, 100)
	if err != nil || len(leases) != 100 {
		t.Fatal(len(leases), err)
	}
	receipts := make([]PublicationReceipt, len(leases))
	for i, lease := range leases {
		receipts[i] = PublicationReceipt{Lease: lease, MessageID: fmt.Sprintf("1000-%d", i)}
	}
	reversed := append([]PublicationReceipt(nil), receipts...)
	for i, j := 0, len(reversed)-1; i < j; i, j = i+1, j-1 {
		reversed[i], reversed[j] = reversed[j], reversed[i]
	}
	errs := make(chan error, 2)
	go func() { errs <- s.MarkPublishedBatch(ctx, b, receipts) }()
	go func() { errs <- s.MarkPublishedBatch(ctx, b, reversed) }()
	succeeded := 0
	for range 2 {
		if err := <-errs; err == nil {
			succeeded++
		} else if !errors.Is(err, ErrLease) {
			t.Fatal(err)
		}
	}
	if succeeded != 1 {
		t.Fatal("receipt ownership not exclusive", succeeded)
	}
	for _, receipt := range receipts {
		var id string
		if err = s.Pool.QueryRow(ctx, `SELECT message_id FROM stream_outbox WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 AND event_key=$4`, b.TenantID, b.ConnectorID, b.Source, receipt.Lease.EventKey).Scan(&id); err != nil || id != receipt.MessageID {
			t.Fatal("wrong receipt mapping", id, err)
		}
	}
}
