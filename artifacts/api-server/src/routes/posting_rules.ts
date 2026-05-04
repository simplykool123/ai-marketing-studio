import { Router } from "express";
import { db } from "@workspace/db";
import { postingRulesTable, postsTable } from "@workspace/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { addDays, startOfDay, setHours } from "date-fns";

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

router.put("/clients/:clientId/posting-rules", async (req, res): Promise<void> => {
  try {
    const { clientId } = req.params;
    const { maxPostsPerDay, preferredWindows, blackoutDates } = req.body as {
      maxPostsPerDay?: Record<string, number>;
      preferredWindows?: number[];
      blackoutDates?: string[];
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

router.post("/clients/:clientId/posts/auto-schedule", async (req, res): Promise<void> => {
  try {
    const { clientId } = req.params;
    const { dryRun = false } = req.body as { dryRun?: boolean };

    const [rules] = await db
      .select()
      .from(postingRulesTable)
      .where(eq(postingRulesTable.clientId, clientId))
      .limit(1);

    const maxPerDay = (rules?.maxPostsPerDay ?? {}) as Record<string, number>;
    const preferredWindows = (rules?.preferredWindows ?? [9, 12, 15, 18]) as number[];
    const blackoutDates = new Set<string>((rules?.blackoutDates ?? []) as string[]);
    const globalMaxPerDay = Object.values(maxPerDay).reduce((a, b) => a + b, 0) || 4;

    const unscheduled = await db
      .select()
      .from(postsTable)
      .where(and(eq(postsTable.clientId, clientId), eq(postsTable.status, "draft")));

    if (unscheduled.length === 0) {
      res.json({ scheduled: [], count: 0, message: "No draft posts to schedule" });
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

        if (blackoutDates.has(dayKey)) {
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
          const scheduledAt = setHours(day, availableHours[hourIndex]!);
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
        await db
          .update(postsTable)
          .set({ status: "scheduled", scheduledAt, updatedAt: new Date() })
          .where(and(eq(postsTable.id, postId), eq(postsTable.clientId, clientId)));
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

export default router;
