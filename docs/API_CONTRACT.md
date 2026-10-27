# HTTP API Contract

Base URL: `http://localhost:3002/api/v1`

Every domain request accepts `X-Tenant-Id`. It defaults to `demo` locally.

## Platform

| Method | URL | Purpose |
|---|---|---|
| GET | `/health` | Liveness, database status, version |
| GET | `/api/v1/dashboard` | Queue metrics and recent activity |

## Investigations

| Method | URL | Purpose |
|---|---|---|
| GET | `/investigations` | List; supports `search`, `status`, `severity`, `limit`, `offset` |
| POST | `/investigations` | Create |
| GET | `/investigations/:id` | Detail with artifacts and remediations |
| PATCH | `/investigations/:id` | Update editable fields |
| DELETE | `/investigations/:id` | Delete local record |
| POST | `/investigations/:id/reinvestigate` | Reset lifecycle and increment replay count |
| POST | `/investigations/:id/determination` | Set determination and workflow state |

## Detection Rules

| Method | URL | Purpose |
|---|---|---|
| GET/POST | `/detection-rules` | List/create |
| GET/PATCH/DELETE | `/detection-rules/:id` | Read/update/delete |
| POST | `/detection-rules/:id/toggle` | Enable or disable |

## Hunts

| Method | URL | Purpose |
|---|---|---|
| GET/POST | `/hunts` | List/create hunt definitions |
| GET/PATCH/DELETE | `/hunts/:id` | Read/update/delete |
| POST | `/hunts/:id/run` | Create a deterministic local execution |

## Connectors

| Method | URL | Purpose |
|---|---|---|
| GET/POST | `/connectors` | List/create configured connectors |
| GET/PATCH/DELETE | `/connectors/:id` | Read/update/delete |
| POST | `/connectors/:id/test` | Validate required config and update health |

Secrets are accepted for local testing but are never returned by list/detail endpoints.

## Remediations

| Method | URL | Purpose |
|---|---|---|
| GET/POST | `/remediations` | List/create; filter by `investigationId` |
| GET/PATCH/DELETE | `/remediations/:id` | Read/update/delete |
| POST | `/remediations/:id/execute` | Transition `pending` to `completed` |

## Error Envelope

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Investigation not found",
    "details": null
  }
}
```
