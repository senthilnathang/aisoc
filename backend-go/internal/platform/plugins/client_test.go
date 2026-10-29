package plugins

import (
	pb "aisoc/backend/internal/gen/worker/v1"
	"context"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/health"
	healthpb "google.golang.org/grpc/health/grpc_health_v1"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"net"
	"testing"
	"time"
)

type fakeWorker struct {
	pb.UnimplementedWorkerServer
	delay bool
}

func TestHealthAndCredentialReplacement(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	const token = "test-token-00000000000000000000000000"
	server := grpc.NewServer(grpc.UnaryInterceptor(func(ctx context.Context, req any, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {
		md, _ := metadata.FromIncomingContext(ctx)
		values := md.Get("authorization")
		if len(values) != 1 || values[0] != "Bearer "+token {
			return nil, status.Error(codes.Unauthenticated, "credential mismatch")
		}
		if md.Get("traceparent")[0] != "test-trace" {
			return nil, status.Error(codes.InvalidArgument, "trace lost")
		}
		return handler(ctx, req)
	}))
	h := health.NewServer()
	healthpb.RegisterHealthServer(server, h)
	go server.Serve(listener)
	defer server.Stop()
	client, err := New(listener.Addr().String(), token)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	ctx := metadata.NewOutgoingContext(context.Background(), metadata.Pairs("authorization", "untrusted-caller", "traceparent", "test-trace"))
	h.SetServingStatus("aisoc.worker.v1.Worker", healthpb.HealthCheckResponse_SERVING)
	if err := client.CheckHealth(ctx); err != nil {
		t.Fatal(err)
	}
	h.SetServingStatus("aisoc.worker.v1.Worker", healthpb.HealthCheckResponse_NOT_SERVING)
	if err := client.CheckHealth(ctx); err == nil {
		t.Fatal("accepted unhealthy worker")
	}
	if _, err := client.Execute(ctx, nil); err == nil {
		t.Fatal("accepted nil request")
	}
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
