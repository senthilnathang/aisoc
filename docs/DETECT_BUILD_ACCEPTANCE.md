# Repeatable Detect-to-Build acceptance

This suite exercises local/mock workflows against real Go HTTP handlers, disposable PostgreSQL and Redis, and local Python/Rust workers. It does not use the running demo database, live providers or a real model. Approvals are explicit test inputs; they authorize only simulated effects inside the disposable environment.

## Run

From the repository root, as an ordinary user:

```bash
python3 scripts/framework/acceptance.py
```

The default is **two independent full runs**, each with fresh databases, ports and worker processes. `--runs 1` is a shorter iteration; `--runs 3` adds another clean repetition. Do not run another `check.py` concurrently: the underlying framework report location and built binaries are shared. The acceptance wrapper serializes its own invocations.

For a single framework execution without the repetition wrapper:

```bash
python3 scripts/framework/check.py --with-streams --platform-acceptance
python3 -m unittest discover -s scripts/framework -p test_acceptance.py
```

Use the existing framework prerequisites: PostgreSQL 16 binaries (`AISOC_TEST_PG_BIN` may select their directory), pinned Redis, Go, Cargo and the prepared Python worker virtual environment. Loopback sockets and child processes must be permitted. No infrastructure is downloaded by this suite. Python optimization (`-O`/`PYTHONOPTIMIZE`) is rejected because assertions are release checks.

## Connected acceptance paths

| Stage | Assertions |
|---|---|
| Build → Investigate | JSON preview, grant-bound draft, explicit import, frozen evidence, four normalized events, IAM/EDR evidence, bounded worker execution, Go QA, approved mock SOAR note; replay inserts zero events; foreign profile access/import denied. |
| Investigate → Respond | Same Build case; evidence-bound mock session proposal, explicit expiring approval, dry run, kill switch, source-conflict and audit rollback; concurrent execution produces one receipt/note and zero external calls. |
| Investigate → Skills/Memory | Same case receives an explicit reviewed outcome and evidence artifact; approval yields a draft Skill and expiring Memory; replay preserves identities, conflicting replay fails. Publish through the existing versioned API, then a new matching case gets one Skill and one Memory snapshot while its verdict remains unknown. |
| Threat Intel → Hunt → Investigate | Import duplicate canonical domain IOCs, create a linked hunt, search the Build case's stored artifact and promote its finding with confirmation. Import/link/run/promotion replay preserves identities; foreign access fails. |
| Investigate → Detect | Separate normalized alert intake produces three case-bound alerts (FP, TP, unreviewed). Repeated intake deduplicates; explicit labels use version checks and reject stale/foreign writes. Generate/validate/replay/apply preserves TP/unreviewed evidence, writes exactly one apply audit and leaves the rule disabled. |

Finding admission already creates a source alert for the Build case. The suite explicitly labels that existing alert and verifies the reviewed case determination stays unchanged. A separate three-alert rule fixture supplies controlled FP/TP/unreviewed replay evidence without tuning the shared mock-login rule.

The underlying framework also runs Go race tests/vet, Python/Rust tests, auth/session/CSRF checks, worker crash recovery, stream delivery/retry/DLQ tests and specialist RPC contract checks. No performance load target is asserted by this acceptance command.

## Reports and failure behavior

- `output/platform-acceptance/report.json`: aggregate result, requested repetitions, revision/dirty marker and per-run exit status/duration.
- `output/platform-acceptance/run-N/`: individual stage report, framework summary, response/context reports and runner log.
- `output/backend-framework/check.log`: detailed log of the most recent framework execution.
- `output/backend-framework/platform-acceptance.json`: current stage progress; starts with `passed:false` and becomes true only after the full framework succeeds.

The wrapper removes the old stage report before each execution, rejects missing stages, nonzero exit codes and non-local modes, and leaves the aggregate failed until all requested runs pass. Output is ignored by Git. Assertions failing stop the run; the existing runner's `finally` block stops its owned children/Redis/PostgreSQL and removes temporary data. Abrupt host termination still requires ordinary process cleanup.

Acceptance mode removes inherited `AISOC_*` variables from child-service configuration, then supplies runner-owned endpoints, authentication and local fixtures. The test helper uses read-only SQL counts to verify persisted effects; its workflow mutations go through the API. Existing fault tests deliberately alter only their disposable database to simulate failures.

## Browser and production boundaries

This command is an HTTP/service acceptance suite, not a browser automation claim. Existing browser suites remain complementary: `case-detection-feedback-browser-check.js`, `rule-recommendations-browser-check.js`, `outcome-learning-regression-browser.js`, `intel-hunt-regression-browser.js`, `case-response-browser-check.js` and `local-integrations-browser-check.js`. Some older browser scripts require retained demo fixtures; they are not prerequisites for this disposable command.

It does not certify production tenancy against a compromised host, live provider API compatibility, model precision/recall, production throughput or disaster recovery. No application schema or runtime behavior changes are required; rollback removes the optional test flag/helper/wrapper and retains existing checks.

## Recorded validation — 2026-11-01

The finalized `python3 scripts/framework/acceptance.py --runs 2` completed both fresh runs successfully: **118.54 s** and **133.40 s**. These are correctness-suite durations, not platform latency or EPS measurements. All four report stages passed in each environment, including the Build case's existing source-alert feedback.

Each run verified one mock response note/effect under concurrent replay with zero external calls; one Skill and Memory application on a matching follow-up; no applications or hunt evidence leakage to a second tenant with identical entity/IOC values; stable Intel import/hunt/promotion replay; and a three-alert detection replay removing 1/1 FP, 0 TP and 0 unreviewed alerts. A label edit invalidated the prior receipt, and regenerated application left the rule disabled with one apply audit.

Two report-validation unit tests, Python compilation, optimized-Python/missing-stream CLI rejection checks and `git diff --check` also passed. The underlying runs included Go race/vet, Python/Rust, real HTTP authentication/tenant tests and local RPC/stream/fault checks. No frontend code changed and no new browser run is claimed for this suite.

## Lifecycle extension

The Skills/Memory stage now also verifies staged publication, source-change detection, explicit reapproval, stale/foreign rejection and archive through Go HTTP endpoints. See [lifecycle coverage](SKILLS_MEMORY_LIFECYCLE.md).
