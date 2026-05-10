import { Request, Response, NextFunction } from "express";
import { supabase, isNetworkError, withTimeout } from "../lib/supabase.js";
import { db } from "@workspace/db";
import { clientUsersTable, profilesTable, type ClientRole } from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";
import { logger } from "../lib/logger.js";

export interface AuthRequest extends Request<Record<string, string>> {
  userId?: string;
  userEmail?: string;
  clientRole?: ClientRole;
}

export const ALL_CLIENT_ROLES: ClientRole[]     = ["owner", "admin", "editor", "approver", "viewer"];
export const MANAGE_CLIENT_ROLES: ClientRole[]  = ["owner", "admin"];
export const EDIT_CONTENT_ROLES: ClientRole[]   = ["owner", "admin", "editor"];
export const APPROVE_CONTENT_ROLES: ClientRole[] = ["owner", "admin", "approver"];
export const MUTATE_CONTENT_ROLES: ClientRole[] = ["owner", "admin", "editor", "approver"];

// ---------------------------------------------------------------------------
// Profile upsert — fire-and-forget; a DB hiccup here must not block the request
// ---------------------------------------------------------------------------

export async function upsertProfile(user: {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
}): Promise<void> {
  const email = user.email ?? "";
  const rawName = user.user_metadata?.name;
  const name =
    typeof rawName === "string" && rawName.trim().length > 0
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

// ---------------------------------------------------------------------------
// requireAuth
//
// Error taxonomy:
//   • No / malformed Bearer token          → 401 Unauthorized
//   • Supabase says token is invalid/expired → 401 Invalid or expired token
//   • Supabase call times out (5 s)         → 503 (connection issue, not user fault)
//   • Network / DNS failure reaching Supabase → 503
//   • Any other unexpected throw            → 503 (safe default)
// ---------------------------------------------------------------------------

const SUPABASE_AUTH_TIMEOUT_MS = 5_000;

export async function requireAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const token = authHeader.slice(7);

  let user: { id: string; email?: string; user_metadata?: Record<string, unknown> | null } | null = null;

  try {
    const { data, error } = await withTimeout(
      supabase.auth.getUser(token),
      SUPABASE_AUTH_TIMEOUT_MS,
      "Supabase auth.getUser"
    );

    if (error || !data.user) {
      // Supabase explicitly rejected the token — definitely a 401
      res.status(401).json({ error: "Invalid or expired token" });
      return;
    }

    user = data.user;
  } catch (err) {
    const network = isNetworkError(err);
    const msg = err instanceof Error ? err.message : String(err);

    if (network || msg.toLowerCase().includes("timed out")) {
      logger.warn({ error: msg }, "requireAuth: Supabase unreachable — returning 503");
      res.status(503).json({
        error: "Authentication service temporarily unreachable. Please retry in a moment.",
        retryable: true,
      });
    } else {
      logger.error({ error: msg }, "requireAuth: unexpected error");
      res.status(503).json({
        error: "Authentication service unavailable. Please retry.",
        retryable: true,
      });
    }
    return;
  }

  req.userId    = user.id;
  req.userEmail = user.email;

  // Profile sync: best-effort — a DB connection blip must NOT fail the request
  upsertProfile(user).catch((err: unknown) => {
    logger.warn(
      { error: err instanceof Error ? err.message : String(err) },
      "requireAuth: profile upsert failed (non-fatal)"
    );
  });

  next();
}

// ---------------------------------------------------------------------------
// Client role helpers
// ---------------------------------------------------------------------------

export async function getClientRole(
  userId: string,
  clientId: string
): Promise<ClientRole | null> {
  const [membership] = await db
    .select({ role: clientUsersTable.role })
    .from(clientUsersTable)
    .where(and(eq(clientUsersTable.userId, userId), eq(clientUsersTable.clientId, clientId)))
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
    const userId   = req.userId;
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
    } catch (err) {
      const network = isNetworkError(err);
      if (network) {
        logger.warn(
          { error: err instanceof Error ? err.message : String(err) },
          "requireClientAccess: DB unreachable"
        );
        res.status(503).json({
          error: "Database temporarily unreachable. Please retry.",
          retryable: true,
        });
      } else {
        res.status(500).json({ error: "Failed to verify client access" });
      }
    }
  };
}

export const requireClientRole = requireClientAccess;
