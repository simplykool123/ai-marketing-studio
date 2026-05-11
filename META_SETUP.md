# Meta Connection Setup

This checklist is for local testing of AI Marketing Studio's Meta connection V1.
It connects a Facebook Page and, when available, the Instagram Business or Creator account linked to that Page.

The app remains the source of truth. Export JSON, Send to workflow, and Mark posted manually stay available even when Meta is not connected.

## What This Enables

- Start Meta OAuth from Publish Queue.
- Store connected Facebook Page and Instagram account in the existing `social_accounts` table.
- Store tokens only when `TOKEN_ENCRYPTION_KEY` is configured.
- Show connected Meta status in Publish Queue.
- Show a real `Publish Meta` action only for Facebook or Instagram posts with a valid connection.

## Known Limitations

- This is not Postiz or Ayrshare integration.
- This does not add native LinkedIn or X/Twitter publishing.
- Instagram publishing requires a public final artwork/image URL.
- Instagram API publishing works only for Instagram Business or Creator accounts linked to a Facebook Page.
- The current schema does not have `provider`, `facebookPageId`, `instagramBusinessAccountId`, or `platformPostId` columns, so V1 stores Meta accounts as existing `facebook` and `instagram` social account rows.
- Long-lived token refresh depends on Meta app credentials and encrypted token storage being configured.
- App review may be required before connecting accounts outside your Meta app roles/testers.

## Required Meta Account Setup

1. Create or use a Facebook account that can manage the test Facebook Page.
2. Create a Facebook Page for the brand or test brand.
3. Make sure the Facebook user authorizing OAuth has Page access that can manage/publish content.
4. Convert the Instagram account to a Professional account: Business or Creator.
5. Link the Instagram Professional account to the Facebook Page.
6. Confirm the Page appears in Meta Business Suite or Page settings before testing OAuth.

Meta help article for linking a professional Instagram account to a Facebook Page:
https://www.facebook.com/help/instagram/402748553849926

## Create The Meta Developer App

1. Go to Meta for Developers:
   https://developers.facebook.com/apps/
2. Create a new app.
3. Choose an app type suitable for business/social publishing.
4. Add/configure Facebook Login for OAuth.
5. Add/configure Instagram Graph API or Instagram API access as required by the current Meta dashboard.
6. Add your local redirect URI exactly:
   `http://localhost:8080/api/auth/meta/callback`
7. Add yourself and any test users as app roles/testers while the app is in development mode.
8. Make sure your Facebook Page and Instagram Professional account are available to the user you test with.

## Permissions Used By This App

The local Meta OAuth route requests:

- `pages_show_list`
- `pages_read_engagement`
- `pages_manage_posts`
- `instagram_basic`
- `instagram_content_publish`
- `business_management`

In development mode, Meta may only allow these for app admins/developers/testers and connected test assets.
For production use with other users or client accounts, expect Meta app review and business verification requirements.

## Environment Setup

Add these to `artifacts/api-server/.env`:

```bash
META_APP_ID=your-meta-app-id
META_APP_SECRET=your-meta-app-secret
META_REDIRECT_URI=http://localhost:8080/api/auth/meta/callback
META_GRAPH_VERSION=v18.0
TOKEN_ENCRYPTION_KEY=replace-with-generated-base64-secret
```

Generate the encryption key with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Notes:

- `META_APP_ID`, `META_APP_SECRET`, and `TOKEN_ENCRYPTION_KEY` must stay backend-only.
- `META_REDIRECT_URI` must exactly match the redirect URI configured in the Meta developer app.
- If your API runs on another local port, update both `META_REDIRECT_URI` and the Meta app redirect URI to match.
- `META_GRAPH_VERSION` defaults to `v18.0` if omitted, but keeping it explicit makes local testing easier to debug.

## Run Locally

From the repo root:

```bash
pnpm install
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/marketing-studio run dev
```

If the API uses `PORT=8080` and the frontend uses `API_PORT=8080`, the frontend proxy can call the API locally.

## Local Test Steps

1. Start the API server with the Meta env vars loaded.
2. Start the marketing studio frontend.
3. Sign in to AI Marketing Studio.
4. Open a client.
5. Go to `Publish Queue`.
6. In the Publishing destination card, click `Connect Meta`.
7. Complete Meta OAuth with the Facebook user that manages the test Page.
8. Approve the requested Page and Instagram permissions.
9. After callback, you should return to `Publish Queue`.
10. Confirm the card shows:
    - `Meta connected` when at least one publishable Facebook or Instagram account is available.
    - Facebook Page name.
    - Instagram handle/name if a linked Instagram Business/Creator account was found.
11. Confirm Export, Send to workflow, and Mark posted are still available.
12. For a Facebook or Instagram post in Ready/Scheduled/Failed state, confirm `Publish Meta` appears only when the matching Meta account is connected.

## Expected Success State

Publish Queue should show a Meta destination with:

- Facebook Page connected.
- Instagram connected if the Page has a linked Instagram Business/Creator account.
- `Publish Meta` visible only on eligible Facebook or Instagram posts.
- No post should show `Published` until the backend has set `publishedAt`.

## Troubleshooting

- `TOKEN_ENCRYPTION_KEY is not configured`: generate the base64 key and restart the API.
- `not_configured`: confirm `META_APP_ID`, `META_APP_SECRET`, and `META_REDIRECT_URI` are present in the API environment.
- Redirect URI mismatch: copy the exact value from `META_REDIRECT_URI` into the Meta developer app OAuth redirect URI settings.
- No Facebook Pages found: confirm the authorizing Facebook user has access to the Page.
- Instagram not connected: confirm the Instagram account is Business/Creator and linked to the selected Facebook Page.
- Publish fails for Instagram: confirm the post has a public final artwork/image URL.
- App works for you but not another user: add that user as a Meta app tester/developer/admin or complete Meta app review for production access.
