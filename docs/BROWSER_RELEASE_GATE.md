# Repeatable local browser release gate

Run from the repository root:

```bash
npm --prefix frontend ci
python3 scripts/framework/release_gate.py --chromium-executable /opt/google/chrome/chrome
```

Use the path to an installed Chrome/Chromium on your host. Playwright is pinned as a frontend development dependency; the gate never downloads a browser. It needs the same local PostgreSQL, Redis, Go, Rust and Python dependencies as `acceptance.py`, plus permission to launch Chromium and bind loopback ports. It does not use the active frontend/backend, demo database, stored operator credentials or retained showcase fixtures.

## Single combined result

Each invocation retains `runner.log`, `framework.log`, stage JSON and `output/release-gate/<run-id>/report.json`; `output/release-gate/latest.json` points to the latest attempted run. Success requires all five stages:

| Stage | Evidence |
|---|---|
| Frontend | Browser launch preflight, lint, production build and frontend regression tests |
| API | Existing full disposable Detect-to-Build acceptance, Go race/vet, auth/tenant checks, Python/Rust, gRPC, Redis/replay and workflow tests |
| Browser | Real JSON upload/import, case navigation, independent Memory ownership/approval, notification read/link, retention archive/cleanup/restore, authenticated foreign-tenant denial, four critical workflow stages, phishing import/review/receipt visibility, durable Hunt retry/cancellation/lost-response replay and desktop/mobile route sweep |
| Identity | Separate mock OIDC provider and API, trusted mapping, independent approval, tenant isolation, logout-all, downgrade/disablement and malformed mapping denial |
| Backup | Two database clones, matching table fingerprints, restored archive payload resolution after original temporary files are removed, retained snapshot verification and corruption rejection |

Reports must explicitly pass in `local/mock` mode and carry the same run ID. Browser completion requires every named workflow stage, all core area routes at both widths, at least 60 distinct route/width checks, and no unexpected page/API errors or external application requests. A missing/stale report, nonzero subprocess result or incomplete backup proof fails the gate. Existing reports cannot satisfy a new run. Reports without the phishing API assertions and eleventh browser workflow cannot satisfy the current contract.

The wrapper serializes release runs. The underlying framework runner also uses a shared lock so standalone checks cannot overwrite a running framework's reports. Graceful timeout/interruption asks the harness to unwind owned services; abrupt host termination or SIGKILL can still require ordinary orphan-process cleanup. The combined result stays failed until all stages finish.

## Fresh fixtures and real browser actions

The disposable cluster is initialized anew. Existing API acceptance produces connected Detect, Investigate, Respond, Hunt and Threat Intel records. The browser extension then generates run-specific JSON files under `fixtures/`:

- `login.json`: synthetic login observations plus IAM/MFA/EDR context for a new isolated Build profile.
- `phishing.json`: four linked synthetic email observations for browser upload and explicit mock-note review. Phishing response and Skills/Memory derivation run through the API gate; the browser inspects the resulting receipt and transcript snapshots.
- `inputs.json`: new pending Skill/Memory inputs and the aged synthetic read-notification specification.
- `telemetry.json`: one normal authentication observation with no investigation finding, used for archived-payload recovery.
- `workflows.json`: fresh reviewed source cases, pending outcome-derived Skill/Memory, a Memory hunt and a disabled local rule with three source alerts. These are setup fixtures; tested mutations use the browser.
- `manifest.json`: durable Hunt retry/cancellation fixtures plus this run's resource IDs, scope and temporary loopback frontend origin. No operator tokens, database URLs or session cookies are retained.

Build imports through the real React/Chakra controls and Go API. The durable Hunt test deliberately drops one already-accepted enqueue response at the browser fetch boundary to verify lost-response replay; it does not fabricate a server result. Explicit confirmation precedes import, approval, cleanup and restore. Separate test-only browser sessions verify that the author cannot self-approve/claim independent review, a configured reviewer can claim/approve, and another tenant cannot retrieve case/Skill/inbox/archive data. Test credentials are accepted only by this runner's disposable API; no real operator credentials are loaded.

The route sweep derives its workspace routes from `frontend/src/navigation.js` and adds fresh detail pages. It checks headings, error states, domain API failures and document overflow at 1440px and 390px. Focused workflow screenshots and selected route screenshots are saved under `screenshots/`. It is a selected interaction gate plus a broad route/layout sweep, **not** an assertion that every control on every screen has browser mutation coverage. Connected response execution/replay, Skill lifecycle, Memory/Hunt promotion and detection feedback now also have browser stages. Their broader fault, concurrency and authorization negatives remain covered by the API stage.

The disposable API allowlists the exact temporary frontend origin; application origin and CSRF checks stay enabled. Browser contexts block requests outside that origin. No test email, webhook, model-provider or containment service is contacted. Chromium background networking is disabled by Playwright's launch defaults; this is an application-request restriction, not a host-level network firewall. Session traces are not recorded.

## Critical workflow stages

The combined report requires these four additional stages and their explicit evidence flags; an older six-stage browser report cannot pass the expanded gate.

| Stage | Browser actions and persisted assertions |
|---|---|
| Respond approvals/replay | Proposer saves evidence-backed mock proposal; self-approval disabled; independent reviewer approves; separate executor sees kill-switch denial, previews and explicitly executes. Reload shows one action. The exact successful UI execution request is repeated through the executor's authenticated session and must return the same note/receipt with `replayed=true` and zero external calls. Dedicated scope returns to stopped. SQL deltas require one note and one execution audit despite replay. |
| Skills lifecycle | Author cannot approve their draft; reviewer publishes; author stages edits while published content remains unchanged. An analyst source-outcome change blocks publication. Independent reapproval and explicit staged publication release the edits; archive persists after reload and disables editing. |
| Memory → Hunt → Investigate | Independent reviewer approves outcome-derived Memory. Local search captures approved provenance; source-outcome change excludes Memory from a new run. Selecting the old run preserves its immutable context. Explicit promotion keeps that snapshot and creates an investigation with unknown determination. |
| Investigate → Detect | Analyst labels false/true positives through case review with explicit confirmation, without changing case determinations. The rule deep link generates suggestions, validates and replays against three alerts. Apply remains blocked without replay; confirmation changes one disabled local rule version and leaves provider sync disabled. SQL requires exactly one application audit. |

No writes are intercepted. API reads assert saved state; response transport replay is a session HTTP request, not a second click on a completed action. Setup creates records through the disposable API. Source-outcome changes and tested approvals/publications/promotions/labels/application run through rendered controls. This does not exercise every possible failure or certify a real provider/model.

## Backup verification on the same dataset

The backup stage dumps the disposable API dataset, restores a first clone, and ages only its synthetic normal-telemetry record. The existing Go archive tool writes a verified compressed payload file. A second dump/restore is compared against the first clone using per-table row counts and row-content fingerprints. File references are rebound only inside the second clone, using the existing archive backup helper.

The test deletes the original temporary archive file and verifies restored resolution from the copied file. It verifies all retained snapshot digests and separately corrupts the copied archive and a retained snapshot to prove both checks reject damage. It never corrupts or replaces the source dataset or live demo data. Temporary dumps, credentials, archive files and databases are removed by the framework lifecycle; durable output contains reports, synthetic inputs and screenshots.

This complements `scripts/runtime/backup.py` and `archive_restore_check.py`. It does not certify off-host backups, production RTO/RPO, real-model quality, live connector compatibility or production throughput.

## Mobile regression found by this gate

The fresh imported Threat Intel report exposed horizontal overflow at 390px: the provenance hash widened the grid track. The report now uses a shrinkable mobile grid/metadata panel and explicitly wraps the SHA-256 text. The detail route remains in the responsive sweep, with screenshots retained.

## Implementation and maintenance

- `scripts/framework/release_gate.py`: orchestration, run identity, timeout handling and aggregate validation.
- `scripts/framework/check.py --browser-release-id <id>`: internal opt-in hook; requires `--with-streams --platform-acceptance` and a wrapper-created run directory.
- `scripts/framework/release_checks.py`: fresh fixture generation and loopback Vite preview lifecycle.
- `scripts/release/browser.mjs`: plain Playwright runner using the pinned dependency and current navigation metadata.
- `scripts/framework/release_workflow_fixtures.py`: independent local source/guidance/hunt/alert setup.
- `scripts/release/workflows.mjs`: critical browser workflows and authenticated execution replay.
- `scripts/framework/release_backup.py`: isolated dataset/payload restore proof.
- `frontend/src/ThreatIntelWorkspace.jsx`: mobile provenance overflow correction.
- `scripts/framework/test_release_gate.py`: rejection of stale, malformed, incomplete and wrong-mode evidence.

Normal `acceptance.py` behavior remains available without a browser. No application schema or runtime deployment change is introduced. To roll back this gate, remove its optional hook, scripts and development dependency; retain the existing API acceptance and backup tools. The main demo stays on its existing ports throughout a run.

```bash
python3 -m unittest discover -s scripts/framework -p 'test_release_gate.py'
python3 -m unittest discover -s scripts/framework -p 'test_acceptance.py'
```

## Original six-stage local result — 2026-11-01

Run `08cef8c303864d5e9df88b8e4ece8181` passed in 253.49 seconds using Chrome 145.0.7632.159. It passed all six browser stages and 72 route/viewport checks (36 routes at 1440px and 390px), with no unexpected page/API errors or external application requests. Frontend lint/build and all 33 frontend regression tests passed, as did the full API/framework suite.

Recovery matched all 76 public-table fingerprints, verified one copied telemetry archive after removing its original temporary file, verified two retention snapshots, and rejected both archive and snapshot corruption. The source database was not modified by recovery. Four release-report validation tests and two existing acceptance-report tests also passed.

Earlier attempts correctly failed on fixture setup (Skill creation status and browser origin configuration), mobile Threat Intel overflow, and a disposable clone name that violated the Go database prefix guard. These issues were corrected before the successful combined result; failed runs remain failed in their own output directories. Reports and screenshots are local generated artifacts, not checked-in fixtures or production certification.

A second fresh run, `55d792f7e8374f16a3b33d498b37cd38`, also passed in 267.92 seconds with 72 route/viewport checks and the same 76-table, one-archive, two-snapshot recovery proof. Both runs generated independent IDs and fixtures and completed owned-service cleanup.

## Expanded ten-stage result — 2026-11-01

Run `710cb82ef8d04b6c8701677f65332263` passed in 258.79 seconds using Chrome 145.0.7632.159. All ten browser stages and 72 desktop/mobile route checks passed, with no unexpected page/API errors or external application requests. Six new workflow checkpoints were also captured and checked for overflow at 1440px and 390px. Frontend lint/build and 33 frontend tests, full API/framework acceptance, five release-report validation tests and two existing acceptance-report tests passed.

The browser used independent fixture-a/fixture-c/fixture-d proposer, approver and executor sessions. Replaying the exact successful execution request returned the same receipt. SQL verified deltas of exactly one response note, one execution audit and one rule application audit. Recovery matched 76 public tables, verified one copied archive and two retention snapshots, and rejected archive/snapshot corruption. The active demo was not used.

Earlier expansion attempts failed on optional learning-fixture fields, reading a rule version from a create response, and an ambiguous Memory locator. Setup now omits inactive fields, fetches the rule before a version-checked update, and uses API snapshot assertions alongside a scoped text wait. No application authorization or validation was weakened. The six-stage reports above describe the previous gate and cannot satisfy the expanded report contract.

## OIDC extension

The gate also requires `identity.json` from a separate disposable OIDC API, browser and loopback provider. Token-mode workflows still run unchanged. See [identity architecture, setup and test boundaries](OIDC_SSO.md). Prior four-stage reports do not satisfy this expanded gate.

Verified run `cebf76ec2d154dec9548d7e177d167f7` passed all five release stages in 490.11 seconds (2026-11-01/02 local run). It passed 34 frontend tests plus lint/build, full Go race/vet and API/framework acceptance, ten browser workflows and 72 desktop/mobile route checks, and all eight identity checks plus self-approval denial with an approver role. Browser reports recorded no page errors or external requests. Recovery matched 76 table fingerprints, verified one copied archive and two retention snapshots, and rejected archive/snapshot corruption. Six release-report and two acceptance-report unit tests also passed.

Generated evidence is in `output/release-gate/cebf76ec2d154dec9548d7e177d167f7/`; reports record the working tree as dirty. This validates local/mock behavior, not a live identity provider or production deployment. Earlier failed runs remain failed; the successful run includes the OIDC proxy fix and Skill lifecycle response wait.

## Local phishing workflow — 2026-11-02

Added a bounded credential-phishing JSON scenario through Build, deterministic detection, evidence-backed Python gRPC mock investigation, explicit SOAR note review and independently approved sandbox session revocation. Existing outcome-derived Skills/Memory approval and matching are reused. The acceptance suite now requires a phishing API stage and an eleventh browser workflow. No live mail provider, actual model or production response is enabled. See [contract, implementation and test boundaries](PHISHING_FLOW.md).


## Verified phishing release — 2026-11-02

Run `108f639e1ceb493f9bc044d81079f416` passed all five release stages in 279.95 seconds: frontend lint/build and 35 regression tests; backend/API acceptance including phishing; eleven browser stages with 72 desktop/mobile route checks; eight OIDC checks plus self-approval denial; and backup/restore matching 76 tables, one archived payload and two retention snapshots with corruption rejection. Go race/vet and Python worker checks ran in the disposable framework suite. Reports and screenshots are under `output/release-gate/108f639e1ceb493f9bc044d81079f416/`.

The earlier `06da61047f714c6696870297ac50aeb1` run failed during its mobile route sweep after phishing passed. The route gate now explicitly waits for a visible heading before inspecting rendered content, instead of assuming network idle means rendering is complete. The complete rerun passed without weakening authorization or evidence checks. Results validate local/mock behavior only; no live mail provider, production response, actual-model quality or throughput is certified.


## Durable local Hunt execution — 2026-11-02

Hunt searches can now run through the existing PostgreSQL job queue and Go investigation-worker, with persisted progress, cancellation, bounded automatic/explicit retries and expired-lease recovery. Completed evidence/Memory receipts and reviewed promotion remain atomic and replay-safe. The UI uses queued execution; synchronous search remains compatible. No live integrations or new service are enabled. See [contracts, limits, deployment and tests](DURABLE_HUNT_EXECUTION.md).


## Verified local release — 2026-11-02

Run `aa47ada7f2d348bdae4a7d64bdea2ed0` passed all five release stages in **450.04 seconds**. Evidence includes six API workflow stages, twelve browser stages, 72 desktop/mobile route checks, frontend lint/build and 35 regression tests, Go race/vet and Python/Rust checks, mock OIDC checks and backup/restore. Durable Hunt browser assertions cover explicit retry, persisted cancellation, enqueue replay and a lost accepted response followed by completed receipt recovery without duplicate runs. Completed and cancelled mobile screenshots were visually inspected.

The initial API attempt exposed a test request missing the required cancellation `attempts` field; that request and documentation were corrected. The subsequent browser run caught overflow from a full run ID in the button label; controls now show short labels with exact accessible names. Earlier failed/superseded runs remain failed. Independent review also identified and resolved a tenant-lock/audit deadlock risk and missing receipt refresh after terminal enqueue replay.

Reports and screenshots: `output/release-gate/aa47ada7f2d348bdae4a7d64bdea2ed0/`. This is local/mock correctness and recovery evidence, not live-provider, distributed-scale or throughput certification.
