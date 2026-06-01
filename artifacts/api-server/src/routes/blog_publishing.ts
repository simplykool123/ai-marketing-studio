import { Router } from "express";
import crypto from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { blogSiteConnectionsTable, clientsTable, postingLogsTable, postsTable } from "@workspace/db/schema";
import { EDIT_CONTENT_ROLES, MANAGE_CLIENT_ROLES, requireClientRole, type AuthRequest } from "../middleware/auth.js";
import { decrypt, encrypt } from "../lib/encryption.js";
import { safeErrorMessage } from "../lib/ai-provider.js";
import { logger } from "../lib/logger.js";

const router = Router();

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function generateSecret(): string {
  return `ams_${crypto.randomBytes(24).toString("base64url")}`;
}

function hashSecret(secret: string): string {
  return crypto.createHash("sha256").update(secret).digest("hex");
}

function hmac(secret: string, body: string): string {
  return `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 90) || `post-${Date.now()}`;
}

function sectionsToHtml(sections: unknown): string {
  if (!Array.isArray(sections)) return "";
  return sections.map((section) => {
    const record = asRecord(section);
    const heading = String(record.heading ?? "").trim();
    const content = String(record.content ?? "").trim();
    return `${heading ? `<h2>${heading}</h2>` : ""}${content ? `<p>${content.replace(/\n{2,}/g, "</p><p>").replace(/\n/g, "<br />")}</p>` : ""}`;
  }).join("\n");
}

function blogPayload(post: typeof postsTable.$inferSelect, client: typeof clientsTable.$inferSelect | undefined) {
  const schema = asRecord(post.contentSchema);
  const schemaMarkup = schema.schemaMarkup ?? schema.schemaSuggestion ?? null;
  const body = sectionsToHtml(schema.sections) || String(schema.fullDraft || post.longFormBody || post.caption || "");
  const tags = Array.isArray(schema.targetKeywords)
    ? schema.targetKeywords.map(String)
    : String(post.hashtags ?? "").split(/\s+/).map((tag) => tag.replace(/^#/, "")).filter(Boolean);
  const categories = Array.isArray(schema.categories) ? schema.categories.map(String) : [];
  const faq = Array.isArray(schema.faq)
    ? schema.faq.map((item) => {
        const r = asRecord(item);
        return { question: String(r.question ?? r.q ?? ""), answer: String(r.answer ?? r.a ?? "") };
      }).filter((item) => item.question && item.answer)
    : [];
  const excerpt = String(schema.excerpt || schema.metaDescription || post.caption || "").slice(0, 320);
  const cta = String(schema.cta || schema.callToAction || "");
  const canonicalUrl = String(schema.canonicalUrl || "");
  return {
    title: post.title || schema.seoTitle || post.topic,
    slug: schema.slug || slugify(post.title || post.topic),
    metaTitle: schema.seoTitle || post.title || post.topic,
    metaDescription: schema.metaDescription || excerpt,
    excerpt,
    body,
    html: body,
    faq,
    featuredImageUrl: post.selectedImageUrl || schema.featuredImageUrl || schema.imageUrl || "",
    heroImageUrl: post.selectedImageUrl || schema.heroImageUrl || schema.featuredImageUrl || "",
    tags,
    categories,
    cta,
    canonicalUrl,
    schemaMarkup,
    publishedAt: new Date().toISOString(),
    author: client?.name || "AI Marketing Studio",
    clientName: client?.name || "",
    sourcePostId: post.id,
  };
}

async function latestConnection(clientId: string) {
  const [connection] = await db
    .select()
    .from(blogSiteConnectionsTable)
    .where(and(eq(blogSiteConnectionsTable.clientId, clientId), eq(blogSiteConnectionsTable.status, "active")))
    .orderBy(desc(blogSiteConnectionsTable.updatedAt))
    .limit(1);
  return connection ?? null;
}

router.get(
  "/clients/:clientId/blog/site-connection",
  requireClientRole(["owner", "admin", "editor", "approver", "viewer"]),
  async (req: AuthRequest, res): Promise<void> => {
    try {
      const connection = await latestConnection(req.params.clientId);
      res.json({
        connection: connection ? {
          id: connection.id,
          siteName: connection.siteName,
          siteUrl: connection.siteUrl,
          endpointUrl: connection.endpointUrl,
          platform: connection.platform,
          status: connection.status,
          lastTestStatus: connection.lastTestStatus,
          lastTestMessage: connection.lastTestMessage,
          lastTestedAt: connection.lastTestedAt,
          createdAt: connection.createdAt,
          updatedAt: connection.updatedAt,
        } : null,
      });
    } catch (err) {
      logger.error({ error: safeErrorMessage(err) }, "Blog connection get failed");
      res.status(500).json({ error: "Failed to load website blog connection" });
    }
  }
);

router.put(
  "/clients/:clientId/blog/site-connection",
  requireClientRole(EDIT_CONTENT_ROLES),
  async (req: AuthRequest, res): Promise<void> => {
    const { siteName, siteUrl, endpointUrl, platform } = req.body as { siteName?: string; siteUrl?: string; endpointUrl?: string; platform?: string };
    if (!siteUrl || !endpointUrl) {
      res.status(400).json({ error: "Site URL and blog receiver endpoint are required." });
      return;
    }
    const platformKind = ["wordpress", "ghost", "webhook"].includes(String(platform)) ? String(platform) : "webhook";
    const secret = generateSecret();
    try {
      // Mark any prior active connections inactive so latestConnection() returns the new one.
      await db.update(blogSiteConnectionsTable)
        .set({ status: "inactive", updatedAt: new Date() })
        .where(and(eq(blogSiteConnectionsTable.clientId, req.params.clientId), eq(blogSiteConnectionsTable.status, "active")));

      const [connection] = await db
        .insert(blogSiteConnectionsTable)
        .values({
          clientId: req.params.clientId,
          siteName: siteName?.trim() || new URL(siteUrl).hostname,
          siteUrl,
          endpointUrl,
          platform: platformKind,
          secretHash: hashSecret(secret),
          encryptedSecret: encrypt(secret),
          status: "active",
        })
        .returning();
      res.status(201).json({
        connection: {
          id: connection.id,
          siteName: connection.siteName,
          siteUrl: connection.siteUrl,
          endpointUrl: connection.endpointUrl,
          platform: connection.platform,
          status: connection.status,
        },
        secret,
      });
    } catch (err) {
      logger.error({ error: safeErrorMessage(err) }, "Blog connection save failed");
      res.status(500).json({ error: "Failed to save website blog connection" });
    }
  }
);

router.delete(
  "/clients/:clientId/blog/site-connection",
  requireClientRole(MANAGE_CLIENT_ROLES),
  async (req: AuthRequest, res): Promise<void> => {
    try {
      await db
        .update(blogSiteConnectionsTable)
        .set({ status: "inactive", updatedAt: new Date() })
        .where(and(eq(blogSiteConnectionsTable.clientId, req.params.clientId), eq(blogSiteConnectionsTable.status, "active")));
      res.status(204).end();
    } catch (err) {
      logger.error({ error: safeErrorMessage(err) }, "Blog connection delete failed");
      res.status(500).json({ error: "Failed to disconnect website" });
    }
  }
);

router.post(
  "/clients/:clientId/blog/site-connection/test",
  requireClientRole(EDIT_CONTENT_ROLES),
  async (req: AuthRequest, res): Promise<void> => {
    try {
      const connection = await latestConnection(req.params.clientId);
      if (!connection) {
        res.status(404).json({ error: "Connect website to publish blog." });
        return;
      }
      const secret = decrypt(connection.encryptedSecret);
      const payload = JSON.stringify({ type: "ams_blog_connection_test", sentAt: new Date().toISOString(), siteName: connection.siteName });
      let ok = false;
      let httpStatus = 0;
      let message = "";
      let data: unknown = {};
      try {
        const response = await fetch(connection.endpointUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-ams-signature": hmac(secret, payload), "x-ams-event": "connection.test" },
          body: payload,
        });
        httpStatus = response.status;
        data = await response.json().catch(() => ({}));
        ok = response.ok;
        message = ok ? `Reached ${connection.siteName} (${response.status}).` : `Endpoint returned HTTP ${response.status}.`;
      } catch (fetchErr) {
        message = fetchErr instanceof Error ? fetchErr.message : "Network error";
      }
      await db.update(blogSiteConnectionsTable)
        .set({
          lastTestStatus: ok ? "ok" : "failed",
          lastTestMessage: message.slice(0, 500),
          lastTestedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(blogSiteConnectionsTable.id, connection.id));
      res.json({ ok, status: httpStatus, response: data, message });
    } catch (err) {
      logger.error({ error: safeErrorMessage(err) }, "Blog connection test failed");
      res.status(500).json({ error: "Connection test failed" });
    }
  }
);

router.post(
  "/clients/:clientId/blog/:postId/publish-to-site",
  requireClientRole(EDIT_CONTENT_ROLES),
  async (req: AuthRequest, res): Promise<void> => {
    try {
      const connection = await latestConnection(req.params.clientId);
      if (!connection) {
        res.status(409).json({ error: "No blog site connected. Connect a website in Client Settings before publishing." });
        return;
      }
      const [post] = await db.select().from(postsTable).where(and(eq(postsTable.id, req.params.postId), eq(postsTable.clientId, req.params.clientId))).limit(1);
      if (!post || post.postType !== "blog") {
        res.status(404).json({ error: "Approved blog draft not found." });
        return;
      }
      if (!["approved", "export_ready", "ready_to_post", "scheduled", "exported", "posted", "posted_manually", "published", "published_via_api"].includes(post.status)) {
        res.status(400).json({ error: "Approve this blog before publishing to website." });
        return;
      }
      const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, req.params.clientId)).limit(1);
      const payload = blogPayload(post, client);
      const body = JSON.stringify(payload);
      const secret = decrypt(connection.encryptedSecret);
      const response = await fetch(connection.endpointUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-ams-signature": hmac(secret, body), "x-ams-event": "blog.publish" },
        body,
      });
      const data = await response.json().catch(() => ({})) as { publishedUrl?: string; url?: string; error?: string };
      if (!response.ok) {
        const errorMessage = data.error || `Website publish failed: HTTP ${response.status}`;
        await db.update(postsTable).set({ publishError: errorMessage, updatedAt: new Date() }).where(eq(postsTable.id, post.id));
        await db.insert(postingLogsTable).values({
          clientId: req.params.clientId,
          postId: post.id,
          action: "blog_publish",
          status: "failed",
          provider: connection.platform || "webhook",
          payload: payload as unknown as Record<string, unknown>,
          responseBody: `HTTP ${response.status} ${errorMessage}`,
        });
        res.status(502).json({ error: errorMessage });
        return;
      }
      const publishedUrl = data.publishedUrl || data.url || `${connection.siteUrl.replace(/\/$/, "")}/${payload.slug}`;
      const nextSchema = { ...asRecord(post.contentSchema), publish: { ...asRecord(asRecord(post.contentSchema).publish), website: { publishedUrl, siteName: connection.siteName, publishedAt: payload.publishedAt } } };
      const [updated] = await db.update(postsTable).set({
        status: "published_via_api",
        publishedAt: new Date(payload.publishedAt),
        publishedUrl,
        publishError: null,
        contentSchema: nextSchema,
        contentSchemaVersion: 1,
        updatedAt: new Date(),
      }).where(eq(postsTable.id, post.id)).returning();
      await db.insert(postingLogsTable).values({
        clientId: req.params.clientId,
        postId: post.id,
        action: "blog_publish",
        status: "success",
        provider: connection.platform || "webhook",
        payload: payload as unknown as Record<string, unknown>,
        responseBody: JSON.stringify({ publishedUrl, response: data }),
      });
      res.json({ ok: true, publishedUrl, post: updated, response: data });
    } catch (err) {
      logger.error({ error: safeErrorMessage(err) }, "Blog publish-to-site failed");
      res.status(500).json({ error: "Blog publish-to-site failed." });
    }
  }
);

export default router;
