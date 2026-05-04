# AI Marketing Studio — Full Project Overview

> Review document. Snapshot of everything built across all completed tasks so it can be cross-checked with another AI.

---

## 1. What this app is

A multi-client AI digital marketing agency platform. One operator (logged-in user) manages many brand "clients". For each client the app handles:

- Brand identity (Brand DNA + content strategy)
- Connected social accounts (Instagram, Facebook, Twitter/X, LinkedIn)
- Campaigns (with goals, dates, target platforms)
- AI content generation — captions, hashtags, DALL·E images, full week/month plans
- Drafts, edits, regeneration
- **Approval workflow + auto-scheduler + posting rules** (Task #4)
- Calendar with drag-and-drop rescheduling
- Posting queue, asset library, persistent AI memory
- Mock publishing + webhook export + Postiz JSON export

---

## 2. Tech stack

| Layer | Choice |
|---|---|
| Monorepo | pnpm workspaces, TypeScript 5.9, Node 24 |
| Frontend | React + Vite (`artifacts/marketing-studio`, port 22628) |
| Backend | Express 5 (`artifacts/api-server`, port 8080) |
| DB | PostgreSQL (Replit built-in) + Drizzle ORM |
| Auth | Supabase Auth (email/password, JWT in `localStorage`) |
| Validation | Zod v4, drizzle-zod |
| API contract | OpenAPI → Orval → React Query hooks + Zod schemas |
| AI text | Configurable: Anthropic / OpenAI / Gemini (per-user setting) |
| AI images | OpenAI DALL·E 3 |
| Image storage | Supabase Storage (optional) |

---

## 3. Repo layout

```
lib/
  api-spec/          OpenAPI spec + Orval config
  api-zod/           Generated Zod schemas (do NOT hand-edit)
  api-client-react/  Generated React Query hooks (do NOT hand-edit)
  db/                Drizzle schema + db client

artifacts/
  api-server/        Express backend
    src/routes/      ai, ai_content, auth, brand_assets, brand_dna,
                     campaigns, clients, dashboard, health, images,
                     memory, oauth, posting_rules, posts, publish,
                     settings, social_accounts, storylines, upload
    src/lib/         context-engine, scheduler, supabase
    src/middleware/  auth (Supabase JWT)

  marketing-studio/  React frontend
    src/context/     AuthContext (Supabase token in localStorage)
    src/pages/       ApprovalQueue, AssetLibrary, BrandDna, BulkGenerate,
                     Calendar, CampaignPlanner, ClientDashboard,
                     ClientSelector, CreatePost, Drafts, LoginPage,
                     ManualPost, Memory, PostingQueue, PostingRulesPage,
                     SettingsPage, SocialAccounts, Storylines
    src/components/  Layout, Sidebar (with pending-approval toast),
                     AiBrainWidget, PlatformPreview, shadcn/ui
```

---

## 4. Completed tasks

### Task #1 — Core platform & dashboard

- `social_accounts` table + full CRUD (`/clients/:id/social-accounts`).
- Per-platform connect/disconnect/toggle with handle, follower count, avatar.
- Enhanced dashboard: 4 stat cards (Total / Drafts / Scheduled / Published), connected accounts panel, upcoming-scheduled timeline. Backed by `/clients/:id/dashboard`.

### Task #2 — AI content engine

- Brand DNA extended with `contentThemes`, `postingCadence`, `audiencePersonas`, `campaignGoals` — fed into every AI call.
- **Campaign plan generation** — `POST /clients/:id/campaigns/:cId/generate-plan`. Claude generates N post outlines, saved as drafts.
- **Per-post regenerate copy** — Claude rewrites caption + hashtags.
- **Per-post image generation** — DALL·E 3 image, saved to both `posts.selectedImageUrl` and the `images` asset table.
- **Bulk Generate** — `POST /clients/:id/generate-bulk`. One Claude call produces 1–4 weeks of posts; background DALL·E fires per post; `/bulk-generate` page polls every 2.5s and shows live progress (spinner → thumbnail).
- `posts.generationStatus` (`generating | ready | failed`) and `posts.imagePrompt` added.

### Task #3 — Social media integrations (foundation)

- Schema + endpoints to register social accounts per client (token fields ready for OAuth — Instagram, Facebook, Twitter, LinkedIn).
- Mock publish + manual mark-as-posted + webhook export + Postiz JSON export.
- `posting_logs` table records every publish action (`mock_post`, `mark_posted_manually`, `webhook_export`).

### Task #4 — Approval workflow & scheduler ⭐ (most recent)

**New DB table: `posting_rules`**
- `clientId`, `platform`, `maxPostsPerDay`, `preferredWindows` (JSON array of `{startHour,endHour}`), `blackoutDates` (JSON array of ISO dates).

**New / updated API endpoints**
| Method | Path | Purpose |
|---|---|---|
| POST | `/clients/:id/posts/:postId/approve` | Approve + schedule (status → **scheduled**) |
| POST | `/clients/:id/posts/:postId/reject` | Reject a draft (status → **rejected**) |
| POST | `/clients/:id/posts/bulk-approve` | Approve many in one call |
| POST | `/clients/:id/posts/auto-schedule` | Auto-place drafts into next valid slots using posting rules |
| GET/POST | `/clients/:id/posting-rules` | List/create per-platform rules |
| PATCH/DELETE | `/clients/:id/posting-rules/:id` | Update/delete a rule |

**Status state machine fix (important)** — `approve`, `bulk-approve`, and `auto-schedule` now set status to **`scheduled`** (not `approved`) when `scheduledAt` is provided, so the existing scheduler in `artifacts/api-server/src/lib/scheduler.ts` actually picks them up. Added `"rejected"` to the `validStatuses` allow-list in the PATCH endpoint.

**Auto-scheduler logic**
- Loads posting rules for the client.
- For each draft: finds the next non-blackout day where the platform's daily post count is below `maxPostsPerDay`, and within one of the `preferredWindows`.
- Per-platform daily limit enforcement (review fix).

**Frontend pages added**
- **`ApprovalQueue.tsx`** — Drafts list with bulk multi-select, "Approve all selected", inline edit dialog (caption + image swap), per-post approve dialog (shows AI-suggested publish time), reject button.
- **`PostingRulesPage.tsx`** — UI to set max posts/day per platform, preferred posting windows, blackout dates.
- **`Calendar.tsx`** — Monthly grid with HTML5 drag-and-drop to reschedule a post to a different day. Filters approved/scheduled/published.

**UX additions**
- Sidebar shows toast notification when pending-approval count increases.
- Sidebar nav link to Posting Rules.
- Approve dialog suggests next valid publish time from the rules engine.

---

## 5. Database schema (current)

Tables: `clients`, `brand_dna`, `storylines`, `posts`, `images`, `content_memory`, `user_settings`, `campaigns`, `social_accounts`, `posting_logs`, **`posting_rules`** (new in Task #4), `brand_assets`.

Key extensions:
- **posts**: `campaignId`, `postType` (`social|blog|newsletter`), `title`, `longFormBody`, `generationStatus`, `imagePrompt`, `status` now includes **`rejected`** alongside `draft|approved|scheduled|published`.
- **brand_dna**: content strategy fields (themes, cadence, personas, goals).
- **social_accounts**: platform, handle, tokens, follower count, isActive.
- **user_settings**: per-user AI provider + model + image provider.
- **posting_rules** *(new)*: per-client/per-platform scheduling constraints.

---

## 6. Sidebar navigation (per client)

Dashboard → Brand DNA → Storylines → Campaigns → Social Accounts → **Posting Rules** → ─── → AI Create → Bulk Generate → Manual Post → ─── → Drafts → **Approvals** (badge) → Posting Queue → Calendar → Memory → ─── → Asset Library → Settings

---

## 7. Things to know when reviewing

- Codegen flow: `pnpm --filter @workspace/api-spec run codegen`, then patch `zod.instanceof(File)` → `zod.any()` in `lib/api-zod/src/generated/api.ts`.
- Generated mutation params are named `data` (not `body`).
- `ApprovePostBody.platform` enum does **not** include `"newsletter"` — cast where needed.
- Both `dashboard` queries and `scheduler` query `status = "scheduled"` — that is why setting `scheduled` (not `approved`) on approve was critical.
- Pre-existing TS errors in `ai_content.ts` and `upload.ts` are unrelated and intentionally left alone.
- Auto-scheduler currently treats drafts as the queue (a draft becomes `scheduled` once it fits a window). The reviewing AI flagged this as a UX choice to confirm — current behaviour is intentional ("approve + place" in one step).

---

## 8. Pending follow-ups (already proposed, not yet started)

- **#17** – Real OAuth flow for the four social platforms (replacing the manual token registration).
- **#18** – Real publish-to-platform integration for the scheduler (today it logs/mock-publishes).
- **#19** – Campaign-scoped bulk approve ("approve all in campaign X").

There is also one task still queued in the project tasks list, separate from these follow-ups, awaiting kickoff.

---

## 9. What you can ask another AI to verify

1. Is the **status state machine** consistent? (`draft → scheduled → published`, with `rejected` as a terminal side-state. Do all writers agree?)
2. Is the **auto-scheduler** rule-evaluation correct given `preferredWindows` + `blackoutDates` + `maxPostsPerDay`?
3. Are there **race conditions** in bulk-approve / auto-schedule (multiple drafts scheduled to the same slot)?
4. Are **per-client AI keys** properly scoped, and are no secrets ever sent to the browser?
5. Is the **Calendar drag-and-drop** writing back through the same PATCH path as inline edits?
6. Is the **Approval Queue inline-edit + image-swap** persisting correctly to both `posts.selectedImageUrl` and the `images` asset table?
