# AI Marketing Studio Production Checklist

This checklist prepares the current MVP to run outside local development. It does not add product features or change the database schema.

## Current Readiness Summary

- TypeScript app shape: Express API plus Vite React frontend.
- Database status checked against the configured Supabase project: all 20 expected public tables are present.
- Storage status checked against the configured Supabase project: `post-images` and `brand-assets` both exist and are public.
- Current uploads and imported brand assets use the `post-images` bucket. Create `brand-assets` as public anyway if keeping the existing setup docs and future bucket separation.
- The frontend calls relative `/api/*` URLs. Production hosting must provide same-origin `/api` routing to the API server, or a future API-base configuration pass is required.

## Required Backend Environment

Set these on the API server host. Do not expose these values in the frontend.

| Variable | Required | Notes |
|---|---:|---|
| `NODE_ENV` | Yes | Use `production`. |
| `PORT` | Yes | Host-provided port, for example Railway `$PORT`; defaults to `8080` locally. |
| `DATABASE_URL` | Yes | Supabase Postgres connection string. Use the pooler URL for the running API; use direct `5432` only for schema push/admin work. |
| `SUPABASE_URL` | Yes | Supabase project URL. |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Backend-only service role key. Never put this in frontend env. |
| `TOKEN_ENCRYPTION_KEY` | Required for real client use | Base64-encoded 32+ byte secret. Required for OAuth tokens, social publishing, analytics refresh from connected accounts, Social Intelligence import, and Settings-stored AI keys. |
| `OPENAI_KEY` | One AI key required | Server fallback key for OpenAI. |
| `GEMINI_KEY` | One AI key required | Server fallback key for Gemini. |
| `ANTHROPIC_KEY` | One AI key required | Server fallback key for Anthropic. |
| `FAL_KEY` | Video only | Optional. Without it, Video Studio should show the configured missing-key message. |
| `GOOGLE_CLIENT_ID` | Archive only | Optional. Prepares future Google Drive archive support; not required for MVP usage. |
| `GOOGLE_CLIENT_SECRET` | Archive only | Optional backend-only secret for future Google Drive archive support. |
| `GOOGLE_REDIRECT_URI` | Archive only | Optional future callback URL, for example `https://api.yourdomain.com/api/auth/google/callback`. |
| `ENABLE_AUTO_PUBLISH` | Strongly recommended | Set `false` until OAuth/social publishing is fully configured and tested. |
| `LOG_LEVEL` | Optional | Use `info` or stricter in production. |

Generate `TOKEN_ENCRYPTION_KEY`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

## Optional Social/OAuth Environment

Only configure these when ready to test real connectors.

| Variable | Purpose |
|---|---|
| `META_APP_ID` | Meta OAuth / Facebook / Instagram. |
| `META_APP_SECRET` | Meta OAuth secret. |
| `META_REDIRECT_URI` | Public callback URL, for example `https://api.yourdomain.com/api/auth/meta/callback`. |
| `META_GRAPH_VERSION` | Defaults to `v18.0` if unset. |
| `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET` | Legacy fallback envs for Meta. |
| `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET` | Legacy fallback envs for Meta. |
| `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` | LinkedIn OAuth. |
| `TWITTER_CLIENT_ID`, `TWITTER_CLIENT_SECRET` | X/Twitter OAuth. |

## Frontend Environment

The frontend currently expects same-origin `/api/*` access.

| Variable | Required | Notes |
|---|---:|---|
| `BASE_PATH` | Usually `/` | Vite base path. |
| `PORT` | Local/preview only | Vite dev/preview port. |
| `API_PORT` | Local dev only | Used by Vite dev proxy. Not a production API URL. |

Do not set Supabase service keys in frontend env.

## Supabase Database

Expected tables:

```text
profiles
clients
client_users
brand_dna
brand_assets
storylines
posts
images
content_memory
user_settings
campaigns
social_accounts
posting_logs
posting_rules
user_api_keys
ai_ideas
campaign_outputs
video_concepts
skill_configs
quality_checks
```

Schema status from the checked Supabase project:

```text
20 expected tables present
0 expected tables missing
```

Before production:

```bash
cd ~/Desktop/ai-marketing-studio
set -a
source artifacts/api-server/.env
set +a
pnpm --filter @workspace/db run push
```

Use direct `5432` database connection for schema push/admin tasks. Use the Supabase pooler connection for the running API.

## Supabase Storage

Required current bucket:

| Bucket | Required | Public | Purpose |
|---|---:|---:|---|
| `post-images` | Yes | Yes | Logo uploads, generated images, final artwork, imported brand images, and durable video downloads currently flow through this bucket. |
| `brand-assets` | Recommended | Yes | Listed in setup docs and useful for future separation, but current upload helper stores brand assets under `post-images/assets/...`. |

Checked project status:

```text
post-images: exists, public, 50 MB, image/* + application/pdf + video/*
brand-assets: exists, public, 50 MB, image/*
```

Before real client use:

- Ensure `post-images` is public.
- Ensure `post-images` allows `image/*`, `application/pdf`, and `video/*`.
- Ensure `post-images` has at least a 50 MB file size limit.
- Keep `brand-assets` public and image-only for future storage separation.
- See `STORAGE_POLICY.md` for the non-destructive Supabase active storage and Google Drive archive plan.

Current server-side limits:

| Flow | Limit |
|---|---:|
| User upload via multer | 10 MB request file limit |
| Brand importer proxy previews | 8 MB |
| Brand asset import from URL | 10 MB |
| Supabase `post-images` target bucket | 50 MB intended server config |
| Durable video download | 50 MB |

## Auth And Session Behavior

- Auth uses Supabase Auth through API routes.
- Frontend stores `ams_token` and `ams_user` in `localStorage`.
- On app load, frontend calls `/api/auth/me`; invalid tokens clear the local session.
- API protected routes require bearer auth and client access.

Production requirements:

- Enable Email provider in Supabase Auth.
- Configure allowed site URL and redirect URLs in Supabase if using hosted auth-related redirects later.
- Use HTTPS only.
- Treat localStorage auth as acceptable for MVP usage testing, not hardened enterprise auth.

## API Startup

Build:

```bash
pnpm --filter @workspace/api-server run build
```

Start:

```bash
pnpm --filter @workspace/api-server run start
```

Health check:

```bash
node -e "fetch('https://api.yourdomain.com/api/health').then(async r => console.log(r.status, await r.text()))"
```

Expected:

```text
200 {"status":"ok"}
```

## Frontend Build And Start

Build:

```bash
pnpm --filter @workspace/marketing-studio run build
```

Preview locally:

```bash
pnpm --filter @workspace/marketing-studio run serve
```

Production hosting must route `/api/*` to the API server because frontend code currently uses relative `/api` calls.

## Scheduler And Auto-Publish Safety

The API server starts the scheduler automatically unless:

```text
ENABLE_AUTO_PUBLISH=false
```

Safety guards already present:

- Scheduler skips entirely when `ENABLE_AUTO_PUBLISH=false`.
- Scheduler skips when `TOKEN_ENCRYPTION_KEY` is missing.
- Scheduler runs a due-post recovery pass on API startup when auto-publish is enabled.
- A manual scoped check is available at `POST /api/clients/:clientId/publishing/run-due-check` for admin/dev recovery.
- Only `scheduled` posts with `scheduledAt <= now` and no `publishedAt` are considered.
- Duplicate in-flight attempts are skipped.
- Current duplicate protection is process-local only.
- Unsupported platforms fail safely with a reason.
- Video auto-publishing is blocked.
- Instagram auto-publishing requires an image/final artwork URL.
- Published state is written only after successful platform publish response.
- Failed attempts stay in `failed` with `publishError` for dashboard and queue visibility.

Reliability decision:

| Option | Fit |
|---|---|
| Current `setInterval` | Good for local and one API server. Lowest change risk. |
| BullMQ + Redis | Stronger retries/locking, but adds Redis and operational overhead. |
| Upstash QStash | Good managed delivery for serverless/hosted cron style deployments, but changes deployment shape. |
| Hosted cron hitting an endpoint | Good next step if paired with an external lock/idempotency check. |

Production recommendation:

- Keep `ENABLE_AUTO_PUBLISH=false` for first real client usage testing.
- Enable only after Meta OAuth, token encryption, connected account refresh, and one manual publish test pass.
- Before multi-server production, move scheduled publishing to a persistent queue or a hosted cron with a cross-process lock.

## CORS And Callback URLs

Current API uses permissive CORS:

```text
app.use(cors())
```

This is acceptable for local/MVP smoke testing but should be restricted before broader production exposure.

Before real client use:

- Restrict CORS to the production frontend origin.
- Configure public OAuth callback URLs:
  - Meta: `https://api.yourdomain.com/api/auth/meta/callback`
  - LinkedIn: `https://api.yourdomain.com/api/auth/oauth/linkedin/callback`
  - X/Twitter: `https://api.yourdomain.com/api/auth/oauth/twitter/callback`
- Add these exact URLs in each provider dashboard.

## Secrets Safety

Do not commit:

- `.env` files
- Supabase service role key
- `DATABASE_URL`
- AI provider keys
- OAuth client secrets
- `TOKEN_ENCRYPTION_KEY`
- `FAL_KEY`

Safe checks:

```bash
git status --short
git diff --check
git grep -n -E "SUPABASE_SERVICE_ROLE_KEY=|DATABASE_URL=postgres|OPENAI_KEY=|GEMINI_KEY=|ANTHROPIC_KEY=|FAL_KEY=|TOKEN_ENCRYPTION_KEY=" -- ':!*.example'
```

Review any hits before committing.

## Deployment Recommendation

Recommended MVP deployment:

1. Deploy API on Railway or Render as a Node service.
2. Deploy frontend on Vercel, Netlify, or Railway static hosting.
3. Add a same-origin `/api/*` rewrite/proxy from the frontend domain to the API service.
4. Keep `ENABLE_AUTO_PUBLISH=false` for initial client testing.
5. Use Supabase hosted Postgres/Auth/Storage.

Why:

- It matches the current app architecture.
- It avoids changing frontend API logic.
- It keeps secrets backend-only.
- It allows the API scheduler to run in one controlled service.

Do not deploy multiple API replicas with auto-publish enabled until there is a distributed scheduler lock or single-worker guarantee. Multiple scheduler instances can attempt the same due post at the same time; current DB guards reduce risk, but a single scheduler process is safer for MVP.

## Known Production Risks

- CORS is currently permissive and should be allowlisted before public use.
- Frontend requires same-origin `/api` routing or rewrite/proxy.
- Current code stores brand imports under `post-images/assets/...`; `brand-assets` exists for future separation but is not active in the app yet.
- Auto-publish should remain disabled until connector OAuth and token encryption are configured and tested.
- Existing local provider logs showed OpenAI auth failure with Gemini fallback succeeding; verify production AI keys before client demos.
- Browser print reports are MVP-grade exports, not archived/report-versioned PDFs.
- Google Drive archive is V1 scaffold-only; no Drive upload, token storage, automatic deletion, or cleanup job is enabled.
- Auth tokens live in `localStorage`; acceptable for MVP testing, not enterprise hardening.
- Supabase service role key gives broad backend access; keep it only in server secrets.

## Must Configure Before Real Client Use

- Production `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
- `TOKEN_ENCRYPTION_KEY` generated as base64 32+ bytes.
- At least one working AI provider key.
- `post-images` public bucket with enough size/mime configuration.
- Frontend-to-API same-origin route or rewrite.
- CORS allowlist.
- Supabase Auth email provider and production URLs.
- Backups for Supabase Postgres.

## Keep Disabled Until Configured

- `ENABLE_AUTO_PUBLISH` should stay `false`.
- Meta/LinkedIn/Twitter OAuth buttons should be treated as unavailable until provider credentials and callbacks are configured.
- Social Intelligence import and analytics refresh from connected platforms require `TOKEN_ENCRYPTION_KEY` and connected OAuth accounts.
- Video generation should be treated as unavailable unless `FAL_KEY` is configured.
- Google Drive archiving should be treated as unavailable until OAuth/token storage and a verified upload path are implemented.

## Final Release Gate

Run before deployment:

```bash
pnpm run typecheck
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/marketing-studio run build
```

Then smoke test:

```bash
curl -i https://api.yourdomain.com/api/health
```

And browser test:

```text
Login -> select client -> Dashboard -> Brand Setup -> Review -> Publish Queue -> Analytics -> Reports
```
