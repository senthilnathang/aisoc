package eventstate

import (
	"context"
	"errors"
	"sync"
	"testing"
)

func TestConcurrentWorkAndGapShareBudget(t *testing.T) {
	s, b, e := setup(t)
	ctx := context.Background()
	accept(t, s, b, Checkpoint{}, "page", e)
	t.Cleanup(func() {
		for _, table := range []string{"stream_replay_gaps", "stream_consumer_work"} {
			if _, err := s.Pool.Exec(ctx, "DELETE FROM "+table+" WHERE tenant_id=$1", b.TenantID); err != nil {
				t.Error(err)
			}
		}
	})
	start := make(chan struct{})
	errs := make(chan error, 2)
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		<-start
		_, err := s.BeginWork(ctx, b, "budget-test", "event:"+e.Identity(), "1000-1", 3, 1)
		errs <- err
	}()
	go func() { defer wg.Done(); <-start; errs <- s.RecordGap(ctx, b, "budget-test", "1000-2", 1) }()
	close(start)
	wg.Wait()
	close(errs)
	accepted, full := 0, 0
	for err := range errs {
		switch {
		case err == nil:
			accepted++
		case errors.Is(err, ErrCapacity):
			full++
		default:
			t.Fatal(err)
		}
	}
	if accepted != 1 || full != 1 {
		t.Fatal(accepted, full)
	}
	var works, gaps int
	if err := s.Pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM stream_consumer_work WHERE tenant_id=$1),(SELECT count(*) FROM stream_replay_gaps WHERE tenant_id=$1)`, b.TenantID).Scan(&works, &gaps); err != nil || works+gaps != 1 {
		t.Fatal(works, gaps, err)
	}
	// Replaying the admitted identity must still work at capacity.
	if gaps == 1 {
		if err := s.RecordGap(ctx, b, "budget-test", "1000-2", 1); err != nil {
			t.Fatal(err)
		}
	} else {
		if _, err := s.BeginWork(ctx, b, "budget-test", "event:"+e.Identity(), "1000-1", 3, 1); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.RecordGap(ctx, b, "budget-test", "1000-3", 1); !errors.Is(err, ErrCapacity) {
		t.Fatal(err)
	}
}
