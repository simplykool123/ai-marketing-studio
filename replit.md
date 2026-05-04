# AI Marketing Studio

## Overview

Multi-client AI digital marketing agency platform. Manages brand setup, social media account connections, AI-generated content (captions + images), drafts, campaigns, scheduling, posting foundation, asset library, posting queue, a full command-center dashboard, and content calendar — all per client. Now with Supabase Auth login and per-user AI provider settings.

## Stack

- **Monorepo**: pnpm workspaces, TypeScript 5.9, Node.js 24
- **Frontend**: React + Vite (`artifacts/marketing-studio`) at port 22628
- **Backend**: Express 5 API server (`artifacts/api-server`) at port 8080
- **Database**: PostgreSQL (Replit built-in) + Drizzle ORM
- **Auth**: Supabase Auth (email/password) via service role proxy
- **Validation**: Zod v4, drizzle-zod
- **API codegen**: Orval from OpenAPI spec → React Query hooks + Zod schemas
- **AI**: Configurable provider (Anthropic/OpenAI/Gemini) for captions; OpenAI DALL-E 3 for images
- **Image storage**: Supabase Storage (optional)

## Architecture

```
lib/
  api-spec/          OpenAPI spec + Orval codegen config
  api-zod/           Generated Zod schemas (do NOT manually edit)
  api-client-react/  Generated React Query hooks (do NOT manually edit)
  db/                Drizzle ORM schema + db client

artifacts/
  api-server/        Express backend
    src/routes/      clients, brand_dna, storylines, posts, images, memory,
                     dashboard, ai (captions, images, suggestions), ai_content
                     (generate-plan, regenerate-copy, generate-image, bulk-generate),
                     auth, settings, campaigns, upload, social_accounts
    src/lib/         context-engine (builds AI context incl. content strategy),
                     supabase (storage)
    src/middleware/  auth.ts (requireAuth — Supabase JWT validation)
  marketing-studio/  React frontend
    src/context/     AuthContext.tsx (Supabase Auth, token in localStorage)
    src/pages/       ClientSelector, ClientDashboard, BrandDna, Storylines,
                     CreatePost, Drafts, Calendar, Memory, AssetLibrary,
                     LoginPage, SettingsPage, CampaignPlanner, PostingQueue,
                     SocialAccounts, BulkGenerate
    src/components/  Layout, Sidebar, AiBrainWidget, PlatformPreview, shadcn/ui
```

## Task #1 — Core Platform & Dashboard (Completed)

1. **Social Accounts** (`/clients/:id/social-accounts`) — Connect/manage Instagram, Facebook, Twitter, LinkedIn accounts per brand. Toggle active/inactive, disconnect. `social_accounts` DB table with platform, accountName, accountHandle, followerCount, isActive.
2. **Enhanced Dashboard** — 4 stat cards (Total Posts, Drafts, Scheduled, Published). Connected Accounts section shows active social accounts. Upcoming Scheduled Posts section lists future-scheduled posts. All fetched via updated `/clients/:id/dashboard` endpoint.
3. **Social Accounts API** — `GET/POST /clients/:id/social-accounts`, `PATCH/DELETE /clients/:id/social-accounts/:accountId`

## Task #2 — AI Content Engine (Completed)

1. **Content Strategy fields** — `brand_dna` extended with `contentThemes`, `postingCadence`, `audiencePersonas`, `campaignGoals`. Shown as new "Content Strategy" card in Brand DNA page. All fields fed to AI context for every generation call.
2. **Campaign Plan Generation** — `POST /clients/:id/campaigns/:campaignId/generate-plan` — Claude generates N post outlines for a campaign, saved as drafts. "AI Plan" button on each campaign card opens a config dialog (post count, platforms).
3. **Per-post Regenerate Copy** — `POST /clients/:id/posts/:postId/regenerate-copy` — Claude rewrites caption + hashtags for a draft post. "Redo Copy" button on each draft card.
4. **Per-post Image Generation** — `POST /clients/:id/posts/:postId/generate-image` — DALL-E 3 generates an image using the brand visual style + caption (or stored `imagePrompt`), saves URL to `posts.selectedImageUrl` AND inserts a row into the `images` asset table. "Gen Image" / "New Image" button on each draft card.
5. **Bulk Generate** — `POST /clients/:id/generate-bulk` — Generates a full 1–4 week content calendar (3/5/7 posts/week) in one Claude call, saved as drafts with `generationStatus="generating"`. Background DALL-E 3 fires automatically for each generated post; results saved to both `posts.selectedImageUrl` and the `images` asset table. Dedicated `/bulk-generate` page with duration/platform config and per-post progress queue (spinner → image thumbnail) that polls every 2.5s.
6. **Generation Status Queue** — `posts` table extended with `generationStatus` (generating|ready|failed) and `imagePrompt` fields. Both campaign plan generation and bulk generation use this for the auto image flow; per-post status transitions are visible in the Bulk Generate UI as a live progress list.

## Phase 1 MVP Features (All Implemented)

1. **Supabase Auth** — email/password login/signup. JWT stored in `localStorage` as `ams_token`. `AuthContext` validates token on mount. `ProtectedRoute` gates all app routes.
2. **Settings Page** (`/settings`) — AI provider selector (Anthropic/OpenAI/Gemini), model picker, image provider settings saved per-user in `user_settings` table.
3. **AI Provider Selector** — All text generation uses the user's preferred provider+model from settings. Defaults to `claude-opus-4-5`.
4. **AI Brain Widget** — On the client dashboard: "Generate Ideas" calls `POST /clients/:id/suggestions` → 5 personalised content ideas with topic, platform, rationale, hook. "Create Post" button navigates to `/clients/:id/create?topic=...`.
5. **Platform Preview Cards** — `PlatformPreview` component renders realistic social-network mockups (Instagram, Facebook, LinkedIn, Twitter/X, Blog, Newsletter). Shown live in step 3 of the Create Post wizard.
6. **Manual Post** — Full manual post editor with all fields.
7. **Campaign Planner** (`/clients/:id/campaigns`) — CRUD campaigns with name, goal, description, dates, platforms, and status (draft/active/paused/completed). + AI Plan button.
8. **Blog + Newsletter modules** — "Newsletter" added to platform list in Create Post. `postType` and `title` fields on the Post model. `longFormBody` for blog/newsletter content. PlatformPreview renders blog/newsletter mockups.
9. **Posting Queue** (`/clients/:id/queue`) — All posts sorted by `scheduledAt`, filterable by status. One-click "Mark Published" action.
10. **Client Selector**: Home page grid of brand clients with avatars and colors.
11. **Brand DNA**: Rich form (brand name, voice, audience, visual style, competitors) used as AI context.
12. **Storylines**: Active/inactive narrative campaigns that inform AI generation.
13. **Create Post** (3-step wizard):
    - Enter topic → AI generates 3 caption options (provider-configurable).
    - Select/edit caption → AI generates images.
    - Review + save as draft.
14. **Drafts & Posts**: Tabbed view (Drafts / Approved). Drafts can be approved+scheduled. Approved posts have full action bar: Mock Post, Mark Posted, Copy Caption, Download Asset, Webhook Export, Export JSON.
15. **Calendar**: Month view with post markers; click to see post details. Includes timeline view of upcoming scheduled posts.
16. **Memory**: Persistent key/value AI context store.
17. **Asset Library**: Filterable grid of all client images (generated/uploaded), organized by status (selected, pending, rejected). Actions: reject, restore, download, delete.
18. **Enhanced Dashboard**: Command center with AI Recommendation card, Today's Content, Upcoming Schedule timeline, Active Storyline, Pending Approvals count, Recent Posts grid.
19. **Sidebar Navigation**: Grouped sections — Overview, Content (Brain, Research, Composer), Publish (Campaigns, Blog, Newsletters, Approvals, Calendar, Drafts), Library (Asset Library, Memory), Settings. Approvals badge shows pending count.

## Database Schema

Tables: `clients`, `brand_dna`, `storylines`, `posts`, `images`, `content_memory`, `user_settings`, `campaigns`, `social_accounts`, `posting_logs`

**user_settings**: userId (FK Supabase auth), aiProvider, aiModel, imageProvider, imageModel
**campaigns**: clientId, name, goal, description, startDate, endDate, platforms (comma-sep), status
**posts** extensions: campaignId, postType ('social'|'blog'|'newsletter'), title, longFormBody, generationStatus ('generating'|'ready'|'failed'), imagePrompt
**brand_dna** extensions: contentThemes, postingCadence, audiencePersonas, campaignGoals
**social_accounts**: clientId (FK), platform (instagram|facebook|twitter|linkedin), accountName, accountHandle, accountId, accessToken, refreshToken, tokenExpiresAt, avatarUrl, followerCount, isActive

Posting log actions: `mock_post`, `mark_posted_manually`, `webhook_export`

## API Endpoints

Base path: `/api`

| Method | Path | Description |
|--------|------|-------------|
| POST | /auth/signup | Create user (Supabase admin API) |
| POST | /auth/login | Sign in (returns JWT) |
| POST | /auth/logout | Invalidate token |
| GET | /auth/me | Validate token, return user |
| GET/PUT | /settings | Get/update user settings (requires auth) |
| GET/POST | /clients/:id/campaigns | List/create campaigns |
| PATCH/DELETE | /clients/:id/campaigns/:id | Update/delete campaign |
| POST | /clients/:id/campaigns/:cId/generate-plan | AI: generate N post drafts for campaign |
| POST | /clients/:id/suggestions | AI Brain — 5 content ideas |
| POST | /clients/:id/posts/:postId/regenerate-copy | AI: rewrite caption + hashtags |
| POST | /clients/:id/posts/:postId/generate-image | AI: DALL-E 3 image, save URL to post |
| POST | /clients/:id/generate-bulk | AI: generate full week/month content calendar |
| GET | /clients | List all clients |
| POST | /clients | Create client |
| GET/PATCH/DELETE | /clients/:id | Get/update/delete client |
| GET/PUT | /clients/:id/brand-dna | Get or upsert Brand DNA |
| GET/POST | /clients/:id/storylines | List/create storylines |
| PATCH/DELETE | /clients/:id/storylines/:id | Update/delete storyline |
| GET/POST | /clients/:id/posts | List/create posts |
| GET/PATCH/DELETE | /clients/:id/posts/:id | Get/update/delete post |
| POST | /clients/:id/posts/:id/approve | Approve + schedule post |
| GET | /clients/:id/dashboard | Enhanced dashboard (stats, connectedAccounts, upcomingPosts, today, storyline) |
| GET/POST | /clients/:id/social-accounts | List/connect social accounts |
| PATCH/DELETE | /clients/:id/social-accounts/:id | Update/disconnect social account |
| POST | /clients/:id/posts/:id/mock-post | Mock publish (sets status=published, logs action) |
| POST | /clients/:id/posts/:id/mark-posted | Mark as manually posted |
| POST | /clients/:id/webhook/export | Send content payload to webhook URL |
| GET | /clients/:id/posts/export | Export approved posts as Postiz JSON |
| GET | /clients/:id/images | List all images for a client (asset library) |
| PATCH/DELETE | /clients/:id/images/:id | Update/delete image |
| GET/POST | /clients/:id/posts/:id/images | List/save post images |
| GET/POST/DELETE | /clients/:id/memory | List/add/delete memory entries |
| POST | /ai/generate-captions | Generate 3 captions (provider-configurable) |
| POST | /ai/generate-images | Generate images with DALL-E 3 |

## Sidebar Navigation (per client)

Dashboard → Brand DNA → Storylines → Campaigns → Social Accounts → [divider] → AI Create → Bulk Generate → Manual Post → [divider] → Drafts → Posting Queue → Calendar → Memory → [bottom] Settings + user/logout

## Key Commands

- `pnpm --filter @workspace/api-server run dev` — run API server
- `pnpm --filter @workspace/marketing-studio run dev` — run frontend
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)

## Important Notes

- `lib/api-zod/src/index.ts` must only export `./generated/api` (NOT `./generated/types`)
- API codegen: run `pnpm exec orval --config lib/api-spec/orval.config.ts` directly to skip typecheck
- After codegen, patch `zod.instanceof(File)` → `zod.any()` in `lib/api-zod/src/generated/api.ts`
- All AI keys are backend-only: `ANTHROPIC_KEY`, `OPENAI_KEY`, `GEMINI_KEY`
- Supabase keys: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (auth + optional image storage)
- Auth token stored in `localStorage` as `ams_token`; `setAuthTokenGetter` from api-client-react attaches it to all generated API calls
- The posts export route `/clients/:clientId/posts/export` is registered BEFORE `/:postId` in posts.ts to avoid Express routing conflict
- Settings endpoint requires `requireAuth` middleware; clients/posts endpoints do NOT require auth (optional migration path)
- AI Brain suggestions call the AI provider — requires valid API key with credits
- Bulk generation and campaign plan generation are synchronous (may take 15-30s for large batches)
- New API routes (mock-post, webhook, images) use direct fetch in frontend rather than generated client to avoid codegen cycle
- Posting logs table records all mock, manual, and webhook publish actions
