package eventstate

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"

	"aisoc/backend/internal/modules/telemetry"
	"aisoc/backend/internal/platform/auth"
)

type ArchivedEvent struct {
	EventKey      string          `json:"event_key"`
	ContentHash   string          `json:"content_hash"`
	Envelope      json.RawMessage `json:"envelope"`
	Disposition   string          `json:"disposition"`
	CreatedAt     time.Time       `json:"created_at"`
	ProcessedAt   time.Time       `json:"processed_at"`
	WorkUpdatedAt *time.Time      `json:"work_updated_at,omitempty"`
}
type ArchiveBundle struct {
	SchemaVersion  string            `json:"schema_version"`
	Binding        telemetry.Binding `json:"binding"`
	Processor      string            `json:"processor"`
	RetentionClass string            `json:"retention_class"`
	Events         []ArchivedEvent   `json:"events"`
}
type ArchiveReceipt struct {
	File          string `json:"file"`
	SHA256        string `json:"sha256"`
	Events        int    `json:"events"`
	CompactedWork int64  `json:"compacted_work"`
	Next          string `json:"next"`
}

// VerifyArchive validates bounded bytes, provenance and content hashes. Hash is
// of the canonical uncompressed bundle, allowing independent restore verification.
func VerifyArchive(path, expectedHash string) (ArchiveBundle, error) {
	var bundle ArchiveBundle
	f, err := os.Open(path)
	if err != nil {
		return bundle, err
	}
	defer f.Close()
	z, err := gzip.NewReader(f)
	if err != nil {
		return bundle, err
	}
	defer z.Close()
	raw, err := io.ReadAll(io.LimitReader(z, 2<<20+1))
	if err != nil || len(raw) > 2<<20 {
		return bundle, ErrInvalid
	}
	if fmt.Sprintf("%x", sha256.Sum256(raw)) != expectedHash {
		return bundle, ErrConflict
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if err = d.Decode(&bundle); err != nil {
		return bundle, ErrInvalid
	}
	if bundle.SchemaVersion != "1.0" || bundle.RetentionClass != "sandbox-evidence" || !validBinding(bundle.Binding) || !idPattern.MatchString(bundle.Processor) || len(bundle.Events) == 0 || len(bundle.Events) > 100 {
		return bundle, ErrInvalid
	}
	seen := map[string]bool{}
	for _, record := range bundle.Events {
		e, err := telemetry.Decode(record.Envelope, bundle.Binding)
		if err != nil || seen[record.EventKey] || e.Identity() != record.EventKey || e.ContentHash() != record.ContentHash || record.CreatedAt.IsZero() || record.ProcessedAt.IsZero() {
			return bundle, ErrConflict
		}
		seen[record.EventKey] = true
	}
	return bundle, nil
}

// ArchiveCompleted exports at most 100 completed, non-case events to a verified
// local artifact, then audits and compacts only matching done-work metadata.
// Evidence, inbox deduplication, source cursors and all prior audit records stay.
// No broad purge or deletion of evidence referenced by a case is performed.
func (o OperatorRecovery) ArchiveCompleted(ctx context.Context, actor auth.Principal, b telemetry.Binding, processor, after, directory string, minAge time.Duration) (ArchiveReceipt, error) {
	var receipt ArchiveReceipt
	allowed := false
	for _, g := range o.Grants {
		if g.Operator == actor && g.Binding == b && actor.ID != "" && actor.Tenant == b.TenantID {
			allowed = true
		}
	}
	if !allowed {
		return receipt, ErrRecoveryDenied
	}
	if !validBinding(b) || !idPattern.MatchString(processor) || (after != "" && !hashPattern.MatchString(after)) || minAge < 24*time.Hour || minAge > 365*24*time.Hour {
		return receipt, ErrInvalid
	}
	rows, err := o.Store.Pool.Query(ctx, `SELECT e.event_key,e.content_hash,e.envelope,i.disposition,e.created_at,i.processed_at,w.updated_at FROM stream_events e JOIN stream_inbox i USING(tenant_id,connector_id,source,event_key) LEFT JOIN stream_consumer_work w ON w.tenant_id=e.tenant_id AND w.connector_id=e.connector_id AND w.source=e.source AND w.processor=$4 AND w.work_key='event:'||e.event_key AND w.state='done' WHERE e.tenant_id=$1 AND e.connector_id=$2 AND e.source=$3 AND i.processor=$4 AND e.event_key>$5 AND NOT EXISTS(SELECT 1 FROM stream_event_archives a WHERE a.tenant_id=e.tenant_id AND a.connector_id=e.connector_id AND a.source=e.source AND a.event_key=e.event_key) AND e.created_at<now()-($6::bigint*interval '1 second') AND i.content_hash=e.content_hash AND NOT EXISTS(SELECT 1 FROM stream_findings f WHERE f.tenant_id=e.tenant_id AND f.connector_id=e.connector_id AND f.source=e.source AND f.document->'event_keys' ? e.event_key) ORDER BY e.event_key LIMIT 100`, b.TenantID, b.ConnectorID, b.Source, processor, after, int64(minAge.Seconds()))
	if err != nil {
		return receipt, err
	}
	bundle := ArchiveBundle{SchemaVersion: "1.0", Binding: b, Processor: processor, RetentionClass: "sandbox-evidence", Events: []ArchivedEvent{}}
	for rows.Next() {
		var event ArchivedEvent
		if err = rows.Scan(&event.EventKey, &event.ContentHash, &event.Envelope, &event.Disposition, &event.CreatedAt, &event.ProcessedAt, &event.WorkUpdatedAt); err != nil {
			break
		}
		bundle.Events = append(bundle.Events, event)
	}
	if err == nil {
		err = rows.Err()
	}
	rows.Close()
	if err != nil {
		return receipt, err
	}
	if len(bundle.Events) == 0 {
		return receipt, nil
	}
	raw, err := json.Marshal(bundle)
	if err != nil || len(raw) > 2<<20 {
		return receipt, ErrInvalid
	}
	receipt.SHA256 = fmt.Sprintf("%x", sha256.Sum256(raw))
	receipt.Events = len(bundle.Events)
	receipt.Next = bundle.Events[len(bundle.Events)-1].EventKey
	if err = os.MkdirAll(directory, 0700); err != nil {
		return receipt, err
	}
	file, err := os.CreateTemp(directory, ".archive-*.tmp")
	if err != nil {
		return receipt, err
	}
	temporary := file.Name()
	defer os.Remove(temporary)
	z := gzip.NewWriter(file)
	if _, err = z.Write(raw); err != nil {
		file.Close()
		return receipt, err
	}
	if err = z.Close(); err != nil {
		file.Close()
		return receipt, err
	}
	if err = file.Sync(); err != nil {
		file.Close()
		return receipt, err
	}
	if err = file.Close(); err != nil {
		return receipt, err
	}
	path := filepath.Join(directory, receipt.SHA256+".json.gz")
	if err = os.Link(temporary, path); err != nil && !os.IsExist(err) {
		return receipt, err
	}
	if _, err = VerifyArchive(path, receipt.SHA256); err != nil {
		return receipt, err
	}
	dir, err := os.Open(directory)
	if err != nil {
		return receipt, err
	}
	err = dir.Sync()
	dir.Close()
	if err != nil {
		return receipt, err
	}
	receipt.File = path
	tx, err := o.Store.Pool.Begin(ctx)
	if err != nil {
		return receipt, err
	}
	defer tx.Rollback(ctx)
	var one int
	if err = tx.QueryRow(ctx, `SELECT 1 FROM stream_source_checkpoints WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 FOR UPDATE`, b.TenantID, b.ConnectorID, b.Source).Scan(&one); err != nil {
		return receipt, err
	}
	for _, event := range bundle.Events {
		var valid bool
		if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM stream_events e JOIN stream_inbox i USING(tenant_id,connector_id,source,event_key) WHERE e.tenant_id=$1 AND e.connector_id=$2 AND e.source=$3 AND e.event_key=$4 AND e.content_hash=$5 AND i.content_hash=$5 AND i.processor=$6) AND NOT EXISTS(SELECT 1 FROM stream_findings WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 AND document->'event_keys' ? $4)`, b.TenantID, b.ConnectorID, b.Source, event.EventKey, event.ContentHash, processor).Scan(&valid); err != nil {
			return receipt, err
		}
		if !valid {
			return receipt, ErrConflict
		}
		// Keep source identity in PostgreSQL for revision checks, and retain the
		// original hash/inbox for replay. Only a verified, fsynced bundle is used.
		original, err := telemetry.Decode(event.Envelope, b)
		if err != nil {
			return receipt, err
		}
		pointer, _ := json.Marshal(archivePointer{true, original.SourceEventID, original.SourceRevision})
		absolute, err := filepath.Abs(path)
		if err != nil {
			return receipt, err
		}
		if _, err = tx.Exec(ctx, `INSERT INTO stream_event_archives(tenant_id,connector_id,source,event_key,file_path,sha256) VALUES($1,$2,$3,$4,$5,$6)`, b.TenantID, b.ConnectorID, b.Source, event.EventKey, absolute, receipt.SHA256); err != nil {
			return receipt, err
		}
		if _, err = tx.Exec(ctx, `UPDATE stream_events SET envelope=$5 WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 AND event_key=$4`, b.TenantID, b.ConnectorID, b.Source, event.EventKey, pointer); err != nil {
			return receipt, err
		}
		if event.WorkUpdatedAt != nil {
			tag, err := tx.Exec(ctx, `DELETE FROM stream_consumer_work w WHERE tenant_id=$1 AND connector_id=$2 AND source=$3 AND processor=$4 AND work_key=$5 AND state='done' AND updated_at=$6 AND NOT EXISTS(SELECT 1 FROM stream_dead_letters d WHERE d.tenant_id=w.tenant_id AND d.connector_id=w.connector_id AND d.source=w.source AND d.processor=w.processor AND d.work_key=w.work_key)`, b.TenantID, b.ConnectorID, b.Source, processor, "event:"+event.EventKey, *event.WorkUpdatedAt)
			if err != nil {
				return receipt, err
			}
			receipt.CompactedWork += tag.RowsAffected()
		}
	}
	details, _ := json.Marshal(map[string]any{"actor": actor.ID, "source": b.Source, "connector_id": b.ConnectorID, "processor": processor, "sha256": receipt.SHA256, "events": receipt.Events, "compacted_work": receipt.CompactedWork, "file": filepath.Base(path)})
	if _, err = tx.Exec(ctx, `INSERT INTO audit_events(tenant_id,id,resource,resource_id,action,details,created_at,updated_at) VALUES($1,$2,'stream_archive',$3,'stream_archive_verified',$4,now(),now()) ON CONFLICT DO NOTHING`, b.TenantID, "stream-archive:"+receipt.SHA256, receipt.SHA256, details); err != nil {
		return receipt, err
	}
	return receipt, tx.Commit(ctx)
}
