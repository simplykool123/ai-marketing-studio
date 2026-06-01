# Phase 51A — Close Phase 51 Acceptance Blockers

**App:** AI Marketing Studio
**Date:** 2026-06-01
**Scope:** Migrate the four remaining JSON-producing routes off `generateTextWithFallback` + manual `JSON.parse`, add per-route validators, formalize Provider Hub and TTS scope honestly.

No new features. No redesign. No imported repos.

---

## TASK 1 — Routes migrated to `generateJsonWithFallback`

All four routes now use the strict-JSON path (`artifacts/api-server/src/lib/ai-json.ts`), with provider-native JSON mode, single repair retry, and validator hook. On unrecoverable failure the route returns **HTTP 422** with a clean retryable message. **No partial drafts saved on failure.**

| Route | Function | Previous path | New path | Schema name | Validator |
| --- | --- | --- | --- | --- | --- |
| `routes/creative.ts` | `POST /creative/prepare-prompt` | `generateTextWithFallback` + local `extractJsonObject` | `generateJsonWithFallback` | `creative_prompt_prep` | ✓ |
| `routes/creative.ts` | `POST /creative/concepts` | `generateTextWithFallback` + local `extractJsonObject` | `generateJsonWithFallback` | `creative_concepts` | ✓ |
| `routes/creative.ts` | `POST /creative/generate-carousel` | `generateTextWithFallback` + local `extractJsonObject` | `generateJsonWithFallback` | `carousel_builder` | ✓ (existing) |
| `routes/creative.ts` | `POST /creative/generate-reel-storyboard` | `generateTextWithFallback` + local `extractJsonObject` | `generateJsonWithFallback` | `reel_storyboard_builder` | ✓ (existing) |
| `routes/creative.ts` | `POST /creative/generate-campaign-pack` | `generateTextWithFallback` + local `extractJsonObject` | `generateJsonWithFallback` | `campaign_pack_builder` | ✓ |
| `routes/growth_advisor.ts` | `POST /growth-advisor/suggest-brand-fields` | `generateTextWithFallback` + ad-hoc `JSON.parse` | `generateJsonWithFallback` | `suggest_brand_fields` | ✓ |
| `routes/growth_advisor.ts` | `POST /growth-advisor/brief` | `generateTextWithFallback` + ad-hoc `JSON.parse` with synthetic fallback brief | `generateJsonWithFallback`; synthetic-fallback removed | `growth_boost` | ✓ |
| `routes/video_studio.ts` | `POST /video-studio/generate` | `generateTextWithFallback` + regex `JSON.parse` | `generateJsonWithFallback` | `video_script` | ✓ |
| `routes/ai-visibility.ts` | `POST /ai-visibility/analyze` | `generateTextWithFallback` + regex `JSON.parse` (returned `{ raw }` on failure) | `generateJsonWithFallback`; raw-fallback removed | `ai_visibility_analysis` | ✓ |
| `routes/ai-visibility.ts` | `POST /ai-visibility/generate-campaign` | `generateTextWithFallback` + regex `JSON.parse` (returned `{ raw }` on failure) | `generateJsonWithFallback`; raw-fallback removed | `ai_visibility_campaign` | ✓ |

The local `extractJsonObject` helper in `routes/creative.ts:67-71` was deleted; the canonical tolerant extractor in `lib/ai-json.ts` is the single source of truth.

Each migrated handler now also catches `JsonParseError` explicitly and returns a clean 422 instead of letting the generic error mapper return a 500.

## TASK 2 — Validators added

Added to `artifacts/api-server/src/lib/skill-validators.ts`:

- `creative_prompt_prep` — requires non-empty `improvedPrompt`
- `creative_concepts` — requires `concepts[]` ≥ 1, each with non-empty `imagePrompt`
- `campaign_pack_builder` — requires non-empty `campaignName`, plus `instagramCarousel` and `reelStoryboard` objects
- `growth_boost` — requires non-empty `summary`, `growthOpportunities[]` ≥ 1, and `recommendedNextCampaign` object
- `suggest_brand_fields` — requires four expected string keys (allows empty per prompt instruction)
- `video_script` — requires non-empty `hook`, `cta`, and `scenes[]` ≥ 2 each with at least one of visual/text/voiceover
- `ai_visibility_analysis` — requires `customerQuestions[]` ≥ 1 and `faqIdeas[]` ≥ 1
- `ai_visibility_campaign` — requires non-empty `campaignName` and at least one of blogOutline/carousel/reel/linkedInPosts/instagramPosts

`carousel_builder`, `reel_storyboard_builder`, and `omnichannel_campaign_builder` validators already existed from Phase 51 and were not re-added.

## TASK 3 — Provider Hub scope decision

**Decision: option B — formalize the supported set, do not add stubs.**

Reason: adding empty adapters for Mistral / DeepSeek / xAI/Grok / Imagen / Veo / Runway would be exactly the kind of fake integration Phase 51 explicitly forbids. The hub already only renders real adapters (`textProviders = ["anthropic", "openai", "gemini"]`, `imageProviders = ["openai", "replicate", "ideogram"]`), so no provider that lacks a real adapter is currently selectable.

Frontend copy in `SettingsPage.tsx` Provider Readiness card now explicitly states:

> "Currently supported: **OpenAI, Gemini, Anthropic** for text; **OpenAI, Replicate/Flux, Ideogram** for image. Other providers (Mistral, DeepSeek, xAI/Grok, Imagen, Runway, Veo, TTS) are not connected in this build."

The Video/TTS info strip was updated from the misleading "not required for Phase 46" text to the honest current status (storyboards + renderSpec save; MP4 and audio require a future sidecar/worker).

## TASK 4 — TTS decision

**Decision: option B — deferred honestly.** No fake audio button shipped.

Reason: Implementing a real ElevenLabs / OpenAI TTS adapter in this phase would require provider-controls plumbing, key storage, Supabase audio upload, and audio preview UI — well past "close the Phase 51 blockers." The renderSpec already persists a `ttsProvider` preference for a future renderer to honor.

Concrete UI changes in `pages/Drafts.tsx` (Timeline-lite editor):

- TTS dropdown options now read "OpenAI TTS (preference only — not connected)" etc., so a user clicking them gets no false expectation.
- A new helper paragraph below the dropdown reads: *"Voiceover script ready. TTS provider not connected yet — your preference is stored in the renderSpec for a future renderer. No audio is generated at this stage."*
- No audio preview button. `contentSchema.voiceoverUrl` is never written.

## TASK 5 — Build / typecheck

All five commands run from the AI Marketing Studio root:

| # | Command | Result |
| --- | --- | --- |
| 1 | `pnpm --filter @workspace/db run push` | `[✓] Changes applied`. No schema changes this phase. |
| 2 | `pnpm --filter @workspace/api-spec run codegen` | Clean. Orval regenerated `api-client-react` and `zod`; `tsc --build` on libs passed. |
| 3 | `pnpm run typecheck` | Clean for all 4 typecheck targets (`artifacts/api-server`, `artifacts/marketing-studio`, `artifacts/mockup-sandbox`, `scripts`). |
| 4 | `pnpm --filter @workspace/api-server run build` | Clean. `dist/index.mjs` = 4.7 MB ESM (esbuild, 512 ms). |
| 5 | `pnpm --filter @workspace/marketing-studio run build` | Clean. `dist/public/assets/index-*.js` = 1.58 MB (442 KB gzipped). 500-KB chunk warning persists — known polish item, not a release blocker. |

## TASK 6 — Summary

### Routes migrated
10 handlers across 4 files. Every JSON generator in the Phase 51A scope now goes through the strict path with a validator and a clean 422 on unrecoverable failure.

### Validators added
8 new validators in `lib/skill-validators.ts` covering every migrated handler.

### JSON failure rate before/after
Not measured live this turn — Phase 51A is a code-level migration. The strict path adds (a) provider-native JSON mode, (b) one repair retry with a meta-prompt, and (c) schema validation, so the structural failure rate should drop in line with the Phase 51 improvements measured for the omnichannel/festival/trend routes that adopted it earlier. Phase 52 browser QA is the right place to capture before/after numbers on these specific routes.

### Provider Hub final scope
Text: OpenAI, Gemini, Anthropic (real adapters in `lib/ai-provider.ts`).
Image: OpenAI (DALL·E 3), Replicate/Flux, Ideogram (real adapters in `lib/image-provider.ts`).
Trend: free (RSS/memory), Serper, Tavily, Twitter (off by default).
Video / TTS / additional text-image providers: deliberately not surfaced.

### TTS status
Deferred honestly. Storyboard saves the script; renderSpec saves the user's `ttsProvider` preference; no audio file is generated; UI surfaces "TTS provider not connected yet."

### Build / typecheck result
All five commands pass clean.

### Remaining blockers
- **Other text-mode routes still using `generateTextWithFallback`:** `campaign_generate.ts:417`, `reports.ts:178`, `trends.ts:520/618`, `social_intelligence.ts:373`, `posts.ts:495`, `ai_brain.ts:174`, `image_studio.ts:355/411`. Several of these emit free text (reports, social caption rewrites) rather than JSON and are intentionally out of scope. Any of them that emit JSON should be flagged during Phase 52 browser QA and migrated then. Phase 51A does not claim those.
- All Phase 51 disabled features remain honestly disabled: render worker, Drive OAuth, GBP API publish, additional providers. Carried forward from `PHASE51_FINAL_REPORT.md`.

### Files changed in this phase
- `artifacts/api-server/src/routes/creative.ts` — 5 handlers migrated; local `extractJsonObject` removed; `JsonParseError` → 422.
- `artifacts/api-server/src/routes/growth_advisor.ts` — 2 handlers migrated; synthetic fallback brief replaced with clean 422.
- `artifacts/api-server/src/routes/video_studio.ts` — 1 handler migrated; ad-hoc `JSON.parse` removed.
- `artifacts/api-server/src/routes/ai-visibility.ts` — 2 handlers migrated; `{ raw: ... }` failure-passthrough removed.
- `artifacts/api-server/src/lib/skill-validators.ts` — 8 new validators.
- `artifacts/marketing-studio/src/pages/SettingsPage.tsx` — Provider Readiness card scope copy updated; Video/TTS info strip honest.
- `artifacts/marketing-studio/src/pages/Drafts.tsx` — Timeline-lite editor TTS dropdown labels honest; "voiceover script ready" copy added.

---

**Phase 51A status:** all four target routes are migrated to `generateJsonWithFallback`; validators added; Provider Hub and TTS surfaces honest. Builds and typecheck pass clean.

Phase 52 (final browser QA + release packaging) starts next, per the user's request.
