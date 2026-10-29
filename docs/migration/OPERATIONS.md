# Local Go release operations

The release uses its own PostgreSQL cluster and database, separate from Go
development fixtures. The persistent `.run/backend-mode` selects the backend used
by the normal launcher. A value of `go` removes the TypeScript API and its worker
from normal startup; Node remains available for isolated comparisons and recovery.
Without a selector file, `run.sh` defaults to Go. Fresh checkouts still require
[development setup](../DEVELOPMENT.md); private release state is not committed.

## Daily operation

```bash
./run.sh status
./run.sh start
./run.sh logs backend
python3 scripts/runtime/monitor.py
python3 scripts/runtime/backup.py
```

The active Go API retains `127.0.0.1:3002`; the frontend remains on port 8080.
PostgreSQL binds loopback port 55436 and stores `aisoc_go_release` in
`.run/go-runtime/pg`. The API and investigation worker use the non-superuser
`aisoc_app` role. Private settings and the connector encryption key live under
`.run/go-runtime/` with restrictive permissions. Never commit or print them.

`./run.sh stop backend` gracefully stops the API, investigation worker and release
PostgreSQL. Starting it restores the same data and runs only Go's investigation
worker. The development launcher remains separate on ports 3003/55435.

The local deployment preserves the prior authentication mode. Token deployments
retain operator IDs, tenant bindings and credential hashes; browser sessions must
be re-established after switching runtimes. Public deployment still requires an
HTTPS reverse proxy and production token/cookie settings. Operational `/ready` and
`/metrics` endpoints should remain private to loopback monitoring.

## Authentication configuration

The initialized launcher reads `.run/go-runtime/settings.json`; it deliberately
overrides inherited Go auth variables with these private settings. Configure
`auth_mode`, `operators_file`, `environment`, `secure_cookies` and `origins` there.
Use token mode, an absolute credential-file path, production environment, secure
cookies and exact HTTPS origins for a secured deployment behind HTTPS termination.
Do not print or commit this settings file; it also contains database/key material.

The operator file contains `{id, tenant_id, token_hash}` records, with lowercase
SHA-256 hashes of high-entropy tokens. The retained `npm --prefix backend run auth:init`
utility can create a private compatible file and refuses to overwrite existing
credentials. Its output is private. Set the release's `operators_file` to the
created file and restart the backend after changing auth settings/hashes.

Direct Go processes use `AISOC_GO_AUTH_MODE`, `AISOC_GO_OPERATORS_FILE`,
`AISOC_GO_ENV`, `AISOC_GO_SECURE_COOKIES` and `AISOC_GO_APP_ORIGINS`. Node variables
`AUTH_MODE`, `NODE_ENV`, `APP_ORIGINS` and `WORKER_ENABLED` do not configure Go.
The normal launcher always starts the investigation worker. For API-only tests,
use an isolated process/fixture rather than disabling the release worker.

## Updating release binaries

The API and investigation worker use retained binaries under `.run/go-runtime/bin/`.
`run.sh start` does not rebuild source. The verified optimization was promoted on
2026-10-29; earlier binaries are retained in a private `previous-*` subdirectory.

For subsequent updates, build/test in isolation first, verify any migration and
rollback implications, retain the previous binaries, stop browser traffic and
backend writers, install the reviewed binaries, then restart with `run.sh`.
Check `/ready`, frontend `/health`, critical reads and worker progress. Apply new
schema migrations explicitly when required; ordinary API startup does not migrate.
Never rerun initial data import/cutover to upgrade binaries.

Comparison stacks are optional and independently managed:

```bash
python3 scripts/runtime/node-compare.py stop
python3 scripts/framework/dev.py stop
```

Stop separately launched preview frontends in their owning terminals. These
commands preserve comparison data. Only the main 3002/8080 release is running
in the normal configuration; Rust/Python specialist services are optional.

## Monitoring and budgets

`/health` checks the process; `/ready` verifies PostgreSQL and migration checksums.
`/metrics` exposes aggregate response classes, latency buckets, Go heap/goroutines,
pool occupancy/acquisition waits and investigation queue age/counts. Request logs
include request IDs, methods, status and duration, without payloads or credentials.

```bash
python3 scripts/runtime/monitor.py --seconds 600
```

The local observation budget is zero new HTTP 5xx or failed jobs, heap at most
256 MiB, and no active investigation older than 60 seconds. Existing historical
failures are baseline counts, not new failures. The ten-minute isolated soak also
requires p99 below one second, at most 50 active jobs and queue drain within 60
seconds; its workload, results and controlled worker crash are recorded in
`output/backend-performance/soak.json`.

Go processes use `GOMAXPROCS=2` and `GOMEMLIMIT=256MiB`. Optional user-service
definitions in `deploy/systemd/` provide restart policies and a shared two-CPU,
1-GiB ceiling. They are syntax-validated templates, not automatically installed
units. Choose either the native launcher or a supervisor; do not run both managers
against the same release. PostgreSQL must be ready before worker startup.

## Backup and restore

`backup.py` takes a consistent custom-format PostgreSQL dump while the application
is running. It retains private recovery settings/operator hashes with the dump,
restores into a disposable database, validates constraints and checks readiness
using the release API binary. It then drops only that disposable database. The
manifest includes the dump SHA-256, table counts and measured restore duration.

Backups are stored under `.run/backups/`. Keep a verified copy off-host using your
approved encrypted backup storage. A database dump without the matching connector
key is insufficient to recover encrypted credentials. No automatic deletion or
off-host upload is performed by these scripts.

An optional daily user timer is provided in
`deploy/systemd/aisoc-go-backup.{service,timer}`. It runs at 03:00 host local time
with up to 15 minutes of jitter and catches up a missed run when the user manager
starts. It works with either runtime manager and does not start or stop the
application. The database must already be running. The timer is not installed or
enabled automatically. To activate it as the same user who owns the release:

```bash
mkdir -p ~/.config/systemd/user
cp deploy/systemd/aisoc-go-backup.service deploy/systemd/aisoc-go-backup.timer ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now aisoc-go-backup.timer
systemctl --user list-timers aisoc-go-backup.timer
journalctl --user -u aisoc-go-backup.service
```

The user manager must remain running for unattended scheduling. Overlapping
manual/timer backups fail without disturbing the active run. Native launcher
shutdown waits for backup verification to finish. The latest report at
`output/migration/release-backup.json` changes atomically from `running` to
`complete` or `failed`; success requires disposable restore cleanup to finish.
A killed process leaves `running`, never a fresh success. Check timer failures
in the journal; this template does not send external notifications or enforce
backup retention. Per-backup manifests retain previous successful verification.

For an actual PostgreSQL recovery, stop writers first, restore the verified dump
into a new database owned by `aisoc_app`, retain the matching private key, update
the private release URL, and validate `/ready` before reopening traffic. Preserve
the original database until reconciliation is complete. Never restore over the
only copy of acknowledged writes.

## Cutover and rollback

The executable cutover gate checks framework/HTTP/browser tests, audits, migration,
backup/restore, the proxy rehearsal, per-operation latency, proportional memory
and the sustained soak:

```bash
python3 scripts/runtime/release_gate.py
python3 scripts/runtime/cutover.py             # Read-only preflight
python3 scripts/runtime/cutover.py --execute   # Authorized initial switch only
```

Cutover pauses the frontend and Node writer, takes a fresh SQLite backup snapshot,
imports an empty release database, reconciles all 26 legacy tables, starts Go,
changes the frontend target and observes ten minutes of operation. It retains the
original SQLite database, private snapshots and the legacy code. Subsequent Go
writes must never be discarded by restarting Node against that old database.

For an explicitly requested rollback during the seven-day rollback window:

```bash
python3 scripts/runtime/rollback.py           # Describe the operation
python3 scripts/runtime/rollback.py --execute
```

Rollback stops writers, reverse-exports the current PostgreSQL data, restores and
reconciles a **new** SQLite database, then selects Node using that new database.
It preserves acknowledged Go-era writes, source credential hashes, encrypted
connector values converted to the legacy format, versions, audits and job state.
Recovery files are private because legacy SQLite contains plaintext connector
credentials. The old snapshot is never substituted for current data.

If rollback fails before Node starts, the launcher can resume the intact Go copy.
Once Node startup has been attempted, the recovered SQLite copy may itself contain
new writes: the script pauses browser traffic and retains it for repair instead of
silently switching back to an older Go database.

Specialist `jobs` records have no equivalent in the old schema. Reverse export
refuses them rather than silently losing them. Keep Go-only persisted specialist
jobs disabled in the domain database throughout the rollback window. Rust/WASM and
Python foundation checks use disposable databases; ordinary AISOC routes require
neither service. Removing legacy recovery code after the window is a separate,
explicit cleanup, not part of the switch.

The proxy-switch rehearsal validates a write through Go, reverse export and the
same acknowledged write through restored Node. See `output/migration/` for the
release gate, rehearsal, backup, observation and final cutover reports.
