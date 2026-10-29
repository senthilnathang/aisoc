package telemetrypipeline

import (
	"context"
	"crypto/sha256"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"sort"
	"strings"
	"sync"
	"time"
)

type profileKey string
type queryStart struct {
	at         time.Time
	sql, stage string
}
type queryStats struct {
	SQL     string  `json:"sql"`
	Stage   string  `json:"stage"`
	Count   int64   `json:"count"`
	TotalMS float64 `json:"total_ms"`
	MaxMS   float64 `json:"max_ms"`
}
type queryProfile struct {
	mu   sync.Mutex
	rows map[string]*queryStats
}

func (p *queryProfile) add(stage, sql string, elapsed time.Duration) {
	sql = strings.Join(strings.Fields(sql), " ")
	id := fmt.Sprintf("%s:%x", stage, sha256.Sum256([]byte(sql)))
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.rows == nil {
		p.rows = map[string]*queryStats{}
	}
	r := p.rows[id]
	if r == nil {
		r = &queryStats{SQL: sql, Stage: stage}
		p.rows[id] = r
	}
	ms := float64(elapsed.Microseconds()) / 1000
	r.Count++
	r.TotalMS += ms
	if ms > r.MaxMS {
		r.MaxMS = ms
	}
}
func (p *queryProfile) TraceQueryStart(ctx context.Context, _ *pgx.Conn, d pgx.TraceQueryStartData) context.Context {
	stage, _ := ctx.Value(profileKey("stage")).(string)
	return context.WithValue(ctx, profileKey("query"), queryStart{time.Now(), d.SQL, stage})
}
func (p *queryProfile) TraceQueryEnd(ctx context.Context, _ *pgx.Conn, _ pgx.TraceQueryEndData) {
	q := ctx.Value(profileKey("query")).(queryStart)
	p.add(q.stage, q.sql, time.Since(q.at))
}
func (p *queryProfile) TraceAcquireStart(ctx context.Context, _ *pgxpool.Pool, _ pgxpool.TraceAcquireStartData) context.Context {
	return context.WithValue(ctx, profileKey("acquire"), time.Now())
}
func (p *queryProfile) TraceAcquireEnd(ctx context.Context, _ *pgxpool.Pool, _ pgxpool.TraceAcquireEndData) {
	stage, _ := ctx.Value(profileKey("stage")).(string)
	p.add(stage, "[pool acquire]", time.Since(ctx.Value(profileKey("acquire")).(time.Time)))
}
func (p *queryProfile) TraceBatchStart(ctx context.Context, _ *pgx.Conn, _ pgx.TraceBatchStartData) context.Context {
	return context.WithValue(ctx, profileKey("batch"), time.Now())
}
func (p *queryProfile) TraceBatchQuery(ctx context.Context, _ *pgx.Conn, d pgx.TraceBatchQueryData) {
	stage, _ := ctx.Value(profileKey("stage")).(string)
	p.add(stage, "[batched statement] "+d.SQL, 0)
}
func (p *queryProfile) TraceBatchEnd(ctx context.Context, _ *pgx.Conn, _ pgx.TraceBatchEndData) {
	stage, _ := ctx.Value(profileKey("stage")).(string)
	p.add(stage, "[batch total]", time.Since(ctx.Value(profileKey("batch")).(time.Time)))
}
func (p *queryProfile) snapshot() []queryStats {
	p.mu.Lock()
	defer p.mu.Unlock()
	result := []queryStats{}
	for _, r := range p.rows {
		result = append(result, *r)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].TotalMS > result[j].TotalMS })
	return result
}
