# HTTP compatibility and comparison tooling

Current Go/PostgreSQL implements all 97 legacy routes. Tests use real HTTP and
disposable fixtures; Node is the reference backend and test driver. See
[testing coverage](../../docs/TESTING.md) and [ADR 003](../../docs/adr/003-replacement-contract-decisions.md).

## Setup and main commands

Install Node backend dependencies and the Go/Rust/Python/PostgreSQL prerequisites
from [development setup](../../docs/DEVELOPMENT.md). From the repository root:

```bash
node --test tests/backend-parity/*.test.mjs tests/backend-performance/*.test.mjs tests/frontend/*.test.mjs
node tests/backend-parity/run.mjs
node tests/backend-parity/auth.mjs
node tests/backend-parity/report.mjs
node tests/backend-parity/lifecycle.mjs
python3 scripts/framework/check.py
```

Default HTTP commands start disposable Node instances and remove their temporary
SQLite databases afterward. The framework runs shared domain/auth suites against
Go with isolated PostgreSQL, plus race/vet, transactions, specialist runtimes and
restart/crash recovery. Reports are generated under ignored `output/`.

## Focused suites

| Files | Scope |
|---|---|
| `response-library`, `case-runbooks`, `response-errors`, `response-validation` | Plans, pinned versions, approvals, conflicts, exact selected errors and 54 schema/parser fixtures |
| `case-activity`, `case-edits`, `case-scalars` | Evidence, feedback, determination, edits, remediation and supported legacy scalar conversions |
| `detection-rules`, `detection-registry`, `detection-intelligence` | Configuration/version lifecycle, filters/sorts/pagination, windowed alert metrics |
| `api-sources`, `source-mapping`, `alert-intake`, `operator-alerts` | Scoped credentials, mapping, native/normalized input, routing and deduplication |
| `investigation-worker`, `investigation-queue` | Local phases, retry, indicators, queue ordering and summary counts |
| `skills-authoring`, full `run` scenarios | Authoring/materials, suggestions, case/hunt applications, feedback and outcomes |
| `hunts`, `connectors`, `threat-intelligence`, `dashboard` | Local domain lifecycles, redaction, aggregate state and isolation |
| `auth`, `response-auth` | Operator/source auth, sessions, CSRF, origins, expiry and tenant binding |

Each name above is an executable `.mjs` file in this directory. The full suite
contains 11 scenarios. Go integration tests additionally verify database-level
constraints, failed-audit rollback, concurrency, encryption and snapshot semantics.

## External disposable targets

```bash
node tests/backend-parity/run.mjs --url http://127.0.0.1:3003 --allow-fixture-writes --label go --output output/backend-parity/go-report.json
```

Only use a disposable development database. External tests create unique tenants
and records but do not reset the database. Start workers for suites that require
processing; acceptance fixtures sometimes intentionally pause workers. The
framework orchestrates these differing conditions automatically.

The harness rejects active ports **3002 and 8080**, non-loopback targets, URL
credentials and external writes without the explicit fixture flag. Token suites
use the public fixture operators defined in `server.mts`; never install them in
the active release. `response-auth.mjs --with-cases` broadens domain auth checks.

`node tests/backend-parity/serve.mjs` keeps an ephemeral Node fixture alive until
Ctrl-C. For a persistent separately seeded Node API/frontend pair, use
`python3 scripts/runtime/node-compare.py start` (3004/8082). Stop it with the same
script's `stop` action. Neither path selects Node for the active release.

## Inventory and coverage

```bash
node --import ./backend/node_modules/tsx/dist/loader.mjs scripts/backend-inventory.mts
```

The inventory uses a temporary legacy database to generate route/request schemas,
database structure and frontend caller references. Outputs are in `contracts/`
and `docs/migration/`. The route matrix remains the legacy compatibility inventory;
Go operational `/ready` and `/metrics` are additional endpoints.

`report.mjs` combines functional/auth probes, checks static-route precedence and
validates 16 journey-to-endpoint/scenario mappings. Full route probing does not
prove every input behavior or execute every browser workflow. For custom reports,
pass `--functional` and `--auth` from the same backend revision.

## Browser checks

Build a separate preview with `npm --prefix frontend run build`, then launch Vite
against the isolated Go API. The ordinary dev frontend can target 3003 on 8081
as described in the developer guide. The token preview helper expects its own
build at `output/go-preview`; build it with:

```bash
cd frontend
./node_modules/.bin/vite build --outDir ../output/go-preview
```

`scripts/framework/token-preview.py` orchestrates isolated token-mode processes.
Read its CLI help before use; it reserves API 3004, so stop Node comparison first.
Playwright CLI snippets in `scripts/framework/` cover journey rendering, response
editor conflicts and token/session workflows. Inspect the page before running a
snippet. Generated screenshots and reports belong under `output/playwright/`.

## Performance and safety

```bash
python3 scripts/framework/benchmark.py --controlled --postgres-diagnostics --output-dir output/backend-performance/new-campaign
```

Default settings: small/large, three repeats, eight clients, 3,000 requests,
50% list / 30% detail / 10% update / 10% create. Workers use a 100 ms fixture
interval. Optional `--sizes small` and `--repeats 1` support investigation;
final comparisons should use repeated matching workloads.

Node and Go run sequentially with fresh databases. Go resource scope includes
API, investigation worker and PostgreSQL. CPU affinity is shared with the load
generator and does not reserve CPUs from other host workloads. Token mode and
workload fingerprints must match. The comparator reports aggregate and
per-operation medians, plus p95/p99 regressions over 10%; it is not a complete
production acceptance gate. See [results and limitations](../../docs/migration/PERFORMANCE.md).

Do not delete private recovery data while cleaning generated evidence, and do
not load-test the active application. Existing comparisons and backup/rollback
tools are independent of normal startup.
