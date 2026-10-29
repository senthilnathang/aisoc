package plugins

import (
	pb "aisoc/backend/internal/gen/worker/v1"
	"aisoc/backend/internal/modules/l1"
	"context"
	"google.golang.org/grpc/metadata"
	"time"
)

// Investigate uses existing transport/auth but a typed RPC. No automatic retries,
// durable job completion or action execution occurs here; Go QA vetoes invalid output.
func (c *Client) Investigate(ctx context.Context, task *pb.InvestigationTask) (*pb.InvestigationResult, error) {
	if err := l1.ValidateTask(task, time.Now()); err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	ctx, deadlineCancel := context.WithDeadline(ctx, time.UnixMilli(task.DeadlineUnixMs))
	defer deadlineCancel()
	ctx = metadata.NewOutgoingContext(ctx, metadata.Join(metadataFrom(ctx), metadata.Pairs("authorization", "Bearer "+c.token)))
	result, err := pb.NewInvestigatorClient(c.connection).Investigate(ctx, task)
	if err != nil {
		return nil, err
	}
	if err = l1.VerifyResult(task, result, time.Now()); err != nil {
		return nil, err
	}
	return result, nil
}
