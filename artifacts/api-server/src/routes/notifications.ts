import { Router } from "express";
import { and, desc, eq, isNull, or } from "drizzle-orm";
import { db } from "@workspace/db";
import { notificationsTable } from "@workspace/db/schema";
import type { AuthRequest } from "../middleware/auth.js";

const router = Router();

router.get("/clients/:clientId/notifications", async (req: AuthRequest, res): Promise<void> => {
  try {
    const clientId = req.params.clientId;
    const userId = req.userId!;
    const rows = await db
      .select()
      .from(notificationsTable)
      .where(
        and(
          eq(notificationsTable.clientId, clientId),
          or(isNull(notificationsTable.userId), eq(notificationsTable.userId, userId))
        )
      )
      .orderBy(desc(notificationsTable.createdAt))
      .limit(50);

    res.json({
      notifications: rows,
      unreadCount: rows.filter((row) => !row.readAt).length,
    });
  } catch {
    res.status(500).json({ error: "Failed to load notifications" });
  }
});

router.post("/clients/:clientId/notifications/:id/read", async (req: AuthRequest, res): Promise<void> => {
  try {
    const clientId = req.params.clientId;
    const id = req.params.id;
    const userId = req.userId!;
    const [updated] = await db
      .update(notificationsTable)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notificationsTable.id, id),
          eq(notificationsTable.clientId, clientId),
          or(isNull(notificationsTable.userId), eq(notificationsTable.userId, userId))
        )
      )
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Notification not found" });
      return;
    }
    res.json(updated);
  } catch {
    res.status(500).json({ error: "Failed to mark notification read" });
  }
});

router.post("/clients/:clientId/notifications/read-all", async (req: AuthRequest, res): Promise<void> => {
  try {
    const clientId = req.params.clientId;
    const userId = req.userId!;
    const rows = await db
      .update(notificationsTable)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notificationsTable.clientId, clientId),
          or(isNull(notificationsTable.userId), eq(notificationsTable.userId, userId))
        )
      )
      .returning({ id: notificationsTable.id });

    res.json({ updated: rows.length });
  } catch {
    res.status(500).json({ error: "Failed to mark notifications read" });
  }
});

export default router;
