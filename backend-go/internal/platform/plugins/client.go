package plugins

import (
	pb "aisoc/backend/internal/gen/worker/v1"
	"aisoc/backend/internal/modules/l1"
	"aisoc/backend/internal/platform/config"
	"context"
	"errors"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	healthpb "google.golang.org/grpc/health/grpc_health_v1"
	"google.golang.org/grpc/metadata"
	"google.golang.org/protobuf/proto"
	"time"
)

const Limit = 65536

type Client struct {
	connection *grpc.ClientConn
	rpc        pb.WorkerClient
	token      string
}

func New(address, token string) (*Client, error) {
	if err := config.Loopback(address); err != nil {
		return nil, err
	}
	if len(token) < 32 {
		return nil, errors.New("worker token too short")
	}
	conn, err := grpc.NewClient(address, grpc.WithTransportCredentials(insecure.NewCredentials()), grpc.WithDefaultCallOptions(grpc.MaxCallRecvMsgSize(70000), grpc.MaxCallSendMsgSize(70000)))
	if err != nil {
		return nil, err
	}
	return &Client{conn, pb.NewWorkerClient(conn), token}, nil
}
func (c *Client) Close() { _ = c.connection.Close() }

// CheckHealth uses the standard unary gRPC health protocol. It is optional for
// legacy specialists; Python implements it. Never retry execution automatically:
// durable job leases own retries and result admission.
func (c *Client) CheckHealth(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, time.Second)
	defer cancel()
	ctx = metadata.NewOutgoingContext(ctx, metadata.Join(metadataFrom(ctx), metadata.Pairs("authorization", "Bearer "+c.token)))
	r, err := healthpb.NewHealthClient(c.connection).Check(ctx, &healthpb.HealthCheckRequest{Service: "aisoc.worker.v1.Worker"})
	if err != nil {
		return err
	}
	if r.Status != healthpb.HealthCheckResponse_SERVING {
		return errors.New("worker is not serving")
	}
	return nil
}

// Preserve tracing metadata but never forward caller-provided service credentials.
func metadataFrom(ctx context.Context) metadata.MD {
	md, _ := metadata.FromOutgoingContext(ctx)
	md = md.Copy()
	md.Delete("authorization")
	return md
}

func (c *Client) Execute(ctx context.Context, r *pb.ExecuteRequest) ([]byte, error) {
	if r == nil {
		return nil, errors.New("missing execution request")
	}
	if len(r.Input) > Limit {
		return nil, errors.New("plugin input exceeds limit")
	}
	for _, value := range []string{r.TenantId, r.JobId, r.AttemptId} {
		if len(value) == 0 || len(value) > 120 {
			return nil, errors.New("invalid execution identity")
		}
	}
	if r.PluginId == l1.Plugin && r.PluginVersion == "1" {
		var task pb.InvestigationTask
		if proto.Unmarshal(r.Input, &task) != nil || task.TenantId != r.TenantId || task.TaskId != r.JobId || task.AttemptId != "" || task.DeadlineUnixMs != 0 {
			return nil, l1.ErrInvalid
		}
		task.AttemptId = r.AttemptId
		task.DeadlineUnixMs = time.Now().Add(5 * time.Second).UnixMilli()
		result, err := c.Investigate(ctx, &task)
		if err != nil {
			return nil, err
		}
		return proto.Marshal(result)
	}
	if r.PluginVersion != "1" || (r.PluginId != "python.normalize" && r.PluginId != "rust.sha256" && r.PluginId != "rust.wasm_ascii_upper") {
		return nil, errors.New("unknown plugin version")
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	ctx = metadata.NewOutgoingContext(ctx, metadata.Join(metadataFrom(ctx), metadata.Pairs("authorization", "Bearer "+c.token)))
	response, err := c.rpc.Execute(ctx, r)
	if err != nil {
		return nil, err
	}
	if response.TenantId != r.TenantId || response.JobId != r.JobId || response.AttemptId != r.AttemptId || response.PluginId != r.PluginId || response.PluginVersion != r.PluginVersion || len(response.Output) > Limit {
		return nil, errors.New("worker result identity or size mismatch")
	}
	return response.Output, nil
}
