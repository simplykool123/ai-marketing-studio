import { createHash, randomBytes } from "crypto";
import { Router } from "express";
import { and, count, desc, eq, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  clientInvitesTable,
  clientUsersTable,
  profilesTable,
  type ClientRole,
} from "@workspace/db/schema";
import {
  MANAGE_CLIENT_ROLES,
  requireAuth,
  requireClientRole,
  type AuthRequest,
} from "../middleware/auth.js";
import { createClientNotification } from "../lib/notifications.js";

const router = Router();

const ROLES: ClientRole[] = ["owner", "admin", "editor", "approver", "viewer"];
const ROLE_RANK: Record<ClientRole, number> = {
  owner: 5,
  admin: 4,
  editor: 3,
  approver: 2,
  viewer: 1,
};
const INVITE_TTL_DAYS = 7;

function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function isClientRole(value: unknown): value is ClientRole {
  return typeof value === "string" && ROLES.includes(value as ClientRole);
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function inviteUrl(req: AuthRequest, token: string): string {
  const origin = typeof req.headers.origin === "string"
    ? req.headers.origin
    : `${req.protocol}://${req.get("host")}`;
  return `${origin}/invites/${token}`;
}

function canManageRole(actorRole: ClientRole | undefined, targetRole: ClientRole): boolean {
  if (actorRole === "owner") return true;
  if (actorRole === "admin") return targetRole !== "owner";
  return false;
}

async function ownerCount(clientId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(clientUsersTable)
    .where(and(eq(clientUsersTable.clientId, clientId), eq(clientUsersTable.role, "owner")));
  return Number(row?.n ?? 0);
}

async function findProfileByEmail(email: string) {
  const [profile] = await db
    .select()
    .from(profilesTable)
    .where(sql`lower(${profilesTable.email}) = ${email}`)
    .limit(1);
  return profile ?? null;
}

router.get("/clients/:clientId/team", requireClientRole(), async (req, res): Promise<void> => {
  try {
    const { clientId } = req.params;
    const members = await db
      .select({
        userId: clientUsersTable.userId,
        role: clientUsersTable.role,
        createdAt: clientUsersTable.createdAt,
        name: profilesTable.name,
        email: profilesTable.email,
      })
      .from(clientUsersTable)
      .innerJoin(profilesTable, eq(profilesTable.id, clientUsersTable.userId))
      .where(eq(clientUsersTable.clientId, clientId))
      .orderBy(clientUsersTable.createdAt);

    const invites = await db
      .select({
        id: clientInvitesTable.id,
        email: clientInvitesTable.email,
        role: clientInvitesTable.role,
        status: clientInvitesTable.status,
        expiresAt: clientInvitesTable.expiresAt,
        acceptedAt: clientInvitesTable.acceptedAt,
        createdAt: clientInvitesTable.createdAt,
      })
      .from(clientInvitesTable)
      .where(eq(clientInvitesTable.clientId, clientId))
      .orderBy(desc(clientInvitesTable.createdAt));

    res.json({ members, invites, currentUserRole: (req as AuthRequest).clientRole ?? null });
  } catch {
    res.status(500).json({ error: "Failed to load team access" });
  }
});

router.post("/clients/:clientId/invites", requireClientRole(MANAGE_CLIENT_ROLES), async (req: AuthRequest, res): Promise<void> => {
  try {
    const { clientId } = req.params;
    const email = normalizeEmail(req.body?.email);
    const role = req.body?.role;

    if (!email || !email.includes("@")) {
      res.status(400).json({ error: "Valid email is required" });
      return;
    }
    if (!isClientRole(role)) {
      res.status(400).json({ error: "Valid role is required" });
      return;
    }
    if (!canManageRole(req.clientRole, role)) {
      res.status(403).json({ error: "You cannot invite someone with that role" });
      return;
    }

    const profile = await findProfileByEmail(email);
    if (profile) {
      const [existingMember] = await db
        .select({ id: clientUsersTable.id })
        .from(clientUsersTable)
        .where(and(eq(clientUsersTable.clientId, clientId), eq(clientUsersTable.userId, profile.id)))
        .limit(1);
      if (existingMember) {
        res.status(409).json({ error: "That user already has access to this client" });
        return;
      }
    }

    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
    const [invite] = await db
      .insert(clientInvitesTable)
      .values({
        clientId,
        email,
        role,
        tokenHash: hashToken(token),
        invitedBy: req.userId!,
        status: "pending",
        expiresAt,
      })
      .returning({
        id: clientInvitesTable.id,
        email: clientInvitesTable.email,
        role: clientInvitesTable.role,
        status: clientInvitesTable.status,
        expiresAt: clientInvitesTable.expiresAt,
        acceptedAt: clientInvitesTable.acceptedAt,
        createdAt: clientInvitesTable.createdAt,
      });

    res.status(201).json({
      invite,
      inviteLink: inviteUrl(req, token),
      emailSent: false,
      message: "Invite created. Copy the invite link and send it manually.",
    });
    await createClientNotification({
      clientId,
      userId: req.userId,
      type: "invite_created",
      title: "Invite created",
      message: `${email} was invited as ${role}.`,
      severity: "info",
      metadata: { inviteId: invite!.id, email, role },
    });
  } catch {
    res.status(500).json({ error: "Failed to create invite" });
  }
});

router.post("/invites/:token/accept", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    const token = req.params.token;
    const tokenHash = hashToken(token);
    const [invite] = await db
      .select()
      .from(clientInvitesTable)
      .where(eq(clientInvitesTable.tokenHash, tokenHash))
      .limit(1);

    if (!invite) {
      res.status(404).json({ error: "Invite not found" });
      return;
    }
    if (invite.status !== "pending") {
      res.status(400).json({ error: `Invite is ${invite.status}` });
      return;
    }
    if (invite.expiresAt.getTime() <= Date.now()) {
      await db
        .update(clientInvitesTable)
        .set({ status: "expired" })
        .where(eq(clientInvitesTable.id, invite.id));
      res.status(400).json({ error: "Invite expired" });
      return;
    }
    if (normalizeEmail(req.userEmail) !== invite.email) {
      res.status(403).json({ error: `Sign in as ${invite.email} to accept this invite` });
      return;
    }

    await db
      .insert(clientUsersTable)
      .values({ clientId: invite.clientId, userId: req.userId!, role: invite.role })
      .onConflictDoNothing();

    const [updated] = await db
      .update(clientInvitesTable)
      .set({ status: "accepted", acceptedAt: new Date() })
      .where(eq(clientInvitesTable.id, invite.id))
      .returning();

    res.json({ invite: updated, clientId: invite.clientId });
    await createClientNotification({
      clientId: invite.clientId,
      userId: invite.invitedBy,
      type: "invite_accepted",
      title: "Invite accepted",
      message: `${invite.email} accepted the ${invite.role} invite.`,
      severity: "success",
      metadata: { inviteId: invite.id, acceptedBy: req.userId, role: invite.role },
    });
  } catch {
    res.status(500).json({ error: "Failed to accept invite" });
  }
});

router.post("/clients/:clientId/invites/:inviteId/cancel", requireClientRole(MANAGE_CLIENT_ROLES), async (req: AuthRequest, res): Promise<void> => {
  try {
    const { clientId, inviteId } = req.params;
    const [invite] = await db
      .select()
      .from(clientInvitesTable)
      .where(and(eq(clientInvitesTable.id, inviteId), eq(clientInvitesTable.clientId, clientId)))
      .limit(1);

    if (!invite) {
      res.status(404).json({ error: "Invite not found" });
      return;
    }
    if (!canManageRole(req.clientRole, invite.role)) {
      res.status(403).json({ error: "You cannot cancel an invite for that role" });
      return;
    }

    const [updated] = await db
      .update(clientInvitesTable)
      .set({ status: "cancelled" })
      .where(and(eq(clientInvitesTable.id, inviteId), eq(clientInvitesTable.clientId, clientId)))
      .returning({
        id: clientInvitesTable.id,
        email: clientInvitesTable.email,
        role: clientInvitesTable.role,
        status: clientInvitesTable.status,
        expiresAt: clientInvitesTable.expiresAt,
        acceptedAt: clientInvitesTable.acceptedAt,
        createdAt: clientInvitesTable.createdAt,
      });

    res.json(updated);
  } catch {
    res.status(500).json({ error: "Failed to cancel invite" });
  }
});

router.patch("/clients/:clientId/team/:userId/role", requireClientRole(MANAGE_CLIENT_ROLES), async (req: AuthRequest, res): Promise<void> => {
  try {
    const { clientId, userId } = req.params;
    const nextRole = req.body?.role;
    if (!isClientRole(nextRole)) {
      res.status(400).json({ error: "Valid role is required" });
      return;
    }

    const [member] = await db
      .select()
      .from(clientUsersTable)
      .where(and(eq(clientUsersTable.clientId, clientId), eq(clientUsersTable.userId, userId)))
      .limit(1);
    if (!member) {
      res.status(404).json({ error: "Member not found" });
      return;
    }
    if (!canManageRole(req.clientRole, member.role) || !canManageRole(req.clientRole, nextRole)) {
      res.status(403).json({ error: "You cannot change that member to that role" });
      return;
    }
    if (member.role === "owner" && nextRole !== "owner" && await ownerCount(clientId) <= 1) {
      res.status(409).json({ error: "Cannot remove the last owner" });
      return;
    }

    const [updated] = await db
      .update(clientUsersTable)
      .set({ role: nextRole })
      .where(and(eq(clientUsersTable.clientId, clientId), eq(clientUsersTable.userId, userId)))
      .returning();

    res.json(updated);
  } catch {
    res.status(500).json({ error: "Failed to update member role" });
  }
});

router.delete("/clients/:clientId/team/:userId", requireClientRole(MANAGE_CLIENT_ROLES), async (req: AuthRequest, res): Promise<void> => {
  try {
    const { clientId, userId } = req.params;
    const [member] = await db
      .select()
      .from(clientUsersTable)
      .where(and(eq(clientUsersTable.clientId, clientId), eq(clientUsersTable.userId, userId)))
      .limit(1);

    if (!member) {
      res.status(404).json({ error: "Member not found" });
      return;
    }
    if (!canManageRole(req.clientRole, member.role)) {
      res.status(403).json({ error: "You cannot remove that member" });
      return;
    }
    if (member.role === "owner" && await ownerCount(clientId) <= 1) {
      res.status(409).json({ error: "Cannot remove the last owner" });
      return;
    }

    await db
      .delete(clientUsersTable)
      .where(and(eq(clientUsersTable.clientId, clientId), eq(clientUsersTable.userId, userId)));

    res.status(204).end();
  } catch {
    res.status(500).json({ error: "Failed to remove member" });
  }
});

export default router;
