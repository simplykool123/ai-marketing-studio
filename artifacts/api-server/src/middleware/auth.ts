import { Request, Response, NextFunction } from "express";
import { supabase } from "../lib/supabase.js";
import { db } from "@workspace/db";
import { clientUsersTable, profilesTable, type ClientRole } from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";

export interface AuthRequest extends Request<Record<string, string>> {
  userId?: string;
  userEmail?: string;
  clientRole?: ClientRole;
}

export const ALL_CLIENT_ROLES: ClientRole[] = ["owner", "admin", "editor", "approver", "viewer"];
export const MANAGE_CLIENT_ROLES: ClientRole[] = ["owner", "admin"];
export const EDIT_CONTENT_ROLES: ClientRole[] = ["owner", "admin", "editor"];
export const APPROVE_CONTENT_ROLES: ClientRole[] = ["owner", "admin", "approver"];
export const MUTATE_CONTENT_ROLES: ClientRole[] = ["owner", "admin", "editor", "approver"];

export async function upsertProfile(user: {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
}): Promise<void> {
  const email = user.email ?? "";
  const rawName = user.user_metadata?.name;
  const name = typeof rawName === "string" && rawName.trim().length > 0
    ? rawName
    : email.split("@")[0] || null;

  await db
    .insert(profilesTable)
    .values({ id: user.id, email, name })
    .onConflictDoUpdate({
      target: profilesTable.id,
      set: { email, name, updatedAt: new Date() },
    });
}

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const token = authHeader.slice(7);
  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
      res.status(401).json({ error: "Invalid or expired token" });
      return;
    }
    req.userId = user.id;
    req.userEmail = user.email;
    await upsertProfile(user);
    next();
  } catch {
    res.status(401).json({ error: "Unauthorized" });
  }
}

export async function getClientRole(userId: string, clientId: string): Promise<ClientRole | null> {
  const [membership] = await db
    .select({ role: clientUsersTable.role })
    .from(clientUsersTable)
    .where(
      and(
        eq(clientUsersTable.userId, userId),
        eq(clientUsersTable.clientId, clientId),
      ),
    )
    .limit(1);

  return membership?.role ?? null;
}

export async function userHasClientRole(
  userId: string,
  clientId: string,
  allowedRoles: readonly ClientRole[] = ALL_CLIENT_ROLES,
): Promise<boolean> {
  const role = await getClientRole(userId, clientId);
  return !!role && allowedRoles.includes(role);
}

export function hasClientRole(
  req: AuthRequest,
  allowedRoles: readonly ClientRole[],
): boolean {
  return !!req.clientRole && allowedRoles.includes(req.clientRole);
}

function extractClientId(req: Request<Record<string, string>>): string | undefined {
  return req.params["clientId"];
}

export function requireClientAccess(
  allowedRoles: readonly ClientRole[] = ALL_CLIENT_ROLES,
) {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    const userId = req.userId;
    const clientId = extractClientId(req);

    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (!clientId) {
      res.status(400).json({ error: "Missing clientId" });
      return;
    }

    try {
      const role = await getClientRole(userId, clientId);
      if (!role || !allowedRoles.includes(role)) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }

      req.clientRole = role;
      next();
    } catch {
      res.status(500).json({ error: "Failed to verify client access" });
    }
  };
}

export const requireClientRole = requireClientAccess;
