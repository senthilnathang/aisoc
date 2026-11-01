package localintegrations

import (
	"aisoc/backend/internal/platform/jobs"
	"encoding/json"
	"testing"
)

func TestBatchEnvelopeBoundsAndStableIdentity(t *testing.T) {
	in := BatchInput{SchemaVersion: "1", ID: "batch-" + jobs.ID(), Name: "Batch", Cases: []BatchCase{{Key: "one", Name: "One", Document: json.RawMessage(`{"schema_version":"1","events":[]}`)}}}
	rows, e := PreviewBatch("tenant", in)
	if e != nil || len(rows) != 1 || rows[0].Valid {
		t.Fatal(rows, e)
	}
	if rows[0].ProfileID != profileFor("tenant", in.ID, "one") || rows[0].ProfileID == profileFor("other", in.ID, "one") || !ValidID(rows[0].ProfileID) {
		t.Fatal("unstable/foreign binding")
	}
	invalidNUL := in
	invalidNUL.Cases = []BatchCase{{Key: "nul", Name: "Invalid", Document: json.RawMessage(`{"schema_version":"1","events":[],"unknown":"\u0000"}`)}}
	if _, e = PreviewBatch("tenant", invalidNUL); e == nil {
		t.Fatal("PostgreSQL-incompatible NUL admitted")
	}
	in.Cases = append(in.Cases, in.Cases[0])
	if _, e = PreviewBatch("tenant", in); e == nil {
		t.Fatal("duplicate keys")
	}
	in.Cases = in.Cases[:1]
	in.ID = "bad"
	if _, e = PreviewBatch("tenant", in); e == nil {
		t.Fatal("bad batch id")
	}
	if _, e = decodeCase(json.RawMessage(`{"schema_version":"1","events":[],"credentials":"must-not-be-stored"}`)); e == nil {
		t.Fatal("unknown fields accepted")
	}
}
