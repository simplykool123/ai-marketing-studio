// Phase 51 — Google Drive archive (honest disabled).
// Per the Phase 51 brief: "If OAuth/upload cannot be safely completed:
// keep disabled, clearly state 'Google Drive archive not connected yet'.
// No fake success." That's what this route does — it returns a clean status
// the UI consumes to show the empty state, and refuses to pretend a file
// was archived.

import { Router } from "express";
import { ALL_CLIENT_ROLES, MANAGE_CLIENT_ROLES, requireClientRole, type AuthRequest } from "../middleware/auth.js";

const router = Router();

const DRIVE_OAUTH_CONFIGURED =
  !!process.env.GOOGLE_OAUTH_CLIENT_ID && !!process.env.GOOGLE_OAUTH_CLIENT_SECRET;

router.get(
  "/clients/:clientId/drive-archive/status",
  requireClientRole(ALL_CLIENT_ROLES),
  async (_req: AuthRequest, res): Promise<void> => {
    res.json({
      connected: false, // Phase 51: OAuth not wired yet, even if creds exist
      oauthConfigured: DRIVE_OAUTH_CONFIGURED,
      message: DRIVE_OAUTH_CONFIGURED
        ? "Google OAuth credentials are present but Drive archive integration is not wired yet."
        : "Google Drive archive not connected yet. To enable, an admin will configure Google OAuth and the per-client Drive folder.",
      capabilities: {
        canArchive: false,
        canList: false,
      },
    });
  },
);

// Refuse any archive attempt — honest 503 with the same message the UI shows.
router.post(
  "/clients/:clientId/drive-archive/upload",
  requireClientRole(MANAGE_CLIENT_ROLES),
  async (_req: AuthRequest, res): Promise<void> => {
    res.status(503).json({
      error: "Google Drive archive not connected yet. Files remain in Supabase Storage. No fake archive operation was performed.",
    });
  },
);

export default router;
