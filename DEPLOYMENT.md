# Deployment Guide

ReplitReasoner is a monorepo with two deployable pieces:

| Piece | Path | Runtime |
|---|---|---|
| Frontend (React + Vite) | `artifacts/reasoner/` | Vercel / any static host |
| API Server (Express) | `artifacts/api-server/` | Railway / Render / Fly.io |

---

## Local Development

```bash
# 1. Install dependencies
pnpm install

# 2. Copy and fill in env files
cp artifacts/api-server/.env.example artifacts/api-server/.env
cp artifacts/reasoner/.env.example artifacts/reasoner/.env

# 3. Push DB schema
pnpm --filter @workspace/db run push

# 4. Start API server (terminal 1)
PORT=5000 DATABASE_URL=<your-pg-url> OPENROUTER_API_KEY=<your-key> \
  pnpm --filter @workspace/api-server run dev

# 5. Start frontend (terminal 2) — Vite proxies /api → localhost:5000 automatically
pnpm --filter @workspace/reasoner run dev
```

Open http://localhost:5173

---

## Deploy API — Railway (recommended)

1. Push this repo to GitHub.
2. Create a new Railway project → "Deploy from GitHub repo".
3. Set the **root directory** to `artifacts/api-server`.
4. Add environment variables:
   - `DATABASE_URL` — your Postgres connection string (Railway can provision one)
   - `OPENROUTER_API_KEY` — from https://openrouter.ai
5. Railway auto-detects the `package.json` start script and deploys.

Note your Railway API URL — you'll need it for the frontend step.

---

## Deploy Frontend — Vercel

1. Import the same GitHub repo in Vercel.
2. Set **Root Directory** to `artifacts/reasoner`.
3. Set **Build Command** to:
   ```
   cd ../.. && pnpm install --no-frozen-lockfile && pnpm -w run typecheck:libs && cd artifacts/reasoner && pnpm run build
   ```
4. Set **Output Directory** to `dist`.
5. Add environment variable:
   - `VITE_API_URL` — your Railway API URL (e.g. `https://my-api.up.railway.app`)
6. Deploy. The `vercel.json` inside `artifacts/reasoner/` handles SPA routing.

---

## Environment Variables Summary

### API Server
| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `OPENROUTER_API_KEY` | Yes | OpenRouter key from openrouter.ai |
| `PORT` | No | HTTP port (default: 5000) |

### Frontend
| Variable | Required | Description |
|---|---|---|
| `VITE_API_URL` | Production only | Full URL of the API server |
| `PORT` | No | Vite dev server port (default: 5173) |
| `API_PORT` | No | Local proxy target port (default: 5000) |
