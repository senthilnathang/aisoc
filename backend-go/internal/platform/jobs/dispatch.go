package jobs

import (
	pb "aisoc/backend/internal/gen/worker/v1"
	"context"
	"errors"
	"sync"
	"time"
)

type DispatcherStore interface {
	Claim(context.Context) (*pb.ExecuteRequest, error)
	Complete(context.Context, *pb.ExecuteRequest, []byte) error
	Retry(context.Context, *pb.ExecuteRequest) error
}

// Dispatch admits only as many leased jobs as there are execution slots. On
// shutdown, in-flight calls receive cancellation; uncommitted leases recover.
func Dispatch(ctx context.Context, store DispatcherStore, execute func(context.Context, *pb.ExecuteRequest) ([]byte, error), concurrency int, report func(error)) error {
	if concurrency < 1 || concurrency > 4 || execute == nil || store == nil {
		return errors.New("invalid dispatcher configuration")
	}
	if report == nil {
		report = func(error) {}
	}
	var wg sync.WaitGroup
	for i := 0; i < concurrency; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for ctx.Err() == nil {
				request, err := store.Claim(ctx)
				if err != nil {
					report(err)
				}
				if err != nil || request == nil {
					timer := time.NewTimer(250 * time.Millisecond)
					select {
					case <-ctx.Done():
						timer.Stop()
						return
					case <-timer.C:
					}
					continue
				}
				result, err := execute(ctx, request)
				if ctx.Err() != nil {
					return
				}
				if err != nil {
					report(err)
					if retryErr := store.Retry(ctx, request); retryErr != nil {
						report(retryErr)
					}
				} else if err = store.Complete(ctx, request, result); err != nil {
					report(err)
				}
			}
		}()
	}
	wg.Wait()
	return nil
}
