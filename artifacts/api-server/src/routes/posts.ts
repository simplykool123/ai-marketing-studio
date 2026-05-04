import { Router } from "express";
import { db } from "@workspace/db";
import { postsTable, clientsTable, postingLogsTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import {
  CreatePostBody,
  UpdatePostBody,
  ApprovePostBody,
  ListPostsQueryParams,
} from "@workspace/api-zod";

const router = Router();

router.get("/clients/:clientId/posts", async (req, res) => {
  try {
    const query = ListPostsQueryParams.parse(req.query);
    const conditions = [eq(postsTable.clientId, req.params.clientId)];
    if (query.status) {
      conditions.push(eq(postsTable.status, query.status));
    }
    const posts = await db
      .select()
      .from(postsTable)
      .where(and(...conditions))
      .orderBy(postsTable.createdAt);
    res.json(posts);
  } catch (err) {
    res.status(500).json({ error: "Failed to list posts" });
  }
});

router.post("/clients/:clientId/posts", async (req, res) => {
  try {
    const body = CreatePostBody.parse(req.body);
    const [post] = await db
      .insert(postsTable)
      .values({ clientId: req.params.clientId, ...body, status: "draft" })
      .returning();
    res.status(201).json(post);
  } catch (err) {
    res.status(400).json({ error: "Failed to create post" });
  }
});

// Export all approved posts as JSON download
router.get("/clients/:clientId/posts/export", async (req, res) => {
  try {
    const [client] = await db
      .select()
      .from(clientsTable)
      .where(eq(clientsTable.id, req.params.clientId))
      .limit(1);

    const posts = await db
      .select()
      .from(postsTable)
      .where(
        and(
          eq(postsTable.clientId, req.params.clientId),
          eq(postsTable.status, "approved")
        )
      )
      .orderBy(postsTable.scheduledAt);

    const exportData = {
      clientName: client?.name ?? "Unknown",
      exportedAt: new Date().toISOString(),
      posts: posts.map((p) => ({
        id: p.id,
        caption: p.caption,
        hashtags: p.hashtags ?? "",
        image_url: p.selectedImageUrl ?? "",
        scheduled_at: p.scheduledAt?.toISOString() ?? "",
        platform: p.platform ?? "instagram",
      })),
    };
    res.json(exportData);
  } catch (err) {
    res.status(500).json({ error: "Failed to export posts" });
  }
});

// Canonical "export/approved" endpoint returning all approved content
router.get("/clients/:clientId/export/approved", async (req, res) => {
  try {
    const [client] = await db
      .select()
      .from(clientsTable)
      .where(eq(clientsTable.id, req.params.clientId))
      .limit(1);

    if (!client) { res.status(404).json({ error: "Client not found" }); return; }

    const posts = await db
      .select()
      .from(postsTable)
      .where(
        and(
          eq(postsTable.clientId, req.params.clientId),
          eq(postsTable.status, "approved")
        )
      )
      .orderBy(postsTable.scheduledAt);

    const exportData = {
      clientName: client.name,
      exportedAt: new Date().toISOString(),
      totalItems: posts.length,
      posts: posts.map((p) => ({
        id: p.id,
        topic: p.topic,
        caption: p.caption,
        hashtags: p.hashtags ?? "",
        selectedImageUrl: p.selectedImageUrl ?? "",
        scheduledAt: p.scheduledAt?.toISOString() ?? "",
        platform: p.platform ?? "instagram",
        status: p.status,
        createdAt: p.createdAt,
      })),
    };

    res.setHeader("Content-Disposition", `attachment; filename="approved-content-${client.name.toLowerCase().replace(/\s+/g, "-")}.json"`);
    res.json(exportData);
  } catch (err) {
    res.status(500).json({ error: "Failed to export approved content" });
  }
});

router.get("/clients/:clientId/posts/:postId", async (req, res): Promise<void> => {
  try {
    const [post] = await db
      .select()
      .from(postsTable)
      .where(
        and(
          eq(postsTable.id, req.params.postId),
          eq(postsTable.clientId, req.params.clientId)
        )
      )
      .limit(1);
    if (!post) { res.status(404).json({ error: "Not found" }); return; }
    res.json(post);
  } catch (err) {
    res.status(500).json({ error: "Failed to get post" });
  }
});

router.patch("/clients/:clientId/posts/:postId", async (req, res) => {
  try {
    const body = UpdatePostBody.parse(req.body);
    const { scheduledAt, ...rest } = body;
    const [post] = await db
      .update(postsTable)
      .set({ ...rest, ...(scheduledAt ? { scheduledAt: new Date(scheduledAt) } : {}), updatedAt: new Date() })
      .where(
        and(
          eq(postsTable.id, req.params.postId),
          eq(postsTable.clientId, req.params.clientId)
        )
      )
      .returning();
    res.json(post);
  } catch (err) {
    res.status(400).json({ error: "Failed to update post" });
  }
});

// Dedicated status-transition endpoint
router.patch("/clients/:clientId/posts/:postId/status", async (req, res): Promise<void> => {
  try {
    const { status, scheduledAt, platform } = req.body as {
      status: string;
      scheduledAt?: string;
      platform?: string;
    };
    const validStatuses = ["draft", "approved", "scheduled", "published", "rejected"];
    if (!status || !validStatuses.includes(status)) {
      res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(", ")}` });
      return;
    }

    const updates: Record<string, unknown> = { status, updatedAt: new Date() };
    if (scheduledAt) updates.scheduledAt = new Date(scheduledAt);
    if (platform) updates.platform = platform;

    const [post] = await db
      .update(postsTable)
      .set(updates)
      .where(
        and(
          eq(postsTable.id, req.params.postId),
          eq(postsTable.clientId, req.params.clientId)
        )
      )
      .returning();

    if (!post) { res.status(404).json({ error: "Post not found" }); return; }
    res.json(post);
  } catch (err) {
    res.status(400).json({ error: "Failed to update post status" });
  }
});

router.delete("/clients/:clientId/posts/:postId", async (req, res) => {
  try {
    await db
      .delete(postsTable)
      .where(
        and(
          eq(postsTable.id, req.params.postId),
          eq(postsTable.clientId, req.params.clientId)
        )
      );
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: "Failed to delete post" });
  }
});

router.post("/clients/:clientId/posts/:postId/reject", async (req, res): Promise<void> => {
  try {
    const [post] = await db
      .update(postsTable)
      .set({ status: "rejected", updatedAt: new Date() })
      .where(
        and(
          eq(postsTable.id, req.params.postId),
          eq(postsTable.clientId, req.params.clientId)
        )
      )
      .returning();
    if (!post) { res.status(404).json({ error: "Post not found" }); return; }
    res.json(post);
  } catch {
    res.status(500).json({ error: "Failed to reject post" });
  }
});

router.post("/clients/:clientId/posts/bulk-approve", async (req, res): Promise<void> => {
  try {
    const { postIds, scheduledAt, platform } = req.body as {
      postIds: string[];
      scheduledAt?: string;
      platform?: string;
    };
    if (!Array.isArray(postIds) || postIds.length === 0) {
      res.status(400).json({ error: "postIds must be a non-empty array" });
      return;
    }
    const { clientId } = req.params;
    const results = [];
    for (const postId of postIds) {
      const parsedDate = scheduledAt ? new Date(scheduledAt) : null;
      const [post] = await db
        .update(postsTable)
        .set({
          status: parsedDate ? "scheduled" : "approved",
          ...(parsedDate ? { scheduledAt: parsedDate } : {}),
          ...(platform ? { platform } : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(postsTable.id, postId), eq(postsTable.clientId, clientId)))
        .returning();
      if (post) results.push(post);
    }
    res.json({ approved: results, count: results.length });
  } catch {
    res.status(400).json({ error: "Failed to bulk approve posts" });
  }
});

router.post("/clients/:clientId/posts/:postId/approve", async (req, res) => {
  try {
    const body = ApprovePostBody.parse(req.body);
    const scheduledAt = new Date(body.scheduledAt);
    const [post] = await db
      .update(postsTable)
      .set({
        status: "scheduled",
        scheduledAt,
        platform: body.platform ?? "instagram",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(postsTable.id, req.params.postId),
          eq(postsTable.clientId, req.params.clientId)
        )
      )
      .returning();
    res.json(post);
  } catch (err) {
    res.status(400).json({ error: "Failed to approve post" });
  }
});

router.post("/clients/:clientId/posts/:postId/mock-post", async (req, res): Promise<void> => {
  try {
    const { clientId, postId } = req.params;

    const [post] = await db
      .select()
      .from(postsTable)
      .where(and(eq(postsTable.id, postId), eq(postsTable.clientId, clientId)))
      .limit(1);

    if (!post) { res.status(404).json({ error: "Post not found" }); return; }

    const [updated] = await db
      .update(postsTable)
      .set({ status: "published", updatedAt: new Date() })
      .where(and(eq(postsTable.id, postId), eq(postsTable.clientId, clientId)))
      .returning();

    await db.insert(postingLogsTable).values({
      clientId,
      postId,
      action: "mock_post",
      status: "success",
      provider: "mock",
      payload: { caption: post.caption, platform: post.platform ?? "instagram" },
      responseBody: JSON.stringify({ success: true, mockId: `mock_${Date.now()}`, message: "Post published successfully (mock)" }),
    });

    res.json({ post: updated, message: "Mock post published successfully" });
  } catch (err) {
    res.status(500).json({ error: "Failed to mock post" });
  }
});

router.post("/clients/:clientId/posts/:postId/mark-posted", async (req, res): Promise<void> => {
  try {
    const { clientId, postId } = req.params;

    const [updated] = await db
      .update(postsTable)
      .set({ status: "published", updatedAt: new Date() })
      .where(and(eq(postsTable.id, postId), eq(postsTable.clientId, clientId)))
      .returning();

    if (!updated) { res.status(404).json({ error: "Post not found" }); return; }

    await db.insert(postingLogsTable).values({
      clientId,
      postId,
      action: "mark_posted_manually",
      status: "success",
      provider: "manual",
    });

    res.json({ post: updated, message: "Post marked as posted" });
  } catch (err) {
    res.status(500).json({ error: "Failed to mark post" });
  }
});

// Webhook export — uses the client's stored webhookUrl, not a user-supplied URL
router.post("/clients/:clientId/webhook/export", async (req, res): Promise<void> => {
  try {
    const { clientId } = req.params;
    const { postId } = req.body as { postId?: string };

    const [client] = await db
      .select()
      .from(clientsTable)
      .where(eq(clientsTable.id, clientId))
      .limit(1);

    if (!client) { res.status(404).json({ error: "Client not found" }); return; }

    let posts;
    if (postId) {
      posts = await db
        .select()
        .from(postsTable)
        .where(and(eq(postsTable.id, postId), eq(postsTable.clientId, clientId)))
        .limit(1);
    } else {
      posts = await db
        .select()
        .from(postsTable)
        .where(and(eq(postsTable.clientId, clientId), eq(postsTable.status, "approved")));
    }

    const payload = {
      clientName: client.name,
      exportedAt: new Date().toISOString(),
      posts: posts.map(p => ({
        id: p.id,
        caption: p.caption,
        hashtags: p.hashtags ?? "",
        image_url: p.selectedImageUrl ?? "",
        scheduled_at: p.scheduledAt?.toISOString() ?? "",
        platform: p.platform ?? "instagram",
        status: p.status,
      })),
    };

    const storedWebhookUrl = (client as { webhookUrl?: string | null }).webhookUrl;

    if (!storedWebhookUrl) {
      res.json({ success: false, payload, message: "No webhook URL configured for this client. Configure it in Settings." });
      return;
    }

    try {
      const hookRes = await fetch(storedWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      for (const post of posts) {
        await db.insert(postingLogsTable).values({
          clientId,
          postId: post.id,
          action: "webhook_export",
          status: hookRes.ok ? "success" : "failed",
          provider: "webhook",
          payload,
          responseBody: `HTTP ${hookRes.status}`,
        });
      }

      res.json({ success: hookRes.ok, status: hookRes.status, payload, message: hookRes.ok ? "Webhook delivery successful" : `Webhook returned ${hookRes.status}` });
    } catch (fetchErr) {
      res.status(502).json({ error: "Failed to call webhook", details: String(fetchErr) });
    }
  } catch (err) {
    res.status(500).json({ error: "Failed to export via webhook" });
  }
});

export default router;
