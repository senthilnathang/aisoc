# React 19 frontend migration

Status: local validation completed on 2026-10-31. Backend architecture and API contracts are unchanged. The application remains a client-rendered React/Chakra/Vite frontend; no server components or Next.js were introduced.

## Versions and compatibility

| Component | Version / policy |
| --- | --- |
| React and React DOM | 19.3.1, pinned together; one deduplicated runtime |
| Chakra UI | 2.10.9 retained after browser validation |
| Emotion / Motion | 11.14.0 / 11.18.2 retained |
| Vite / React plugin | 6.4.5 / 4.4.1 retained |
| React Compiler | babel-plugin-react-compiler 1.0.0, target 19 |
| ESLint / hooks plugin | 10.14.0 / 7.1.1 |
| Node | ^20.19.0, ^22.13.0, or >=24; tested with 24.0.1 and npm 11.3.0 |

Chakra's declared peer range accepts React >=18; Motion accepts React 18 or 19. Actual dialogs, forms, drawers, focus restoration, skill input and L1 screens were tested. This validates the application's exercised surface, not every possible Chakra component. A Chakra 3 redesign is not required by this migration.

ESLint's transitive minimatch is overridden to 11.0.1 to address GHSA-g3hv-75wg-m249. Fresh install, lint and audit validate this combination; remove the override when upstream dependencies select a patched compatible release. Do not use `npm audit fix --force` or legacy peer resolution.

## Compiler and profiling

`frontend/compiler.config.js` configures the compiler first in the existing React plugin's Babel pipeline. It defaults on, targets React 19, and rejects invalid flag values. The optional profiling alias does not change normal builds.

```bash
npm --prefix frontend ci
npm --prefix frontend run lint
npm --prefix frontend run build
node --test tests/frontend/*.test.mjs
npm --prefix frontend run compiler:report

# Disable compilation independently of the React runtime.
AISOC_REACT_COMPILER=0 npm --prefix frontend run build

# Local diagnostic build only; do not publish this as the normal artifact.
VITE_REACT_PROFILE=1 npm --prefix frontend run build
```

Profiling uses React's profiling renderer and a bounded `window.__AISOC_REACT_PROFILE__` buffer of 1,000 timing-only records. It records no incident content. Rebuild without `VITE_REACT_PROFILE=1` after measuring.

Automatic memoization is selective. The compiler report recorded 37 successful function compilations, 37 unsupported-function diagnostics (try/finally or throw inside try/catch), and one explicit skip. Diagnostics are not a whole-application coverage percentage. Unsupported functions retain ordinary React behavior; existing `useMemo` and callbacks remain.

**Known compiler limitation:** `TelemetryBrowser` uses `"use no memo"`. Compiler 1.0 generated an unguarded `page.items` cache dependency while `page` was null, even after extracting the guarded list. Browser tests reproduced the blank telemetry page. The opt-out retains React 19 and fixes the loading path; do not remove it without testing initial loading, source changes and pagination with the next compiler version.

The recommended Hooks lint rules are enabled, except `set-state-in-effect`: existing asynchronous-fetch effects intentionally reset loading/error state. That performance-style convention is documented rather than rewriting all data loading in this migration. Rules-of-hooks, exhaustive dependencies, mutation and static-component checks remain enforced with zero warnings.

## Correctness fixes

- Alert intake now locks submission synchronously with a ref. Two clicks in one event cycle produced two requests before the fix; the regression test now observes one intercepted request.
- Skill editor fields now have stable module-level component identity. Previously sequential typing retained only the first character and lost focus; the test now preserves the full text and focus.
- Skill refresh dependencies are explicit; investigation generation cleanup invalidates its captured request generation.
- Telemetry's nullable loading state remains safe via the compiler opt-out above.

## Verification

- Clean `npm ci`, deduplicated React dependency tree, production build, zero-warning Hooks lint, build-output tests and compiler on/off transform tests.
- npm audit: zero known vulnerabilities at validation time, including development dependencies.
- 375px and 1440px investigation filtering, alert modal focus/escape/restoration, duplicate-submit prevention and skill typing.
- Local production-preview browser checks with compiler off and on: source/detection forms, response drawer focus, telemetry pagination, out-of-order chart responses, session expiry hiding case data and stopping queue polling.
- Existing L1 suite: mock labels, citations, mobile overflow, queued/failed/invalid/empty results, escaped untrusted text and stale refresh warning.
- All browser mutations intercepted; no live provider response or demo import was performed.

Run `scripts/framework/react-migration-browser-check.js` and `scripts/framework/react-async-browser-check.js` through the Playwright browser tool on a local frontend/preview. Async tests require the existing `demo-showcase-01` dataset. Run `investigation-review-browser-check.js` from a completed mock showcase case on port 8080 or the isolated production preview on 8084. Scripts throw on assertion failures and clean up routes. The temporary migration preview uses 127.0.0.1:8084 with `AISOC_API_PROXY_TARGET=http://127.0.0.1:3003`; normal access remains port 8080.

See [measured results](benchmarks/react-19-migration.md). These are local rendering diagnostics, not backend EPS or production capacity claims. Long-running memory-soak and broad browser-matrix testing remain follow-up work.

## Rollback

For compiler-specific regressions, rebuild with `AISOC_REACT_COMPILER=0` and restart the frontend. For runtime regressions, revert the migration commits on `codex/react-19-migration`, restore the matching package/lock files, run `npm ci`, rebuild, and restart with `./run.sh stop frontend` followed by `./run.sh start frontend`. Baseline commit `b80dd23` contains the browser harness and submission guard on React 18.3.1; `32848e8` contains the pre-migration L1 visibility and database repair work. Do not reset or delete database state.

React Actions, optimistic updates, lazy loading and virtualization are optional future work with their own evidence and UX requirements. An approval or privileged response must never appear executed merely because an optimistic frontend update succeeded.

## References

- [React 19 upgrade guide](https://react.dev/blog/2024/04/25/react-19-upgrade-guide)
- [React Compiler installation](https://react.dev/learn/react-compiler/installation)
- [Chakra migration guide](https://chakra-ui.com/docs/get-started/migration)
- [minimatch advisory](https://github.com/advisories/GHSA-g3hv-75wg-m249)
