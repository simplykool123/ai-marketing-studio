# AI Marketing Studio — Local Development Guide

This guide covers running the app entirely outside Replit using:
- **Supabase** for PostgreSQL database, Auth, and file Storage
- **Any host** (VS Code locally, Railway, Render, Vercel, etc.)

---

## Architecture Overview

```
artifacts/
  marketing-studio/   ← React + Vite frontend  (default port 5173)
  api-server/         ← Express 5 API backend  (default port 8080)
lib/
  db/                 ← Drizzle ORM schema + migrations
  api-spec/           ← OpenAPI spec
  api-zod/            ← Generated Zod validators
  api-client-react/   ← Generated React Query hooks
```

In local dev, Vite proxies all `/api/*` calls to the Express server automatically — no CORS config needed.

---

## Prerequisites

| Tool | Minimum version | Install |
|---|---|---|
| Node.js | 20.x | https://nodejs.org |
| pnpm | 9.x | `npm install -g pnpm@9` |
| Git | any | https://git-scm.com |

---

## 1 — Supabase Project Setup

You need **one Supabase project** that handles auth, storage, and the database.

### 1a — Create the project
1. Go to https://supabase.com and create a new project
2. Note your **Project Reference ID** (shown in the URL: `https://supabase.com/dashboard/project/<ref>`)

### 1b — Get your credentials
From **Project Settings → API**:
- `SUPABASE_URL` = `https://<ref>.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY` = the `service_role` secret key (backend only)
- `VITE_SUPABASE_ANON_KEY` = the `anon` public key (frontend)

From **Project Settings → Database → Connection string → URI**:
- Copy the **direct** connection string (port 5432) — use this as `DATABASE_URL`
- Replace `[YOUR-PASSWORD]` with your database password

### 1c — Create Storage buckets
In the Supabase dashboard, go to **Storage** and create two buckets:
1. `post-images` — set to **Public**
2. `brand-assets` — set to **Public**

### 1d — Enable Auth providers
Go to **Authentication → Providers** and enable at minimum:
- **Email** (enabled by default)

---

## 2 — Clone & Install

```bash
git clone https://github.com/YOUR_USERNAME/ai-marketing-studio.git
cd ai-marketing-studio
```

### macOS / Windows — Fix platform overrides first

The `pnpm-workspace.yaml` has Linux-only esbuild overrides for the Replit environment.
**Before running `pnpm install` on macOS or Windows**, remove the `overrides` block from `pnpm-workspace.yaml`
(everything from `overrides:` to the end of the file), or pnpm will fail to install native binaries.

Then install:

```bash
pnpm install
```

---

## 3 — Environment Variables

### Backend (`artifacts/api-server/.env`)

Copy the example and fill in values:

```bash
cp artifacts/api-server/.env.example artifacts/api-server/.env
```

**Required variables:**

| Variable | Where to get it |
|---|---|
| `DATABASE_URL` | Supabase → Project Settings → Database → Connection string (URI, port 5432) |
| `SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → service_role key |
| `TOKEN_ENCRYPTION_KEY` | Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `ANTHROPIC_KEY` / `OPENAI_KEY` / `GEMINI_KEY` | At least one AI key required |

**Optional (OAuth social platforms):**

| Variable | Purpose |
|---|---|
| `FACEBOOK_APP_ID` + `FACEBOOK_APP_SECRET` | Facebook / Instagram OAuth |
| `LINKEDIN_CLIENT_ID` + `LINKEDIN_CLIENT_SECRET` | LinkedIn OAuth |
| `TWITTER_CLIENT_ID` + `TWITTER_CLIENT_SECRET` | Twitter/X OAuth |

### Frontend (`artifacts/marketing-studio/.env`)

The frontend does **not** talk to Supabase directly — all auth and data goes through the Express API. Only three vars needed:

```bash
cp artifacts/marketing-studio/.env.example artifacts/marketing-studio/.env
```

| Variable | Value |
|---|---|
| `PORT` | `5173` |
| `BASE_PATH` | `/` |
| `API_PORT` | `8080` (must match backend PORT; used by Vite's local proxy) |

---

## 4 — Database Setup (Drizzle → Supabase Postgres)

This pushes all Drizzle schema tables to your Supabase PostgreSQL database.
Run this once on first setup and again any time the schema changes.

```bash
# Make sure DATABASE_URL is set in artifacts/api-server/.env OR exported:
export DATABASE_URL="postgresql://postgres.[ref]:[password]@..."

pnpm --filter @workspace/db run push
```

This creates all tables:
`clients`, `brand_dna`, `brand_assets`, `storylines`, `posts`, `images`,
`content_memory`, `user_settings`, `campaigns`, `social_accounts`,
`posting_logs`, `posting_rules`

---

## 5 — Run Locally

Open **two terminals**:

### Optional — enable Brand Importer visual screenshot analysis

The Brand Setup website importer can analyze the rendered homepage palette and hero images when Chromium is installed for Playwright. Install the browser once after dependencies are installed:

```bash
pnpm --filter @workspace/api-server exec playwright install chromium
```

If Chromium is not installed or a website blocks rendering, the importer still falls back to HTML/CSS extraction and shows a warning in the importer result.

**Terminal 1 — API server:**
```bash
cd artifacts/api-server
pnpm dev
# → Server listening on port 8080
```

**Terminal 2 — Frontend:**
```bash
cd artifacts/marketing-studio
pnpm dev
# → Vite dev server on http://localhost:5173
```

Open http://localhost:5173 in your browser.

The Vite dev server automatically proxies `/api/*` → `http://localhost:8080` so there's no CORS issue.

---

## 6 — TypeCheck & Build

```bash
# Typecheck everything (from repo root):
pnpm typecheck

# Typecheck libs only:
pnpm typecheck:libs

# Build everything:
pnpm build

# Build just the frontend:
pnpm --filter @workspace/marketing-studio run build

# Build just the API:
pnpm --filter @workspace/api-server run build
```

---

## 7 — Migrating Data from Replit PostgreSQL to Supabase

If you have existing data in Replit's built-in PostgreSQL that you want to move:

### 7a — Export from Replit

In the Replit shell:

```bash
# Export full schema + data
pg_dump "$DATABASE_URL" \
  --no-owner \
  --no-acl \
  --format=plain \
  --file=replit_export.sql

# Or export data only (if schema already pushed to Supabase):
pg_dump "$DATABASE_URL" \
  --no-owner \
  --no-acl \
  --data-only \
  --format=plain \
  --file=replit_data.sql
```

### 7b — Import to Supabase

```bash
# Set your Supabase direct connection string
export SUPABASE_DB_URL="postgresql://postgres.[ref]:[password]@db.[ref].supabase.co:5432/postgres"

# Push schema first (creates all tables):
pnpm --filter @workspace/db run push

# Then import data only:
psql "$SUPABASE_DB_URL" -f replit_data.sql
```

### 7c — File storage migration (optional)

If you have images stored in Replit's Supabase Storage buckets (they're already in Supabase),
no migration is needed — just point the same `SUPABASE_URL` and keys at the same project.

---

## 8 — Deployment Options

### Option A — Railway (recommended for full-stack)

1. Connect your GitHub repo to Railway
2. Create two services: `api-server` and `marketing-studio`
3. Set the root directory for each service to the respective `artifacts/` folder
4. Add all environment variables from the `.env.example` files
5. Set `PORT` to Railway's `$PORT` variable
6. The frontend needs `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` at build time

### Option B — Vercel (frontend) + Railway (backend)

**Frontend on Vercel:**
```bash
cd artifacts/marketing-studio
vercel deploy
# Set env vars: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
# Set BASE_PATH=/
```

**Backend on Railway:**
- Point at `artifacts/api-server/`
- Set all backend env vars

**Update Vite proxy for production:**
Set `VITE_API_URL=https://your-railway-backend.up.railway.app` and update the proxy config.

### Option C — Render

Same approach as Railway — set root directory per service.

---

## 9 — VS Code Recommended Extensions

Create `.vscode/extensions.json`:
```json
{
  "recommendations": [
    "esbenp.prettier-vscode",
    "dbaeumer.vscode-eslint",
    "bradlc.vscode-tailwindcss",
    "Prisma.prisma",
    "ms-vscode.vscode-typescript-next"
  ]
}
```

---

## 10 — Troubleshooting

### `pnpm install` fails with platform errors on macOS/Windows
Remove the `overrides:` block from `pnpm-workspace.yaml` — it pins Linux-only binaries for the Replit environment.

### `PORT environment variable is required`
The API server and Vite server now default to `8080` and `5173` respectively. Make sure you're not accidentally setting PORT= in a parent shell.

### `BASE_PATH environment variable is required`
Vite now defaults `BASE_PATH` to `/`. This error only appears on old Replit deploys. Pull the latest code.

### Database connection errors
- Ensure `DATABASE_URL` uses the **direct** connection (port 5432), not the pooler, when running `drizzle-kit push`
- For the running API, either connection type works

### Supabase Storage upload fails
Make sure the `post-images` and `brand-assets` buckets exist in your Supabase project and are set to **Public**.

### Social OAuth not working
OAuth callbacks require a publicly accessible URL. Use ngrok or similar for local testing:
```bash
ngrok http 8080
# Then set: REPLIT_DEV_DOMAIN=your-ngrok-subdomain.ngrok.io (without https://)
```

---

## Environment Variable Reference (complete)

### Backend

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✅ | Supabase Postgres connection string |
| `SUPABASE_URL` | ✅ | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Supabase service role secret |
| `TOKEN_ENCRYPTION_KEY` | ✅ | 32+ byte hex string for encrypting OAuth tokens |
| `ANTHROPIC_KEY` | One required | Anthropic Claude API key |
| `OPENAI_KEY` | One required | OpenAI API key |
| `GEMINI_KEY` | One required | Google Gemini API key |
| `PORT` | ❌ | API server port (default: 8080) |
| `NODE_ENV` | ❌ | `development` or `production` |
| `LOG_LEVEL` | ❌ | Pino log level (default: `info`) |
| `FACEBOOK_APP_ID` | ❌ | Facebook OAuth |
| `FACEBOOK_APP_SECRET` | ❌ | Facebook OAuth |
| `INSTAGRAM_APP_ID` | ❌ | Instagram OAuth |
| `INSTAGRAM_APP_SECRET` | ❌ | Instagram OAuth |
| `LINKEDIN_CLIENT_ID` | ❌ | LinkedIn OAuth |
| `LINKEDIN_CLIENT_SECRET` | ❌ | LinkedIn OAuth |
| `TWITTER_CLIENT_ID` | ❌ | Twitter/X OAuth |
| `TWITTER_CLIENT_SECRET` | ❌ | Twitter/X OAuth |

### Frontend

The frontend calls all auth and data endpoints through the Express API.
No Supabase keys needed in the browser.

| Variable | Required | Description |
|---|---|---|
| `PORT` | ❌ | Vite dev server port (default: 5173) |
| `BASE_PATH` | ❌ | URL base path (default: `/`) |
| `API_PORT` | ❌ | Backend port for Vite proxy (default: 8080) |
