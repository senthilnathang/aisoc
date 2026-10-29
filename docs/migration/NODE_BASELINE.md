# Initial Node Backend Baseline

Status: preliminary shared-host observation; not a release acceptance baseline.
Historical receipt from 2026-10-28. Current Go/Node results and optimization
evidence are in [the performance review](PERFORMANCE.md).

The isolated Node backend completed three repeats for each dataset with zero HTTP
request errors. Each repeat used two tenants, concurrency eight, 100 warm-up reads,
and 1,000 timed operations. The mix was 50% list, 30% detail, 10% update, and 10% create.
All runtime databases were disposable. The active AISOC backend was not targeted.

| Dataset | Initial cases | Median successful requests/s | Median p95 ms | Median p99 ms | Median sampled peak RSS MiB | Requests/s range |
|---|---|---|---|---|---|---|
| small | 200 | 235.0 | 62.9 | 72.7 | 168.2 | 220.4–247.9 |
| large | 2000 | 166.8 | 91.3 | 110.4 | 181.8 | 56.4–172.6 |

The wide range on the large dataset means this run is unsuitable for attributing
performance differences to runtime or database technology. Repeat on controlled,
equivalent resources before setting release thresholds. No Go result existed at
the time of this initial receipt; later controlled campaigns are documented separately.

RSS and CPU measurements cover the Node API/worker process; SQLite is in that process.
A Go/PostgreSQL comparison must separately report Go process metrics and total stack
resources, including PostgreSQL and any enabled specialist workers. The load generator
runs outside the sampled process. Memory peaks are sampled every 100 ms.

Background probes measure submission-to-observed-completion, including polling delay.
The original report recorded the requested 50 ms interval, but the Node backend
enforces a 100 ms minimum. These historical measurements therefore ran at 100 ms.
The fixture now reports that effective interval, and future performance workloads
use a new fingerprint with 100 ms. Do not compare the old metadata uncritically.
The legacy Node application's default interval is 1,500 ms. The active Go worker
uses 100 ms. Later verification added pool metrics, token-mode campaigns and soak
coverage; those results do not retroactively change this historical fixture.

[Raw measurements and source provenance](node-baseline.json) include hardware/cgroup
information, workload fingerprint, per-repeat metrics, and limitations.
[Reproduction commands](../../tests/backend-parity/README.md) support later Go runs.
