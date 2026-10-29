# Production preparation — not activated

The selected deployment remains local-only. No public listener, off-host upload,
external alert or privileged provider action is enabled by these templates.

## Service ownership

Existing `deploy/systemd/aisoc-go-*` units supervise the release API, worker and
PostgreSQL, with backup/restore verification and a timer. The new
`aisoc-foundation.service` supervises the isolated JSON foundation only. Install
it as a user service after adjusting `/opt/aisoc` and ensuring the user's PATH can
resolve Go, Redis and Python dependencies. Do not run both manual foundation
lifecycle commands and its supervisor. Stop the supervisor first for maintenance.
Frontend hosting and public TLS are separate deployment decisions.

## HTTPS and access controls

Use `nginx.conf.example` only after replacing the domain, certificate and key
paths. Keep Go bound to loopback behind the proxy. Set `AISOC_GO_ENV=production`,
`AISOC_GO_AUTH_MODE=token`, secure cookies, exact HTTPS origins and a private
operator credential file. Provision each operator's tenant and explicit stream
grants; disable both mock-import and sandbox-response permissions. Configuration
rejects those sandbox permissions in production. SSO, tenant provisioning and
managed key rotation still need environment-specific implementation.

## Encrypted off-host backup

The existing `scripts/runtime/backup.py` creates and restores a private backup,
checks constraints and verifies API readiness. Use its verified backup directory
as input to `scripts/runtime/encrypt_backup.py`. Supply a trusted recipient
fingerprint already imported into a dedicated GPG keyring. It creates only an
encrypted archive and SHA-256 manifest in the chosen destination. Select an
off-host mounted backup destination, or transfer the encrypted artifact using
your organization's authenticated backup transport. No destination is assumed.
An encryption/upload receipt is not a restore test: test decryption and restore
in a separate environment, document RPO/RTO and alert on backup age/failure.

## Alerts and failover

The scoped operations API reports backlog, pending age, failed work, replay gaps
and worker heartbeat. Scrape it with a dedicated scoped token and forward only
bounded metrics, never evidence payloads, to your monitoring service. Suggested
initial alerts: missing heartbeat >30 seconds; pending age >15 seconds; nonzero
DLQ; backup verification failure; stale backup >24 hours; disk >80%. Tune from
measured workload. External destinations and credentials remain unset.

Existing tests cover worker crash, transport loss/replay, stalled TCP and memory
backpressure. Replicated failover, power loss and network partitions across real
hosts require a deployment-specific rehearsal. The 1,000 EPS target remains a
measured release gate, not an assertion made by configuration.
