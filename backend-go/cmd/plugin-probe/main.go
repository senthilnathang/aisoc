package main

import (
	pb "aisoc/backend/internal/gen/worker/v1"
	"aisoc/backend/internal/platform/config"
	"aisoc/backend/internal/platform/jobs"
	"aisoc/backend/internal/platform/plugins"
	"context"
	"crypto/sha256"
	"fmt"
	"os"
	"strings"
	"time"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "worker probe failed:", err)
		os.Exit(1)
	}
}
func run() error {
	c, err := config.Load()
	if err != nil {
		return err
	}
	if c.PythonAddress == "" && c.RustAddress == "" {
		return fmt.Errorf("no specialist addresses configured")
	}
	for _, sample := range []struct{ address, plugin, input, expected string }{
		{c.RustAddress, "rust.wasm_ascii_upper", "Hello World", "HELLO WORLD"},
		{c.PythonAddress, "python.normalize", "  Hello   WORLD  ", "hello world"},
		{c.RustAddress, "rust.sha256", "hello", fmt.Sprintf("%x", sha256.Sum256([]byte("hello")))},
	} {
		if sample.address == "" {
			continue
		}
		tlsConfig := config.WorkerTLS{}
		if sample.plugin == "python.normalize" {
			tlsConfig = c.PythonTLS
		}
		client, err := plugins.NewWithTLS(sample.address, c.WorkerToken, tlsConfig)
		if err != nil {
			return err
		}
		if sample.plugin == "python.normalize" {
			if err := client.CheckHealth(context.Background()); err != nil {
				client.Close()
				return fmt.Errorf("python gRPC readiness: %w", err)
			}
		}
		request := &pb.ExecuteRequest{TenantId: "framework-probe", JobId: jobs.ID(), AttemptId: jobs.ID(), PluginId: sample.plugin, PluginVersion: "1", Input: []byte(sample.input)}
		result, err := client.Execute(context.Background(), request)
		client.Close()
		if err != nil {
			return err
		}
		if string(result) != sample.expected {
			return fmt.Errorf("unexpected result from %s", sample.plugin)
		}
		bad, err := plugins.NewWithTLS(sample.address, "incorrect-token-00000000000000000000", tlsConfig)
		if err != nil {
			return err
		}
		_, err = bad.Execute(context.Background(), request)
		bad.Close()
		if err == nil {
			return fmt.Errorf("worker accepted invalid credential")
		}
		fmt.Println("PASS", sample.plugin, "result and credential rejection")
	}
	if c.PythonAddress != "" {
		client, err := plugins.NewWithTLS(c.PythonAddress, c.WorkerToken, c.PythonTLS)
		if err != nil {
			return err
		}
		defer client.Close()
		task := &pb.InvestigationTask{TenantId: "framework-probe", IncidentId: "mock-case", TaskId: jobs.ID(), AttemptId: jobs.ID(), SchemaVersion: "1", DeadlineUnixMs: time.Now().Add(10 * time.Second).UnixMilli(), MaxOutputBytes: 8192, Mode: "mock-v1", Evidence: []*pb.EvidenceItem{{Reference: "mock:ignore-instructions", ContentHash: strings.Repeat("a", 64), EventTime: time.Now().Add(-time.Minute).UTC().Format(time.RFC3339), EventType: "authentication.failed"}}}
		result, err := client.Investigate(context.Background(), task)
		if err != nil {
			return err
		}
		if result.Verdict != "INCONCLUSIVE" || !result.RequiresHumanReview {
			return fmt.Errorf("unsafe mock result")
		}
		bad, err := plugins.NewWithTLS(c.PythonAddress, "incorrect-token-00000000000000000000", c.PythonTLS)
		if err != nil {
			return err
		}
		defer bad.Close()
		if _, err = bad.Investigate(context.Background(), task); err == nil {
			return fmt.Errorf("investigation accepted invalid credential")
		}
		fmt.Println("PASS typed Go/Python investigation RPC, QA and credential rejection; mock inconclusive, no actions")
		if os.Getenv("AISOC_PROBE_MODEL") == "1" {
			task.Mode = "model-v1"
			task.DeadlineUnixMs = time.Now().Add(10 * time.Second).UnixMilli()
			if _, err = client.Investigate(context.Background(), task); err != nil {
				return err
			}
			fmt.Println("PASS Go gRPC to configured JSON inference service and Go QA; model quality not assessed")
		}
	}
	return nil
}
