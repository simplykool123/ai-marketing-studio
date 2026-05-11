# Video Studio — Research & Product Plan

> **Status:** Plan only. No code changes.
> **Last updated:** May 2026.
> **Do not implement until publishing connector work is complete.**

---

## 1. Provider Comparison — AI Video Generation

All prices below are per 10-second output clip, May 2026 rates.

### Generation APIs

| Provider | Route | Cost / 10s | Audio | T2V | I2V | Quality tier | API maturity |
|---|---|---|---|---|---|---|---|
| **Wan 2.5/2.6** | fal.ai | $0.50 | No | ✓ | ✓ | Good | Production |
| **Veo 3.1** | Replicate | **$0.30** | ✓ native | ✓ | ✓ | Excellent | Production |
| **Kling 3.0** | fal.ai | $0.75 (no audio) | Optional +$0.30 | ✓ | ✓ | Excellent | Production |
| **Pika 2.2** | fal.ai | $0.40 (8s, 720p) | No | ✓ | ✓ | Strong | Production |
| **Seedance 2.0 Fast** | Replicate | $0.22 | ✓ | ✓ | ✓ | Good | Production |
| Runway Gen-4 Turbo | Runway API | $0.50 | No | ✓ | ✓ | Top | Production |
| Runway Gen-4.5 | Runway API | $1.20 | No | ✓ | ✓ | #1 benchmark | Production |
| Veo 3 (audio) | fal.ai | $4.00 | ✓ native | ✓ | ✓ | Excellent | Production |
| Luma Ray 3.14 | Luma API | ~subscription | No | ✓ | ✓ | Strong | Subscription only |
| Veo 3 (audio) | Vertex AI | $7.50 | ✓ native | ✓ | ✓ | Excellent | Enterprise only |

### Critical findings

**fal.ai is the best primary gateway for SaaS:**
- Unified SDK (`@fal-ai/client`) — one integration, many models
- Usage-based billing, charged only on successful outputs
- Hosts Wan, Kling, Pika, Veo 3, Seedance — swap models without changing integration
- Clean queue-based async pattern with progress callbacks

**Veo 3.1 via Replicate is the best value:**
- $0.03/sec — cheapest audio-capable model by far
- Native dialogue + SFX generation in one pass
- Image-to-video supported
- SynthID watermark is invisible but embedded in all Google Veo outputs

**Wan 2.5/2.6 is the budget default:**
- $0.05/sec via fal.ai
- No audio — post-process required for music/captions
- Runs 480p or 1080p, 5–10 second clips
- Good enough quality for social short-form content

**Runway rate limits are a real constraint:**
- Tier 1 (entry): only 1–2 concurrent requests, 50–200 generations/day
- Tier 3 (requires $100 spend): 5 concurrent, 1,000–2,000/day
- Not suitable as a primary provider until spend history is established

**Avoid:**
- Luma API: subscription credit model, can't scale per-user cost predictably
- Vertex AI direct: expensive + GCP IAM complexity
- Any model with audio=only-via-separate-pass at V1 (adds pipeline complexity)

---

## 2. Rendering / Template Tool Comparison

### For branded overlays, captions, and logo compositing

| Tool | Template approach | Caption overlay | Logo + image overlay | Keyframe animation | Integration effort | Cost model |
|---|---|---|---|---|---|---|
| **Creatomate** | Visual editor → API | ✓ dedicated | ✓ full | ✓ rich | Low | ~$41/mo (2,000 credits) |
| **Shotstack** | JSON timeline | ✓ `CaptionAsset` | ✓ `ImageAsset` | Limited | Medium | $0.30/min PAYG |
| **Remotion Lambda** | React JSX | ✓ custom | ✓ full | ✓ full | High | Free / $100+/mo license |
| **FFmpeg (Docker)** | None (code-built) | ✓ `subtitles` filter | ✓ `overlay` filter | No | High | Server cost only |

### Critical findings

**Creatomate is the best V1 choice:**
- Build a branded template once in their visual editor (no code)
- Inject dynamic data per render: `{ headline, logo_url, caption_text }`
- Node.js SDK: `@creatomate/preview` + REST API
- Handles text animation, logo placement, color theming natively
- ~$41/month covers ~140 videos/month at 720p. For a SaaS charging clients, this is marginal cost.
- Key caveat: output files are auto-deleted after 30 days — must download to Supabase Storage immediately after render

**Shotstack is the developer-first alternative:**
- Pay-as-you-go at $0.30/min — no monthly minimum
- `CaptionAsset` and `RichCaptionAsset` are first-class (animated captions)
- AI endpoints built in: `TextToSpeechAsset`, `ImageToVideoAsset`, `TextToImageAsset`
- More flexible timeline compositing than Creatomate
- Downside: no keyframe animation, no visual template editor — you write JSON

**FFmpeg (direct, not fluent-ffmpeg):**
- `fluent-ffmpeg` is **archived as of May 2025** — do not use
- Direct FFmpeg via `child_process.execFile` with a bundled binary is viable
- Good for simple tasks: burn logo watermark onto AI-generated video, add subtitle overlay
- Zero marginal cost — only server/Lambda CPU
- Too painful for full branded template rendering — use for lightweight post-processing only

**Remotion:**
- Maximum brand control — full React JSX rendering
- High setup cost: AWS Lambda, IAM, render queues, composition management
- Licensing required for teams ($100+/month)
- Best justified if you need custom animated motion graphics, not if you need "put logo + caption on a video"
- Not recommended at V1 for this app

---

## 3. Recommended V1 Video Workflow

### Design principle

Video in a marketing studio app is not a full NLE. It is a **content packager**: take an AI concept, generate a short clip, brand it, get it approved, put it in the queue. The entire video flow should slot into the existing Review → Publish Queue pipeline without any special-casing.

### V1 workflow (4 steps, all within existing app architecture)

```
[1] Script / Scene Card Builder (frontend)
    ↓
[2] AI Video Generation (fal.ai → Wan or Kling)
    ↓
[3] Branded Compositing (Shotstack or Creatomate)
    ↓
[4] Review → Publish Queue (existing flow, zero changes)
```

#### Step 1 — Script / Scene Cards

User fills in a structured brief — not a full script, just enough for the AI:

```
Platform:       Instagram Reel / TikTok / LinkedIn
Hook (3s):      "Most brands get this wrong..."
Core message:   What the video communicates in one sentence
Visual concept: Describe the scene / mood
CTA text:       "Follow for more" / "DM us"
Duration:       5s / 8s / 10s
Music:          Yes / No (adds cost)
```

This is a form in the Video Studio page. No AI required at this step.

#### Step 2 — AI Video Generation

Backend: call `fal.ai` with the prompt built from the brief.

```js
// Default model: Wan 2.5 (cheap, fast)
// Quality mode: Kling 3.0 (better, 1.5× cost)

await fal.subscribe("fal-ai/wan-25-preview/text-to-video", {
  input: {
    prompt: buildVideoPrompt(brief, brandDna),
    aspect_ratio: platformToAspectRatio(brief.platform),
    duration: brief.duration,
  },
  onQueueUpdate: (update) => notifyJobStatus(jobId, update),
});

// Output: result.data.video.url — direct MP4 URL
// Download to Supabase Storage immediately
```

The `buildVideoPrompt` function injects Brand DNA (visual style, colors, tone) + brief fields into a prompt. Lives in a new `lib/video-generator.ts`.

The raw AI video is saved as a `posts` row with:
- `contentType: "video"`
- `postType: "social"`
- `status: "draft"`
- `contentSchema.rawVideoUrl` = Supabase-stored MP4
- `contentSchema.brief` = the original brief

#### Step 3 — Branded Compositing (optional but recommended)

After the raw video is generated, a second pass adds branding:

**Option A — Shotstack (recommended for V1):**
```js
// Compose: raw AI video + logo overlay + caption text + outro card
const timeline = buildShotstackTimeline({
  videoUrl: rawVideoUrl,
  logoUrl: client.logoUrl,
  captionText: brief.cta,
  brandColor: client.brandDna.primaryColor,
  duration: brief.duration,
});
const renderId = await shotstack.render(timeline);
// Poll until complete, download to Supabase Storage
// Update post: contentSchema.brandedVideoUrl = finalUrl
```

**Option B — FFmpeg overlay (cheaper, less animation):**
```
ffmpeg -i raw.mp4 -i logo.png \
  -filter_complex "overlay=W-w-20:H-h-20" \
  -vf "drawtext=text='Follow for more':fontsize=28:fontcolor=white:x=20:y=H-50" \
  branded.mp4
```
Run in a Docker container on the API server. Zero per-render cost.

For V1: ship the FFmpeg path first (free, no new billing account), plan the Shotstack upgrade for V2.

#### Step 4 — Review and Publish Queue

The branded video post lands in Review with status `"draft"`. From here:

- User sees the video preview (HTML5 `<video>` tag)
- Approve → moves to Publish Queue
- Edit caption/hashtags inline (existing Review flow)
- Publish Queue exports it or marks as posted — no changes to existing queue logic

The `contentType: "video"` flag differentiates video posts from image posts in the Review UI for the preview renderer. Everything else — approval, rejection, AI Memory feedback, queue — is unchanged.

---

## 4. V1 Page Spec — Video Studio UI

The Video Studio page (`/clients/:clientId/video-studio`) is a single-screen brief form. No timeline editor. No preview player during generation. Generation is async.

```
┌─────────────────────────────────────────────────────┐
│  Video Studio                                       │
│  Create a short branded video for social media.     │
│                                                     │
│  Platform        [ Instagram Reel ▾ ]               │
│  Duration        [ 8 seconds ▾ ]                    │
│                                                     │
│  Hook (3s)       [________________________]         │
│  Core message    [________________________]         │
│  Visual concept  [________________________]         │
│  CTA text        [________________________]         │
│                                                     │
│  Quality         ○ Standard (Wan 2.5 — $0.50)      │
│                  ○ High quality (Kling — $0.75)     │
│                                                     │
│  [ Generate Video ]                                 │
│                                                     │
│  ─────────────────────────────────────────────────  │
│  In progress (3)          View in Review →          │
│  [thumbnail] "Hook — Most brands..."  Generating…   │
│  [thumbnail] "Product launch..."      Ready ✓       │
└─────────────────────────────────────────────────────┘
```

No real-time streaming preview. The page shows a job list with status. Completed jobs link to the Review queue. This is how the AI Brain and Campaign Planner pages already work — fire and forget, review later.

---

## 5. Architecture — What Gets Built

### New files (API server)

| File | Purpose |
|---|---|
| `src/lib/video-generator.ts` | `generateVideo(brief, brandDna, provider)` → calls fal.ai, returns raw video URL |
| `src/lib/video-brander.ts` | `brandVideo(rawUrl, client)` → FFmpeg overlay or Shotstack call, returns branded URL |
| `src/lib/video-prompts.ts` | `buildVideoPrompt(brief, brandDna)` → constructs fal.ai prompt from brand context |
| `src/routes/video_studio.ts` | POST `/clients/:clientId/video/generate` → orchestrates generation + branding + post creation |

### Modified files (API server)

| File | Change |
|---|---|
| `src/routes/index.ts` | Mount `/video_studio` router |

### New files (frontend)

| File | Purpose |
|---|---|
| `src/pages/VideoStudio.tsx` | Brief form + job status list |

### Modified files (frontend)

| File | Change |
|---|---|
| `src/App.tsx` | Add `/clients/:clientId/video-studio` route |
| `src/pages/Drafts.tsx` | Render `<video>` tag when `post.contentType === "video"` |
| `src/pages/PostingQueue.tsx` | Render video thumbnail when `contentType === "video"` |

### Database — no schema changes required

`posts.contentType` already accepts any string value. `contentSchema` (JSONB) stores `rawVideoUrl`, `brandedVideoUrl`, `brief`. `postType: "social"` for short-form clips.

A future migration adds `video_jobs` table for persistent async job tracking (generation can take 30–180 seconds). At V1, job status can live in the `posts` row's `generationStatus` field, which already exists.

---

## 6. V2 / V3 Roadmap

### V2 — Quality and cost controls

- Add Kling 3.0 as a quality-tier selection in the UI (already researched, just needs provider routing)
- Add Veo 3.1 via Replicate as a "premium + audio" option
- Creatomate integration for animated branded templates (intro card, outro card, lower thirds)
- Video job queue with BullMQ/Redis for reliable async processing
- `video_jobs` table: tracks per-job status, model used, cost, duration

### V3 — Multi-scene and brand templates

- Multi-scene video: 2–4 connected scenes from a Storyline/Campaign (Kling 3.0 Omni supports up to 6 connected scenes)
- Branded Creatomate templates: upload brand colors, logo, font → auto-apply to all videos
- Caption skill: transcribe AI-generated audio (Whisper), burn in styled captions via Shotstack `RichCaptionAsset`
- Carousel-to-video: convert a Carousel Builder skill output into a slideshow video
- Video Memory: save winning prompts and visual styles to `imageStyleMemory` section

### Not in V1–V3

- Full timeline editor (not a video editor — it's a content packager)
- AI avatar studio (separate product)
- Real-time streaming preview during generation
- Long-form video (>60 seconds)
- Native TikTok/Instagram/YouTube direct publishing (requires platform API approvals)
- Auto-posting without human Review approval

---

## 7. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Generation latency (30–180s) | Medium | Async job model — user gets notified, doesn't wait on page. Show "in progress" job list. |
| fal.ai outage | Medium | Abstract the provider call behind `video-generator.ts`. Route to Replicate/Runway as fallback. |
| Cost blowout per client | Medium | Per-generation cost display in the UI before confirming. Cap daily generations per client in `posting_rules`. |
| SynthID watermark in Veo output | Low | Invisible to viewers but embedded. Document this for clients. Runaway/Kling have no watermark. |
| FFmpeg Docker cold start | Low | Pre-warm the container. For V1, acceptable latency since user isn't waiting synchronously. |
| Storage size (MP4 files) | Low | 10s MP4 at 1080p ≈ 5–15 MB. Supabase free tier includes 1 GB storage. Monitor and prune old drafts. |
| fluent-ffmpeg is archived | None (if avoided) | Use `child_process.execFile` with a bundled `ffmpeg-static` binary instead. |

---

## 8. Files / Areas Likely Touched Later

When Video Studio is eventually built, these files will need review or modification:

**API server:**
- `src/lib/ai-provider.ts` — may need a `video` generation mode alongside existing text modes
- `src/lib/provider-router.ts` — add video-specific routing logic
- `src/lib/client-memory-packet.ts` — `videoStyleMemory` is already in the packet, just needs populated entries
- `src/routes/upload.ts` — may need a `/upload/video` endpoint for user-uploaded source clips
- `src/lib/durable-image-storage.ts` — extend for video storage (Supabase Storage bucket, not just images)

**Frontend:**
- `src/pages/Drafts.tsx` — add `<video>` preview rendering for `contentType === "video"` posts
- `src/pages/PostingQueue.tsx` — video thumbnail and "Copy video URL" action
- `src/components/layout/Sidebar.tsx` — "Video" link already exists under More Tools → Create

**Schema:**
- `lib/db/src/schema/posts.ts` — no change needed; `contentType` and `contentSchema` are flexible
- Future: `video_jobs` table for persistent async job tracking

---

## 9. Codex Implementation Prompt — First Safe Video Step

Use this when ready to start implementation. This is the smallest safe first step: the generation API integration only, no UI, no compositing, no rendering tools.

---

```
PHASE VIDEO-1 — VIDEO GENERATION API INTEGRATION ONLY

Constraints:
- Do not touch any existing routes, pages, or components
- Do not change database schema
- Do not build Video Studio UI
- Do not implement compositing or rendering
- Do not touch Publish Queue or Review pages
- TypeScript strict mode — no any types
- Run pnpm run typecheck when done

Task:
Add a video generation library file and a single API route.

1. Create artifacts/api-server/src/lib/video-generator.ts

   This file exports one function:

   export async function generateVideo(input: {
     prompt: string;
     aspectRatio: "16:9" | "9:16" | "1:1";
     durationSeconds: 5 | 8 | 10;
     provider?: "wan" | "kling";
   }): Promise<{ videoUrl: string; provider: string; model: string }>

   Implementation:
   - Install @fal-ai/client as a dependency
   - Use FAL_KEY from environment (process.env.FAL_KEY)
   - Default provider: "wan" → model "fal-ai/wan-25-preview/text-to-video"
   - "kling" provider → model "fal-ai/kling-video/v2.1/standard/text-to-video"
   - Call fal.subscribe() with input, await result
   - Return { videoUrl: result.data.video.url, provider, model }
   - Throw a descriptive error if FAL_KEY is not set or if fal.subscribe fails

2. Create artifacts/api-server/src/routes/video_studio.ts

   Mount: POST /clients/:clientId/video/generate

   Request body:
   {
     prompt: string;        // required, min 10 chars
     platform: string;      // "instagram" | "tiktok" | "linkedin" | "youtube"
     durationSeconds?: 5 | 8 | 10;   // default 8
     quality?: "standard" | "high";   // "standard" = wan, "high" = kling
   }

   Handler:
   - Auth: requireClientRole(EDIT_CONTENT_ROLES)
   - Validate body (prompt required, platform required)
   - Map platform to aspectRatio: instagram/tiktok → "9:16", linkedin/youtube → "16:9", else "1:1"
   - Map quality to provider: "standard" → "wan", "high" → "kling"
   - Call generateVideo({ prompt, aspectRatio, durationSeconds, provider })
   - Insert a posts row:
     - clientId
     - contentType: "video"
     - postType: "social"
     - platform: body.platform
     - topic: prompt.slice(0, 100)
     - caption: ""
     - status: "draft"
     - generationStatus: "ready"
     - contentSchema: { rawVideoUrl: videoUrl, brief: { prompt, platform, durationSeconds, quality } }
     - generationMetadata: { provider, model, route: "video_studio.generate" }
   - Return { post, videoUrl }

   Error handling:
   - If FAL_KEY missing: 500 with "Video generation is not configured. Add FAL_KEY to server environment."
   - If generateVideo throws: 500 with the error message
   - Wrap in try/catch, log error with logger

3. Mount the router in artifacts/api-server/src/routes/index.ts
   Import videoStudioRouter from "./video_studio.js"
   Add: app.use("/", videoStudioRouter)

4. Run pnpm run typecheck — must pass clean

Do not build the frontend. Do not build compositing. Do not build a job queue. Return the files changed and typecheck result.
```

---

## 10. Provider Recommendation Summary

**Primary gateway:** fal.ai — unified SDK, pay-as-you-go, multiple models, no monthly minimum  
**Default model:** Wan 2.5 (`fal-ai/wan-25-preview/text-to-video`) at $0.05/sec — cheapest viable quality  
**Quality model:** Kling 3.0 via fal.ai at $0.075/sec — significantly better visual output  
**Best value with audio:** Veo 3.1 via Replicate at $0.03/sec — add when audio is needed in V2  
**Branded overlay:** FFmpeg (Docker, zero marginal cost) for V1 → Shotstack PAYG ($0.30/min) for V2  
**Avoid at V1:** Runway (rate limit constraints), Luma (subscription credits), Vertex AI (cost + GCP setup)
