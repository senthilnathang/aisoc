package eventstate

import (
	"aisoc/backend/internal/modules/telemetry"
	"bytes"
	"context"
	"github.com/jackc/pgx/v5"
)

type envelopeReader interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}
type archivePointer struct {
	Archived       bool   `json:"_archive"`
	SourceEventID  string `json:"source_event_id"`
	SourceRevision string `json:"source_revision"`
}

// ResolveEnvelope verifies the complete archive on every read. Missing or corrupt
// archives fail closed. No caller-controlled path is accepted by this boundary.
func ResolveEnvelope(ctx context.Context, reader envelopeReader, b telemetry.Binding, key string, raw []byte) ([]byte, error) {
	if !bytes.HasPrefix(raw, []byte(`{"_archive":true,`)) {
		return raw, nil
	}
	var path, hash, contentHash string
	err := reader.QueryRow(ctx, `SELECT a.file_path,a.sha256,e.content_hash FROM stream_event_archives a JOIN stream_events e USING(tenant_id,connector_id,source,event_key) WHERE a.tenant_id=$1 AND a.connector_id=$2 AND a.source=$3 AND a.event_key=$4`, b.TenantID, b.ConnectorID, b.Source, key).Scan(&path, &hash, &contentHash)
	if err != nil {
		return nil, err
	}
	bundle, err := VerifyArchive(path, hash)
	if err != nil {
		return nil, err
	}
	if bundle.Binding != b {
		return nil, ErrConflict
	}
	for _, event := range bundle.Events {
		if event.EventKey == key {
			if event.ContentHash != contentHash {
				return nil, ErrConflict
			}
			return event.Envelope, nil
		}
	}
	return nil, ErrNotFound
}
