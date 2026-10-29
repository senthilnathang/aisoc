package plugins

import (
	pb "aisoc/backend/internal/gen/worker/v1"
	"context"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"net"
	"testing"
	"time"
)

type fakeWorker struct {
	pb.UnimplementedWorkerServer
	delay bool
}

func (f fakeWorker) Execute(ctx context.Context, r *pb.ExecuteRequest) (*pb.ExecuteResponse, error) {
	if f.delay {
		<-ctx.Done()
		return nil, ctx.Err()
	}
	return &pb.ExecuteResponse{TenantId: "foreign", JobId: r.JobId, AttemptId: r.AttemptId, PluginId: r.PluginId, PluginVersion: r.PluginVersion}, nil
}
func TestRejectSpoofedResultsAndCancel(t *testing.T) {
	for _, slow := range []bool{false, true} {
		listener, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			t.Fatal(err)
		}
		server := grpc.NewServer()
		pb.RegisterWorkerServer(server, fakeWorker{delay: slow})
		go server.Serve(listener)
		client, err := New(listener.Addr().String(), "test-token-00000000000000000000000000")
		if err != nil {
			t.Fatal(err)
		}
		ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
		_, err = client.Execute(ctx, &pb.ExecuteRequest{TenantId: "a", JobId: "job", AttemptId: "attempt", PluginId: "rust.sha256", PluginVersion: "1"})
		cancel()
		client.Close()
		server.Stop()
		if err == nil {
			t.Fatal("accepted spoofed or late result")
		}
		if slow && status.Code(err) != codes.DeadlineExceeded {
			t.Fatalf("expected deadline: %v", err)
		}
	}
}
