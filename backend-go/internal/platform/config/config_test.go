package config

import "testing"

func TestLoopbackAndReservedPorts(t *testing.T) {
	for _, address := range []string{"0.0.0.0:3003", "example.com:3003", "127.0.0.1:0", "127.0.0.1:99999"} {
		if Loopback(address) == nil {
			t.Errorf("accepted %s", address)
		}
	}
	t.Setenv("AISOC_GO_DATABASE_URL", "postgres://localhost/aisoc_go_test")
	t.Setenv("AISOC_GO_RELEASE_MODE", "")
	t.Setenv("AISOC_GO_ADDR", "127.0.0.1:3002")
	if _, err := Load(); err == nil {
		t.Fatal("accepted active port")
	}
	t.Setenv("AISOC_GO_ADDR", "127.0.0.1:3003")
	t.Setenv("AISOC_PYTHON_ADDR", "127.0.0.1:50051")
	t.Setenv("AISOC_WORKER_TOKEN", "")
	if _, err := Load(); err == nil {
		t.Fatal("accepted worker without credential")
	}
}

func TestReleaseCanRetainLegacyAPIPort(t *testing.T) {
	t.Setenv("AISOC_GO_DATABASE_URL", "postgres://localhost/aisoc_go_release")
	t.Setenv("AISOC_GO_ADDR", "127.0.0.1:3002")
	t.Setenv("AISOC_GO_RELEASE_MODE", "true")
	t.Setenv("AISOC_GO_AUTH_MODE", "local")
	t.Setenv("AISOC_GO_ENV", "development")
	t.Setenv("AISOC_GO_OPERATORS_FILE", "")
	t.Setenv("AISOC_PYTHON_ADDR", "")
	t.Setenv("AISOC_RUST_ADDR", "")
	if _, err := Load(); err != nil {
		t.Fatal(err)
	}
	t.Setenv("AISOC_GO_ADDR", "127.0.0.1:8080")
	if _, err := Load(); err == nil {
		t.Fatal("release accepted frontend port")
	}
}

func TestWorkerConcurrencyBounds(t *testing.T) {
	t.Setenv("AISOC_GO_DATABASE_URL", "postgres://localhost/aisoc_go_test")
	t.Setenv("AISOC_GO_ADDR", "127.0.0.1:3003")
	t.Setenv("AISOC_PYTHON_ADDR", "")
	t.Setenv("AISOC_RUST_ADDR", "")
	t.Setenv("AISOC_GO_WORKER_CONCURRENCY", "2")
	t.Setenv("AISOC_GO_TENANT_WORKER_LIMIT", "1")
	c, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if c.WorkerConcurrency != 2 || c.TenantWorkerLimit != 1 {
		t.Fatal("incorrect concurrency")
	}
	for _, key := range []string{"AISOC_GO_WORKER_CONCURRENCY", "AISOC_GO_TENANT_WORKER_LIMIT"} {
		for _, v := range []string{"0", "5", "invalid"} {
			t.Setenv(key, v)
			if _, err = Load(); err == nil {
				t.Fatal("accepted invalid limit", key, v)
			}
		}
		t.Setenv(key, "1")
	}
}
