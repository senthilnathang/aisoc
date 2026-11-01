package config

import "testing"

func TestLocalBuildRetentionConfiguration(t *testing.T) {
	t.Setenv("AISOC_GO_AUTH_MODE", "local")
	t.Setenv("AISOC_GO_OPERATORS_FILE", "")
	t.Setenv("AISOC_GO_STREAM_OPERATIONS_FILE", "")
	t.Setenv("AISOC_GO_ENV", "")
	for _, key := range []string{"AISOC_BUILD_MAX_RETAINED_PROFILES", "AISOC_BUILD_MAX_RETAINED_BATCHES"} {
		for _, bad := range []string{"0", "-1", "201", "bad"} {
			t.Setenv(key, bad)
			if _, e := loadAuth(); e == nil {
				t.Fatal(key, bad)
			}
		}
		t.Setenv(key, "25")
	}
	a, e := loadAuth()
	if e != nil || a.BuildMaxProfiles != 25 || a.BuildMaxBatches != 25 {
		t.Fatal(a.BuildMaxProfiles, a.BuildMaxBatches, e)
	}
}
