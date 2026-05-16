import { Router } from "express";
import crypto from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { blogSiteConnectionsTable, clientsTable, postsTable } from "@workspace/db/schema";
import { EDIT_CONTENT_ROLES, requireClientRole, type AuthRequest } from "../middleware/auth.js";
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
  return {
    title: post.title || schema.seoTitle || post.topic,
    slug: schema.slug || slugify(post.title || post.topic),
    body,
    html: body,
    metaDescription: schema.metaDescription || post.caption || "",
    featuredImageUrl: post.selectedImageUrl || schema.featuredImageUrl || schema.imageUrl || "",
    tags,
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
          status: connection.status,
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
    const { siteName, siteUrl, endpointUrl } = req.body as { siteName?: string; siteUrl?: string; endpointUrl?: string };
    if (!siteUrl || !endpointUrl) {
      res.status(400).json({ error: "Site URL and blog receiver endpoint are required." });
      return;
    }
    const secret = generateSecret();
    try {
      const [connection] = await db
        .insert(blogSiteConnectionsTable)
        .values({
          clientId: req.params.clientId,
          siteName: siteName?.trim() || new URL(siteUrl).hostname,
          siteUrl,
          endpointUrl,
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
      const response = await fetch(connection.endpointUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-ams-signature": hmac(secret, payload), "x-ams-event": "connection.test" },
        body: payload,
      });
      const data = await response.json().catch(() => ({}));
      res.json({ ok: response.ok, status: response.status, response: data });
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
        res.status(409).json({ error: "Connect website to publish blog." });
        return;
      }
      const [post] = await db.select().from(postsTable).where(and(eq(postsTable.id, req.params.postId), eq(postsTable.clientId, req.params.clientId))).limit(1);
      if (!post || post.postType !== "blog") {
        res.status(404).json({ error: "Approved blog draft not found." });
        return;
      }
      if (!["approved", "export_ready", "scheduled", "posted", "published"].includes(post.status)) {
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
        await db.update(postsTable).set({ publishError: data.error || `Website publish failed: HTTP ${response.status}`, updatedAt: new Date() }).where(eq(postsTable.id, post.id));
        res.status(502).json({ error: data.error || "Website publish failed." });
        return;
      }
      const publishedUrl = data.publishedUrl || data.url || `${connection.siteUrl.replace(/\/$/, "")}/${payload.slug}`;
      const nextSchema = { ...asRecord(post.contentSchema), publish: { ...asRecord(asRecord(post.contentSchema).publish), website: { publishedUrl, siteName: connection.siteName, publishedAt: payload.publishedAt } } };
      const [updated] = await db.update(postsTable).set({
        status: "published",
        publishedAt: new Date(payload.publishedAt),
        publishedUrl,
        publishError: null,
        contentSchema: nextSchema,
        contentSchemaVersion: 1,
        updatedAt: new Date(),
      }).where(eq(postsTable.id, post.id)).returning();
      res.json({ ok: true, publishedUrl, post: updated, response: data });
    } catch (err) {
      logger.error({ error: safeErrorMessage(err) }, "Blog publish-to-site failed");
      res.status(500).json({ error: "Blog publish-to-site failed." });
    }
  }
);

export default router;
