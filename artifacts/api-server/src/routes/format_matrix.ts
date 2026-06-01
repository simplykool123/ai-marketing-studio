import { Router } from "express";
import { FORMAT_MATRIX } from "../lib/format-matrix.js";
import { POST_STATUSES, statusLabel } from "../lib/post-status.js";

const router = Router();

// Public to any authenticated user — the matrix has no client-specific data.
router.get("/format-matrix", (_req, res) => {
  res.json({
    formats: FORMAT_MATRIX,
    statuses: POST_STATUSES.map((value) => ({ value, label: statusLabel(value) })),
    generatedAt: new Date().toISOString(),
  });
});

export default router;
