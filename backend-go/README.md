# AISOC Go backend

Active modular Go API and PostgreSQL persistence, with a separate investigation
worker and optional Rust/WASM/Python specialist dispatch. All 97 legacy routes
are implemented for supported workflows. The selected local foundation runs on
API 3003/PostgreSQL 55435 through migration 030; the preserved release remains on
3002/55436 after the 2026-10-29 migration. See [architecture](../docs/ARCHITECTURE.md),
[release evidence](../docs/migration/RELEASE_STATUS.md) and
[contract differences](../docs/adr/003-replacement-contract-decisions.md).

From the repository root, `./run.sh import-demo all`, `showcase`, or `files FILE...`
uses the Go mock-import API with durable checkpoints and deduplication. It requires
the foundation profile. Use `--dry-run` to validate selection first. See
[developer commands](../docs/DEVELOPMENT.md) and [bundle format](../docs/BENCHMARK_DATA_IMPORT.md).
Publication receipts now use a bounded set update with sorted row locks and atomic
lease validation. Telemetry transactions support up to 500 events. See the
[performance gate](../docs/PERFORMANCE_GATE.md) for repeated measurements and limits;
average throughput alone does not establish stable latency or production capacity.

## Structure

- `cmd/api`: HTTP API; `cmd/investigation-worker`: durable local domain phases.
- `cmd/worker`: optional leased specialist jobs; `cmd/plugin-probe`: RPC verification.
- `cmd/migrate`: schema/checksums; `cmd/data-migrate`: import/export/reconciliation.
- `internal/modules`: tenant-scoped domains and transactional repositories.
- `internal/platform`: config/auth/database/jobs/RPC; `internal/transport/httpapi`: HTTP.
- `migrations/`: 30 ordered PostgreSQL migrations in source, applied transactionally.
  Migrations 020–027 add streaming recovery, finding admission, mock investigation/SOAR,
  cache invalidation, metadata-budget counters and worker heartbeat. Foundation
  startup applies all migrations; the separate release remains on 019.

Domain modules cover investigations, detection, intake, response plans/runbooks,
Skills, hunts, connectors, intelligence and dashboard projections. Related writes
and audit history are atomic; supported workflows need no Node fallback.

## Start isolated development

Requirements: Go 1.26.10 (see `go.mod`), PostgreSQL 16 and Python 3.12. Use an
ordinary user; PostgreSQL initdb refuses root. From the repository root:

```bash
python3 scripts/framework/dev.py start --investigation-worker
python3 scripts/framework/dev.py status
python3 scripts/framework/dev.py stop
```

The launcher owns PostgreSQL 55435/database `aisoc_go_dev`, API 3003 and optional
investigation worker under `.run/go-dev/`. It generates private credentials,
uses a non-superuser application role, applies migrations and rejects occupied
ports. Stop preserves data; stop/start rebuilds binaries after source edits.
This local-auth launcher never changes the release.

For a frontend against this API, see [fresh-checkout setup](../docs/DEVELOPMENT.md#fresh-checkout-isolated-development).
New development databases have no legacy demo records.

## Manual configuration

Use the names in [.env.example](.env.example); do not commit real values.
Create a dedicated database with the `aisoc_go_` prefix and a suitable role.
Export configuration explicitly, then from this directory:

```bash
make build
make migrate
make api
```

Run `bin/investigation-worker` separately with the same database/tenant settings.
Set `AISOC_GO_CONNECTOR_KEY` to a retained 32-byte key encoded as 64 hexadecimal
characters before storing connector secrets. API startup does not run migrations.

Token mode uses `AISOC_GO_AUTH_MODE=token` and `AISOC_GO_OPERATORS_FILE`, a private
JSON array of `{id, tenant_id, token_hash}`; hashes are lowercase SHA-256 hex.
Origins, secure cookies, TTL and environment use `AISOC_GO_APP_ORIGINS`,
`AISOC_GO_SECURE_COOKIES`, `AISOC_GO_SESSION_TTL_MS` and `AISOC_GO_ENV`.
Production requires token mode, secure cookies and exact HTTPS origins.

The initialized release launcher translates private settings to these variables;
plain Node `AUTH_MODE`/`WORKER_ENABLED` are not supported Go controls.
See [operations](../docs/migration/OPERATIONS.md).

## Specialist foundation

`contracts/plugins.json` defines `rust.sha256`, `rust.wasm_ascii_upper` and
`python.normalize`. Go validates tenant/job/attempt/plugin/version identity and
size before committing results. RPC is loopback-only, service-authenticated,
limited to five seconds and 64 KiB input/output. Specialists have no database authority.

Wasmi executes an embedded allowlisted transform with fuel, one memory page and
no host imports. Python executes trusted allowlisted code in a bounded child
process with deadline/cancellation cleanup, not arbitrary uploaded code.
Ordinary API workflows work with both specialists disabled.

The optional [Redis Streams sandbox](../docs/REDIS_STREAMS.md) now provides a
bounded telemetry adapter with authenticated consumer groups and explicit ACK.
Run `python3 scripts/framework/check.py --with-streams` to verify the PostgreSQL
outbox/inbox bridge. It is not connected to live intake or required by core startup.

Python includes FastAPI health/readiness and authenticated capability endpoints
with gRPC execution in the same independent process. Enable with
`python3 scripts/framework/dev.py start --investigation-worker --python-worker`
after stopping development services. See the
[Python guide](../services/python-worker/README.md) for configuration and limits.

For isolated manual specialist testing, set matching `AISOC_WORKER_TOKEN` and
worker addresses, then run the services and `make worker`/`make probe`.
Keep optional addresses/token unset for a core-only manual process.
During legacy rollback retention, do not enable Go-only persisted specialist jobs
in the release database. The framework uses disposable databases instead.

## Verification

Install frontend/legacy fixture dependencies, Rust 1.88+ and the Python worker
venv as described in [development](../docs/DEVELOPMENT.md#verification). Then:

```bash
python3 scripts/framework/check.py
```

This runs Go race tests/vet, shared HTTP/auth suites, transaction/concurrency
checks, persistence, worker SIGKILL recovery, and bounded Rust/Python tests.
Database integration tests skip without `AISOC_GO_TEST_DATABASE_URL`; the framework
supplies an isolated target and serializes packages because of failure triggers.
`make test` uses the same package serialization. Full route coverage and
remaining browser/production limits are in [testing](../docs/TESTING.md).

Generated worker stubs are committed; regenerate after proto changes with
`scripts/framework/generate.sh`. Never point fixture mutation tests at 3002/8080.

## Performance and operations

The investigation hot paths batch SQL commands within existing transactions,
use typed detail responses and resolve connector aliases lazily. Existing locks,
tenant predicates, audit rollback and durable commits remain intact. Mutable
business state is not memoized across requests.

The final small-fixture median improved from 236.6 to 273.1 requests/s against a
fresh pre-edit Go baseline; update p99 changed from 86.0 to 73.9 ms and create p99
from 109.7 to 80.5 ms. The earlier approximately 600 ms spikes were already absent
in that pre-edit baseline. See [performance evidence](../docs/migration/PERFORMANCE.md)
for controls, absolute Node/Go results, CPU costs and limitations.

`run.sh` manages the initialized release on 3002/8080 with PostgreSQL 55436.
Its verified binaries are separate from development builds. Backups, keys,
post-write rollback and explicit binary promotion are documented in
[operations](../docs/migration/OPERATIONS.md). Build/cache cleanup must preserve
private state and recovery artifacts.

Real providers, external queries, enterprise identity, remote TLS workers and
arbitrary third-party plugin hosting are [future work](../docs/ROADMAP.md).
