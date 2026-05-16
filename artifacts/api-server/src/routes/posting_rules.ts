import { Router } from "express";
import { db } from "@workspace/db";
import { postingRulesTable, postsTable } from "@workspace/db/schema";
import { eq, and, isNull, inArray } from "drizzle-orm";
import { addDays, startOfDay, setHours, setMinutes, setSeconds, setMilliseconds } from "date-fns";
import { APPROVE_CONTENT_ROLES, MANAGE_CLIENT_ROLES, requireClientRole } from "../middleware/auth.js";
import { schedulePost } from "../lib/publishing-destinations.js";

const router = Router();

router.get("/clients/:clientId/posting-rules", async (req, res): Promise<void> => {
  try {
    const { clientId } = req.params;
    const [rules] = await db
      .select()
      .from(postingRulesTable)
      .where(eq(postingRulesTable.clientId, clientId))
      .limit(1);

    if (!rules) {
      res.json({
        id: null,
        clientId,
        maxPostsPerDay: {},
        preferredWindows: [9, 12, 15, 18],
        blackoutDates: [],
        timezone: "UTC",
        preferredDays: [1, 2, 3, 4, 5],
        minGapHours: 4,
        createdAt: null,
        updatedAt: null,
      });
      return;
    }
    res.json(rules);
  } catch {
    res.status(500).json({ error: "Failed to get posting rules" });
  }
});

router.put("/clients/:clientId/posting-rules", requireClientRole(MANAGE_CLIENT_ROLES), async (req, res): Promise<void> => {
  try {
    const { clientId } = req.params;
    const { maxPostsPerDay, preferredWindows, blackoutDates, timezone, preferredDays, minGapHours } = req.body as {
      maxPostsPerDay?: Record<string, number>;
      preferredWindows?: number[];
      blackoutDates?: string[];
      timezone?: string;
      preferredDays?: number[];
      minGapHours?: number;
    };

    const existing = await db
      .select({ id: postingRulesTable.id })
      .from(postingRulesTable)
      .where(eq(postingRulesTable.clientId, clientId))
      .limit(1);

    const values = {
      clientId,
      ...(maxPostsPerDay !== undefined ? { maxPostsPerDay } : {}),
      ...(preferredWindows !== undefined ? { preferredWindows } : {}),
      ...(blackoutDates !== undefined ? { blackoutDates } : {}),
      ...(timezone !== undefined ? { timezone } : {}),
      ...(preferredDays !== undefined ? { preferredDays } : {}),
      ...(minGapHours !== undefined ? { minGapHours } : {}),
      updatedAt: new Date(),
    };

    if (existing.length > 0) {
      const [updated] = await db
        .update(postingRulesTable)
        .set(values)
        .where(eq(postingRulesTable.clientId, clientId))
        .returning();
      res.json(updated);
    } else {
      const [created] = await db
        .insert(postingRulesTable)
        .values({
          clientId,
          maxPostsPerDay: maxPostsPerDay ?? {},
          preferredWindows: preferredWindows ?? [9, 12, 15, 18],
          blackoutDates: blackoutDates ?? [],
          timezone: timezone ?? "UTC",
          preferredDays: preferredDays ?? [1, 2, 3, 4, 5],
          minGapHours: minGapHours ?? 4,
        })
        .returning();
      res.json(created);
    }
  } catch {
    res.status(500).json({ error: "Failed to update posting rules" });
  }
});

const PLATFORM_BEST_HOURS: Record<string, number[]> = {
  instagram: [9, 12, 15, 18],
  facebook: [9, 13, 16],
  linkedin: [8, 12, 17],
  twitter: [8, 12, 17, 20],
  default: [9, 12, 15, 18],
};

router.post("/clients/:clientId/posts/auto-schedule", requireClientRole(APPROVE_CONTENT_ROLES), async (req, res): Promise<void> => {
  try {
    const { clientId } = req.params;
    const { dryRun = false } = req.body as { dryRun?: boolean };

    const [rules] = await db
      .select()
      .from(postingRulesTable)
      .where(eq(postingRulesTable.clientId, clientId))
      .limit(1);

    const maxPerDay = (rules?.maxPostsPerDay ?? {}) as Record<string, number>;
    const preferredWindows = (rules?.preferredWindows?.length ? rules.preferredWindows : [9]) as number[];
    const blackoutDates = new Set<string>((rules?.blackoutDates ?? []) as string[]);
    const preferredDays = new Set<number>(((rules as any)?.preferredDays?.length ? (rules as any).preferredDays : [1, 2, 3, 4, 5]) as number[]);
    const minGapHours: number = (rules as any)?.minGapHours ?? 4;
    const globalMaxPerDay = Object.values(maxPerDay).reduce((a, b) => a + b, 0) || 4;

    const unscheduled = await db
      .select()
      .from(postsTable)
      .where(
        and(
          eq(postsTable.clientId, clientId),
          inArray(postsTable.status, ["approved", "export_ready"]),
          isNull(postsTable.scheduledAt)
        )
      );

    if (unscheduled.length === 0) {
      res.json({ scheduled: [], count: 0, message: "No ready posts need scheduling" });
      return;
    }

    const schedule: { postId: string; scheduledAt: Date }[] = [];
    // Track per-day totals and per-platform-per-day counts separately
    const slotsPerDay = new Map<string, number>(); // dayKey -> total used
    const slotsPerPlatformPerDay = new Map<string, number>(); // "dayKey:platform" -> used

    for (const post of unscheduled) {
      let placed = false;
      let dayOffset = 1;
      while (!placed && dayOffset < 90) {
        const day = addDays(startOfDay(new Date()), dayOffset);
        const dayKey = day.toISOString().slice(0, 10);
        const dayOfWeek = day.getDay();

        if (blackoutDates.has(dayKey) || !preferredDays.has(dayOfWeek)) {
          dayOffset++;
          continue;
        }

        const platform = post.platform ?? "default";
        const platformKey = `${dayKey}:${platform}`;
        const platformMax = maxPerDay[platform] !== undefined ? maxPerDay[platform]! : 2;
        const platformUsed = slotsPerPlatformPerDay.get(platformKey) ?? 0;
        const totalUsed = slotsPerDay.get(dayKey) ?? 0;

        // Enforce both the per-platform cap AND the global daily cap
        if (platformUsed < platformMax && totalUsed < globalMaxPerDay) {
          const availableHours = preferredWindows.length > 0
            ? preferredWindows
            : PLATFORM_BEST_HOURS[platform] ?? PLATFORM_BEST_HOURS.default;
          const hourIndex = platformUsed % availableHours.length;
          const candidateHour = availableHours[hourIndex]!;

          // Enforce minGapHours between posts on the same day
          const existingSlotsOnDay = schedule
            .filter(s => s.scheduledAt.toISOString().slice(0, 10) === dayKey)
            .map(s => s.scheduledAt.getHours());
          const tooClose = existingSlotsOnDay.some(h => Math.abs(h - candidateHour) < minGapHours);
          if (tooClose) {
            dayOffset++;
            continue;
          }

          const scheduledAt = setMilliseconds(setSeconds(setMinutes(setHours(day, candidateHour), 0), 0), 0);
          schedule.push({ postId: post.id, scheduledAt });
          slotsPerPlatformPerDay.set(platformKey, platformUsed + 1);
          slotsPerDay.set(dayKey, totalUsed + 1);
          placed = true;
        } else {
          dayOffset++;
        }
      }
    }

    if (!dryRun) {
      for (const { postId, scheduledAt } of schedule) {
        await schedulePost(postId, clientId, scheduledAt);
      }
    }

    res.json({
      scheduled: schedule.map(s => ({ postId: s.postId, scheduledAt: s.scheduledAt.toISOString() })),
      count: schedule.length,
      dryRun,
    });
  } catch {
    res.status(500).json({ error: "Failed to auto-schedule posts" });
  }
});

// Return the next suitable scheduledAt for a single post given current rules
router.get("/clients/:clientId/posts/:postId/suggest-schedule", async (req, res): Promise<void> => {
  try {
    const { clientId } = req.params;

    const [rules] = await db
      .select()
      .from(postingRulesTable)
      .where(eq(postingRulesTable.clientId, clientId))
      .limit(1);

    const preferredWindows = (rules?.preferredWindows?.length ? rules.preferredWindows : [9]) as number[];
    const blackoutDates = new Set<string>((rules?.blackoutDates ?? []) as string[]);
    const preferredDays = new Set<number>(((rules as any)?.preferredDays?.length ? (rules as any).preferredDays : [1, 2, 3, 4, 5]) as number[]);

    let dayOffset = 0;
    while (dayOffset < 90) {
      const day = addDays(startOfDay(new Date()), dayOffset === 0 ? 0 : dayOffset);
      const dayKey = day.toISOString().slice(0, 10);
      const dayOfWeek = day.getDay();

      if (!blackoutDates.has(dayKey) && preferredDays.has(dayOfWeek)) {
        const hour = preferredWindows[0] ?? 9;
        const now = new Date();
        const candidate = setMilliseconds(setSeconds(setMinutes(setHours(day, hour), 0), 0), 0);
        if (candidate > now) {
          res.json({ scheduledAt: candidate.toISOString(), hour, dayKey });
          return;
        }
      }
      dayOffset++;
    }

    // Fallback: tomorrow at 9am
    const fallback = setMilliseconds(setSeconds(setMinutes(setHours(addDays(startOfDay(new Date()), 1), 9), 0), 0), 0);
    res.json({ scheduledAt: fallback.toISOString(), hour: 9, dayKey: fallback.toISOString().slice(0, 10) });
  } catch {
    res.status(500).json({ error: "Failed to suggest schedule" });
  }
});

// Manually reschedule a single post in the queue
router.patch("/clients/:clientId/posts/:postId/reschedule", requireClientRole(APPROVE_CONTENT_ROLES), async (req, res): Promise<void> => {
  try {
    const { clientId, postId } = req.params;
    const { scheduledAt } = req.body as { scheduledAt: string };

    if (!scheduledAt) {
      res.status(400).json({ error: "scheduledAt is required" });
      return;
    }

    const parsed = new Date(scheduledAt);
    if (isNaN(parsed.getTime())) {
      res.status(400).json({ error: "Invalid scheduledAt date" });
      return;
    }

    const [updated] = await db
      .update(postsTable)
      .set({ scheduledAt: parsed, status: "scheduled", updatedAt: new Date() })
      .where(and(eq(postsTable.id, postId), eq(postsTable.clientId, clientId)))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Post not found" });
      return;
    }

    res.json(updated);
  } catch {
    res.status(500).json({ error: "Failed to reschedule post" });
  }
});

export default router;
