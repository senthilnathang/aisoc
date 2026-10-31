package jobs

import (
	pb "aisoc/backend/internal/gen/worker/v1"
	"context"
	"sync"
	"testing"
	"time"
)

type dispatchFixture struct {
	mu                  sync.Mutex
	next, done, retried int
}

func (f *dispatchFixture) Claim(ctx context.Context) (*pb.ExecuteRequest, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.next == 4 {
		return nil, nil
	}
	f.next++
	return &pb.ExecuteRequest{JobId: ID()}, nil
}
func (f *dispatchFixture) Complete(context.Context, *pb.ExecuteRequest, []byte) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.done++
	return nil
}
func (f *dispatchFixture) Retry(context.Context, *pb.ExecuteRequest) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.retried++
	return nil
}
func TestDispatchBoundsAndShutdown(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	f := &dispatchFixture{}
	entered := make(chan struct{}, 4)
	release := make(chan struct{})
	finished := make(chan error, 1)
	go func() {
		finished <- Dispatch(ctx, f, func(ctx context.Context, r *pb.ExecuteRequest) ([]byte, error) {
			entered <- struct{}{}
			select {
			case <-release:
				return []byte("ok"), nil
			case <-ctx.Done():
				return nil, ctx.Err()
			}
		}, 2, func(error) {})
	}()
	for i := 0; i < 2; i++ {
		select {
		case <-entered:
		case <-time.After(2 * time.Second):
			t.Fatal("not concurrent")
		}
	}
	select {
	case <-entered:
		t.Fatal("exceeded bound")
	case <-time.After(50 * time.Millisecond):
	}
	close(release)
	deadline := time.Now().Add(2 * time.Second)
	for {
		f.mu.Lock()
		n := f.done
		f.mu.Unlock()
		if n == 4 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("work not completed")
		}
		time.Sleep(time.Millisecond)
	}
	cancel()
	select {
	case err := <-finished:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("shutdown blocked")
	}
	if err := Dispatch(ctx, f, nil, 0, func(error) {}); err == nil {
		t.Fatal("invalid capacity accepted")
	}
}

func TestDispatchCancelsInflightWithoutCommitting(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	f := &dispatchFixture{}
	entered := make(chan struct{}, 1)
	finished := make(chan error, 1)
	go func() {
		finished <- Dispatch(ctx, f, func(ctx context.Context, _ *pb.ExecuteRequest) ([]byte, error) {
			entered <- struct{}{}
			<-ctx.Done()
			return nil, ctx.Err()
		}, 1, nil)
	}()
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("not started")
	}
	cancel()
	select {
	case err := <-finished:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("execution not cancelled")
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.done != 0 || f.retried != 0 {
		t.Fatal("shutdown attempted a domain write")
	}
}
