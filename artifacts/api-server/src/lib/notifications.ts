import { db } from "@workspace/db";
import { notificationsTable } from "@workspace/db/schema";
import { logger } from "./logger.js";

export type NotificationSeverity = "info" | "warning" | "error" | "success";

export async function createClientNotification(input: {
  clientId: string;
  userId?: string | null;
  type: string;
  title: string;
  message: string;
  severity?: NotificationSeverity;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await db.insert(notificationsTable).values({
      clientId: input.clientId,
      userId: input.userId ?? null,
      type: input.type,
      title: input.title,
      message: input.message,
      severity: input.severity ?? "info",
      metadata: input.metadata ?? {},
    });
  } catch (err) {
    logger.warn(
      { clientId: input.clientId, type: input.type, error: err instanceof Error ? err.message : String(err) },
      "Notification write failed"
    );
  }
}
