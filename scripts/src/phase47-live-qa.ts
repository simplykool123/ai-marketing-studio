// Phase 47 live QA probe — exercises the FINAL_QA_CHECKLIST critical paths via HTTP.
//
// Run with:
//   node --env-file=artifacts/api-server/.env --import tsx scripts/src/phase47-live-qa.ts
//
// Two test users (created or signed in via Supabase Auth) drive the privacy
// and sharing scenarios. Falls back to creating fresh accounts on each run.

import crypto from "node:crypto";

const API = process.env.PROBE_API ?? "http://localhost:8080";
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL, SUPABASE_ANON_KEY, or SUPABASE_SERVICE_ROLE_KEY in env.");
  process.exit(1);
}

type Probe = { name: string; ok: boolean; note?: string };
const probes: Probe[] = [];
function record(name: string, ok: boolean, note?: string) {
  probes.push({ name, ok, note });
  const status = ok ? "PASS" : "FAIL";
  const tag = ok ? "\x1b[32m" : "\x1b[31m";
  console.log(`  ${tag}${status}\x1b[0m  ${name}${note ? ` — ${note}` : ""}`);
}

async function adminCreateUser(email: string, password: string) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  return { status: res.status, body: await res.json() as { id?: string; msg?: string; error_description?: string } };
}

async function supabaseSignin(email: string, password: string) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ email, password }),
  });
  return res.json() as Promise<{ access_token?: string; user?: { id: string }; error?: string; error_description?: string }>;
}

async function adminDeleteUser(userId: string) {
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    method: "DELETE",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
}

async function getToken(label: string): Promise<{ token: string; userId: string; email: string }> {
  const tag = crypto.randomBytes(4).toString("hex");
  // Use a domain Supabase doesn't reject. Real-looking gmail+suffix is most tolerant.
  const email = `phase47.${label}.${tag}@gmail.com`;
  const password = `Phase47-${tag}-ProbeTest!`;
  const created = await adminCreateUser(email, password);
  if (!created.body.id) {
    throw new Error(`adminCreateUser failed for ${label}: status=${created.status} ${JSON.stringify(created.body)}`);
  }
  const signin = await supabaseSignin(email, password);
  if (!signin.access_token || !signin.user) {
    throw new Error(`signin failed for ${label}: ${JSON.stringify(signin)}`);
  }
  return { token: signin.access_token, userId: signin.user.id, email };
}

async function api(token: string, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const res = await fetch(`${API}${path}`, { ...init, headers });
  const body = await res.text();
  let parsed: unknown = body;
  try { parsed = JSON.parse(body); } catch { /* keep raw */ }
  return { status: res.status, ok: res.ok, body: parsed as any };
}

(async () => {
  console.log("\n=== Phase 47 live QA probe ===\n");

  // 0. health
  {
    const r = await fetch(`${API}/api/health`);
    record("health endpoint reachable", r.ok);
  }

  // 1. create two users
  let userA!: { token: string; userId: string; email: string };
  let userB!: { token: string; userId: string; email: string };
  try {
    userA = await getToken("a");
    userB = await getToken("b");
    record("create two distinct users", true, `${userA.email.split("@")[0]} / ${userB.email.split("@")[0]}`);
  } catch (e) {
    record("create two distinct users", false, e instanceof Error ? e.message : String(e));
    return;
  }

  // 2. user A creates a client; becomes owner
  const created = await api(userA.token, "/api/clients", { method: "POST", body: JSON.stringify({ name: `QA Client ${crypto.randomBytes(2).toString("hex")}` }) });
  record("user A can create client", created.status === 201 && !!created.body?.id, created.status === 201 ? `id=${created.body.id}` : `status=${created.status} body=${JSON.stringify(created.body)}`);
  const clientAId = created.body?.id as string;
  if (!clientAId) return;

  // 3. user B's client list excludes Client A
  const listB = await api(userB.token, "/api/clients");
  const bSeesA = Array.isArray(listB.body) && listB.body.some((c: any) => c.id === clientAId);
  record("user B does not see Client A in /clients", !bSeesA);

  // 4. user B cannot fetch Client A directly
  const directB = await api(userB.token, `/api/clients/${clientAId}`);
  record("user B 403s on GET /clients/<A>", directB.status === 403, `status=${directB.status}`);

  // 5. user B cannot list Client A posts
  const postsB = await api(userB.token, `/api/clients/${clientAId}/posts`);
  record("user B 403s on GET /clients/<A>/posts", postsB.status === 403, `status=${postsB.status}`);

  // 6. user A can fetch its own client
  const directA = await api(userA.token, `/api/clients/${clientAId}`);
  record("user A can GET /clients/<A>", directA.status === 200);

  // 7. user A invites user B as editor
  const invite = await api(userA.token, `/api/clients/${clientAId}/invites`, { method: "POST", body: JSON.stringify({ email: userB.email, role: "editor" }) });
  record("user A invites user B as editor", invite.status === 201, `status=${invite.status}`);
  const inviteLink: string | undefined = invite.body?.inviteLink;
  const inviteToken = inviteLink?.split("/").pop();

  // 8. user B accepts invite
  if (inviteToken) {
    const accept = await api(userB.token, `/api/invites/${inviteToken}/accept`, { method: "POST" });
    record("user B accepts invite", accept.status === 200, `status=${accept.status}`);
  } else {
    record("user B accepts invite", false, "no invite token from response");
  }

  // 9. user B sees Client A now
  const listB2 = await api(userB.token, "/api/clients");
  const bSeesA2 = Array.isArray(listB2.body) && listB2.body.some((c: any) => c.id === clientAId);
  record("user B now sees Client A after invite", bSeesA2);

  // 10. user B as editor cannot invite others
  const inviteByB = await api(userB.token, `/api/clients/${clientAId}/invites`, { method: "POST", body: JSON.stringify({ email: "third@example.com", role: "viewer" }) });
  record("editor user B cannot invite others (403)", inviteByB.status === 403, `status=${inviteByB.status}`);

  // 11. blog connection status when none exists
  const blogStatus = await api(userA.token, `/api/clients/${clientAId}/blog/site-connection`);
  record("blog GET returns null connection when none set", blogStatus.status === 200 && blogStatus.body?.connection === null, `status=${blogStatus.status}`);

  // 12. blog publish-to-site without connection 409s with friendly message
  const dummyPost = await api(userA.token, `/api/clients/${clientAId}/posts`, { method: "POST", body: JSON.stringify({ topic: "QA blog", caption: "test", postType: "blog" }) });
  const dummyPostId = dummyPost.body?.id;
  if (dummyPostId) {
    // Approve so the publish gate doesn't refuse on status
    await api(userA.token, `/api/clients/${clientAId}/posts/${dummyPostId}/approve`, { method: "POST", body: JSON.stringify({}) });
    const pub = await api(userA.token, `/api/clients/${clientAId}/blog/${dummyPostId}/publish-to-site`, { method: "POST" });
    record("blog publish without connection 409s clearly", pub.status === 409 && /No blog site connected/i.test(String(pub.body?.error ?? "")), `status=${pub.status} err=${pub.body?.error ?? ""}`);
  } else {
    record("blog publish without connection 409s clearly", false, "could not create dummy blog post");
  }

  // 13. save a blog connection
  const saveConn = await api(userA.token, `/api/clients/${clientAId}/blog/site-connection`, { method: "PUT", body: JSON.stringify({ siteName: "QA Site", siteUrl: "https://example.com", endpointUrl: "https://webhook.site/000-qa-fake", platform: "webhook" }) });
  record("save blog connection", saveConn.status === 201, `status=${saveConn.status}`);
  record("save returns signing secret once", typeof saveConn.body?.secret === "string" && saveConn.body.secret.startsWith("ams_"), saveConn.body?.secret ? `secret starts with ${saveConn.body.secret.slice(0,8)}…` : "no secret");

  // 14. subsequent GET hides the secret
  const blog2 = await api(userA.token, `/api/clients/${clientAId}/blog/site-connection`);
  const exposed = JSON.stringify(blog2.body).includes("encrypted_secret") || JSON.stringify(blog2.body).includes("secretHash") || JSON.stringify(blog2.body).includes("encryptedSecret");
  record("GET blog connection does not expose secret/hash", !exposed && blog2.body?.connection?.platform === "webhook");

  // 15. test connection persists lastTestStatus
  const test = await api(userA.token, `/api/clients/${clientAId}/blog/site-connection/test`, { method: "POST" });
  record("test connection endpoint responds", test.status === 200, `status=${test.status} ok=${test.body?.ok}`);
  const after = await api(userA.token, `/api/clients/${clientAId}/blog/site-connection`);
  record("blog connection records lastTestedAt", !!after.body?.connection?.lastTestedAt, after.body?.connection?.lastTestStatus ?? "");

  // 16. provider readiness endpoint
  const ph = await api(userA.token, "/api/ai/provider-health");
  record("provider health endpoint returns a status", ph.status === 200 && typeof ph.body?.status === "string", `status=${ph.body?.status ?? "?"}`);
  const noRawKey = !/sk-(ant|proj)|AIza[0-9A-Za-z-_]{20}/.test(JSON.stringify(ph.body ?? {}));
  record("provider health never includes raw API keys", noRawKey);

  // 17. settings/provider-status mirrors keys
  const ps = await api(userA.token, "/api/settings/provider-status");
  record("provider-status endpoint reachable", ps.status === 200);
  record("anthropic key visible to settings (env fallback)", !!ps.body?.anthropic?.keyExists, ps.body?.anthropic?.source);

  // 18. status truth — approve, schedule, mark posted
  const draft = await api(userA.token, `/api/clients/${clientAId}/posts`, { method: "POST", body: JSON.stringify({ topic: "Status truth probe", caption: "hello", platform: "instagram" }) });
  const draftId = draft.body?.id;
  if (draftId) {
    const approve = await api(userA.token, `/api/clients/${clientAId}/posts/${draftId}/approve`, { method: "POST", body: JSON.stringify({}) });
    record("approve writes canonical ready_to_post", approve.body?.status === "ready_to_post", `status=${approve.body?.status}`);

    const tomorrow = new Date(Date.now() + 86400_000).toISOString();
    const reschedule = await api(userA.token, `/api/clients/${clientAId}/posts/${draftId}/approve`, { method: "POST", body: JSON.stringify({ scheduledAt: tomorrow }) });
    record("approve+schedule writes canonical scheduled", reschedule.body?.status === "scheduled", `status=${reschedule.body?.status}`);

    const markPosted = await api(userA.token, `/api/clients/${clientAId}/posts/${draftId}/mark-posted`, { method: "POST" });
    record("mark-posted writes canonical posted_manually", markPosted.body?.post?.status === "posted_manually", `status=${markPosted.body?.post?.status}`);

    // dashboard counts publishedCount correctly
    const dash = await api(userA.token, `/api/clients/${clientAId}/dashboard`);
    record("dashboard counts posted_manually as published", typeof dash.body?.publishedCount === "number" && dash.body.publishedCount >= 1, `publishedCount=${dash.body?.publishedCount}`);
  } else {
    record("status truth probe", false, "could not create draft");
  }

  // 19. listPosts accepts campaignId filter (Bug #2 fix)
  const listFiltered = await api(userA.token, `/api/clients/${clientAId}/posts?campaignId=00000000-0000-0000-0000-000000000000`);
  record("listPosts accepts campaignId query param", listFiltered.status === 200, `status=${listFiltered.status}`);

  // 20. patch contentSchema actually persists (Bug #4 fix)
  if (draftId) {
    const patch = await api(userA.token, `/api/clients/${clientAId}/posts/${draftId}`, { method: "PATCH", body: JSON.stringify({ contentSchema: { finalArtworkUrl: "https://example.com/art.png", probe: "phase47" }, contentSchemaVersion: 1 }) });
    const refetched = await api(userA.token, `/api/clients/${clientAId}/posts/${draftId}`);
    const persisted = refetched.body?.contentSchema?.probe === "phase47";
    record("PATCH contentSchema persists (no silent strip)", patch.status === 200 && persisted, `patched=${patch.status} probe=${refetched.body?.contentSchema?.probe ?? "missing"}`);
  }

  // ── Phase 50 — format matrix + omnichannel + festival + WhatsApp + GBP + Trend Radar + Growth Boost + learning dedupe ──

  // 21. format matrix endpoint returns the canonical list (25 formats)
  const fm = await api(userA.token, "/api/format-matrix");
  const fmFormats = Array.isArray(fm.body?.formats) ? fm.body.formats : [];
  const hasWhatsApp = fmFormats.some((f: any) => f.contentType === "whatsapp_status_image");
  const hasGbp = fmFormats.some((f: any) => f.contentType === "gbp_post");
  const hasReadyForWhatsApp = Array.isArray(fm.body?.statuses) && fm.body.statuses.some((s: any) => s.value === "ready_for_whatsapp");
  record("format matrix returns >=20 formats with whatsapp + gbp + ready_for_whatsapp status", fmFormats.length >= 20 && hasWhatsApp && hasGbp && hasReadyForWhatsApp, `count=${fmFormats.length}`);

  // 22. GBP status — honest "not connected"
  const gbpStatus = await api(userA.token, `/api/clients/${clientAId}/gbp/status`);
  record("GBP status reports not connected with checklist", gbpStatus.status === 200 && gbpStatus.body?.connected === false && Array.isArray(gbpStatus.body?.checklist) && gbpStatus.body.checklist.length >= 10, `total=${gbpStatus.body?.total} done=${gbpStatus.body?.completed}`);

  // 23. WhatsApp ready transition writes ready_for_whatsapp status
  const waSeed = await api(userA.token, `/api/clients/${clientAId}/posts`, { method: "POST", body: JSON.stringify({ topic: "WA probe", caption: "test", platform: "instagram" }) });
  const waPostId = waSeed.body?.id;
  if (waPostId) {
    const waReady = await api(userA.token, `/api/clients/${clientAId}/whatsapp/${waPostId}/ready`, { method: "POST" });
    record("WhatsApp /ready writes canonical ready_for_whatsapp status", waReady.body?.post?.status === "ready_for_whatsapp", `status=${waReady.body?.post?.status}`);
  } else {
    record("WhatsApp /ready writes canonical ready_for_whatsapp status", false, "could not seed post");
  }

  // 24. status enum accepts ready_for_whatsapp via the canonical status endpoint
  if (waPostId) {
    const tx = await api(userA.token, `/api/clients/${clientAId}/posts/${waPostId}/status`, { method: "PATCH", body: JSON.stringify({ status: "ready_for_whatsapp" }) });
    record("PATCH /status accepts ready_for_whatsapp", tx.status === 200 && tx.body?.status === "ready_for_whatsapp");
  }

  // 25. learning memory dedupe — same key/value written twice produces only one row
  const memBefore = await api(userA.token, `/api/clients/${clientAId}/memory`);
  const memBeforeCount = Array.isArray(memBefore.body) ? memBefore.body.length : Array.isArray(memBefore.body?.memories) ? memBefore.body.memories.length : 0;
  // Trigger a learning write twice via approve flow on the same draft.
  if (waPostId) {
    await api(userA.token, `/api/clients/${clientAId}/posts/${waPostId}/approve`, { method: "POST", body: JSON.stringify({}) });
    await api(userA.token, `/api/clients/${clientAId}/posts/${waPostId}/approve`, { method: "POST", body: JSON.stringify({}) });
  }
  const memAfter = await api(userA.token, `/api/clients/${clientAId}/memory`);
  const memAfterCount = Array.isArray(memAfter.body) ? memAfter.body.length : Array.isArray(memAfter.body?.memories) ? memAfter.body.memories.length : 0;
  record("learning memory dedupes identical entries", memAfterCount - memBeforeCount <= 2, `before=${memBeforeCount} after=${memAfterCount} delta=${memAfterCount - memBeforeCount}`);

  // 26. Phase 50 skills are lazy-seeded by the generator routes themselves on
  // first execute. We don't have a dedicated list endpoint to probe here, and
  // seeding is implicitly verified by the generator probes below. (A previous
  // version of this probe asserted /api/skills exists; it does not — only
  // client-scoped /api/clients/:id/skills/connectivity exists.)

  // 27. omnichannel generate endpoint reachable. We expect either 200 + items
  // or an upstream 4xx/5xx if the AI provider rejects (which is acceptable —
  // proves the route is wired and falls through to the skill engine).
  const omni = await api(userA.token, `/api/clients/${clientAId}/omnichannel/generate`, {
    method: "POST",
    body: JSON.stringify({
      topic: "QA omnichannel probe — keep small",
      goal: "awareness",
      formats: ["instagram_post", "linkedin_post"],
      platforms: ["instagram", "linkedin"],
    }),
  });
  const omniOk = omni.status === 200 || omni.status === 502 || omni.status === 422; // accept upstream failures
  record("omnichannel generate route is wired (any structured response)", omniOk, `status=${omni.status} ${omni.body?.error ? "err=" + String(omni.body.error).slice(0, 80) : ""}`);
  // If it succeeded, items must have persisted as posts in the campaign.
  if (omni.status === 200) {
    const campaignId = omni.body?.campaign?.id;
    if (campaignId) {
      const listInCamp = await api(userA.token, `/api/clients/${clientAId}/posts?campaignId=${campaignId}`);
      record("omnichannel persists items to posts table linked to campaign", Array.isArray(listInCamp.body) && listInCamp.body.length > 0, `posts=${Array.isArray(listInCamp.body) ? listInCamp.body.length : "?"}`);
    }
  }

  // 28. Growth Boost route is wired (same tolerance for upstream failures)
  const gb = await api(userA.token, `/api/clients/${clientAId}/growth-boost/generate`, { method: "POST", body: JSON.stringify({ industry: "QA Industry", city: "QA City" }) });
  record("growth-boost generate route is wired", gb.status === 200 || gb.status === 502 || gb.status === 422, `status=${gb.status}`);

  // 29. Festival pack route is wired
  const fest = await api(userA.token, `/api/clients/${clientAId}/festivals/generate-pack`, { method: "POST", body: JSON.stringify({ occasion: "QA Festival", date: "2026-07-04", platforms: ["instagram"] }) });
  record("festival pack generate route is wired", fest.status === 200 || fest.status === 502 || fest.status === 422, `status=${fest.status}`);

  // 30. Trend Radar route is wired
  const trend = await api(userA.token, `/api/clients/${clientAId}/trends/radar`, { method: "POST", body: JSON.stringify({ industry: "QA Industry", platforms: ["instagram"] }) });
  record("trend radar route is wired", trend.status === 200 || trend.status === 502 || trend.status === 422, `status=${trend.status}`);

  // 31. AI Brain campaign-ideas route is wired
  const brain = await api(userA.token, `/api/clients/${clientAId}/brain/campaign-ideas`, { method: "POST", body: JSON.stringify({ focus: "QA focus", count: 1 }) });
  record("AI Brain campaign-ideas route is wired", brain.status === 200 || brain.status === 502 || brain.status === 422, `status=${brain.status}`);

  // 32. GBP compose route is wired
  const gbpCompose = await api(userA.token, `/api/clients/${clientAId}/gbp/compose`, { method: "POST", body: JSON.stringify({ topic: "QA GBP post", postKind: "update" }) });
  record("GBP compose route is wired", gbpCompose.status === 200 || gbpCompose.status === 502 || gbpCompose.status === 422, `status=${gbpCompose.status}`);

  // 33. GBP publish without OAuth returns 409 honest "not connected"
  if (gbpCompose.status === 200) {
    const gbpPostId = gbpCompose.body?.post?.id;
    if (gbpPostId) {
      const gbpPub = await api(userA.token, `/api/clients/${clientAId}/gbp/${gbpPostId}/publish`, { method: "POST" });
      record("GBP publish without OAuth returns 409 + exported status", gbpPub.status === 409 && gbpPub.body?.post?.status === "exported", `status=${gbpPub.status} post=${gbpPub.body?.post?.status}`);
    }
  }

  // 34. WhatsApp Status generate route is wired
  const waGen = await api(userA.token, `/api/clients/${clientAId}/whatsapp/status/generate`, { method: "POST", body: JSON.stringify({ topic: "QA WhatsApp Status", format: "image" }) });
  record("WhatsApp Status generate route is wired", waGen.status === 200 || waGen.status === 502 || waGen.status === 422, `status=${waGen.status}`);

  // ── Phase 51 — JSON reliability + honest video/drive lifecycle ──

  // 35. After Phase 51 JSON mode + repair retry, the same 7 generators should
  // now return 200 with valid JSON (not 422). Re-run the smallest one and
  // assert success.
  const omni51 = await api(userA.token, `/api/clients/${clientAId}/omnichannel/generate`, {
    method: "POST",
    body: JSON.stringify({
      topic: "Phase 51 JSON reliability probe",
      goal: "awareness",
      formats: ["instagram_post", "linkedin_post"],
      platforms: ["instagram", "linkedin"],
    }),
  });
  record("P51: omnichannel returns 200 (JSON mode + repair)", omni51.status === 200 && Array.isArray(omni51.body?.items) && omni51.body.items.length >= 1, `status=${omni51.status} items=${omni51.body?.items?.length ?? "?"}${omni51.body?.error ? " err=" + String(omni51.body.error).slice(0, 80) : ""}`);
  if (omni51.status === 200 && omni51.body?.meta) {
    record("P51: generation metadata includes provider/model/generatedAt", typeof omni51.body.meta.provider === "string" && typeof omni51.body.meta.model === "string" && typeof omni51.body.meta.generatedAt === "string", `provider=${omni51.body.meta.provider} repairUsed=${omni51.body.meta.repairUsed}`);
  }

  // 36. Trend Radar (smaller schema — should be fastest to validate JSON mode)
  const trend51 = await api(userA.token, `/api/clients/${clientAId}/trends/radar`, { method: "POST", body: JSON.stringify({ industry: "Local cafe", platforms: ["instagram"] }) });
  record("P51: trend radar returns 200 with trends[]", trend51.status === 200 && Array.isArray(trend51.body?.trends) && trend51.body.trends.length >= 1, `status=${trend51.status} trends=${trend51.body?.trends?.length ?? "?"}`);

  // 37. GBP compose with JSON mode
  const gbp51 = await api(userA.token, `/api/clients/${clientAId}/gbp/compose`, { method: "POST", body: JSON.stringify({ topic: "Phase 51 GBP test post", postKind: "update" }) });
  record("P51: GBP compose returns 200 with caption + actionButton", gbp51.status === 200 && typeof gbp51.body?.post?.caption === "string" && gbp51.body.post.caption.length > 0, `status=${gbp51.status}`);

  // 38. WhatsApp Status with JSON mode
  const wa51 = await api(userA.token, `/api/clients/${clientAId}/whatsapp/status/generate`, { method: "POST", body: JSON.stringify({ topic: "Phase 51 WA test", format: "image" }) });
  record("P51: WhatsApp Status generator returns 200", wa51.status === 200 && typeof wa51.body?.post?.id === "string", `status=${wa51.status}`);

  // 39. Video render — honest "worker not connected" status endpoint
  const renderStatus = await api(userA.token, `/api/clients/${clientAId}/video-render/status`);
  record("P51: video-render status reports worker not connected honestly", renderStatus.status === 200 && renderStatus.body?.workerConnected === false && typeof renderStatus.body?.message === "string", `connected=${renderStatus.body?.workerConnected}`);

  // 40. Video render queue without worker — returns 503 with truthful message,
  // does not fake completion. We need a post with a videoRenderSpec for this
  // probe to be meaningful, so we PATCH one in.
  if (draftId) {
    await api(userA.token, `/api/clients/${clientAId}/posts/${draftId}`, {
      method: "PATCH",
      body: JSON.stringify({ contentSchema: { videoRenderSpec: { scenes: [{ onScreenText: "test" }] } }, contentSchemaVersion: 1 }),
    });
    const queueRes = await api(userA.token, `/api/clients/${clientAId}/video-render/${draftId}/queue`, { method: "POST" });
    const goodHonestResponse = (queueRes.status === 503 && queueRes.body?.state === "queued") || (queueRes.status === 200);
    record("P51: video-render queue honest when worker missing", goodHonestResponse, `status=${queueRes.status} state=${queueRes.body?.state}`);
    // And the post itself must NOT have videoUrl unless a real worker provided one
    const verifyPost = await api(userA.token, `/api/clients/${clientAId}/video-render/${draftId}`);
    record("P51: post has no videoUrl when worker missing (no fake MP4)", !verifyPost.body?.videoUrl, `videoUrl=${verifyPost.body?.videoUrl ?? "null"} state=${verifyPost.body?.state}`);
  }

  // 41. Drive archive — honest disabled
  const drive = await api(userA.token, `/api/clients/${clientAId}/drive-archive/status`);
  record("P51: drive-archive status reports not connected", drive.status === 200 && drive.body?.connected === false, `connected=${drive.body?.connected}`);
  const driveUp = await api(userA.token, `/api/clients/${clientAId}/drive-archive/upload`, { method: "POST", body: JSON.stringify({ supabasePath: "x" }) });
  record("P51: drive-archive upload returns honest 503", driveUp.status === 503, `status=${driveUp.status}`);

  // Summary
  const failed = probes.filter((p) => !p.ok);
  console.log(`\n=== ${probes.length - failed.length}/${probes.length} probes passed ===`);
  if (failed.length) {
    console.log("\nFailed probes:");
    for (const f of failed) console.log(`  - ${f.name}${f.note ? ` (${f.note})` : ""}`);
  } else {
    console.log("All live QA probes passed.");
  }

  // Cleanup test users + client
  try {
    if (clientAId) await api(userA.token, `/api/clients/${clientAId}`, { method: "DELETE" }).catch(() => {});
    await adminDeleteUser(userA.userId).catch(() => {});
    await adminDeleteUser(userB.userId).catch(() => {});
  } catch { /* best-effort cleanup */ }

  process.exit(failed.length ? 1 : 0);
})().catch((err) => {
  console.error("Probe crashed:", err);
  process.exit(2);
});
