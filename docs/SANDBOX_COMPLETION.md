# Local sandbox completion plan

Scope confirmed: JSON mock data, local foundation/sandbox only. Live vendor/model
validation and production response activation are outside this release.

Current demo usability: `./run.sh import-demo all` replays the showcase plus the
prepared benchmark bundle; `showcase` and `files FILE.json...` select subsets.
Dry-run validates inputs, and repeated imports insert no duplicates. The local
database holds 70,000 demo events plus the original fixture. See
[import instructions](BENCHMARK_DATA_IMPORT.md) and the current
[performance report](STREAM_PERFORMANCE_REPORT.md); historical measurements below
are milestones, not current throughput guarantees.

Engineering defaults (configurable, not universal SOC standards): provisional
1,000 sustained EPS and 3x burst; 2-second ingest-to-finding p95; at least 7-day
projected-event retention/replay; at least 90-day deduplication metadata and
365-day audit retention. The sandbox retains these records indefinitely; these
minimums do not enable automatic deletion. Archive eligibility defaults to 7 days.
Measurements may fail these targets and must remain visible. Model investigation
latency is measured separately; deterministic mock output is not model evaluation.

Completed local work, in dependency order:

1. Derived durable metadata-budget counters with backfill/rollback/concurrency tests.
2. Scoped consumer-DLQ recovery, operator inspection/retry API and operations UI.
3. Bounded monitoring thresholds and dashboard status without automatic response.
4. JSON-driven local end-to-end fixtures through existing Go/Python/Rust boundaries.
5. Verifiable archive/export and retention policy preserving dedup/evidence/audit.
6. Bounded load/burst/fault checks, larger-retention measurements and explicit gates.
7. Documentation, local foundation migration/startup and final end-to-end validation.

No Kafka/ClickHouse/new orchestration service. Rust changes require measured benefit.
All response execution stays sandbox-only; no privileged actions are activated.

The foundation has been backed up, migrated through 030 and started locally.
Browser validation imported four events, observed four completed and zero pending,
followed the investigation link, confirmed mock SOAR synchronization and replayed
the fixture with zero insertions. Browser console: zero errors/warnings. The
independent full regression suite passed after the final code changes. Screenshot:
`output/playwright/stream-operations.png`. Release API 3002 remains separate.

The original 10,000-event overload probe drained all events at 229.82 EPS, p95 34.758 seconds
scheduled-input-to-ACK, zero final pending/ACK backlog. **The provisional 1,000 EPS
target is not met.** Full finding/model latency and live inference quality are not
established. Those limits do not prevent testing the bounded local JSON workflow.

The latest sustained probe completed 60,000/60,000 at 745 EPS, p95 29.987 seconds,
with zero unacknowledged backlog and synchronous durability enabled. The full suite
passed; the throughput target remains open. See the [performance report](STREAM_PERFORMANCE_REPORT.md)
and [configurable local release gates](LOCAL_RELEASE_GATES.md). The persistent demo
still holds 10,000 events across ten sources; replay inserted zero. The updated
48-table backup restored successfully. A separate disposable restore recovered 100
archived events after removing original archive files and rejected corruption.

## Start and use

```bash
AISOC_RUNTIME_PROFILE=foundation ./run.sh start both
AISOC_RUNTIME_PROFILE=foundation ./run.sh status both
```

Stop an already-running frontend before switching profiles. The launcher applies
additive migrations through 030, starts its own Redis on 16379 and retains private
settings under `.run/`. Release API 3002 remains separate. The main frontend on 8080
now targets foundation API 3003. The extra demo preview on 8082 is stopped.
Open `http://127.0.0.1:8080/build/stream-operations`, load the suspicious-login
example, then import. A source checkpoint is checked atomically. Reimporting the
same source events inserts zero new events. The worker sends bounded typed work
to Python gRPC 50051; FastAPI health is on 8001. Go verifies the mock result and
adds an evidence-backed note to mock SOAR. The verdict remains inconclusive and
requires human review. Rust is verified independently; this small correlation
path has no measured reason to cross a Rust RPC boundary.

Local scopes live in `.run/go-dev/stream-scopes.json`; other environments can set
`AISOC_GO_STREAM_OPERATIONS_FILE`. Grants bind actor, tenant, connector, source and
processor. Inspection, mock import and retry permissions are separate. Production
configuration refuses mock import and sandbox response grants. The sandbox defaults
to 1,000 hot events per source (configurable to 10,000), 100 per import and 1 MiB per
request. Verified payload archives free hot capacity while retaining dedup identities;
the identity ceiling is 100,000 per source. It deliberately stops at
capacity; it is not an unbounded telemetry collector.

## Monitoring and recovery

The scoped API `/api/v1/stream-operations` lists only authorized sources. The UI
shows accepted/completed/pending counts, oldest pending age, failures, worker
heartbeat and recent investigation/SOAR outcomes. Default local alerts: pending
500, age 15 seconds, any failed work/dead letters, missing/stale/retrying worker
or full mock source. Scope files can override queue thresholds. Five-second UI
polls do not overlap. No external notifications or production supervisor is enabled.

Publication/consumer retries require current attempt and operator generation,
an allowlisted reason and review reference. Retries are idempotent, capped and
audited atomically. Poison/content-conflict deliveries cannot be reset. Consumer
retry preserves the original DLQ in audit. SOAR conflict review rebases only the
draft note against an explicitly reviewed version; it preserves analyst fields.

## Verified archive and retention

`cmd/stream-archive` exports at most 100 completed events per call to a private
gzip bundle, verifies its SHA-256 and fsyncs it before committing audit and metadata
compaction. Events referenced by findings and dead-letter work are excluded.
Only eligible completed consumer-work rows are compacted. Source envelopes,
inbox deduplication, publication receipts, checkpoints and audits are preserved.
An archive is an additional copy, not permission to delete case evidence. Export
does not free the 1,000-event source allowance.

Run with the existing private foundation configuration without printing credentials:

```bash
cd backend-go && go build -o bin/stream-archive ./cmd/stream-archive
cd ..
python3 - <<'PY'
import sys, subprocess
sys.path.insert(0, 'scripts/framework')
import dev
subprocess.run(['backend-go/bin/stream-archive', '--scope', 'sandbox-qradar',
                '--min-age-days', '7'], env=dev.dev_env(dev.settings()), check=True)
PY
# Verify a receipt's file/hash independently:
backend-go/bin/stream-archive --verify PATH_FROM_RECEIPT --sha256 HASH_FROM_RECEIPT
```

Advance using the receipt continuation key (`--after`). Store receipt hashes with
audit/backup records. Corrupt artifacts are rejected. Audit failure rolls back
compaction; a verified orphan export can safely remain. Off-host encrypted storage,
destructive expiry and live source replay guarantees require a separate deployment.

## Validation and limits

The full `python3 scripts/framework/check.py --with-streams` check passed, including
Go race/vet, HTTP/auth regression, Python/Rust tests and typed gRPC dispatch. New
coverage includes scoped HTTP denial, unknown/oversized input rejection, atomic
consumer recovery, counter rollback, archive corruption/audit rollback, and replay
after compaction. A 501-event test loses Redis transport with backlog, accepts more
source events and recovers every event once. A separate real worker SIGKILL/restart
test produces two mock SOAR notes from eight events; duplicate import inserts zero.

Reproduce the larger overload/burst probe:

```bash
python3 scripts/framework/check.py --with-streams --stream-load --stream-measure-only \
  --stream-events 10000 --stream-eps 1000 --stream-idle-poll-ms 20 \
  --stream-burst-multiplier 3
```

The middle third of event batches is scheduled at 3x rate. This is bounded overload,
not a sustained capacity certification. Probe latency ends at durable disposition
and ACK; it does not measure full finding/model latency. Reports retain scheduling
lag, SQL/WAL timing, CPU/RAM, queue depth and p50/p95/p99. See
[performance evidence](STREAM_PERFORMANCE_REPORT.md). Mock inference validates
contracts and safety checks, not real-world precision/recall or prompt robustness.

## Migration and rollback

Back up the local foundation before applying 020–027. Migration 026 backfills
derived counters with transactional insert/delete triggers; 027 adds heartbeat
metadata. Existing domain APIs remain intact. To disable streaming, stop the
foundation and set `streams_enabled` false in its private settings before restart.
Keep the additive schema and evidence; do not reverse migrations by dropping data.
An exact pre-migration rollback uses the retained database backup and matching
binaries in a separate restored instance. The release database is not migrated.
