import { Router } from "express";
import { db } from "@workspace/db";
import {
  clientsTable,
  postsTable,
  brandDnaTable,
  storylinesTable,
  campaignsTable,
  socialAccountsTable,
  imagesTable,
  contentMemoryTable,
  postingRulesTable,
  brandAssetsTable,
} from "@workspace/db/schema";
import { eq, and, count } from "drizzle-orm";
import {
  CreateClientBody,
  UpdateClientBody,
} from "@workspace/api-zod";

const router = Router();

function getInitials(name: string): string {
  return name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

const COLORS = [
  "#6366f1", "#8b5cf6", "#ec4899", "#f59e0b", "#10b981",
  "#3b82f6", "#ef4444", "#14b8a6", "#f97316", "#a855f7",
];

/** Returns true if the client has any related data rows. */
async function clientHasRelatedData(clientId: string): Promise<boolean> {
  const checks = await Promise.all([
    db.select({ n: count() }).from(postsTable).where(eq(postsTable.clientId, clientId)),
    db.select({ n: count() }).from(brandDnaTable).where(eq(brandDnaTable.clientId, clientId)),
    db.select({ n: count() }).from(storylinesTable).where(eq(storylinesTable.clientId, clientId)),
    db.select({ n: count() }).from(campaignsTable).where(eq(campaignsTable.clientId, clientId)),
    db.select({ n: count() }).from(socialAccountsTable).where(eq(socialAccountsTable.clientId, clientId)),
    db.select({ n: count() }).from(imagesTable).where(eq(imagesTable.clientId, clientId)),
    db.select({ n: count() }).from(contentMemoryTable).where(eq(contentMemoryTable.clientId, clientId)),
    db.select({ n: count() }).from(postingRulesTable).where(eq(postingRulesTable.clientId, clientId)),
    db.select({ n: count() }).from(brandAssetsTable).where(eq(brandAssetsTable.clientId, clientId)),
  ]);
  return checks.some((r) => Number(r[0]?.n ?? 0) > 0);
}

// GET /clients — returns non-archived by default; ?includeArchived=true includes all
router.get("/clients", async (req, res) => {
  try {
    const includeArchived = req.query.includeArchived === "true";
    const clients = includeArchived
      ? await db.select().from(clientsTable).orderBy(clientsTable.createdAt)
      : await db.select().from(clientsTable).where(eq(clientsTable.archived, false)).orderBy(clientsTable.createdAt);
    res.json(clients);
  } catch (err) {
    res.status(500).json({ error: "Failed to list clients" });
  }
});

router.post("/clients", async (req, res) => {
  try {
    const body = CreateClientBody.parse(req.body);
    const color = body.color ?? COLORS[Math.floor(Math.random() * COLORS.length)];
    const [client] = await db
      .insert(clientsTable)
      .values({
        name: body.name,
        color,
        avatarInitials: getInitials(body.name),
      })
      .returning();
    res.status(201).json(client);
  } catch (err) {
    res.status(400).json({ error: "Failed to create client" });
  }
});

router.get("/clients/:clientId", async (req, res): Promise<void> => {
  try {
    const [client] = await db
      .select()
      .from(clientsTable)
      .where(eq(clientsTable.id, req.params.clientId))
      .limit(1);
    if (!client) { res.status(404).json({ error: "Not found" }); return; }
    res.json(client);
  } catch (err) {
    res.status(500).json({ error: "Failed to get client" });
  }
});

router.patch("/clients/:clientId", async (req, res) => {
  try {
    const body = UpdateClientBody.parse(req.body);
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (body.name) {
      updates.name = body.name;
      updates.avatarInitials = getInitials(body.name);
    }
    if (body.color) updates.color = body.color;
    // Extra editable fields (not in generated schema, accepted as plain body)
    const extra = req.body as Record<string, unknown>;
    if (typeof extra.industry === "string") updates.industry = extra.industry || null;
    if (typeof extra.logoUrl === "string") updates.logoUrl = extra.logoUrl || null;
    const [client] = await db
      .update(clientsTable)
      .set(updates)
      .where(eq(clientsTable.id, req.params.clientId))
      .returning();
    res.json(client);
  } catch (err) {
    res.status(400).json({ error: "Failed to update client" });
  }
});

// POST /clients/:clientId/archive
router.post("/clients/:clientId/archive", async (req, res): Promise<void> => {
  try {
    const [client] = await db
      .update(clientsTable)
      .set({ archived: true, updatedAt: new Date() })
      .where(eq(clientsTable.id, req.params.clientId))
      .returning();
    if (!client) { res.status(404).json({ error: "Not found" }); return; }
    res.json(client);
  } catch (err) {
    res.status(500).json({ error: "Failed to archive client" });
  }
});

// POST /clients/:clientId/restore
router.post("/clients/:clientId/restore", async (req, res): Promise<void> => {
  try {
    const [client] = await db
      .update(clientsTable)
      .set({ archived: false, updatedAt: new Date() })
      .where(eq(clientsTable.id, req.params.clientId))
      .returning();
    if (!client) { res.status(404).json({ error: "Not found" }); return; }
    res.json(client);
  } catch (err) {
    res.status(500).json({ error: "Failed to restore client" });
  }
});

// Update webhook URL for a client
router.patch("/clients/:clientId/webhook-url", async (req, res): Promise<void> => {
  try {
    const { webhookUrl } = req.body as { webhookUrl?: string };
    const [client] = await db
      .update(clientsTable)
      .set({ webhookUrl: webhookUrl ?? null, updatedAt: new Date() })
      .where(eq(clientsTable.id, req.params.clientId))
      .returning();
    if (!client) { res.status(404).json({ error: "Not found" }); return; }
    res.json(client);
  } catch (err) {
    res.status(400).json({ error: "Failed to update webhook URL" });
  }
});

// DELETE /clients/:clientId — only allowed if no related data exists
router.delete("/clients/:clientId", async (req, res): Promise<void> => {
  try {
    const hasData = await clientHasRelatedData(req.params.clientId);
    if (hasData) {
      res.status(409).json({
        error: "Client has related data. Archive it instead of deleting.",
        code: "HAS_RELATED_DATA",
      });
      return;
    }
    await db.delete(clientsTable).where(eq(clientsTable.id, req.params.clientId));
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: "Failed to delete client" });
  }
});

export default router;
