# Phase 46 Final QA Checklist

**App:** AI Marketing Studio  
**Phase:** 46 — Final App Readiness (privacy, blog connections, provider readiness, status truth)  
**Date:** 2026-05-31

How to use: tick each step in a real browser session using two separate user accounts (User A, User B). When a step is blocked by a missing third-party key, note it explicitly rather than leaving the box empty.

---

## 1. User and client lifecycle (privacy)

- [ ] **1.1** Sign up User A with a fresh email; arrive on `/clients`.
- [ ] **1.2** Sign up User B with a different fresh email in an incognito window; arrive on `/clients` — list is empty.
- [ ] **1.3** As User A, create a new client "Client A". Confirm User A becomes role `owner` in Settings → Team.
- [ ] **1.4** As User B, refresh `/clients` — Client A is **not** visible. Try hitting `/clients/<Client-A-id>/dashboard` directly — server responds 403 Forbidden.
- [ ] **1.5** As User A, open Client A → Settings → Team and invite User B's email as `editor`. Copy the invite link from the toast.
- [ ] **1.6** Paste the invite link in User B's window, accept, and confirm Client A now appears in User B's client list.
- [ ] **1.7** As User B (now `editor`), confirm they can open Drafts, generate, edit, and approve. Confirm they **cannot** invite anyone or change roles (UI hides those, server returns 403 if hit directly).

## 2. Brand DNA and growth setup

- [ ] **2.1** As User A on Client A, open Brand DNA → paste a real website URL → run Website Importer.
- [ ] **2.2** Confirm the Import Review panel labels each field (`found on website` / `AI suggested` / `Not found`).
- [ ] **2.3** Click "Save to Brand Profile" and reload — values persist in `content_memory`.

## 3. AI Visibility (Phase 43 regression check)

- [ ] **3.1** Open AI Visibility, run an analysis.
- [ ] **3.2** Save the result as a campaign — confirm it appears in Review without page reload, and after a reload.

## 4. Carousel (Phase 45 regression check)

- [ ] **4.1** From Creative Studio or Campaign Pack, generate a carousel draft.
- [ ] **4.2** Refresh Drafts — carousel still present, slide structure intact.

## 5. Reel storyboard (Phase 45 regression check)

- [ ] **5.1** Generate a reel storyboard from Creative Studio.
- [ ] **5.2** Refresh Drafts — storyboard still present, scenes intact.

## 6. Image generation (Phase 4 + Phase 44)

- [ ] **6.1** With at least one image provider key (OpenAI / Replicate / Ideogram) configured in Settings → AI Keys, open Image Studio → generate one image.
- [ ] **6.2** Confirm the image preview is a Supabase Storage URL (`supabase.co/storage/...`), not a transient provider URL.
- [ ] **6.3** Remove the image provider key, attempt to generate — confirm the UI shows the error: **"No image provider connected. Add OpenAI, Replicate, or Ideogram key in Settings → AI Keys."** No blank image is saved.

## 7. Provider readiness center

- [ ] **7.1** Open Settings → check the "AI Provider Readiness" summary card at the top.
- [ ] **7.2** Confirm Text AI / Image AI rows correctly badge each provider with **"your key"** or **"env fallback"** when present, or mute when absent.
- [ ] **7.3** Open the AI Keys tab → click Test on Anthropic / OpenAI / Gemini → confirm the test result shows key source, last 4-char key hint, and a clear success or error message.
- [ ] **7.4** Confirm no raw key bytes are visible anywhere in the UI or the browser network panel.

## 8. Status truth — approval → schedule → publish

- [ ] **8.1** Open a draft in Review; click Approve without a date.
- [ ] **8.2** Confirm the badge reads **"Ready to post"** (canonical) — both in Drafts and in Publish Queue.
- [ ] **8.3** Schedule the post for a future date; confirm Calendar shows it on the chosen day and the badge reads **"Scheduled"**. Sanity check: `publishedAt` is still null in the database.
- [ ] **8.4** Mark a post posted manually (via the "Mark posted manually" action). Badge changes to **"Posted manually"** with a publish timestamp. Posting Logs records an entry with `action: mock_post` and `provider: manual` (or `mock`).
- [ ] **8.5** Export approved posts as JSON → confirm the export includes both `ready_to_post` and `scheduled` rows; `status` field uses canonical names.
- [ ] **8.6** Run a real direct publish (requires a connected social account). On success, badge changes to **"Published via API"** with a real `publishedUrl`. On failure, badge changes to **"Failed"** with the error visible.
- [ ] **8.7** Confirm Calendar and Queue both group posts using the same status logic (no view disagrees).

## 9. Blog connection

- [ ] **9.1** As Client A, open Client Settings (Posting Rules page) → scroll to **Website / Blog Connection** card.
- [ ] **9.2** Add a connection: choose platform (WordPress / Ghost / Custom webhook), enter site URL + receiver endpoint, save.
- [ ] **9.3** A signing secret is shown **once** in an emerald box; copy it. Refresh the page → secret is no longer visible.
- [ ] **9.4** Click **Test Connection** — for a working receiver, badge changes to "Connected" and `lastTestedAt` updates. For an unreachable URL, badge shows "Last test failed" with a clear message.
- [ ] **9.5** Open Blog Studio. With a connection saved, the green status strip names the connected site. Without a connection (Client B), the amber strip shows "No blog site connected" and a "Connect Website" button.

## 10. Blog draft → publish

- [ ] **10.1** In Blog Studio, generate a blog post on a real keyword. Confirm the draft persists in Review after page reload.
- [ ] **10.2** Approve the blog draft in Review.
- [ ] **10.3** From Posting Queue or Drafts, trigger "Publish to website".
- [ ] **10.4** Confirm the receiver gets a POST with `x-ams-signature` header, body containing `title, slug, metaTitle, metaDescription, excerpt, body, html, faq, featuredImageUrl, heroImageUrl, tags, categories, cta, canonicalUrl, schemaMarkup, publishedAt`.
- [ ] **10.5** On success, post status becomes **"Published via API"**, `publishedUrl` is stored, and a `posting_log` row records `action: blog_publish, status: success`.
- [ ] **10.6** Test the no-connection path: as Client B with no blog connection, attempt publish-to-site → 409 with **"No blog site connected. Connect a website in Client Settings before publishing."**. No post status mutation.

## 11. Cross-client data isolation

- [ ] **11.1** As User A, create Client B (a second client). Generate one draft in Client A and one in Client B.
- [ ] **11.2** From Client A's Drafts, confirm Client B's draft is **not** visible.
- [ ] **11.3** Hit `/api/clients/<Client-B-id>/posts` while authenticated as a user with no membership → 403.
- [ ] **11.4** Hit `/api/clients/<Client-A-id>/brand-assets` while authenticated as User B (after revoking their membership) → 403.
- [ ] **11.5** Hit `/api/clients/<Client-A-id>/blog/site-connection` from User B → 403. Confirm the `encryptedSecret` and `secretHash` never appear in any successful response.

## 12. Auth / session

- [ ] **12.1** Log out of User A in the main window. Refresh — redirected to login.
- [ ] **12.2** Sign back in. Token persists; protected routes load again.

---

## Acceptance summary

When all boxes in §1–§11 pass (or are explicitly noted as blocked by missing third-party keys), Phase 46 is complete.

Known blockers acceptable for Phase 46:
- §6 / §8.6 require live AI / social-platform credentials. If absent in the test environment, mark blocked and confirm the **error path** is visible to the user instead of a silent failure.
- §9.4 / §10.4 require a real blog receiver. If absent, use webhook.site to validate the request shape and signature.
