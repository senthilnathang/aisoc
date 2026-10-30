# Targeted security and optimization review

Reviewed 2026-10-30 against the local foundation. This is a targeted source review,
dependency audit and regression check, not a penetration test or production certification.

## Findings and changes

| Finding | Exposure and severity assessment | Remediation |
|---|---|---|
| Browser Origin was not enforced before local-mode handlers | Medium in the local deployment: an untrusted website could submit simple browser requests to handlers; withholding CORS response headers does not stop side effects | `Manager.Protect` in `backend-go/internal/platform/auth/auth.go` rejects non-allowlisted, empty and duplicate Origin headers before public/local/token branches |
| Import receipt writes followed a supplied symlink or hardlink | Medium, local prerequisite: an operator imports an untrusted writable bundle with a receipt pointing to another writable file | `write_json` in `scripts/framework/benchmark_import.py` writes a private temporary file and atomically replaces the destination entry; it does not truncate the link target |
| Artifact checks and reads were separate; large provenance hashes loaded the entire file | Robustness and memory cost; FIFO input could block and repeated reads could validate different bytes | Open once with no-follow/nonblocking flags, require a bounded regular file, reject duplicate JSON keys, hash the same parsed page bytes and stream large provenance hashes |
| Python environment contained pip 24.0 with published advisories | Installer/tooling exposure; not an observed application exploit | Updated the local worker installer to pip 26.2 and added the pinned bootstrap command to developer/Python setup instructions |

Origin is not authentication: non-browser callers can omit it. Local mode remains
credentialless and must remain local. Host/DNS-rebinding defenses, remote TLS/mTLS,
production access control and live provider authorization are not certified by this
change. Atomic receipt replacement is not an fsync durability guarantee or protection
against an attacker controlling parent-directory changes under the same OS account.

## Measured optimization

A temporary 32 MiB input produced identical SHA-256 digests through both paths:

| Hash path | Peak Python allocation (`tracemalloc`) | Elapsed time |
|---|---:|---:|
| Previous `digest(path.read_bytes())` | 33,558,970 bytes | 0.1947 s |
| Incremental `artifact_digest` (64 KiB chunks) | 136,006 bytes | 0.2243 s |

This single local run shows approximately 99.6% lower peak allocation for the hash
operation, not lower overall import RSS or faster ingestion. Bundle preparation still
materializes events for transformation. No new EPS benchmark was run; stable 1,000 EPS
remains unproven. See [existing throughput results](STREAM_PERFORMANCE_REPORT.md).

## Dependency audit

| Scope | Tool and result |
|---|---|
| Go modules (`backend-go`) | govulncheck v1.9.0: no vulnerabilities found |
| Frontend lockfile | `npm audit --json`: zero reported vulnerabilities |
| Retained Node backend lockfile | `npm audit --json`: zero reported vulnerabilities |
| Installed Python worker environment | pip-audit 2.10.1: initial pip 24.0 findings; repeat scan after pip 26.2 update reports no known vulnerabilities |
| Rust worker lockfile | cargo-audit 0.22.2: scanned 132 dependencies against 1,386 RustSec advisories; exit 0, no findings |

The initial Python report emitted 12 rows, including duplicate advisory IDs, all for
pip; it must not be interpreted as 12 distinct application vulnerabilities. These are
point-in-time advisory database results. They do not detect every application-level
authorization, injection or data-flow flaw. Bootstrap updates affect newly created
environments only when the documented command is run.

## Regression checks

`python3 -m unittest discover -s scripts/framework -p 'test_*import*.py'` passes
13 tests. New cases preserve symlink/hardlink targets, enforce private receipts,
reject FIFO/symlink/oversized/duplicate-key input, and verify streamed checksums.
`TestOriginRejectedBeforeLocalOrPublicHandlers` covers local/token modes, protected
and public paths, invalid/duplicate Origins, and allowed/no-Origin local requests.

`python3 scripts/framework/check.py --with-streams` passes the isolated full
Go/PostgreSQL/Redis/Python/Rust checks, including Go race tests and typed gRPC
investigation/credential-rejection checks. Markdown link validation passes 306 links.
After restarting the local foundation, `/health` returns 200 for allowed/no Origin
and 403 for an untrusted Origin. Read-only API checks preserve 10,000 completed
showcase events and 60,000 completed benchmark events, with no pending events.
The first benchmark verification flagged two workers immediately after restart;
both subsequently reported running without errors, and the repeated aggregate
verification passed with no unhealthy scopes, dead letters or publication failures.
`./run.sh import-demo all --dry-run` also passed against the retained bundle.
No demo data, schemas, live integration settings or privileged response policies
are changed by these fixes.

## Remaining review scope

- Complete application-wide authorization, tenant-isolation and SQL data-flow review;
  the existing parameterized pgx design is not itself proof of injection immunity.
- Review provider credential-file bounds and permissions consistently across adapters.
- Validate remote worker transport and deployment controls before any remote rollout.
- Repeat dependency scans in CI and after upgrades; this review does not add a CI gate.
- The frontend raw-HTML wizard inspected during this pass uses static instructions;
  no user-controlled XSS path was established there. Reassess before making it dynamic.
