# React migration measurements — 2026-10-31

Local Chromium, Node 24.0.1, npm 11.3.0, same host and 1440px viewport. Fixed queue response during each measured run; 13 existing cases. Each production run performs 5 warm-up and 30 measured filter/clear cycles, including Playwright input and DOM waits. No backend writes. These sequential runs are subject to host load and browser automation noise, not statistically controlled capacity measurements.

| Build | Filter cycle median | Filter cycle p95 | Production JS gzip |
| --- | ---: | ---: | ---: |
| React 18.3.1 baseline | 137 ms | 248 ms | 212.94 kB |
| React 19.3.1, compiler off (after input fixes) | 143 ms | 218 ms | 236.55 kB |
| React 19.3.1, compiler on, telemetry opted out | 81 ms | 111 ms | 245.86 kB |

The final normal-build repeat measured **139 ms median / 233 ms p95** with profiling confirmed disabled. This also stayed within the 10% p95 regression threshold versus the 218 ms compiler-off sample.

An earlier React 19 runtime-only run measured 109/179 ms median/p95. This variability is why no universal percentage speedup is claimed. Compiler-on remained within the proposed 10% p95 regression threshold in these production samples.

The runtime-only compressed bundle increased approximately 11.1%; compiler output adds approximately 3.9% beyond that. The runtime increase appears before compiler activation with the UI library unchanged and only small correctness changes. It is an accepted migration tradeoff, not a successful bundle-size reduction. The existing >500 kB Vite chunk warning remains. Route splitting should be evaluated separately against initial-load measurements.

## React profiling builds (separate from production timings)

The same interaction loop with the profiling renderer records commit actualDuration. Samples include warm-up renders and incidental polling, so commit counts need not match exactly.

| React 19 configuration | Recorded commits | Commit duration median | Commit duration p95 | Browser cycle median / p95 |
| --- | ---: | ---: | ---: | ---: |
| Compiler off | 73 | 19.0 ms | 69.6 ms | 153 / 249 ms |
| Compiler on | 74 | 22.9 ms | 69.8 ms | 98 / 260 ms |

Profiling does not demonstrate a consistent commit-time improvement. The browser-cycle benefit in the production run cannot be attributed solely to memoization from these samples. React Compiler is enabled for validated eligible components, with an independent off switch; do not promise all components are memoized.

## Correctness and security findings

- Two alert requests from same-cycle double click: reproduced, guarded, retested to one.
- Skill input remount on each keystroke: reproduced as `M` instead of `Migration typing`; stable field fixes it.
- Compiler hoisted nullable telemetry access: reproduced twice; explicit component opt-out passes initial loading and pagination.
- Audit initially exposed development-tool minimatch advisory. Patched override plus supported ESLint yields zero known vulnerabilities.
- Compiler report: 37 successful functions, 37 unsupported-function diagnostics, 1 explicit opt-out. Report can be regenerated with `npm --prefix frontend run compiler:report`.

Functional verification is documented in [migration notes](../REACT_19_MIGRATION.md). No long-running memory soak or production throughput test was performed. Saved screenshots and temporary builds are local ignored artifacts under `output/react19` and `output/playwright`.
