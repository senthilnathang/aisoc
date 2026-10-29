package telemetrypipeline

import (
	"aisoc/backend/internal/platform/eventstate"
	"aisoc/backend/internal/platform/streams"
	"context"
	"time"
)

type RetentionPage struct {
	Next             string
	Scanned, Removed int
	Skipped          map[string]int
}

// Prune is explicit and bounded to 100 entries. Durable evidence/inbox/audit are
// retained. No timer or core startup path calls it automatically.
func (r Runtime) Prune(ctx context.Context, retirer *streams.Client, after string, minAge time.Duration) (RetentionPage, error) {
	result := RetentionPage{Skipped: map[string]int{}}
	if r.validate() != nil || retirer == nil || minAge < time.Minute || minAge > 7*24*time.Hour {
		return result, eventstate.ErrInvalid
	}
	entries, err := retirer.Page(ctx, r.Binding, after)
	if err != nil {
		return result, err
	}
	for _, d := range entries {
		result.Scanned++
		result.Next = d.ID
		if d.Err != nil {
			result.Skipped["invalid"]++
			continue
		}
		done, err := r.Store.Committed(ctx, r.Binding, r.Processor, d.Key, d.ContentHash)
		if err != nil {
			return result, err
		}
		if !done {
			result.Skipped["uncommitted"]++
			continue
		}
		status, err := retirer.Retire(ctx, r.Binding, r.Processor, d, minAge)
		if err != nil {
			return result, err
		}
		if status == "removed" {
			result.Removed++
		} else {
			result.Skipped[status]++
		}
	}
	if len(entries) < 100 {
		result.Next = ""
	}
	return result, nil
}
