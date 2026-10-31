package database

import "testing"

func TestOnlyKnown031HistoryIsCompatible(t *testing.T) {
	old := "cbc21a936b5f240e6481b9807d519894d8fd9085fcbec2b3253899b0baa09abf"
	corrected := "474fa303d5e3a4679567f85dd608e1c3fea68604a9a17708f5d39afe0d42c107"
	if !migrationMatches("031_job_dispatch.sql", old, corrected) {
		t.Fatal("known deployed history rejected")
	}
	for _, v := range [][3]string{{"030_stream_payload_budgets.sql", old, corrected}, {"031_job_dispatch.sql", "unknown", corrected}, {"031_job_dispatch.sql", old, "changed-again"}} {
		if migrationMatches(v[0], v[1], v[2]) {
			t.Fatal("unrecognized migration drift accepted")
		}
	}
}
