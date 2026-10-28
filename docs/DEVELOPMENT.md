# Developer Guide

## Prerequisites and local run

Use Node.js 22 or newer (the backend uses `node:sqlite`) and npm. Install with
`npm --prefix backend ci` and `npm --prefix frontend ci`.

```bash
./run.sh start
./run.sh status
./run.sh logs backend
./run.sh logs frontend
./run.sh stop
```

Local validation is login-free by default. The frontend and API are available at
`http://localhost:8080` and `http://localhost:3002`; health is `/health`. Runtime
PIDs and logs are stored under ignored `.run/`. See [README](../README.md) for
optional token mode and credential handling.

## Implementation conventions

- Preserve current URLs and extend contracts with backward-compatible migrations.
- Scope every mutable record and lookup by `tenant_id`.
- Validate route parameters and payloads with TypeBox; keep domain logic in
  services and transport in `frontend/src/api.js`.
- Extend existing screens before adding new routes, and retain responsive behavior.
- Skills must use the full available workspace width as `/detect/rules` does;
  keep columns shrinkable and content wrap-safe at narrow widths.
- Skills matching records versioned guidance and rationale for analyst review; it
  does not execute instructions or perform response actions.
- Identify local simulations clearly. Do not present vendor claims as measured
  AISOC performance.

## Validation

```bash
npm --prefix backend run typecheck
npm --prefix backend test
npm --prefix frontend run build
bash -n run.sh
git diff --check
```

See [Testing](TESTING.md) for workflow coverage and limits. Browser screenshots
and Playwright artifacts under `output/` are generated and should not be committed
unless a specific review artifact is requested.
