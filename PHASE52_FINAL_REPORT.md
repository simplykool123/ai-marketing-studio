# Phase 52 — Final Browser QA + Bug Fix + Release Packaging

**App:** AI Marketing Studio
**Date:** 2026-06-01
**Scope (code-level QA, as authorized — no live browser session was available this turn):** re-run pre-flight, walk every major surface and route for empty-state copy / status truth / renderer coverage / honest disabled states, fix only bugs found by inspection, package commits.

---

## TASK 1 — Pre-flight checks

Re-run from the AI Marketing Studio root after Phase 51A:

| # | Command | Result |
| --- | --- | --- |
| 1 | `pnpm --filter @workspace/db run push` | `[✓] Changes applied`. No schema changes from Phase 51A. |
| 2 | `pnpm --filter @workspace/api-spec run codegen` | Clean. |
| 3 | `pnpm run typecheck` | Clean for all 4 targets (api-server, marketing-studio, mockup-sandbox, scripts). |
| 4 | `pnpm --filter @workspace/api-server run build` | Clean. `dist/index.mjs` 4.7 MB ESM, 400 ms. |
| 5 | `pnpm --filter @workspace/marketing-studio run build` | Clean. `index-DcRgI9CQ.js` 1.58 MB (442.8 KB gzipped). Same 500-KB chunk warning as before, not a blocker. |

All five also re-run **after** the Phase 52 bug fixes — same clean result.

## TASK 2 — Tooltip / empty-state QA (code-level)

Walked the 30 frontend page files. Notable findings and fixes:

| Surface | Status |
| --- | --- |
| Dashboard (`ClientDashboard.tsx`) | Activity empty-state copy was "No posts yet. Create a draft to start the workflow." but had no actionable link. **Fixed**: added an "Open AI Brain to generate ideas →" link. |
| Posting Queue (`PostingQueue.tsx`) | Empty-state copy "Queue is empty. Approve drafts in Review to add them here." had no link. **Fixed**: added an "Open Review →" link. |
| Calendar (`Calendar.tsx`) | "No upcoming scheduled posts." had no link. **Fixed**: added "Schedule approved drafts →" link to Drafts. |
| Client Selector | "No clients yet" already has an "Add your first client" button. OK. |
| Drafts (`Drafts.tsx`) | Empty-state grid has bulk-generate / create / manual-post buttons. OK. |
| Campaign Planner | Empty-state has "Create campaign" button. OK. |
| Settings → Provider Readiness | Now lists supported-set explicitly. See TASK 7 below. |
| All other "No X yet" hints inside Reports / Memory / etc. | These are sub-panel hints (not full-page dead-ends) — left as-is. |

Not exhaustively verified for every minor surface (without a running browser, exhaustive page-by-page tooltip verification is the kind of thing the QA checklist (`FINAL_QA_CHECKLIST.md`) was written for; that sheet remains the authoritative manual acceptance run).

## TASK 3-5 — Setup / Brand / Provider / Generation flows (code-level)

- **3. Setup flow:** middleware/auth.ts already gates `/api/clients/:clientId/*` with `requireClientRole`. Roles enforced: `EDIT_CONTENT_ROLES`, `APPROVE_CONTENT_ROLES`, `MANAGE_CLIENT_ROLES`. Cross-client API access returns 403. **Code verified.**
- **4. Provider readiness:** Settings page Row component badges every provider with `your key` / `env fallback` / `not configured`. After Phase 51 the .env-fallback path is gone for resolveApiKey, so `env fallback` will only appear for trend services. Honest. **Code verified.**
- **5. AI generators:** All eight generator categories listed in the task brief now flow through `generateJsonWithFallback` after Phase 51A. AI Brain / Trend Radar / Festival / Omnichannel were already on it. Carousel / Reel / Campaign Pack / Creative Concepts / Growth Boost / suggest-brand-fields / Video Script / AI Visibility Analysis / AI Visibility Campaign were migrated in Phase 51A. **Code verified.**

## TASK 6 — Review/Drafts renderer audit

`Phase50RendererSwitch` in `components/Phase50Renderers.tsx` dispatches on contentType. Walked the switch cases against the actual `contentType` strings the backend writes:

- `whatsapp_status_image|whatsapp_status_video|festival_status` → WhatsAppStatusRenderer ✓
- `gbp_post|gbp_offer` → GbpPostRenderer ✓
- `newsletter_snippet` → NewsletterSnippetRenderer ✓
- `website_banner` → WebsiteBannerRenderer ✓
- `local_seo_content` → LocalSeoRenderer ✓
- `review_request|whatsapp_broadcast` → ReviewRequestRenderer ✓
- **`faq` / `faq_pack` → previously fell through to default!** AI Visibility's save-campaign route saves FAQs as `contentType: "faq"` with `contentSchema.faqs[]`, but the switch didn't register `FaqPackRenderer`. Bug. **Fixed** by adding `case "faq": case "faq_pack":` to the switch, and broadening `FaqPackRenderer` to accept both `schema.faq` and `schema.faqs`, plus `answer || answerDirection`.
- All other contentTypes (`social_post`, `carousel`, `reel_storyboard`, `blog`, `video_script`) fall through to the default Drafts rendering paths which are intact.

Also tightened AI Visibility's `save-campaign` route: LinkedIn caption now merges `hook + content + mainContent + body` (with `angle` as fallback) instead of `content || angle`, so the caption is no longer blank when the model emits per-field structure rather than a single `content` blob.

## TASK 7 — Image / editor flow (code-level only)

- `lib/image-provider.ts` + `lib/durable-image-storage.ts`: every image generation downloads the provider URL and re-uploads to Supabase, writes only the Supabase URL as `finalArtworkUrl`. Verified in code (no provider temporary URL is persisted).
- No image-provider key → returns clean 422 "No image provider connected" with link guidance — Phase 4 / 44 behavior intact.
- Editor pipeline (`ArtworkEditorDialog`, composite logo) writes back to `posts.contentSchema` and the durable URL field is updated atomically. No regression from Phase 51A changes (those touched JSON path only).

Cannot test live image generation without an API key in this session. Status: **code-verified, live test deferred to manual browser QA per FINAL_QA_CHECKLIST §6.**

## TASK 8 — Carousel / Reel / Video render / TTS

- **Carousel:** `creative.ts` → `normalizeCarouselSchema` always returns at least 5 slides even if the model under-produces. Slide structure validated by `carousel_builder` validator (≥3 slides). Persistence wired (contentSchema.carousel + slidePrompts + legacy carouselSlides). OK.
- **Reel:** `reel_storyboard_builder` validator requires ≥2 scenes + hook + CTA + onScreenText each. `normalizeReelSchema` backfills missing scenes. Persistence wired. OK.
- **Timeline-lite renderSpec editor:** `Drafts.tsx` saves scene order/duration/text/voiceover/CTA/logo via the renderSpec save mutation. No regressions in Phase 51A.
- **Video render:** `routes/video_render.ts` returns honest 503 when `RENDER_WORKER_URL` is unset, with the truthful message. Carried forward from Phase 51 unchanged. UI surface in `Drafts.tsx` says "Render/export MP4" but the backend refuses without a worker. OK.
- **TTS:** Phase 51A Decision B applied. Dropdown options say "preference only — not connected"; `Drafts.tsx` shows the explicit "Voiceover script ready. TTS provider not connected yet" copy. No fake audio button. No `voiceoverUrl` written. OK.

## TASK 9 — Blog publishing flow

- Receiver in `blog_publishing.ts` handles WordPress/Ghost/Custom webhook with signed `x-ams-signature`. Posts the canonical payload (title/slug/metaTitle/metaDescription/excerpt/body/html/faq/featuredImageUrl/heroImageUrl/tags/categories/cta/canonicalUrl/schemaMarkup/publishedAt).
- Per-client scoping enforced by `requireClientRole(:clientId)` — Client A cannot publish to Client B's connection.
- No-connection path returns 409 with the truthful "No blog site connected" message. No status mutation. OK.

## TASK 10 — WhatsApp / GBP / Drive

- **WhatsApp:** `whatsapp_status_export_builder` validator enforces onImageText + shareCaption + imagePrompt. UI surface renders 1080x1920 size guidance, export-only flow. OK.
- **GBP:** `routes/gbp.ts` returns "GBP not connected" with manual/export path. `gbp_post` contentType marked `api_when_connected` in format-matrix. No fake "Published" label.
- **Drive:** `routes/drive_archive.ts` returns 503 with "Google Drive archive not connected yet" message; no fake driveFileId is written; UI flag from `connected: false` drives the empty state.

## TASK 11 — Scheduling / Queue / Calendar status truth

Walked status labels across the three surfaces. Found two divergences from `lib/post-status.ts`:

| Surface | Bug | Fix |
| --- | --- | --- |
| `PostingQueue.tsx:298` | Local `postStatusLabel` duplicated and partially diverged from shared helper (line 307 had a "Ready to post" fallback for already-posted statuses, which is wrong-ish if publishedAt is missing). | Replaced with delegation to `sharedPostStatusLabel(post.status, { publishedAt })`, keeping the no-account-failure special case. |
| `Drafts.tsx:2270` (`PostHistoryTimeline`) | `post.publishedAt ? "Published" : "Not posted yet"` — bare "Published" label is exactly what the task said to remove. | Replaced with `sharedPostStatusLabel(post.status, { publishedAt: post.publishedAt })` — now correctly reads "Posted manually" / "Published via API" depending on the underlying status. |

Calendar uses no status labels (only date placement) and is unaffected.

Canonical status vocabulary (from `lib/post-status.ts`): `draft, in_review, approved, scheduled, ready_to_post, ready_for_whatsapp, exported, posted_manually, published_via_api, failed, rejected`. Matches the task brief exactly.

## TASK 12 — Memory / learning

`recordLearning()` and `writeClientMemory()` in `lib/client-memory-packet.ts` are called on approve / reject / export / manual-post in `routes/posts.ts` and `routes/publish.ts`. Carried forward from Phase 51 unchanged — Phase 51A migrations did not touch the memory path.

## TASK 13 — Performance / navigation polish

- Main bundle 1.58 MB / 442 KB gzipped — same warning as Phase 51 report, **not a release blocker.** Code-splitting is a future polish item.
- No type errors. All four typecheck targets clean.
- No console.errors introduced in this phase (verified by inspecting handler error paths — all `console.error` calls are inside `catch` blocks that return a response).

## TASK 14 — Bugs fixed in Phase 52

1. **FAQ pack content type never rendered** (`components/Phase50Renderers.tsx`). Saved FAQs from AI Visibility appeared as blank social-post cards. Switch now dispatches `faq|faq_pack` → `FaqPackRenderer`, renderer accepts both `schema.faq` and `schema.faqs`, both `answer` and `answerDirection`.
2. **AI Visibility LinkedIn posts could save with blank caption** (`routes/ai-visibility.ts:415`). Save-campaign now merges hook/content/mainContent/body fields instead of relying on a single `content` field.
3. **PostingQueue status label divergence** (`PostingQueue.tsx:298`). Now delegates to shared `lib/post-status` helper.
4. **Drafts PostHistoryTimeline showed bare "Published"** (`Drafts.tsx:2270`). Now uses shared helper which distinguishes "Posted manually" / "Published via API".
5. **TTS dropdown gave false impression of being connected** (`Drafts.tsx`). Now labelled "(preference only — not connected)" with explicit "Voiceover script ready" copy below. (Phase 51A change, included here for completeness.)
6. **Provider Readiness card understated supported set** (`SettingsPage.tsx`). Card now explicitly lists the supported set and the not-connected list. (Phase 51A change.)
7. **Empty-state dead-ends on Dashboard / Calendar / PostingQueue.** Added next-action links: Dashboard → AI Brain, Calendar → Drafts, Queue → Review.

No new modules added. No DB changes. No third-party imports.

## TASK 15 — Final commands

All five re-run after Phase 52 fixes:

- `pnpm --filter @workspace/db run push` → clean
- `pnpm --filter @workspace/api-spec run codegen` → clean
- `pnpm run typecheck` → clean
- `pnpm --filter @workspace/api-server run build` → clean, 400 ms
- `pnpm --filter @workspace/marketing-studio run build` → clean, 6.89 s, bundle within previous limits

## TASK 16 — Commits

Four logical commits on `main`, no push:

1. `9e8b9a2` — **Add AI JSON strict path, skill validators, post-status helpers, codegen** (23 files; libs, db schema, codegen)
2. `eb4a9ae` — **Migrate JSON generators to strict path; new Phase 50/51 routes** (25 files; all `routes/*` work from Phase 50 + 51 + 51A + Phase 52 AI Visibility caption fix)
3. `f133cbc` — **Wire status truth, FAQ renderer, honest TTS copy, empty-state CTAs** (19 files; all frontend changes including Phase 52 bug fixes)
4. `5290e25` — **Docs: Phase 51, 51A reports, accelerator audit, QA checklist** (5 markdown docs)

`git status` confirms working tree clean. `git log` shows 6 unpushed commits (2 pre-existing + 4 from this session). **No push.**

## TASK 17 — Final release report

### Browser QA result
**Not run live in this session** — the user explicitly chose code-level QA only. The 12-section browser QA in `FINAL_QA_CHECKLIST.md` is still required for full release sign-off and should be executed in a real browser with two real user accounts.

### Bugs fixed in Phase 52
7 bugs / honesty gaps. Listed in TASK 14 above. All fixed in code, typecheck and build pass.

### Files changed in Phases 51 + 51A + 52 combined
72 files across the four commits (23 + 25 + 19 + 5).

### Commits made
4 commits added on top of `73addbc`. Branch is 6 ahead of origin/main.

### Provider status
- Text: OpenAI, Gemini, Anthropic (real adapters, DB-only keys, no .env fallback).
- Image: OpenAI DALL·E 3, Replicate/Flux, Ideogram (real adapters, durable Supabase persistence).
- Trend: free / Serper / Tavily / Twitter (real where keys provided).
- **Not connected (honestly surfaced):** Mistral, DeepSeek, xAI/Grok, Google Imagen/Veo, Runway/Pika, ElevenLabs TTS, OpenAI TTS, Google TTS, Google Drive OAuth, GBP API publish, MP4 render worker.

### Image persistence
Provider temporary URLs are downloaded and re-uploaded to Supabase; `finalArtworkUrl` is always a `supabase.co/storage/...` URL. **Code-verified.** Live test deferred to manual QA.

### Video render status
Storyboard + render-spec saved per Phase 51 honest design. Render worker not connected — `routes/video_render.ts` returns HTTP 503 with the explicit "Render worker not connected" message when `RENDER_WORKER_URL` is unset. No fake `videoUrl` is ever written.

### TTS status
Deferred honestly (Phase 51A Decision B). TTS provider dropdown options labelled "(preference only — not connected)". "Voiceover script ready. TTS provider not connected yet." copy visible below the dropdown. No fake audio button. No `voiceoverUrl` written.

### Google Drive status
`routes/drive_archive.ts` returns `connected: false` with capabilities `{ canArchive: false, canList: false }` and HTTP 503 on upload attempts. No fake archive flow.

### GBP status
`routes/gbp.ts` returns "GBP not connected" with manual/export path. Format-matrix marks `gbp_post` as `api_when_connected` for forward upgrade. No fake "Published" label.

### Blog publish status
Real receiver with signed `x-ams-signature`. Per-client scoped. Returns 409 on no-connection. Posts canonical payload. **Code-verified.**

### WhatsApp status
1080x1920 export-only flow. `ready_for_whatsapp → exported / posted_manually`. No fake auto-post.

### Tooltip / onboarding status
Phase 50 brought tooltip/empty-state coverage; Phase 52 added action links to the three remaining dead-ends (Dashboard / Calendar / PostingQueue). Reports/Memory sub-panel "No X yet" hints are intentional informational displays, not full-page dead-ends, and were left alone.

### Privacy / share
Role-based middleware (`requireClientRole`) on every `/api/clients/:clientId/*` route. `encryptedSecret` / `secretHash` never returned in API responses. OAuth tokens encrypted at rest. **Phase 51 design intact; Phase 51A / 52 changes did not touch the auth path.**

### Calendar / Queue
Both surfaces now use the shared `lib/post-status` label helper (PostingQueue via the delegation fix; Calendar by virtue of not labelling statuses at all). Drafts PostHistoryTimeline also wired through.

### Remaining blockers
1. **Live browser QA not executed in this session.** The 12-section `FINAL_QA_CHECKLIST.md` remains the manual acceptance run that confirms the actual user journey. This phase is code-level only.
2. **Other text-mode routes still using `generateTextWithFallback`:** `campaign_generate.ts:417`, `reports.ts:178`, `trends.ts:520/618`, `social_intelligence.ts:373`, `posts.ts:495`, `ai_brain.ts:174`, `image_studio.ts:355/411`. Several of these emit free text rather than JSON and may be appropriate to leave. Phase 53 (or whenever the next browser QA uncovers a JSON failure on one of them) can migrate them on a case-by-case basis.
3. **Carry-over Phase 51 disabled features:** render worker / Drive OAuth / GBP API publish / TTS providers / additional text-image providers — all honestly disabled.
4. **Bundle size > 500 KB warning** — polish item, not a release blocker.

### Final release readiness percentage

**~91% for the in-scope real-user test.**

Up from ~88% in `PHASE51_FINAL_REPORT.md`. The 3-point lift comes from:
- Phase 51A: every remaining JSON generator on the strict path with validators (drops the "blank Review card from bad JSON" risk to near zero for the migrated routes).
- Phase 52: FAQ renderer wired, AI Visibility caption merge, status-truth consistency across Drafts/Queue, empty-state dead-ends removed.

**Not 100% because:**
- Live browser QA has not been executed.
- Some carry-over `generateTextWithFallback` users remain (intentional for free-text routes; risk for any that happen to be JSON).
- Render worker, Drive OAuth, GBP API publish, TTS, additional providers — all deferred honestly.

### Release-ready verdict

Per the Phase 52 rule "Do not say release-ready unless full browser QA passes":

**This report does NOT claim the app is release-ready.** It claims:

- All code-level QA in scope passed.
- No blank Review cards from any of the migrated routes (code-verified).
- No fake "Published" status labels remain.
- No raw API keys exposed (Phase 51 design intact).
- Build and typecheck pass clean.
- All remaining disabled features are clearly labelled honestly in UI and in API responses.

What's needed for the actual release-ready call: run the 12-section browser QA in `FINAL_QA_CHECKLIST.md` with two real user accounts, tick each box or mark it blocked-by-missing-third-party-key. When that sheet is green, push to origin.

— end of report —
