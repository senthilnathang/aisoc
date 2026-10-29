# Optional Redis Streams sandbox (S03)

The Go adapter is `backend-go/internal/platform/streams`. Redis is optional and
not connected to live intake yet. PostgreSQL remains responsible for durable
checkpoints, outbox records, consumer effects and job orchestration. Python still
uses gRPC; there is no Redis investigation queue or model call per telemetry event.

## Start and stop

From the repository root:

```bash
python3 scripts/framework/redis_runtime.py start
python3 scripts/framework/redis_runtime.py status
python3 scripts/framework/redis_runtime.py stop
```

This creates an independent Redis instance on **127.0.0.1:16379**, with private
configuration, ACL credentials, logs and AOF files in `.run/redis-dev/`. Stop
preserves data. It neither uses nor modifies existing Redis instances on 6379.
The Go/FastAPI development launcher and release `run.sh` remain unchanged; Redis
does not become a dependency of ordinary API readiness or startup.

The launcher verifies Redis **7.0.15**, the installed sandbox baseline, and uses
the pinned Go client **go-redis v9.23.0**. `AISOC_REDIS_BIN` may point to an equivalent
server binary. Different versions need an explicit compatibility review and tests.
This pin is a local reproducibility choice, not approval of this version for
production security or availability requirements.

The launcher preserves Redis's executable launch name (important for distribution
multicall binaries). Process ownership requires its private working directory,
matching executable and recorded process start time; it does not rely on Redis's
rewritten environment or kill unrelated Redis processes.

## Security and memory

- Literal loopback only; the adapter rejects non-loopback plaintext connections.
  Remote operation requires a future TLS configuration and deployment review.
- Default Redis user is disabled. Separate publisher/consumer users have only
  required stream commands and `soc:telemetry:*` keys. A private admin user manages
  the isolated instance and tests; never pass that credential to a worker.
- Service ACLs separate roles, not individual tenants. Go must derive the source
  binding from authenticated connector configuration; per-tenant credentials and
  quotas can further restrict deployment where needed.
- `maxmemory 64mb`, `noeviction`, 32 clients and one logical database. No silent
  queue eviction and no automatic stream trimming. Full memory produces errors;
  S04 applies producer backpressure and durable retry/DLQ policy.
- AOF enabled with `appendfsync everysec`; RDB scheduling disabled. AOF restart
  tests do not establish zero data loss or replicated failover guarantees. Memory
  overhead, AOF rewrite and process RSS can exceed the configured data limit.
- Passwords are generated into private settings and hashed in the ACL file. The
  launcher passes no database credentials to Redis. Never commit `.run/`.

## Adapter contract

`streams.Config` takes a literal loopback address, ACL username and secret password.
It is a service-internal configuration, not an HTTP or user-controlled URI.
Connections use RESP2, bounded timeouts, a maximum of four active connections and
disabled automatic command retries. Ambiguous publication outcomes remain visible
to the caller and PostgreSQL retry/identity handling.

| Method | Responsibility |
|---|---|
| `Key` | Derive one partition from trusted tenant/connector/source identities |
| `Publish` | Validate projected telemetry and XADD an envelope/key/content hash; no trimming |
| `EnsureGroup` | Idempotently create the consumer group at `0`, including older entries |
| `Read` | Read 1–100 messages with 1ms–1s blocking; no implicit acknowledgment |
| `Reclaim` | Bounded XAUTOCLAIM with continuation cursor and explicit deleted-entry IDs |
| `Ack` | Explicit acknowledgment after durable processing or failure disposition |
| `Pending` | Pending count for a group; broader metrics are S10 work |
| `Health` / `Close` | Bounded authenticated PING and connection cleanup |

Keys have the form `soc:telemetry:{sha256(binding)}:0`. The binding hash prevents
delimiter ambiguity and separates sources; it is not a tenant authorization token.
Group/consumer names and message IDs are validated, not arbitrary Redis commands.

Malformed or foreign envelopes return a delivery with its ID and validation error.
They stay pending. Redis 7 can report pending IDs whose payloads were deleted;
the adapter exposes these as `DeletedIDs` instead of silently discarding them.
S04 records gaps and reconciles retained state; source backfill is later work. Pending
ownership alone does not fence database effects; the S02 inbox does that.

Only projected telemetry is implemented here. Finding publication, live workers,
automatic retention, replay/DLQ scheduling, caching and provider connectors remain
later tasks. No claim is made that an adapter alone is a reliable live pipeline.

S09 now provides an opt-in [local IOC enrichment cache](ENRICHMENT_CACHE.md) with
its own `aisoc-cache` ACL role and `soc:cache:ioc:*` keys. It is separate from stream
delivery and does not change core startup. Production retention and live provider
integration remain later gates.

## Verification

```bash
python3 scripts/framework/check_streams.py
python3 scripts/framework/check.py --with-streams
```

The first command uses disposable Redis with temporary ACLs and a random port. It
tests role separation, valid/invalid credentials, explicit ACK, pending reclaim,
missing-payload reporting, poisoned messages, bounds/cancellation and graceful AOF
restart with pending work. The PostgreSQL bridge test intentionally skips there.

The second command supplies both disposable PostgreSQL and Redis. The bridge test
publishes the same durable outbox event twice after a simulated lost receipt, then
models consumer loss after database commit but before ACK. Reclaimed deliveries
must create exactly one sample Go job through the inbox, with all deliveries ACKed
only after successful database admission. Existing framework tests also run.

Receipts: `output/streams/report.json` and `output/backend-framework/report.json`.
No production providers or privileged response actions are used. Abrupt persistence
loss and production failover remain S10 gates. S04 tests modeled stream loss,
stalled TCP, actual OOM, DLQ failure and retained replay (see STREAMING_RECOVERY.md). These tests do not establish EPS, latency SLOs or production durability.

See [implementation tasks](IMPLEMENTATION_TASKS.md),
[PostgreSQL persistence](STREAMING_PERSISTENCE.md),
[Redis XAUTOCLAIM](https://redis.io/docs/latest/commands/xautoclaim/) and
[Redis consumer groups](https://redis.io/docs/latest/commands/xreadgroup/).
