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
	for _, sample := range []struct{ address, plugin, input, expected string }{
		{c.RustAddress, "rust.wasm_ascii_upper", "Hello World", "HELLO WORLD"},
		{c.PythonAddress, "python.normalize", "  Hello   WORLD  ", "hello world"},
		{c.RustAddress, "rust.sha256", "hello", fmt.Sprintf("%x", sha256.Sum256([]byte("hello")))},
	} {
		client, err := plugins.New(sample.address, c.WorkerToken)
		if err != nil {
			return err
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
		bad, err := plugins.New(sample.address, "incorrect-token-00000000000000000000")
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
	return nil
}
