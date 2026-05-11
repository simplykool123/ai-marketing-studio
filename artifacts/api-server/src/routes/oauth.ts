import { Router } from "express";
import { randomBytes, createHash } from "node:crypto";
import { db } from "@workspace/db";
import { socialAccountsTable } from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";
import { encryptToken, isEncryptionConfigured } from "../lib/crypto.js";
import { logger } from "../lib/logger.js";
import {
  MANAGE_CLIENT_ROLES,
  requireAuth,
  userHasClientRole,
  type AuthRequest,
} from "../middleware/auth.js";

function generatePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

interface OAuthState {
  clientId: string;
  userId: string;
  platform: string;
  codeVerifier?: string;
  expiresAt: number;
}

const STATE_TTL_MS = 10 * 60 * 1000;
const stateStore = new Map<string, OAuthState>();

function consumeState(nonce: string): OAuthState | null {
  const entry = stateStore.get(nonce);
  if (!entry) return null;
  stateStore.delete(nonce);
  if (entry.expiresAt < Date.now()) return null;
  return entry;
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of stateStore.entries()) {
    if (v.expiresAt < now) stateStore.delete(k);
  }
}, 60_000).unref();

const router = Router();

function getBaseUrl(req: { get: (h: string) => string | undefined }): string {
  const devDomain = process.env.REPLIT_DEV_DOMAIN;
  if (devDomain) return `https://${devDomain}`;
  const host = req.get("x-forwarded-host") ?? req.get("host") ?? "localhost:8080";
  const proto = req.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

function getAppUrl(req: { get: (h: string) => string | undefined }): string {
  const devDomain = process.env.REPLIT_DEV_DOMAIN;
  if (devDomain) return `https://${devDomain}/marketing-studio`;
  const host = req.get("x-forwarded-host") ?? req.get("host") ?? "localhost";
  return `http://${host}/marketing-studio`;
}

interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  authUrl: string;
  tokenUrl: string;
  scope: string;
  extra?: Record<string, string>;
}

function getOAuthConfig(platform: string): OAuthConfig | null {
  switch (platform) {
    case "instagram":
    case "facebook": {
      const clientId = process.env.META_APP_ID ?? process.env.FACEBOOK_APP_ID ?? process.env.INSTAGRAM_APP_ID;
      const clientSecret = process.env.META_APP_SECRET ?? process.env.FACEBOOK_APP_SECRET ?? process.env.INSTAGRAM_APP_SECRET;
      if (!clientId || !clientSecret) return null;
      const version = process.env.META_GRAPH_VERSION ?? "v18.0";
      return {
        clientId,
        clientSecret,
        authUrl: `https://www.facebook.com/${version}/dialog/oauth`,
        tokenUrl: `https://graph.facebook.com/${version}/oauth/access_token`,
        scope:
          platform === "instagram"
            ? "instagram_basic,instagram_content_publish,pages_show_list,pages_read_engagement,business_management"
            : "pages_show_list,pages_read_engagement,pages_manage_posts",
      };
    }
    case "linkedin": {
      const clientId = process.env.LINKEDIN_CLIENT_ID;
      const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
      if (!clientId || !clientSecret) return null;
      return {
        clientId,
        clientSecret,
        authUrl: "https://www.linkedin.com/oauth/v2/authorization",
        tokenUrl: "https://www.linkedin.com/oauth/v2/accessToken",
        scope: "r_liteprofile,w_member_social,r_organization_social,rw_organization_admin",
      };
    }
    case "twitter": {
      const clientId = process.env.TWITTER_CLIENT_ID;
      const clientSecret = process.env.TWITTER_CLIENT_SECRET;
      if (!clientId || !clientSecret) return null;
      return {
        clientId,
        clientSecret,
        authUrl: "https://twitter.com/i/oauth2/authorize",
        tokenUrl: "https://api.twitter.com/2/oauth2/token",
        scope: "tweet.write tweet.read users.read media.write offline.access",
      };
    }
    default:
      return null;
  }
}

function getMetaGraphVersion(): string {
  return process.env.META_GRAPH_VERSION ?? "v18.0";
}

function getMetaOAuthConfig(): OAuthConfig | null {
  const clientId = process.env.META_APP_ID ?? process.env.FACEBOOK_APP_ID ?? process.env.INSTAGRAM_APP_ID;
  const clientSecret = process.env.META_APP_SECRET ?? process.env.FACEBOOK_APP_SECRET ?? process.env.INSTAGRAM_APP_SECRET;
  if (!clientId || !clientSecret) return null;
  const version = getMetaGraphVersion();
  return {
    clientId,
    clientSecret,
    authUrl: `https://www.facebook.com/${version}/dialog/oauth`,
    tokenUrl: `https://graph.facebook.com/${version}/oauth/access_token`,
    scope: [
      "pages_show_list",
      "pages_read_engagement",
      "pages_manage_posts",
      "instagram_basic",
      "instagram_content_publish",
      "business_management",
    ].join(","),
  };
}

async function extendFacebookToken(
  shortToken: string,
  clientId: string,
  clientSecret: string
): Promise<{ token: string; expiresIn?: number }> {
  const version = getMetaGraphVersion();
  const res = await fetch(
    `https://graph.facebook.com/${version}/oauth/access_token?grant_type=fb_exchange_token&client_id=${clientId}&client_secret=${clientSecret}&fb_exchange_token=${encodeURIComponent(shortToken)}`
  );
  if (!res.ok) return { token: shortToken };
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  return { token: data.access_token ?? shortToken, expiresIn: data.expires_in };
}

type MetaPageData = {
  pageId: string;
  pageName: string;
  pageToken: string;
  instagramBusinessAccountId: string | null;
  instagramUsername: string | null;
};

async function getFacebookPageData(
  userToken: string
): Promise<{ pageId: string; pageName: string; pageToken: string } | null> {
  const version = getMetaGraphVersion();
  const res = await fetch(
    `https://graph.facebook.com/${version}/me/accounts?fields=id,name,access_token&access_token=${userToken}`
  );
  if (!res.ok) return null;
  const { data } = (await res.json()) as { data: Array<{ id: string; name: string; access_token: string }> };
  if (!data || data.length === 0) return null;
  const page = data[0]!;
  return { pageId: page.id, pageName: page.name, pageToken: page.access_token };
}

async function getInstagramBusinessAccountId(
  pageId: string,
  pageToken: string
): Promise<string | null> {
  const version = getMetaGraphVersion();
  const res = await fetch(
    `https://graph.facebook.com/${version}/${pageId}?fields=instagram_business_account&access_token=${pageToken}`
  );
  if (!res.ok) return null;
  const data = (await res.json()) as { instagram_business_account?: { id: string } };
  return data.instagram_business_account?.id ?? null;
}

async function getMetaPageData(userToken: string): Promise<MetaPageData | null> {
  const version = getMetaGraphVersion();
  const res = await fetch(
    `https://graph.facebook.com/${version}/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&access_token=${userToken}`
  );
  if (!res.ok) return null;

  const { data } = (await res.json()) as {
    data?: Array<{
      id: string;
      name: string;
      access_token: string;
      instagram_business_account?: { id?: string; username?: string };
    }>;
  };
  if (!data || data.length === 0) return null;

  const page = data.find((item) => item.instagram_business_account?.id) ?? data[0]!;
  return {
    pageId: page.id,
    pageName: page.name,
    pageToken: page.access_token,
    instagramBusinessAccountId: page.instagram_business_account?.id ?? null,
    instagramUsername: page.instagram_business_account?.username ?? null,
  };
}

async function upsertOAuthAccount(input: {
  clientId: string;
  platform: string;
  accountId: string;
  accountName: string;
  accountHandle?: string | null;
  accessToken: string;
  tokenExpiresAt?: Date | null;
}) {
  const encryptedToken = encryptToken(input.accessToken);
  const existing = await db
    .select({ id: socialAccountsTable.id })
    .from(socialAccountsTable)
    .where(
      and(
        eq(socialAccountsTable.clientId, input.clientId),
        eq(socialAccountsTable.platform, input.platform),
        eq(socialAccountsTable.accountId, input.accountId)
      )
    )
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(socialAccountsTable)
      .set({
        accessToken: encryptedToken,
        tokenExpiresAt: input.tokenExpiresAt ?? undefined,
        accountName: input.accountName,
        accountHandle: input.accountHandle ?? undefined,
        isActive: true,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(socialAccountsTable.id, existing[0]!.id),
          eq(socialAccountsTable.clientId, input.clientId),
        ),
      );
    return;
  }

  await db.insert(socialAccountsTable).values({
    clientId: input.clientId,
    platform: input.platform,
    accountName: input.accountName,
    accountHandle: input.accountHandle ?? null,
    accountId: input.accountId,
    accessToken: encryptedToken,
    tokenExpiresAt: input.tokenExpiresAt ?? null,
    isActive: true,
  });
}

router.post("/auth/meta/start", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const { clientId } = (req.body ?? {}) as { clientId?: string };

  if (!clientId) {
    res.status(400).json({ error: "Missing clientId" });
    return;
  }

  const userId = req.userId ?? "";
  const hasAccess = await userHasClientRole(userId, clientId, MANAGE_CLIENT_ROLES);
  if (!hasAccess) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  if (!isEncryptionConfigured()) {
    res.status(503).json({
      error: "TOKEN_ENCRYPTION_KEY is not configured. Meta connection needs encrypted token storage.",
      tokenStorageSafe: false,
    });
    return;
  }

  const config = getMetaOAuthConfig();
  if (!config) {
    res.status(503).json({
      error: "not_configured",
      missing: ["META_APP_ID", "META_APP_SECRET", "META_REDIRECT_URI"],
    });
    return;
  }

  const nonce = randomBytes(32).toString("base64url");
  stateStore.set(nonce, {
    clientId,
    userId,
    platform: "meta",
    expiresAt: Date.now() + STATE_TTL_MS,
  });

  const redirectUri = process.env.META_REDIRECT_URI ?? `${getBaseUrl(req)}/api/auth/meta/callback`;
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: redirectUri,
    scope: config.scope,
    state: nonce,
  });

  res.json({ redirectUrl: `${config.authUrl}?${params.toString()}` });
});

router.get("/auth/meta/callback", async (req, res) => {
  const { code, state, error } = req.query as {
    code?: string;
    state?: string;
    error?: string;
  };

  const stateEntry = state ? consumeState(state) : null;
  if (!stateEntry || stateEntry.platform !== "meta") {
    res.status(400).send("Invalid or expired state parameter");
    return;
  }

  const clientId = stateEntry.clientId;
  const appUrl = getAppUrl(req);
  const returnUrl = `${appUrl}/clients/${clientId}/queue`;

  if (error || !code) {
    res.redirect(`${returnUrl}?meta_error=${encodeURIComponent(error ?? "cancelled")}`);
    return;
  }

  const hasAccess = await userHasClientRole(stateEntry.userId, clientId, MANAGE_CLIENT_ROLES);
  if (!hasAccess) {
    res.status(403).send("Forbidden");
    return;
  }

  const config = getMetaOAuthConfig();
  if (!config) {
    res.redirect(`${returnUrl}?meta_error=not_configured`);
    return;
  }

  try {
    const redirectUri = process.env.META_REDIRECT_URI ?? `${getBaseUrl(req)}/api/auth/meta/callback`;
    const tokenRes = await fetch(config.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: redirectUri,
        code,
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      throw new Error(`Meta token exchange failed: ${err}`);
    }

    const tokenData = (await tokenRes.json()) as { access_token: string; expires_in?: number };
    const extended = await extendFacebookToken(tokenData.access_token, config.clientId, config.clientSecret);
    const pageData = await getMetaPageData(extended.token);
    if (!pageData) {
      throw new Error("No Facebook Pages found. Make sure you manage at least one Facebook Page.");
    }

    await upsertOAuthAccount({
      clientId,
      platform: "facebook",
      accountId: pageData.pageId,
      accountName: pageData.pageName,
      accessToken: pageData.pageToken,
      tokenExpiresAt: null,
    });

    if (pageData.instagramBusinessAccountId) {
      await upsertOAuthAccount({
        clientId,
        platform: "instagram",
        accountId: pageData.instagramBusinessAccountId,
        accountName: pageData.instagramUsername ? `@${pageData.instagramUsername}` : "Instagram Business",
        accountHandle: pageData.instagramUsername ? `@${pageData.instagramUsername}` : null,
        accessToken: pageData.pageToken,
        tokenExpiresAt: null,
      });
    }

    logger.info(
      {
        clientId,
        facebookPageId: pageData.pageId,
        instagramBusinessAccountId: pageData.instagramBusinessAccountId,
      },
      "Meta OAuth account connected"
    );
    res.redirect(`${returnUrl}?meta_success=1`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.warn({ err }, "Meta OAuth callback error");
    res.redirect(`${returnUrl}?meta_error=${encodeURIComponent(message)}`);
  }
});

router.post("/auth/oauth/:platform/start", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const platform = String(req.params.platform);
  const { clientId } = (req.body ?? {}) as { clientId?: string };

  if (!clientId) {
    res.status(400).json({ error: "Missing clientId" });
    return;
  }

  const userId = req.userId ?? "";

  const hasAccess = await userHasClientRole(userId, clientId, MANAGE_CLIENT_ROLES);
  if (!hasAccess) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  if (!isEncryptionConfigured()) {
    res.status(503).json({ error: "TOKEN_ENCRYPTION_KEY is not configured — contact your administrator" });
    return;
  }

  const config = getOAuthConfig(platform);
  if (!config) {
    res.status(503).json({ error: "not_configured", platform });
    return;
  }

  const baseUrl = getBaseUrl(req);
  const redirectUri = `${baseUrl}/api/auth/oauth/${platform}/callback`;

  const pkce = platform === "twitter" ? generatePkce() : null;
  const nonce = randomBytes(32).toString("base64url");
  stateStore.set(nonce, {
    clientId,
    userId,
    platform,
    codeVerifier: pkce?.verifier,
    expiresAt: Date.now() + STATE_TTL_MS,
  });

  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: redirectUri,
    scope: config.scope,
    state: nonce,
    ...(config.extra ?? {}),
    ...(pkce ? { code_challenge: pkce.challenge, code_challenge_method: "S256" } : {}),
  });

  res.json({ redirectUrl: `${config.authUrl}?${params.toString()}` });
});

router.get("/auth/oauth/:platform/callback", async (req, res) => {
  const { platform } = req.params;
  const { code, state, error } = req.query as {
    code?: string;
    state?: string;
    error?: string;
  };

  const stateEntry = state ? consumeState(state) : null;
  if (!stateEntry || stateEntry.platform !== platform) {
    res.status(400).send("Invalid or expired state parameter");
    return;
  }
  const clientId = stateEntry.clientId;
  const codeVerifier = stateEntry.codeVerifier ?? "";
  const hasAccess = await userHasClientRole(stateEntry.userId, clientId, MANAGE_CLIENT_ROLES);
  if (!hasAccess) {
    res.status(403).send("Forbidden");
    return;
  }

  const appUrl = getAppUrl(req);
  const returnUrl = `${appUrl}/clients/${clientId}/social-accounts`;

  if (error || !code) {
    res.redirect(`${returnUrl}?oauth_error=${encodeURIComponent(error ?? "cancelled")}&platform=${platform}`);
    return;
  }

  const config = getOAuthConfig(platform);
  if (!config) {
    res.redirect(`${returnUrl}?oauth_error=not_configured&platform=${platform}`);
    return;
  }

  try {
    const baseUrl = getBaseUrl(req);
    const redirectUri = `${baseUrl}/api/auth/oauth/${platform}/callback`;

    const tokenRes = await fetch(config.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: redirectUri,
        code,
        ...(platform === "twitter" && codeVerifier ? { code_verifier: codeVerifier } : {}),
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      throw new Error(`Token exchange failed: ${err}`);
    }

    const tokenData = (await tokenRes.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };

    let accountId: string | null = null;
    let accountName: string | null = null;
    let accountHandle: string | null = null;
    let finalAccessToken = tokenData.access_token;
    let finalRefreshToken = tokenData.refresh_token ?? null;
    let expiresAt: Date | null = tokenData.expires_in
      ? new Date(Date.now() + tokenData.expires_in * 1000)
      : null;

    if (platform === "facebook" || platform === "instagram") {
      const extended = await extendFacebookToken(tokenData.access_token, config.clientId, config.clientSecret);
      finalAccessToken = extended.token;
      if (extended.expiresIn) {
        expiresAt = new Date(Date.now() + extended.expiresIn * 1000);
      }

      const pageData = await getFacebookPageData(finalAccessToken);
      if (!pageData) {
        throw new Error(
          "No Facebook Pages found. Ensure you have admin access to at least one Facebook Page."
        );
      }

      if (platform === "instagram") {
        const igId = await getInstagramBusinessAccountId(pageData.pageId, pageData.pageToken);
        if (!igId) {
          throw new Error(
            "No Instagram Business Account found connected to your Facebook Page. " +
              "Convert your Instagram account to a Business or Creator account and link it to your Facebook Page."
          );
        }
        accountId = igId;
        accountName = "Instagram Business";
        finalAccessToken = pageData.pageToken;
      } else {
        accountId = pageData.pageId;
        accountName = pageData.pageName;
        finalAccessToken = pageData.pageToken;
        expiresAt = null;
      }
    } else if (platform === "linkedin") {
      const profileRes = await fetch(
        "https://api.linkedin.com/v2/me?projection=(id,localizedFirstName,localizedLastName)",
        { headers: { Authorization: `Bearer ${finalAccessToken}` } }
      );
      if (profileRes.ok) {
        const p = (await profileRes.json()) as {
          id: string;
          localizedFirstName?: string;
          localizedLastName?: string;
        };
        accountId = p.id;
        accountName =
          [p.localizedFirstName, p.localizedLastName].filter(Boolean).join(" ") ||
          "LinkedIn Account";
      }
    } else if (platform === "twitter") {
      const meRes = await fetch("https://api.twitter.com/2/users/me", {
        headers: { Authorization: `Bearer ${finalAccessToken}` },
      });
      if (meRes.ok) {
        const { data } = (await meRes.json()) as {
          data: { id: string; name: string; username: string };
        };
        accountId = data.id;
        accountName = data.name;
        accountHandle = `@${data.username}`;
      }
    }

    const encryptedToken = encryptToken(finalAccessToken);
    const encryptedRefresh = finalRefreshToken ? encryptToken(finalRefreshToken) : null;

    const existing = await db
      .select({ id: socialAccountsTable.id })
      .from(socialAccountsTable)
      .where(
        and(
          eq(socialAccountsTable.clientId, clientId),
          eq(socialAccountsTable.platform, platform),
          ...(accountId ? [eq(socialAccountsTable.accountId, accountId)] : [])
        )
      )
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(socialAccountsTable)
        .set({
          accessToken: encryptedToken,
          refreshToken: encryptedRefresh ?? undefined,
          tokenExpiresAt: expiresAt ?? undefined,
          accountId: accountId ?? undefined,
          accountName: accountName ?? `${platform} Account`,
          accountHandle: accountHandle ?? undefined,
          isActive: true,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(socialAccountsTable.id, existing[0]!.id),
            eq(socialAccountsTable.clientId, clientId),
          ),
        );
    } else {
      await db.insert(socialAccountsTable).values({
        clientId,
        platform,
        accountName: accountName ?? `${platform} Account`,
        accountHandle: accountHandle ?? null,
        accountId: accountId ?? null,
        accessToken: encryptedToken,
        refreshToken: encryptedRefresh ?? null,
        tokenExpiresAt: expiresAt ?? null,
        isActive: true,
      });
    }

    logger.info({ platform, clientId, accountId }, "OAuth account connected");
    res.redirect(`${returnUrl}?oauth_success=1&platform=${platform}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.warn({ err, platform }, "OAuth callback error");
    res.redirect(`${returnUrl}?oauth_error=${encodeURIComponent(message)}&platform=${platform}`);
  }
});

export default router;
