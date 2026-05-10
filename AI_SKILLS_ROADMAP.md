# AI Skills Roadmap — AI Marketing Studio

> **Status:** Living document. Updated May 2026.
> **Do not act on this roadmap while publishing connector work is in progress.**

---

## 1. Current Skill System

### Architecture

The skill system is a database-driven, prompt-template execution engine. Each skill is a row in `skill_configs` with:

| Field | Purpose |
|---|---|
| `skillId` | Stable string key, e.g. `"seo_blog_strategist"` |
| `displayName` | Human-readable label |
| `category` | Groups skills — `social_post`, `blog`, `newsletter`, `image`, etc. |
| `config` (JSONB) | `prompt_template`, `provider_routing`, `save_destination`, `output_schema` |
| `isGlobal` / `clientId` | Global skills available to all clients; client-specific overrides possible |

### Execution flow

```
POST /clients/:clientId/skills/:skillId/execute
  ↓
buildClientMemoryPacket(clientId)   ← Brand DNA + storyline + memory + recent posts
  ↓
buildPrompt(skill, memoryPacket, input)   ← injects {{variables}} from input
  ↓
generateTextWithFallback(provider, model, prompt)
  ↓
parseSkillJsonOutput(text)   ← strips markdown fences, validates JSON object
  ↓
evaluateQuality(skill, output)   ← CTA / content / required fields / length checks
  ↓
INSERT into posts (status: "draft")   ← linked to campaignId + storylineId if provided
INSERT into quality_checks
  ↓
Return { post, output }
```

### What the memory packet injects

Every skill automatically receives the full client context:
- Brand DNA (tone, audience, USP, content pillars, visual colors)
- Active storyline + current chapter/theme
- Last 10 approved/published posts (avoids repetition)
- Dismissed AI ideas (avoids repeating rejected angles)
- All memory entries (rules, performance learnings, image style, SEO)
- Latest 5 campaigns

### How output maps to posts

The route in `skills.ts` extracts these fields from the JSON output and maps them to `postsTable`:

| Output key(s) | Post column |
|---|---|
| `caption`, `metaDescription`, `preheader`, `hook` | `caption` |
| `topic`, `title`, `seoTitle`, `subject` | `topic` / `title` |
| `fullDraft`, `body`, `voiceoverFull` | `longFormBody` |
| `imagePrompt`, `visualDirection` | `imagePrompt` |
| `hashtags` (array or string) | `hashtags` |
| `platform` | `platform` |
| `cta` | quality check only |

Everything else lands in `contentSchema` (JSONB) — visible in Review, usable by Artwork Editor and export.

### Currently wired skills

No skills are seeded yet — the database table exists and the execution engine is complete, but no `skill_configs` rows have been inserted. The campaign generator still uses a single-prompt bulk call. The skill engine is ready for use.

Three skill IDs are referenced in comments in `campaign_generate.ts` as future migration targets:
- `seo_blog_strategist`
- `linkedin_thought_leader`
- `instagram_carousel_builder`

---

## 2. Recommended Next Skills

### Skill 1 — Occasion Artwork Prompt Skill

**Purpose:** Given a marketing occasion (festival, national day, product launch), generate a branded artwork direction: headline, subline, color mood, background concept, and image prompt. Feeds directly into the Artwork Editor.

**Input fields:**
```json
{
  "occasionTitle": "Diwali 2025",
  "occasionCategory": "festival",
  "occasionDate": "2025-10-20",
  "platform": "instagram",
  "tone": "warm and celebratory"
}
```

**Memory used:** Brand DNA (colors, visual style), imageStyleMemory (winning prompts, preferred style), active storyline

**Output schema:**
```json
{
  "headline": "string",
  "subline": "string",
  "supportingLine": "string",
  "backgroundConcept": "string",
  "imagePrompt": "string",
  "colorMood": "string",
  "caption": "string",
  "hashtags": ["string"],
  "cta": "string"
}
```

**Where output saves:** `posts` table, `contentType: "social_post"`, `status: "draft"`. `contentSchema` includes `headline`, `subline`, `backgroundConcept`, `imagePrompt` — Artwork Editor reads these directly to pre-fill layers.

**How it appears in Review:** As a draft with an "Edit Artwork" button pre-loaded with the generated headline/subline/image direction.

**Risk / complexity:** Low. The output schema is a strict superset of what Artwork Editor already reads. No new routes needed — call via `/skills/occasion_artwork/execute`. The only dependency is that `skill_configs` has a seeded row.

---

### Skill 2 — Platform Rewrite Skill

**Purpose:** Take an approved post and rewrite it for a different platform — same core message, different tone, length, and format conventions. Instagram → LinkedIn, blog excerpt → Twitter thread, etc.

**Input fields:**
```json
{
  "sourceCaption": "string",
  "sourcePlatform": "instagram",
  "targetPlatform": "linkedin",
  "topic": "string"
}
```

**Memory used:** Brand DNA (tone), contentRules (always follow / avoid), recent approved posts on target platform

**Output schema:**
```json
{
  "caption": "string",
  "platform": "string",
  "hashtags": ["string"],
  "cta": "string",
  "formatNotes": "string"
}
```

**Where output saves:** New `posts` row, `status: "draft"`, linked to same `campaignId` if source post has one.

**How it appears in Review:** Appears alongside the source post. A future UX could link them as "variants."

**Risk / complexity:** Very low. No new schema. Pure text-in / text-out. Good quick win.

---

### Skill 3 — Storyline Campaign Skill

**Purpose:** Given an active storyline and a target week number, generate 3–5 posts that advance the narrative: each post builds on the previous, references the storyline chapter, and avoids repeating recent content.

**Input fields:**
```json
{
  "storylineId": "uuid",
  "storylineTitle": "string",
  "storylineNarrative": "string",
  "weekNumber": 2,
  "platforms": ["instagram", "linkedin"],
  "postsPerPlatform": 2
}
```

**Memory used:** Full memory packet — especially `storyMemory.currentChapter`, `rejectionMemory`, `recentApprovedOrPublishedPosts` (avoids repeating recent topics)

**Output schema:**
```json
{
  "posts": [
    {
      "platform": "string",
      "topic": "string",
      "caption": "string",
      "imagePrompt": "string",
      "hashtags": ["string"],
      "cta": "string",
      "storylineChapterNote": "string"
    }
  ]
}
```

**Where output saves:** One `posts` row per item in `output.posts`, all linked to `storylineId`. The route needs to loop the array and insert each — this is the one structural addition needed (skills route currently inserts one post per execution).

**How it appears in Review:** Posts grouped by the linked storyline — visible in the existing Storylines panel and the draft calendar.

**Risk / complexity:** Medium. Requires a small extension to `skills.ts` to handle `output.posts[]` (array output, not single post). Everything else — memory, schema, review flow — already exists.

---

### Skill 4 — Quality Review Skill

**Purpose:** Given a draft post's caption, platform, and brand context, return a structured quality score with specific improvement suggestions. Used to upgrade "low quality" drafts before they reach the approval queue.

**Input fields:**
```json
{
  "caption": "string",
  "platform": "string",
  "topic": "string",
  "imagePrompt": "string"
}
```

**Memory used:** Brand DNA (tone, audience), contentRules (approved/banned phrases), performanceMemory (what worked / what did not)

**Output schema:**
```json
{
  "score": 0.85,
  "verdict": "approve" | "improve" | "reject",
  "issues": ["string"],
  "suggestions": ["string"],
  "revisedCaption": "string",
  "cta": "string"
}
```

**Where output saves:** Does NOT create a new post. Updates the existing post's `qualityScore`, `qualityReport`, and optionally `caption` if `revisedCaption` is accepted. Writes to `quality_checks` table.

**How it appears in Review:** "Improve" button on low-quality drafts triggers this skill. Shows before/after diff in a dialog. User accepts or ignores suggestion.

**Risk / complexity:** Medium. The execution is straightforward, but the route is different — it updates an existing post rather than inserting a new one. Needs a separate endpoint or a flag on the existing execute route: `?mode=improve&postId=xxx`.

---

### Skill 5 — SEO Blog Skill V2

**Purpose:** Upgrade from the campaign generator's bulk blog outline to a full, standalone blog draft: SEO-optimised title, meta description, slug, full section bodies, FAQ, internal link suggestions, and a social teaser caption.

**Input fields:**
```json
{
  "keyword": "string",
  "intent": "informational" | "commercial" | "transactional",
  "wordCount": 1200,
  "includesFAQ": true,
  "tone": "string"
}
```

**Memory used:** seoMemory (target keywords, competitor angles, internal link ideas), Brand DNA (tone, audience), recent blog posts (avoids duplicate topics)

**Output schema:**
```json
{
  "seoTitle": "string",
  "slug": "string",
  "metaDescription": "string",
  "fullDraft": "string",
  "sections": [{ "heading": "string", "body": "string" }],
  "faq": [{ "q": "string", "a": "string" }],
  "internalLinks": ["string"],
  "socialTeaser": "string",
  "imagePrompt": "string",
  "cta": "string"
}
```

**Where output saves:** `posts`, `postType: "blog"`, `contentType: "blog"`, `longFormBody` = `fullDraft`. `contentSchema` holds sections + FAQ for the Blog Studio editor to render.

**How it appears in Review:** In the "Blog" tab of Review/Drafts. The Blog Studio page renders `contentSchema.sections` and `contentSchema.faq` as editable sections.

**Risk / complexity:** Low-medium. The Blog Studio already reads `contentSchema` for section rendering. The only risk is `fullDraft` length — 1200 words at standard token rates. Set `max_tokens: 3500` in the skill config's `provider_routing`.

---

### Skill 6 — Carousel Builder Skill

**Purpose:** Generate a structured 5–8 slide Instagram/LinkedIn carousel: hook slide, content slides, CTA slide. Each slide has a headline, body text, and image direction. Outputs are usable by the Artwork Editor per slide.

**Input fields:**
```json
{
  "topic": "string",
  "platform": "instagram" | "linkedin",
  "slideCount": 6,
  "angle": "string",
  "cta": "string"
}
```

**Memory used:** Brand DNA (tone, visual style, colors), imageStyleMemory (preferred style, winning prompts), contentRules

**Output schema:**
```json
{
  "coverHeadline": "string",
  "slides": [
    {
      "slideNumber": 1,
      "headline": "string",
      "body": "string",
      "imageDirection": "string"
    }
  ],
  "ctaSlide": { "headline": "string", "body": "string", "cta": "string" },
  "caption": "string",
  "hashtags": ["string"],
  "imagePrompt": "string"
}
```

**Where output saves:** One `posts` row, `contentType: "carousel"`. `contentSchema.slides[]` is rendered in a future Carousel preview component in Review. For now, `caption` is the preview text shown in Review.

**How it appears in Review:** Standard draft card. A future "Carousel preview" button would render the slides using the Artwork Editor layout. For now, the slides are visible in the `contentSchema` JSON view.

**Risk / complexity:** Low for generation. The Review UI for carousels requires new frontend work (slide-by-slide preview). Recommend shipping the skill first and reviewing raw output; build the carousel preview UI as a separate task.

---

### Skill 7 — Publish Package Skill

**Purpose:** Take a set of approved posts (by campaign or date range) and generate a structured client-ready export: a brief description of each post, suggested dates, image notes, and a cover summary. Output is a clean document, not raw JSON.

**Input fields:**
```json
{
  "postIds": ["uuid"],
  "clientName": "string",
  "periodLabel": "May 2025",
  "includeImages": true
}
```

**Memory used:** Brand DNA (for cover summary tone), latestCampaigns (for context in the cover)

**Output schema:**
```json
{
  "coverSummary": "string",
  "posts": [
    {
      "postId": "string",
      "platform": "string",
      "scheduledDate": "string",
      "caption": "string",
      "imageNote": "string",
      "hashtags": "string"
    }
  ],
  "notes": "string"
}
```

**Where output saves:** Does not create a `posts` row. Returns output directly to the frontend for display or download. The existing JSON export package in Publish Queue already handles the download; this skill adds an AI-written narrative layer on top.

**How it appears in Review:** Not in Review. Triggered from the Publish Queue "Export" flow. A future "Generate client report" button calls this skill and appends the `coverSummary` to the JSON export.

**Risk / complexity:** Low. Pure AI text generation over existing data. No DB writes. Requires a dedicated lightweight endpoint (not the generic skills execute route).

---

## 3. Recommended Build Order

### Tier 1 — Quick wins (build now, no workflow disruption)

| # | Skill | Why first |
|---|---|---|
| 1 | **Platform Rewrite** | Pure text rewrite, no schema changes, one new skill config row |
| 2 | **SEO Blog V2** | Replaces the weakest part of campaign generation, reuses existing Blog Studio UI |
| 3 | **Occasion Artwork** | Closes the Marketing Calendar → Artwork Editor gap, output schema already compatible |

### Tier 2 — Medium effort (build after Tier 1 is stable)

| # | Skill | Dependency |
|---|---|---|
| 4 | **Quality Review** | Needs a separate update-post endpoint — don't mix with insert flow |
| 5 | **Carousel Builder** | Works today; carousel preview UI is future work |

### Tier 3 — After publishing connector is complete

| # | Skill | Dependency |
|---|---|---|
| 6 | **Storyline Campaign** | Needs array-output support in `skills.ts` |
| 7 | **Publish Package** | Needs publishing flow to be stable first |

---

## 4. What Not to Build Yet

**Autonomous posting agents** — Any skill that triggers publish without a human approval step. The approval gate in Review is load-bearing; bypassing it loses the memory-feedback loop (rejections teach AI).

**Auto-scheduling inside skills** — Skills should produce `status: "draft"`. Date assignment stays in the auto-scheduler and Publish Queue, which already have rules/cadence logic.

**Complex analytics AI** — No performance data from real platforms is ingested yet. Memory-based performance learning exists, but it relies on manual notes and approvals. Building an analytics skill before platform APIs are connected is premature.

**Video generation skills** — `videoStyleMemory` exists in the memory packet but no video generation pipeline is wired. Flag this for a dedicated video sprint.

**Native social API calls inside skills** — Skills are content generators, not publishers. Publishing logic lives in `publish.ts`. Keep the boundary clean.

**Per-client skill overrides** — The `skill_configs` table supports `clientId`-scoped skill rows, but building a UI to manage per-client prompt overrides adds significant complexity. Defer until at least 3 skills are running in production and the override use case is validated.

---

## 5. Seeding a Skill Config

When ready to test, seed a skill row directly in Supabase or via a migration. Example for Platform Rewrite:

```sql
INSERT INTO skill_configs (skill_id, display_name, category, config, is_global, is_active)
VALUES (
  'platform_rewrite',
  'Platform Rewrite',
  'social_post',
  '{
    "prompt_template": "Rewrite the following caption for {{targetPlatform}}.\n\nSource platform: {{sourcePlatform}}\nCaption: {{sourceCaption}}\nTopic: {{topic}}\n\nReturn JSON: { caption, platform, hashtags, cta, formatNotes }",
    "provider_routing": { "default_quality_mode": "balanced", "max_tokens": 800 },
    "save_destination": { "content_type": "social_post", "status": "draft" },
    "output_schema": { "required": ["caption", "platform", "cta"] }
  }',
  true,
  true
);
```

Call it via:
```
POST /clients/:clientId/skills/platform_rewrite/execute
{ "input": { "sourcePlatform": "instagram", "targetPlatform": "linkedin", "sourceCaption": "...", "topic": "..." } }
```

---

## 6. Risks

| Risk | Mitigation |
|---|---|
| Skill output JSON varies per model/temperature | `parseSkillJsonOutput` is already lenient (strips fences, extracts first `{}`). Add `output_schema.required` to every skill to surface missing fields via `evaluateQuality`. |
| Long blog drafts hit token limits | Set `max_tokens: 3500` for SEO Blog V2. Split into outline + body fill if needed. |
| Carousel slide count variability | Fix `slideCount` in input and add it to `output_schema.required` to enforce structure. |
| Memory packet grows large with many posts | The packet already limits `recentPosts` to 10 and `aiIdeas` to 50. Add a similar cap to `memoryEntries` if needed. |
| Skills route inserts one post per call — Storyline Campaign needs array | Add `output.posts[]` loop support to `skills.ts` only when Storyline Campaign is built; don't pre-optimise. |

---

*Next recommended skill to build: **Platform Rewrite** — zero schema changes, immediately useful for multi-platform clients, validates the full skill execution loop end-to-end.*
