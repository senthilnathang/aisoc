# Repeatable local browser release gate

Extend check.py's existing disposable PostgreSQL/Redis/API/worker lifecycle. A new release wrapper creates a unique run directory, executes frontend checks and the API harness, and validates run-bound browser/API/backup artifacts before reporting success. No retained demo database or credentials are read.

Generate local login JSON plus pending guidance and aged notification fixtures per run. Use a pinned Playwright Node dependency with an installed Chrome/Chromium binary. Exercise real UI writes against the disposable API, independent synthetic operators, tenant-negative checks, and all navigation routes at desktop/mobile widths. Block external browser requests. Do not record credentials or session traces.

Run archive-backed backup recovery in two clones of this same disposable dataset. Preserve per-table fingerprints, verify copied payloads after original temporary files disappear, and reject corruption. Retain only reports, synthetic JSON and screenshots; temporary databases, credentials, dumps and processes are cleaned up by the harness.

A single report requires fresh, matching run IDs and explicit success from frontend, API, browser and backup. A missing/failed stage or nonzero subprocess result fails the release. Add unit tests for incomplete/stale evidence and dependency/CLI validation. Existing standalone acceptance and demo browser tools remain compatible.
