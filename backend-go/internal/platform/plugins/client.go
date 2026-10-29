package plugins

import (
	pb "aisoc/backend/internal/gen/worker/v1"
	"aisoc/backend/internal/platform/config"
	"context"
	"errors"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"
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
func (c *Client) Execute(ctx context.Context, r *pb.ExecuteRequest) ([]byte, error) {
	if len(r.Input) > Limit {
		return nil, errors.New("plugin input exceeds limit")
	}
	for _, value := range []string{r.TenantId, r.JobId, r.AttemptId} {
		if len(value) == 0 || len(value) > 120 {
			return nil, errors.New("invalid execution identity")
		}
	}
	if r.PluginVersion != "1" || (r.PluginId != "python.normalize" && r.PluginId != "rust.sha256" && r.PluginId != "rust.wasm_ascii_upper") {
		return nil, errors.New("unknown plugin version")
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	ctx = metadata.AppendToOutgoingContext(ctx, "authorization", "Bearer "+c.token)
	response, err := c.rpc.Execute(ctx, r)
	if err != nil {
		return nil, err
	}
	if response.TenantId != r.TenantId || response.JobId != r.JobId || response.AttemptId != r.AttemptId || response.PluginId != r.PluginId || response.PluginVersion != r.PluginVersion || len(response.Output) > Limit {
		return nil, errors.New("worker result identity or size mismatch")
	}
	return response.Output, nil
}
