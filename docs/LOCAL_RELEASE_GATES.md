# Configurable local delivery and release gates

The user selected **local-only, configurable integrations/inference, and mock
responses**. These are the active boundaries. No production hosting, remote
notifications, live identity revocation or paid model invocation is enabled.
The main development frontend binds to `127.0.0.1:8080`; public hosting requires
the separate authenticated HTTPS deployment configuration.

Migration 030 adds derived hot-payload/identity counters with transactional insert,
update, delete and rollback accounting. It preserves existing rows and all source
receipts. Workers now use bounded batches of up to 500; Redis capacity limits, fenced
publication receipts and PostgreSQL commit-before-ACK are unchanged. For rollback,
restore the verified pre-migration backup and its matching binaries; do not delete
migration history or edit an applied migration checksum.

The 500-event limit and set-based receipt update require no new schema migration.
Three consecutive runs verify average throughput above 1,000 EPS; the stricter
latency gate still fails. See [current measurements and tuning](PERFORMANCE_GATE.md).

Performance probes retain `fsync=on` and `synchronous_commit=on` and record their
actual settings. `--pg-commit-delay-us` optionally tests a bounded group-commit
delay in disposable PostgreSQL only. It is not enabled in the running foundation
without evidence of benefit. PostgreSQL documents the latency/throughput tradeoff
in its [WAL configuration reference](https://www.postgresql.org/docs/16/runtime-config-wal.html).

## Integration contracts

`backend-go/cmd/integration-probe` reads private JSON and writes a new private
result file. It never commits a source cursor or imports unreviewed source data.
Examples in `deploy/examples/` contain placeholders, not working credentials.

```bash
cd backend-go
go build -o bin/integration-probe ./cmd/integration-probe
bin/integration-probe --config /private/qradar.json --saved-search 42 --out /private/search.json
bin/integration-probe --config /private/qradar.json --search-id SEARCH_ID --out /private/evidence.json
bin/integration-probe --provider sentinel --config /private/sentinel.json --out /private/incidents.json
```

Ariel accepts only allowlisted saved searches, never model-supplied AQL. Configure
the saved search with the correct domain, time window and a `domainid` projection.
Results are capped at 100; a full page explicitly requires query refinement and
must not be treated as complete evidence. A failed submission is ambiguous and
is not automatically retried. This follows the documented asynchronous
[Ariel submission](https://ibmsecuritydocs.github.io/qradar_api_25.0/25.0--ariel-searches-POST.html)
and [result retrieval](https://ibmsecuritydocs.github.io/qradar_api_25.0/25.0--ariel-searches-search_id-results-GET.html)
contracts; installed-version validation is still required.

Sentinel reads one page of incidents using a separately refreshed ARM access-token
file. Continuations must match the configured origin, workspace and API version;
returned incident IDs must belong to that workspace. Failed calls retain the old
cursor; the caller schedules bounded retries. Tokens are not refreshed by LLMs.
The [Microsoft incident-list contract](https://learn.microsoft.com/en-us/rest/api/securityinsights/incidents/list?view=rest-securityinsights-2025-09-01)
defines the versioned path and pagination. These incident records are not claimed
to be raw authentication telemetry. Mapping/admission must preserve provenance.

SOAR write-back continues through the existing durable mock note reconciliation,
including version conflict review, analyst-field preservation and idempotent replay.
A live note writer is not activated or certified. Its installed API conflict and
duplicate-reconciliation semantics must be checked before replacing the mock adapter.

## Inference configuration and evaluation

Copy the inference example to `.run/go-dev/inference.json`, set mode 0600 and restart
the foundation with `./run.sh stop backend` / `./run.sh start backend`. Only Python
receives this model endpoint/credential reference; it receives no database or response
credentials. Configuration enables `model-v1` RPC capability; durable demo jobs stay
explicitly mock-mode. Go still validates citations and requires human review.

The local evaluation covers valid verdict contracts, hallucinated citations,
contradictory citations, omitted missing evidence, action injection, duplicate JSON
fields, malformed and oversized output. It tests enforcement, not real-model
precision/recall or false-negative rate. Real model quality requires labelled cases
and the configured model service; no quality score is fabricated from mock output.

## Archive-backed recovery

`scripts/runtime/backup.py` now enumerates archive references from the **restored
dump**, copies only referenced files within the configured private archive root,
verifies bundle hashes, remaps disposable restore references to the copies, and
verifies all archived payloads. It records original paths and compressed-file hashes
in the backup manifest. Encryption rechecks both dump and archive hashes.

The original dump retains original archive paths: when recovering elsewhere, restore
files to their recorded paths or explicitly remap them from the manifest before
starting the API. Never start from a database-only dump with missing payload files.
`stream-archive --verify-database` verifies archive contents against database identity
and hash receipts without changing the database.

```bash
python3 scripts/framework/archive_restore_check.py
python3 scripts/runtime/backup.py --state .run/go-dev
python3 -m unittest discover -s scripts/runtime -p 'test_*.py'
```

The local rehearsal uses two disposable database clones, archives 100 eligible events,
restores copied files after removing the originals, and rejects corruption. It never
ages or edits showcase data. Existing hot/identity limits remain enforced; this is
not unlimited retention or an off-host/disaster-recovery certification.

## Operations and responses

`monitor.py --state .run/go-dev --api-port 3003` observes the foundation. Supplying
`--webhook-config /private/alerts.json` explicitly enables a configured HTTPS alert
transport. No destination is supplied locally. Tests use a loopback HTTPS server,
verify certificate trust, reject untrusted certificates and send only bounded
component/reason fields. Public TLS and replicated host failover remain deployment
gates; prepared systemd/NGINX configuration is not an activated production service.
The monitor includes free disk space; `--min-free-gib` defaults provisionally to
5 GiB and must be sized for actual retention, WAL growth and outage backlogs.

Session revocation remains mock-only, with approval expiry, audit rollback,
idempotency, quotas and kill-switch tests. Revoked sessions cannot be resurrected;
reauthentication creates a new session. No live IAM credential is configured.
