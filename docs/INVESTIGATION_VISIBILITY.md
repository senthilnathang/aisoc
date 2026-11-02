# Investigation review visibility

The case Summary now includes **L1 investigation review**, separate from the
analyst determination and deterministic processing steps. Open a showcase case
from Stream operations or the Investigations queue.

The panel displays:
- Worker state, attempt budget and last update.
- Evidence linkage, Python completion, Go contract checks and mock SOAR note state.
- Recorded verdict, missing evidence and required human L2 review.
- Competing hypotheses with clickable supporting/counterevidence references.
- Evidence timestamps and expandable content hashes.
- Failed/cancelled jobs, invalid results, absent reviews and refresh failures.

Mock inference is explicitly labeled. A synchronized mock note does not mean a
closed case; a completed job does not imply a valid result. Go revalidates stored
Protobuf task/result identity, bounds and citations at the recorded completion time
before exposing a verdict. Contract validation does not establish evidence truth.
No model invocation, retry, response action or database write occurs on page load.

## API and refresh behavior

`GET /api/v1/investigations/{id}/l1` is authenticated and tenant-scoped. Unknown and
foreign cases return 404. It reads a repeatable-read snapshot of the finding,
deterministic specialist job ID, job state and escalation state. Existing case API
contracts remain unchanged; no schema migration is needed. Source credentials
cannot access this operator endpoint.

The frontend refreshes active work and pending write-back every five seconds.
Terminal outcomes use manual **Refresh review**. Network failures retain a visible
stale-data warning and retry automatically. Switching cases cancels display updates
from old requests. References are rendered as text and local anchors, never source
HTML or executable external URLs.

This view supports the current finding-linked Python review path. Manual cases show
that no specialist review was requested. Actual local-model connection/evaluation
was deferred by the user; the demo remains mocked. Generalized agent workflows and
remote provider health are not inferred from this projection.

## Validation

Backend tests cover completed results, foreign-case denial, corrupt output and
failed jobs. Run the disposable suite with
`python3 scripts/framework/check.py --with-streams`. Frontend build:
`cd frontend && npm run build`. The build retains the existing bundle-size warning.
Browser checks cover real showcase data, citation navigation, desktop/mobile layout,
empty/failure/stale states and HTML-safe rendering using response fixtures only.


During deployment a pre-existing migration checksum mismatch was diagnosed and
repaired through explicit historical compatibility plus additive migration 032;
no recorded checksum or demo data was rewritten. See
[repair details](WORKER_DISPATCH_SECURITY.md#historical-031-compatibility-and-repair).


## Shared Investigations registry table — 2026-11-02

Investigations and Received alerts use the shared table, preserving search, polling and intake/case actions. Pagination covers only the existing latest-100 snapshot; it does not query all historical records. See [component contract and browser checks](frontend/RECORDS_TABLE.md#investigations-registry-integration). Run `node scripts/framework/investigations-records-table-browser.mjs`; domain writes are intercepted.

Validation on 2026-11-02: frontend lint, all 17 frontend regression files, final production build and the Investigations records-table browser suite passed. Both tabs passed desktop/mobile and keyboard access checks. Investigations mobile and Received alerts desktop screenshots were visually inspected. Mock intake, linked/unlinked alert actions, polling-driven empty-page recovery, stale-row warnings and initial-error retry passed. Real API checks were read-only; alert submission was intercepted, so demo data was unchanged. The existing bundle-size warning remains. Evidence: `output/playwright/investigations-records-table/report.json`.
