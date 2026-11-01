package threatintel

import "testing"

func TestNormalizeImportedIOCs(t *testing.T) {
	for _, tc := range []struct{ kind, value, want string }{{"ip", "2001:0DB8:0:0::1", "2001:db8::1"}, {"domain", " EXAMPLE.TEST. ", "example.test"}, {"url", "HTTPS://Example.Test:443/Case?x=Y", "https://example.test/Case?x=Y"}, {"hash_md5", "D41D8CD98F00B204E9800998ECF8427E", "d41d8cd98f00b204e9800998ecf8427e"}} {
		got, e := normalizeIOC(tc.kind, tc.value)
		if e != nil || got != tc.want {
			t.Fatal(tc, got, e)
		}
	}
	for _, tc := range []struct{ kind, value string }{{"ip", "999.1.1.1"}, {"domain", "-bad.test"}, {"domain", "*.example.test"}, {"url", "file:///etc/passwd"}, {"url", "https://user:secret@example.test"}, {"hash_sha256", "abc"}, {"hash_md5", "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"}, {"unknown", "value"}} {
		if _, e := normalizeIOC(tc.kind, tc.value); e == nil {
			t.Fatal("accepted", tc)
		}
	}
}

func TestPreviewCanonicalIdentityAndBounds(t *testing.T) {
	in := IntelImport{SchemaVersion: "1", Source: "demo", ExternalID: "one", Title: "Example", Severity: "medium", PublishedAt: "2026-11-01T00:00:00Z", Indicators: []ImportIOC{{Type: "domain", Value: "EXAMPLE.TEST."}, {Type: "domain", Value: "example.test", Severity: "high"}}}
	a, e := PreviewImport(in)
	if e != nil || a.Unique != 1 || a.Duplicates != 1 {
		t.Fatal(a, e)
	}
	in.Indicators = []ImportIOC{{Type: "domain", Value: "example.test", Severity: "high"}}
	b, e := PreviewImport(in)
	if e != nil || a.Hash != b.Hash {
		t.Fatal("canonical identity mismatch", e)
	}
	in.Indicators = make([]ImportIOC, 201)
	if _, e = PreviewImport(in); e == nil {
		t.Fatal("oversized batch accepted")
	}
	in.Indicators = b.Document.Indicators
	in.PublishedAt = "2026-11-01"
	if _, e = PreviewImport(in); e == nil {
		t.Fatal("ambiguous timestamp accepted")
	}
}
