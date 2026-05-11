import { Router } from "express";
import { db } from "@workspace/db";
import { socialAccountsTable } from "@workspace/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { isEncryptionConfigured } from "../lib/crypto.js";
import { MANAGE_CLIENT_ROLES, requireClientRole } from "../middleware/auth.js";

const router = Router();

const FETCH_COLUMNS = {
  id: socialAccountsTable.id,
  clientId: socialAccountsTable.clientId,
  platform: socialAccountsTable.platform,
  accountName: socialAccountsTable.accountName,
  accountHandle: socialAccountsTable.accountHandle,
  accountId: socialAccountsTable.accountId,
  avatarUrl: socialAccountsTable.avatarUrl,
  followerCount: socialAccountsTable.followerCount,
  isActive: socialAccountsTable.isActive,
  accessToken: socialAccountsTable.accessToken,
  tokenExpiresAt: socialAccountsTable.tokenExpiresAt,
  createdAt: socialAccountsTable.createdAt,
  updatedAt: socialAccountsTable.updatedAt,
};

type FetchedAccount = {
  id: string;
  clientId: string;
  platform: string;
  accountName: string;
  accountHandle: string | null;
  accountId: string | null;
  avatarUrl: string | null;
  followerCount: number | null;
  isActive: boolean;
  accessToken: string | null;
  tokenExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function toDto(account: FetchedAccount) {
  const hasOauth = !!account.accessToken;
  const tokenExpired = hasOauth && !!account.tokenExpiresAt && account.tokenExpiresAt < new Date();
  return {
    id: account.id,
    clientId: account.clientId,
    platform: account.platform,
    accountName: account.accountName,
    accountHandle: account.accountHandle,
    accountId: account.accountId,
    avatarUrl: account.avatarUrl,
    followerCount: account.followerCount,
    isActive: account.isActive,
    hasOauth,
    tokenExpired,
    tokenExpiresAt: account.tokenExpiresAt?.toISOString() ?? null,
    createdAt: account.createdAt instanceof Date ? account.createdAt.toISOString() : account.createdAt,
    updatedAt: account.updatedAt instanceof Date ? account.updatedAt.toISOString() : account.updatedAt,
  };
}

function accountReady(account: FetchedAccount | null) {
  if (!account) return null;
  const dto = toDto(account);
  return {
    id: dto.id,
    platform: dto.platform,
    accountName: dto.accountName,
    accountHandle: dto.accountHandle,
    accountId: dto.accountId,
    hasOauth: dto.hasOauth,
    tokenExpired: dto.tokenExpired,
    tokenExpiresAt: dto.tokenExpiresAt,
    isActive: dto.isActive,
  };
}

router.get("/clients/:clientId/meta/status", async (req, res) => {
  try {
    const accounts = await db
      .select(FETCH_COLUMNS)
      .from(socialAccountsTable)
      .where(
        and(
          eq(socialAccountsTable.clientId, req.params.clientId),
          eq(socialAccountsTable.isActive, true),
          inArray(socialAccountsTable.platform, ["facebook", "instagram"])
        )
      );

    const facebook = (accounts as FetchedAccount[]).find((account) => account.platform === "facebook") ?? null;
    const instagram = (accounts as FetchedAccount[]).find((account) => account.platform === "instagram") ?? null;
    const tokenStorageSafe = isEncryptionConfigured();
    const facebookReady = !!facebook?.accessToken && !toDto(facebook).tokenExpired;
    const instagramReady = !!instagram?.accessToken && !toDto(instagram).tokenExpired;

    res.json({
      provider: "meta",
      tokenStorageSafe,
      configured: tokenStorageSafe && (facebookReady || instagramReady),
      facebookPage: accountReady(facebook),
      instagramAccount: accountReady(instagram),
      canPublishFacebook: tokenStorageSafe && facebookReady,
      canPublishInstagram: tokenStorageSafe && instagramReady,
      missing: [
        ...(tokenStorageSafe ? [] : ["TOKEN_ENCRYPTION_KEY"]),
        ...(facebook ? [] : ["Facebook Page"]),
        ...(instagram ? [] : ["Instagram Business account"]),
      ],
    });
  } catch {
    res.status(500).json({ error: "Failed to fetch Meta connection status" });
  }
});

router.get("/clients/:clientId/social-accounts", async (req, res) => {
  try {
    const accounts = await db
      .select(FETCH_COLUMNS)
      .from(socialAccountsTable)
      .where(eq(socialAccountsTable.clientId, req.params.clientId))
      .orderBy(socialAccountsTable.createdAt);
    res.json(accounts.map(toDto));
  } catch {
    res.status(500).json({ error: "Failed to fetch social accounts" });
  }
});

router.post("/clients/:clientId/social-accounts", requireClientRole(MANAGE_CLIENT_ROLES), async (req, res) => {
  try {
    const { platform, accountName, accountHandle, accountId, avatarUrl, followerCount } =
      req.body as {
        platform: string;
        accountName: string;
        accountHandle?: string;
        accountId?: string;
        avatarUrl?: string;
        followerCount?: number;
      };

    if (!platform || !accountName) {
      res.status(400).json({ error: "platform and accountName are required" });
      return;
    }

    const [inserted] = await db
      .insert(socialAccountsTable)
      .values({
        clientId: req.params.clientId,
        platform,
        accountName,
        accountHandle: accountHandle ?? null,
        accountId: accountId ?? null,
        avatarUrl: avatarUrl ?? null,
        followerCount: followerCount ?? null,
        isActive: true,
      })
      .returning(FETCH_COLUMNS);

    res.status(201).json(toDto(inserted as FetchedAccount));
  } catch {
    res.status(500).json({ error: "Failed to create social account" });
  }
});

router.patch("/clients/:clientId/social-accounts/:accountId", requireClientRole(MANAGE_CLIENT_ROLES), async (req, res) => {
  try {
    const { accountName, accountHandle, avatarUrl, followerCount, isActive } = req.body as {
      accountName?: string;
      accountHandle?: string;
      avatarUrl?: string;
      followerCount?: number;
      isActive?: boolean;
    };

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (accountName !== undefined) updates.accountName = accountName;
    if (accountHandle !== undefined) updates.accountHandle = accountHandle;
    if (avatarUrl !== undefined) updates.avatarUrl = avatarUrl;
    if (followerCount !== undefined) updates.followerCount = followerCount;
    if (isActive !== undefined) updates.isActive = isActive;

    const [updated] = await db
      .update(socialAccountsTable)
      .set(updates)
      .where(
        and(
          eq(socialAccountsTable.id, req.params.accountId),
          eq(socialAccountsTable.clientId, req.params.clientId)
        )
      )
      .returning(FETCH_COLUMNS);

    if (!updated) {
      res.status(404).json({ error: "Account not found" });
      return;
    }
    res.json(toDto(updated as FetchedAccount));
  } catch {
    res.status(500).json({ error: "Failed to update social account" });
  }
});

router.delete("/clients/:clientId/social-accounts/:accountId", requireClientRole(MANAGE_CLIENT_ROLES), async (req, res) => {
  try {
    await db
      .delete(socialAccountsTable)
      .where(
        and(
          eq(socialAccountsTable.id, req.params.accountId),
          eq(socialAccountsTable.clientId, req.params.clientId)
        )
      );
    res.status(204).send();
  } catch {
    res.status(500).json({ error: "Failed to delete social account" });
  }
});

export default router;
