# React 19 Migration Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Upgrade the existing frontend to React 19 while preserving behavior, then validate React Compiler automatic memoization against measured rendering costs.

**Architecture:** Keep the current client-rendered React application and Go API contracts. Separate runtime compatibility from compiler optimization. Retain Chakra 2 only if dependency support and browser tests establish compatibility; otherwise migrate Chakra in a distinct prerequisite change.

**Tech Stack:** React/React DOM 18.3.1 currently; Chakra UI 2.10.9; Emotion 11.14.0; Framer Motion 11.18.2; Vite 6.4.5; @vitejs/plugin-react 4.4.1; JavaScript/JSX.

**Spec:** User request: plan React 19 migration, including memoization and modern features. This document contains the proposed scope and implementation sequence; implementation has not started.

## Global constraints

- Local sandbox only; preserve Go API, tenant authorization, database, mock response boundaries, and demo data.
- Preserve current UI appearance, routes, keyboard access, and frontend port 8080.
- Preserve existing uncommitted frontend visibility and database repair work; establish its reviewed baseline before branching for migration.
- Keep RisingWave work separate. Suggested implementation branch: `codex/react-19-migration`.
- Select and pin matching supported stable React/React DOM 19.x versions at execution time, checking release/security notes and dependency peer ranges. Do not use forced or legacy-peer-deps installation to hide conflicts.
- Do not introduce Next.js, server components, TypeScript conversion, or a routing rewrite for this migration.
- React 19 alone does not enable automatic memoization. Compiler activation is separately reversible.

## Verified repository baseline

| File | Current implementation / implication |
| --- | --- |
| `frontend/package.json`, `frontend/package-lock.json` | Exact versions above; build uses Vite and publish script; no lint/component-test scripts currently declared. |
| `frontend/src/main.jsx` | Uses `createRoot`, ChakraProvider with theme, alert dialogs, forms and toast APIs; large application entry deserves targeted changes, not wholesale rewriting. |
| `frontend/src/theme.js` | Chakra 2 `extendTheme`, component styles and defaultProps. These theme settings are not React function-component defaultProps. |
| `frontend/vite.config.js` | React plugin, API proxy, CSP, SPA preview fallback. Preserve these while configuring compiler. |
| `frontend/src/DetectionIntelligence.jsx` | Existing `useMemo`; memoization is not absent from the application. |
| `frontend/src/InvestigationReview.jsx` | New pending frontend visibility work with polling and stale/error states. Include in migration baseline. |
| `tests/frontend/build-output.test.mjs` | Build publishing tests, not sufficient UI compatibility coverage. |
| `scripts/framework/investigation-review-browser-check.js` | Existing review browser checks to retain and reuse. |

## Review focus

1. Portaled dialogs/drawers must retain focus trapping, Escape behavior, and focus restoration.
2. Polling after navigation or tenant/session changes must not display stale case data or leak timers.
3. Rapid double submission must not duplicate sandbox requests or lose disabled/loading states.
4. Compiler must not retain stale closures or suppress legitimate updates in mutable chart/table data.
5. Direct route reloads, CSP, assets and API proxy must work in the published production build.

## Task 1: Establish compatibility and performance baseline

**Files:** inspect package files, Vite config, theme, all `frontend/src/*.jsx`; create `scripts/framework/react-migration-browser-check.js` and `docs/benchmarks/react-19-migration.md`.

- [ ] Record Node/npm versions, installed dependency tree, peer ranges and security advisories; inspect the exact proposed React 19 patch and transitive Chakra/Emotion/Motion support. Record incompatibilities rather than assuming a broad peer range proves runtime support.
- [ ] Audit deprecated APIs, ref callbacks, effect cleanup, render-time mutation and hook order using React 18.3 warnings and source inspection. Check new JSX transform output. Keep valid existing memoization.
- [ ] Extend browser coverage for login/session errors, investigation list/detail, telemetry filters, source configuration, stream operations, detection rule forms and response sandbox screens. Use intercepted mutations or disposable fixtures, never live response providers.
- [ ] Assert dialog focus/escape/restoration, one request per submit, cleanup on route change, late fetch rejection, and absence of cross-session data; cover 375px and 1440px widths.
- [ ] Baseline production-build navigation/filter/poll interactions using fixed local fixtures and identical hardware/browser conditions: 5 warm-ups and 30 measured iterations per interaction. Record median/p95 interaction latency, request counts, JS errors, compressed asset sizes and memory trend. Profile React commit time separately with a profiling build.
- [ ] Run `npm --prefix frontend run build` and `node --test tests/frontend/*.test.mjs`; execute both browser check scripts through the existing Playwright runner. Save results and commit baseline checks independently.

**Deliverable:** reproducible baseline and explicit dependency decision for Task 2.

## Task 2: Resolve UI dependency compatibility, then upgrade runtime

**Files:** `frontend/package.json`, `frontend/package-lock.json`; affected JSX identified by Task 1. Conditional Chakra migration also touches `frontend/src/theme.js`, `main.jsx`, and all Chakra-consuming components.

- [ ] Try the selected React 19 dependency set in the migration checkout without publishing to the running demo. Retain Chakra 2 only if supported dependency constraints, warning checks and complete browser coverage pass.
- [ ] If Chakra 2 is unsupported or fails compatibility tests, prepare a separate Chakra 3 prerequisite commit. Review a pinned codemod dry run; migrate provider/theme tokens and recipes, dialogs/drawers, forms, tables, alerts and toaster APIs. Check the selected Chakra version's Node requirement. Remove Motion/Emotion styled only if the application itself has no remaining imports.
- [ ] Pin matching React and React DOM 19 versions. Apply only applicable official upgrade changes; inspect codemod output rather than applying broad rewrites blindly. Preserve API behavior and visual design.
- [ ] Verify fresh `npm ci` in frontend, dependency tree with no invalid peers or duplicate runtime versions, production build, build-output tests, and all baseline browser checks. Record warnings explicitly; no new React compatibility warnings are accepted.
- [ ] Compare screenshots, bundle sizes and baseline interactions. Investigate any repeatable p95 regression above 10% or compressed JS increase above 5%; these are proposed migration gates, not existing product SLOs.
- [ ] Commit runtime/UI compatibility changes separately from compiler configuration. If Chakra prerequisite is substantial, retain it as a separately reviewable commit with its own passing UI tests.

**Deliverable:** React 19 running with unchanged product flows; compiler still disabled.

## Task 3: Enable and measure React Compiler

**Files:** package/lock files, `frontend/vite.config.js`; create `frontend/eslint.config.js`; narrowly modify components flagged by diagnostics.

- [ ] Add pinned compatible ESLint/React Hooks lint tooling and a `lint` script. Record and fix correctness issues relevant to compiler eligibility: mutation, invalid hooks and effect dependencies. Avoid broad formatting changes.
- [ ] Add a pinned React Compiler Babel plugin, configured first in the Babel pipeline. Current plugin-react 4 supports its inline Babel option; if tooling must change, use documentation for the selected version, not the newer plugin-react 6 API by accident.
- [ ] Provide a build-time `AISOC_REACT_COMPILER=0` escape hatch. Build compiler-off and compiler-on from the same React 19 revision. Confirm compilation through transformed output or React DevTools, and document skipped components/diagnostics.
- [ ] Run lint, build and browser scenarios for both configurations, especially table filters, chart updates, polling, form inputs and stale responses. Preserve existing manual memoization unless a separately measured change justifies removing it.
- [ ] Repeat Task 1 measurements under identical conditions. Enable by default only if correctness passes and no repeatable regression crosses the agreed gates; report measured gains or no measurable gain without claiming universal speedups.
- [ ] Commit compiler setup and benchmark results separately; disable compiler independently if it exposes a regression.

**Deliverable:** verified automatic memoization with a documented off switch and empirical results.

## Task 4: Release locally and document

**Files:** `README.md`, `docs/DEVELOPMENT.md`, `docs/ARCHITECTURE.md`, `docs/TESTING.md`, `docs/ROADMAP.md`, benchmark report.

- [ ] Document actual pinned versions, Node requirement, compiler configuration, lint/test commands and known limitations.
- [ ] Validate the published build, direct route reloads, fonts/assets, API proxy and CSP through the normal launcher. Keep database/demo data and backend services intact.
- [ ] Verify no regression in mock labels, human-review requirements, tenant authorization, or sandbox response controls. Run the existing investigation review browser suite against the local demo.
- [ ] Record final baseline/runtime/compiler comparison, commit IDs and rollback steps. Review and merge only after checks pass.

**Rollback:** first disable compiler and rebuild if compiler-specific. For runtime/UI regressions, revert migration commits in reverse dependency order, restore the matching lockfile, run `npm ci`, rebuild and restart frontend through the normal launcher. No database migration is involved. Preserve the known-good baseline artifact until local acceptance.

## Optional follow-up features

React 19 Actions/useActionState/useOptimistic may improve individual forms, but require their own UX and error/retry tests. Do not optimistically show a response action as executed or an approval as granted. Consider transitions/deferred rendering only where profiling identifies an expensive interaction; these are not new prerequisites of React 19. Lazy loading and table virtualization are separate measured optimizations, not implied benefits of upgrading React.

## References

- [Official React 19 upgrade guide](https://react.dev/blog/2024/04/25/react-19-upgrade-guide)
- [React Compiler installation and Vite integration](https://react.dev/learn/react-compiler/installation)
- [Chakra UI v3 migration guide](https://chakra-ui.com/docs/get-started/migration)

Planning performed on 2026-10-31. No dependency upgrades, migration tests or performance claims were made by writing this plan.
