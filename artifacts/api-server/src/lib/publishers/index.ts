export interface PublishParams {
  caption: string;
  hashtags?: string | null;
  imageUrl?: string | null;
  accountId: string;
  accessToken: string;
  platform: string;
}

export interface PublishResult {
  publishedUrl: string;
  publishedAt: Date;
}

function fullCaption(caption: string, hashtags?: string | null): string {
  return hashtags ? `${caption}\n\n${hashtags}` : caption;
}

async function graphApiPost(url: string, params: Record<string, string>): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
}

export async function publishToInstagram(params: PublishParams): Promise<PublishResult> {
  const { caption, hashtags, imageUrl, accountId, accessToken } = params;
  const text = fullCaption(caption, hashtags);

  if (!imageUrl) throw new Error("Instagram requires an image URL to publish");

  const createRes = await graphApiPost(
    `https://graph.facebook.com/v18.0/${accountId}/media`,
    { image_url: imageUrl, caption: text, access_token: accessToken }
  );
  if (!createRes.ok) {
    const err = await createRes.json().catch(() => ({}));
    throw new Error(`Instagram container error: ${JSON.stringify(err)}`);
  }
  const { id: creationId } = (await createRes.json()) as { id: string };

  const publishRes = await graphApiPost(
    `https://graph.facebook.com/v18.0/${accountId}/media_publish`,
    { creation_id: creationId, access_token: accessToken }
  );
  if (!publishRes.ok) {
    const err = await publishRes.json().catch(() => ({}));
    throw new Error(`Instagram publish error: ${JSON.stringify(err)}`);
  }
  const { id: mediaId } = (await publishRes.json()) as { id: string };

  const permalinkRes = await fetch(
    `https://graph.facebook.com/v18.0/${mediaId}?fields=permalink&access_token=${accessToken}`
  );
  let publishedUrl = `https://www.instagram.com/p/${mediaId}/`;
  if (permalinkRes.ok) {
    const { permalink } = (await permalinkRes.json()) as { permalink?: string };
    if (permalink) publishedUrl = permalink;
  }

  return { publishedUrl, publishedAt: new Date() };
}

export async function publishToFacebook(params: PublishParams): Promise<PublishResult> {
  const { caption, hashtags, imageUrl, accountId, accessToken } = params;
  const message = fullCaption(caption, hashtags);

  let endpoint: string;
  let body: Record<string, string>;

  if (imageUrl) {
    endpoint = `https://graph.facebook.com/v18.0/${accountId}/photos`;
    body = { message, url: imageUrl, access_token: accessToken };
  } else {
    endpoint = `https://graph.facebook.com/v18.0/${accountId}/feed`;
    body = { message, access_token: accessToken };
  }

  const res = await graphApiPost(endpoint, body);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Facebook publish error: ${JSON.stringify(err)}`);
  }
  const { id } = (await res.json()) as { id: string };
  const parts = id.split("_");
  const pageId = parts[0];
  const postId = parts[1];

  return {
    publishedUrl: `https://www.facebook.com/${pageId ?? accountId}/posts/${postId ?? id}/`,
    publishedAt: new Date(),
  };
}

async function registerLinkedInImageUpload(
  accessToken: string,
  authorUrn: string
): Promise<{ uploadUrl: string; assetUrn: string }> {
  const res = await fetch("https://api.linkedin.com/v2/assets?action=registerUpload", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "X-Restli-Protocol-Version": "2.0.0",
    },
    body: JSON.stringify({
      registerUploadRequest: {
        owner: authorUrn,
        recipes: ["urn:li:digitalmediaRecipe:feedshare-image"],
        serviceRelationships: [
          {
            identifier: "urn:li:userGeneratedContent",
            relationshipType: "OWNER",
          },
        ],
        supportedUploadMechanism: ["SYNCHRONOUS_UPLOAD"],
      },
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`LinkedIn registerUpload failed: ${JSON.stringify(err)}`);
  }

  const data = (await res.json()) as {
    value: {
      uploadMechanism: {
        "com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest": {
          uploadUrl: string;
        };
      };
      asset: string;
    };
  };

  const uploadUrl =
    data.value.uploadMechanism["com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"]
      .uploadUrl;
  const assetUrn = data.value.asset;

  return { uploadUrl, assetUrn };
}

export async function publishToLinkedIn(params: PublishParams): Promise<PublishResult> {
  const { caption, hashtags, imageUrl, accountId, accessToken } = params;
  const text = fullCaption(caption, hashtags);
  const authorUrn = `urn:li:person:${accountId}`;

  let mediaCategory = "NONE";
  const media: unknown[] = [];

  if (imageUrl) {
    const { uploadUrl, assetUrn } = await registerLinkedInImageUpload(accessToken, authorUrn);

    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) throw new Error(`Failed to download image for LinkedIn upload: ${imageUrl}`);
    const imgBuffer = await imgRes.arrayBuffer();

    const uploadRes = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": imgRes.headers.get("content-type") ?? "image/jpeg",
      },
      body: imgBuffer,
    });
    if (!uploadRes.ok) {
      const err = await uploadRes.text().catch(() => "");
      throw new Error(`LinkedIn image upload failed: ${uploadRes.status} ${err}`);
    }

    mediaCategory = "IMAGE";
    media.push({
      status: "READY",
      description: { text: text.substring(0, 200) },
      media: assetUrn,
      title: { text: caption.substring(0, 80) },
    });
  }

  const body = {
    author: authorUrn,
    lifecycleState: "PUBLISHED",
    specificContent: {
      "com.linkedin.ugc.ShareContent": {
        shareCommentary: { text },
        shareMediaCategory: mediaCategory,
        ...(media.length > 0 ? { media } : {}),
      },
    },
    visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
  };

  const res = await fetch("https://api.linkedin.com/v2/ugcPosts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "X-Restli-Protocol-Version": "2.0.0",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`LinkedIn publish error: ${JSON.stringify(err)}`);
  }
  const result = (await res.json()) as { id: string };
  const encodedId = encodeURIComponent(result.id ?? "");

  return {
    publishedUrl: `https://www.linkedin.com/feed/update/${encodedId}/`,
    publishedAt: new Date(),
  };
}

export async function publishToTwitter(params: PublishParams): Promise<PublishResult> {
  const { caption, hashtags, imageUrl, accessToken } = params;
  const text = fullCaption(caption, hashtags).substring(0, 280);

  let mediaIds: string[] | undefined;

  if (imageUrl) {
    const imgRes = await fetch(imageUrl);
    if (imgRes.ok) {
      const imgBuffer = await imgRes.arrayBuffer();
      const contentType = imgRes.headers.get("content-type") ?? "image/jpeg";
      const blob = new Blob([imgBuffer], { type: contentType });
      const form = new FormData();
      form.append("media", blob, "upload.jpg");
      form.append("media_category", "tweet_image");
      const uploadRes = await fetch("https://api.x.com/2/media/upload", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        body: form,
      });
      if (uploadRes.ok) {
        const { data } = (await uploadRes.json()) as { data?: { id?: string } };
        if (data?.id) mediaIds = [data.id];
      }
    }
  }

  const tweetBody: Record<string, unknown> = { text };
  if (mediaIds) tweetBody.media = { media_ids: mediaIds };

  const res = await fetch("https://api.twitter.com/2/tweets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(tweetBody),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Twitter publish error: ${JSON.stringify(err)}`);
  }
  const { data } = (await res.json()) as { data: { id: string } };

  return {
    publishedUrl: `https://twitter.com/i/web/status/${data.id}/`,
    publishedAt: new Date(),
  };
}

export async function publishToPlatform(params: PublishParams): Promise<PublishResult> {
  switch (params.platform) {
    case "instagram": return publishToInstagram(params);
    case "facebook": return publishToFacebook(params);
    case "linkedin": return publishToLinkedIn(params);
    case "twitter": return publishToTwitter(params);
    default: throw new Error(`Unsupported platform: ${params.platform}`);
  }
}
