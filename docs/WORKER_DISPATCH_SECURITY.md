# Durable worker dispatch and optional mTLS

Implemented on main, 2026-10-31. This is local-tested foundation code, not production
activation. RisingWave is independent. Go owns orchestration; Python performs
bounded inference; Rust remains an optional bounded specialist.

```mermaid
sequenceDiagram
  participant Domain as Go domain transaction
  participant DB as PostgreSQL / sqlc + pgx
  participant Dispatch as Go bounded dispatcher
  participant Python as Python gRPC + FastAPI
  Domain->>DB: Commit job + domain state together
  Dispatch->>DB: Lock eligible tenant with oldest dispatch time
  Dispatch->>DB: Check running cap; claim job and commit lease/turn
  Dispatch->>Python: Typed RPC with bearer + optional mTLS
  Python-->>Dispatch: Tenant/job/attempt-bound result
  Dispatch->>DB: Complete only while matching lease is valid
```

## PostgreSQL and scheduling

`backend-go/sqlc.yaml` uses the actual migrations and queries under
`internal/platform/jobs/queries`; generated pgx/v5 code lives in `jobs/jobsql`.
`jobs.Store` retains domain-friendly signatures. `Enqueue` takes the caller's
transaction; completion, retry and cancellation retain tenant/attempt fencing.
Other repositories still use parameterized pgx. Redis still uses go-redis; there
is no generic transaction spanning PostgreSQL and Redis.

Migration 031 creates `job_dispatch_tenants`, backfills existing jobs, and installs
an insert trigger covering all job writers. It adds a partial running-lease index.
Claiming locks a tenant row with `SKIP LOCKED`, then rechecks capacity and claims a
job in the same transaction. Last-dispatch time is updated only on a successful
claim. External RPCs run after commit. Defaults:

| Configuration | Default | Allowed |
|---|---:|---|
| `AISOC_GO_WORKER_CONCURRENCY` | 2 | 1..4 slots per process |
| `AISOC_GO_TENANT_WORKER_LIMIT` | 1 | 1..4 unexpired running jobs per tenant |

Use the same tenant limit across all dispatchers sharing a database. Do not mix
pre-031 workers with the new dispatcher when enforcing caps; old workers do not
participate in tenant admission locking. Running counts
include all plugins, so a tenant cannot evade the cap by choosing another plugin.
The worker claims only plugins it can execute. Delayed retries do not block other
eligible tenants. Shutdown cancels RPC contexts; remaining leases recover after
expiry. No unbounded in-memory job queue is introduced.

This is equal-turn fairness among eligible tenants in the specialist `jobs` queue,
not weighted priority scheduling, hard resource isolation, or a fairness guarantee
for the separate `investigation_jobs` phase processor. Locks, database availability
and RPC duration still affect observed latency. Python's four RPC slots include
health calls; choose budgets conservatively when increasing process counts.

Rollback: stop upgraded workers before running old binaries, which ignore fairness
and caps. Migration 031 is additive and may remain installed; no table drop or demo
cleanup is required. Rebuild/migrate before restarting through the launcher.

## Optional Go/Python mTLS

Plaintext remains restricted to literal loopback. Python gRPC may use a specific
remote bind IP only with complete TLS configuration. HTTP management and the Rust
plaintext worker remain loopback-only. Remote hosting is not activated here.

| Process | Environment variables |
|---|---|
| Both | `AISOC_PYTHON_ADDR`, `AISOC_WORKER_TOKEN`, `AISOC_PYTHON_TLS_CA_FILE`, `AISOC_PYTHON_TLS_SERVER_NAME` |
| Go | `AISOC_GO_WORKER_TLS_CERT_FILE`, `AISOC_GO_WORKER_TLS_KEY_FILE` |
| Python | `AISOC_PYTHON_TLS_CERT_FILE`, `AISOC_PYTHON_TLS_KEY_FILE`, `AISOC_PYTHON_TLS_CLIENT_NAME` |

Use a dedicated worker CA. Go's certificate requires clientAuth and a DNS SAN equal
to `AISOC_PYTHON_TLS_CLIENT_NAME`. Python's certificate requires serverAuth, the SAN
in `AISOC_PYTHON_TLS_SERVER_NAME`, and clientAuth for its own authenticated readiness
probe. The two names must differ. The server's self-probe identity is authorized
only for unary health checks, not execution. Go verifies the configured server
name and CA; Python requires a trusted client certificate with the expected SAN.
Bearer checks and tenant/task/attempt validation remain mandatory under TLS.

Keep private keys outside Git with restricted file permissions. Install replacement
certificates atomically and restart the affected Go/Python processes to rotate;
there is no hot reload, automated PKI, revocation distribution or external secret
manager in this increment. Source API key rotation/revocation remains the existing
transactional intake mechanism. Do not give provider credentials to Python.

The existing foundation launcher keeps its controlled local settings. For mTLS use
explicit process environments or a supervisor that passes these variables; do not
assume the launcher's environment allowlist forwards them. No TLS credentials are
stored in demo JSON. Missing files, invalid CA/key pairs or partial configuration
fail closed, never silently downgrade to plaintext.

## Verification

- `python3 scripts/framework/install_sqlc.py`: checksum-pinned Linux amd64 v1.31.1;
  other platforms may install that version and set `make SQLC=/absolute/path`.
- From `backend-go`: `make sqlc-check`, `go test -race -p 1 ./...`, `go vet ./...`.
- `python3 scripts/framework/check_jobs.py`: disposable PostgreSQL, migration,
  rollback, concurrent claims, fairness, cap, retry/cancel and stale lease tests.
- `python3 scripts/framework/check.py --with-streams`: full disposable framework,
  including actual Go-to-Python execution/investigation over temporary mTLS certs.
- Python `test_tls.py`: valid peer, wrong identity, missing certificate, missing
  bearer, partial config, and self-probe execution rejection. Go adds wrong server
  name and untrusted CA rejection. Test certificates are temporary and never deployable.

References: [sqlc configuration](https://docs.sqlc.dev/en/latest/reference/config.html),
[pinned sqlc release](https://github.com/sqlc-dev/sqlc/releases/tag/v1.31.1).
