package eventstate

import (
	"testing"
	"time"
)

func TestRetryDelayBounds(t *testing.T) {
	for _, attempt := range []int{-100, 0, 1, 2, 3, 4, 5, 6, 10000} {
		bounded := attempt
		if bounded < 1 {
			bounded = 1
		}
		if bounded > 6 {
			bounded = 6
		}
		base := time.Second * time.Duration(1<<uint(bounded-1))
		if base > 30*time.Second {
			base = 30 * time.Second
		}
		for i := 0; i < 100; i++ {
			delay := RetryDelay(attempt)
			if delay < base || delay >= 2*base || delay > time.Minute {
				t.Fatalf("attempt=%d delay=%s", attempt, delay)
			}
		}
	}
}
