# Local retention and recovery across Detect to Build

Open **Build → Retention & recovery** at `/build/retention`. The workspace provides tenant-scoped policies, bounded eligibility previews, immutable record snapshots, audit receipts and recovery inspection. Integrations remain local/mock.

## Scope and safety boundary

Archive snapshots preserve source rows and links. They do **not** hide or delete cases, evidence, guidance, imports or replay receipts, free import/profile quota slots, reactivate archived guidance, or change approval/response state. Snapshotting can increase storage. The only cleanup operation in this release removes the signed-in operator's **read notifications**, after an identical verified snapshot exists. That notification can be restored explicitly.

| Category | Eligible state before age/policy checks | Source treatment |
|---|---|---|
| Detect | Disabled rule | Preserve rule, versions and alert references |
| Investigate | Resolved/closed case, no queued/running/failed investigation job or unexecuted case-linked response | Preserve case and all evidence/dependencies |
| Respond | Executed sandbox action | Preserve action, receipt and policy/approval history |
| Hunt | Completed hunt | Preserve runs, evidence, promotions and snapshots |
| Threat Intel | Archived report | Preserve report, indicators and import tombstones |
| Skills | Archived/learning-archived guidance | Preserve guidance/materials/version history |
| Memory | Archived context | Preserve context and immutable usage references |
| Build integrations | Archived profile | Preserve configuration/revisions/replay state |
| Build imports | Nonempty batch with every item accepted | Preserve manifest, per-case checkpoints and replay keys; accepted intake does not imply downstream investigation completion |
| Notifications | Current recipient's read notice | Explicit snapshot → cleanup → optional restore |

Use each owning workspace's existing guarded lifecycle to disable/archive a resource before snapshotting it here. Active/unread/unresolved records and records younger than the configured age show a protection reason. This release does not implement whole-domain purging or legal-hold management; domain rows remain retained.

## Operator workflow

1. Choose a category. Archive policies start **disabled**, with a 30-day minimum age. Set 1–3650 days and supply a 10–1000-byte reason; save uses the displayed policy version. Enabling a policy schedules nothing.
2. Preview a record. Its timestamp, protection reason, byte size and SHA-256 bind the action to the saved revision. Age uses the last update/read time, not merely creation time. Source and archive lists each page by 25.
3. Enter a reason, explicitly confirm the selected record and choose **Archive snapshot**. A changed policy/source or protected record returns 409; refresh before retrying.
4. For a read notice, **Clean up read notification** requires a matching archived copy. Other record categories have no delete operation. Audit and archive rows remain.
5. Inspect the saved archive. The server verifies its digest before returning contents. **Restore read notification** restores only that recipient's notice; conflicts with a changed existing notice fail rather than overwriting it.

Policies and writes require the existing authenticated **proposer** role. All queries bind the authenticated tenant; notification reads, snapshots and restoration additionally bind the recipient. No client-supplied role, tenant or filesystem path is accepted. Ownership and independent approval permissions are unchanged.

## Consistency, limits and APIs

The application serializes retention operations per tenant with a transaction advisory lock. Notification cleanup also locks the live notice and conditionally deletes its exact JSON snapshot. Policy, snapshot, cleanup/restore and audit writes are transactional. Archive and restore replay do not duplicate records/audit. Repeated cleanup returns a retained matching archive receipt when the source notice is absent. Policy saves use compare-and-swap; retry after a lost response by refreshing the policy version.

Domain archive copies represent the source row at the read instant. Source rows are not frozen against future edits/reopening. Most snapshots contain the parent row only; batch snapshots also include ordered items. These are **not standalone recovery bundles for linked entities**. A consistent PostgreSQL backup plus referenced immutable payload files provides full recovery.

Local limits: 25 rows per page, 1,000 retained snapshots per tenant and 2 MiB per snapshot. Snapshot history is retained without automatic expiry. Large catalogs, tenant-specific quotas, immutable off-host storage and domain purge workflows remain future work. Notification cleanup reduces the live notice list, not total archival storage.

| API | Contract |
|---|---|
| `GET /api/v1/build/retention?kind=notification&offset=0` | Policy, kinds, source preview, archive receipts, page state; offset 0–1,000,000 |
| `POST /api/v1/build/retention/policy` | `kind`, `enabled`, `age_days`, `expected_version`, `reason` |
| `POST /api/v1/build/retention/actions` | `kind`, `id`, `digest`, `policy_version`, `operation=archive|cleanup|restore`, `confirm=true`, `reason` |
| `GET /api/v1/build/retention/archives/:id` | Verified snapshot; recipient restrictions for notices |

For archive/cleanup, `id` is the source preview ID. For restore, it is the archive receipt ID. Response IDs encode connector, source and action ID together. Recovery does not require the archive policy to remain enabled. Invalid inputs return 400; missing/foreign resources 404; stale/protected/integrity/quota conflicts 409. The shared role gate returns 403 for unauthorized mutations.

## Backup and restore

Existing tools are reused:

```bash
python3 scripts/runtime/backup.py --state .run/go-dev
python3 scripts/framework/archive_restore_check.py
```

The backup tool writes private recovery material under `.run/backups`, restores PostgreSQL into a disposable database with errors fatal, validates constraints, copies and verifies referenced payload files, verifies retention snapshot digests in bounded pages, and checks the restored API's readiness. It now reports `retention_snapshots_verified`. Backup success is recorded only after verification; a failed attempt replaces the latest success status with failure. Recovery material may contain credentials and is not a public downloadable frontend artifact.

The two-clone rehearsal ages only cloned telemetry, creates temporary archive files, copies them into a backup, restores a second database, removes the original temporary files and verifies restored payload resolution. It also restores a synthetic retention policy, snapshot and audit record and rejects both corrupted archive payloads and corrupted retention snapshots. Source demo data is never aged or replaced by this test. Existing encrypted-backup tests cover local encryption and tamper rejection; off-host delivery and production failover remain unverified.

## Implementation and migration

- `backend-go/migrations/052_retention_recovery.sql`: additive policies, snapshots and cross-domain candidate view.
- `backend-go/internal/modules/retention/retention.go`: policy/version checks, digest validation, bounded previews, audit and notification recovery.
- `backend-go/internal/modules/investigations/queries/retention.sql`: parameterized sqlc queries. Notification restoration lists columns explicitly because sqlc incorrectly expands a wildcard over `jsonb_populate_record`.
- `backend-go/internal/transport/httpapi/retention.go` and `platform/auth/roles.go`: routes and proposer gate.
- `frontend/src/RetentionWorkspace.jsx`, `navigation.js`, `main.jsx`: Build workspace, navigation and breadcrumbs through existing route metadata.
- `scripts/runtime/archive_backup.py`, `backup.py`, `scripts/framework/archive_restore_check.py`: verified backup/recovery.

Apply migration052 through the standard Go runner. Rollback deploys the prior app while retaining the additive tables/view and audit history. Never drop snapshots as an application rollback. No new infrastructure or automatic maintenance worker is added.

## Regression commands

```bash
python3 scripts/framework/acceptance.py --runs 1
npm --prefix frontend run lint
npm --prefix frontend run build
node --test tests/frontend/*.test.mjs
make -C backend-go sqlc-check
python3 -m unittest discover -s scripts/runtime -p 'test_*backup.py'
```

The Go database suite covers disabled policies, unread/active protection, stale policy/source conflicts, recipient/tenant isolation, archive/cleanup/restore replay, corruption rejection and preservation of source cases. Authenticated HTTP acceptance verifies role gates and all category previews. `scripts/framework/retention-browser.js` covers policy configuration, confirmation, archive/cleanup/restore, restored policy state, desktop and 390px mobile. It requires an aged synthetic `retention-browser-*` read notice owned by the local operator; it uses no browser credentials. The test retains that restored notice, archive and audit receipt as local synthetic fixtures.

## Verified local results — 2026-11-01

- Full disposable Detect-to-Build acceptance passed in **183.26 seconds** (one run); `output/platform-acceptance/report.json` records base commit `ad185b1` plus the uncommitted implementation. Authenticated retention API report: `output/backend-framework/retention-recovery.json`.
- The initial database/browser run exposed sqlc's incorrect wildcard expansion in notification restore. Explicit columns fixed it; archive/cleanup/restore subsequently passed in both API and browser tests.
- Final additional Go race tests in a fresh disposable database passed for retention, HTTP and auth. These cover audit-failure rollback and rejection of corrupted archive replay, added after the full acceptance run.
- Local backup verified **76 tables**, one retention snapshot and restored API readiness; backup took approximately **2.95s**, verification/restore **19.59s**. This is a local sample, not a production RTO/SLO. Report: `output/migration/release-backup.json`.
- Two-clone archive rehearsal recovered **100 events** from one copied payload file after deleting the original temporary file. Retention policy/snapshot/audit survived restore; archive-file and snapshot corruption were rejected. Report: `output/backend-framework/archive-restore.json`. Source demo data was unchanged.
- **Seven** backup unit tests passed, including bounded snapshot verification, failed/overlapping backup status and encryption tamper rejection. The encryption test initially required retry outside the restricted sandbox because GPG could not start its temporary agent there.
- Frontend lint/build and **15 frontend test files** passed. The existing Vite bundle warning remains (main bundle approximately 1,045 KB before gzip). sqlc drift and whitespace checks passed.
- Credential-free browser regression passed desktop/390px mobile archive→cleanup→restore and restored the disabled policy, with zero page errors or document overflow. The restored synthetic notice, archive and audit history remain as local demo fixtures. Screenshots: `output/playwright/retention-desktop.png` and `retention-mobile.png`.

Local Go service is refreshed with migration052. No production credentials, live integrations, off-host delivery or destructive domain purge was enabled.

## Combined release gate

[The browser release gate](BROWSER_RELEASE_GATE.md) now combines fresh JSON browser workflows, this API acceptance suite and archive-backed recovery in one disposable run. Standalone commands remain supported.
