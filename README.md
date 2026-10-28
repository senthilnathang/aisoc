# AISOC Local Replica

Local, screenshot-driven React replica with a SQLite-backed service.

## Workspace

- `frontend/` - React, Chakra UI, Vite
- `backend/` - TypeScript, Fastify, Node SQLite
- `docs/` - architecture, API, developer setup, data model, test strategy, and roadmap
- `screenshots/` - visual references

## Development

```bash
npm --prefix backend ci
npm --prefix frontend ci
./run.sh start           # Start and health-check both services
./run.sh status
./run.sh logs backend
./run.sh stop            # Stop only this launcher's process groups
```

`run.sh` follows the service-management pattern in `/opt/AgentGuard/run.sh`,
adapted to this repository's Node/SQLite backend and Vite frontend. Targets are
`all`, `backend`, and `frontend`. Runtime logs and PID files live in `.run/`.
After backend source changes, run `./run.sh stop backend` followed by
`./run.sh start backend`. Frontend changes reload through Vite.

Default URLs:

- Frontend: `http://localhost:8080`
- Backend: `http://localhost:3002`
- Health: `http://localhost:3002/health`

Local development opens directly without login so the app can be validated.
To enable operator authentication later, initialize credentials once with
`npm --prefix backend run auth:init`, stop the backend, then start it with
`AUTH_MODE=token ./run.sh start backend`. This workspace already has credentials.
When token mode is enabled, sign in with
the private token in `.run/auth/operator-token`; never commit or share that file.
Browser sessions use HttpOnly cookies and CSRF protection. Restarting the backend
signs out browser sessions. Development defaults to local mode with `X-Tenant-Id`;
production requires token mode and HTTPS configuration.

Open **Build → API sources** to connect any cloud, on-premises, or custom sender.
Choose a detection rule and issue a scoped key. The sender maps its native event
to the displayed JSON contract and POSTs to the source endpoint. Keys are shown
once, stored as hashes, expire, and can be rotated or revoked immediately.
Source keys cannot read cases or administer the workspace. See
[the API contract](docs/API_CONTRACT.md) for endpoints and deployment settings.

Detection rules support creation, catalog template import, query/schedule editing,
enable/disable, routing preferences, and recorded change history. Investigation
details load case-specific summaries, evidence, tool transcripts, feedback, and
history from SQLite. These records survive service restarts.

Open **Skills** for tenant-scoped investigation and hunting guidance. Skills can
be drafted, published, scoped to modules/providers/alert context, and attached to
versioned reference materials. Matching saves the skill version and rationale on
cases or hunts for analyst review. Suggestions are derived from repeated reviewed
cases; outcome reporting shows sample counts and does not imply causal improvement.
See the [developer guide](docs/DEVELOPMENT.md), [architecture](docs/ARCHITECTURE.md),
[API contract](docs/API_CONTRACT.md), and [testing strategy](docs/TESTING.md).

Open **Investigate → Submit alert → Use example alert** to exercise the local
pipeline. Incoming alerts are deduplicated by tenant, source, and source alert ID.
Rule routing determines whether an investigation is created. A durable background
worker records supplied evidence, compares local indicators, and records a review
outcome. The UI refreshes progress automatically. Reinvestigating an ingested
alert queues another run while retaining its earlier evidence and transcript.

The local worker starts with the backend; `WORKER_ENABLED=false ./run.sh start backend`
disables it for manual development. Stop a running backend before changing this
setting. Pending phases resume on restart; failed runs require an explicit retry.

This is a local prototype: detection queries are stored, not executed against a
SIEM. The worker is deterministic, not an LLM agent, and does not run external
tools. Catalog templates are imported disabled, without query logic. Remediation,
connector tests, and hunts remain local simulations. Manual/seed cases without
an ingested alert retain the earlier manual review behavior.

Reference and implementation screenshots are in `output/playwright/`.
See [the delivery roadmap](docs/ROADMAP.md) for completed work and remaining scope.
See the [AI SOC feature roadmap](docs/FEATURE_ROADMAP.md) for the staged plan
covering connectors, investigations, detection, agents, response, hunting, and
reporting.
