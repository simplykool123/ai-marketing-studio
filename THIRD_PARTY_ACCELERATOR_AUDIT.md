# Third-Party Accelerator Audit

Phase 48 rule: no full GitHub repo was imported, vendored, merged, or copied into the main app. Every repo below was evaluated for architecture lessons, license risk, and fit with the current app. Implementation in this phase uses small, hand-written app-native code only.

## Decisions

| Repo | URL | License / status checked | Useful pieces | Phase 48 decision |
| --- | --- | --- | --- | --- |
| Remotion | https://github.com/remotion-dev/remotion | Custom Remotion License. Free for individuals, non-profits, for-profit orgs up to 3 employees, or evaluation; larger for-profit commercial use requires a company license. | React composition model, render specs, server/lambda renderer patterns. | Reference only for now. Do not import until business/license eligibility is confirmed. A future renderer should be a sidecar/adaptor fed by our saved `videoRenderSpec`. |
| Twick React video editor SDK | https://github.com/ncounterspecialist/twick | Sustainable Use License v1.0. Allows app use, modification, and self-hosting; restricts reselling/rebranding/redistributing as an SDK or developer tool. | Timeline data model, scene elements, browser/server export architecture. | Reference only. No package import in Phase 48 because SDK/license positioning needs product/legal review. |
| DesignCombo React Video Editor | https://github.com/designcombo/react-video-editor | Public repo found, but licensing appears commercial/unclear from public search results. | Timeline/editor UX inspiration. | Reference only. No code copy/import. |
| MoneyPrinterTurbo | https://github.com/harry0703/MoneyPrinterTurbo | MIT license verified from repository LICENSE. | End-to-end short-video pipeline ideas: script, media search, subtitles, voice, FFmpeg render. | Reference / possible future sidecar. Not imported because it is a broad Python app and would be too disruptive for the current TypeScript app. |
| OpenMontage | https://github.com/calesthio/OpenMontage | AGPL-3.0 license verified from repository LICENSE. | Agentic video-production pipeline, asset retrieval, narration, Remotion/FFmpeg render orchestration. | Reference only. AGPL network-copyleft risk means no copy/import into proprietary/main app surfaces. |
| Short Video Maker | https://github.com/gyoridavid/short-video-maker | MIT license verified from repository LICENSE. | Lightweight short-video workflow and provider orchestration concepts. | Reference / possible future isolated sidecar. Not imported in Phase 48 to protect app stability. |
| ALwrity | https://github.com/AJaySi/ALwrity | README says MIT, but GitHub API reports `license: null` and raw LICENSE lookup returned 404 at audit time. | Blog/SEO/answer-engine workflow ideas, content OS structure, persona/context concepts. | Reference only until repository license file/metadata is cleanly verified. |
| Postiz | https://github.com/gitroomhq/postiz-app | AGPL-3.0 license verified from repository LICENSE. | Publishing connector UX, account/status truth, scheduling concepts. | Reference only. No code copy/import due AGPL obligations. |

## What Was Adopted

- `videoRenderSpec` pattern: an app-native JSON contract that can feed a future renderer without binding the main app to Remotion, Twick, FFmpeg, or a Python sidecar today.
- Timeline-lite UI: small native Review-page editor for scene order, duration, background URL, on-screen text, voiceover, music mood, TTS provider placeholder, logo toggle, and CTA end card.
- Blog answer-engine shaping: stronger Blog Studio input and normalized output fields for direct answers, FAQ/schema, internal links, local/service angles, image prompt, and CTA.
- Publishing/archive truth: existing status model remains explicit (`ready_to_post`, `scheduled`, `published_via_api`, `posted_manually`). Google Drive archive remains disabled/truthful unless credentials and upload implementation exist.

## What Was Not Adopted

- No repo was cloned into the app.
- No third-party source files were copied.
- No new SDK dependency was added.
- No auto-publishing or fake connected archive status was introduced.
- No provider temporary media URL is intentionally saved by this phase; generated/stored media must remain durable Supabase URLs where existing image/video flows already persist them.

## Future Integration Path

1. Keep the main app as the system of record for posts, approvals, schedules, and durable Supabase media.
2. Treat video rendering as an isolated worker/sidecar fed by `contentSchema.videoRenderSpec`.
3. Choose a renderer only after license review:
   - Remotion sidecar if company-license requirements are satisfied.
   - FFmpeg/Python sidecar for MIT-compatible pipeline pieces.
   - Twick only if product usage fits SUL and redistribution concerns are resolved.
4. Never enable an export button as successful unless it writes a durable URL back to `contentSchema.finalVideoUrl` or `contentSchema.videoUrl`.
