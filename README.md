# 7AI Local Replica

Local, screenshot-driven React replica with a SQLite-backed service.

## Workspace

- `frontend/` - React, Chakra UI, Vite
- `backend/` - TypeScript, Fastify, Node SQLite
- `docs/` - architecture, API, data model, decisions, and roadmap
- `screenshots/` - visual references

## Development

```bash
# Backend
cd backend
npm install
npm run dev

# Frontend (another terminal)
cd frontend
npm install
npm run dev
```

Default URLs:

- Frontend: `http://localhost:8080`
- Backend: `http://localhost:3002`
- Health: `http://localhost:3002/health`

Authentication is intentionally bypassed for local development. The backend still
models tenant isolation through `X-Tenant-Id`, defaulting to `demo`.
