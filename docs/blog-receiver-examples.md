# Blog Receiver Examples

AI Marketing Studio sends approved blog drafts as JSON with:

- `x-ams-signature: sha256=<hmac>`
- `x-ams-event: blog.publish`

Verify the HMAC over the raw request body using the one-time secret shown when the connection is created.

## Express

```ts
import crypto from "node:crypto";
import express from "express";

const app = express();
const secret = process.env.AMS_BLOG_SECRET!;

app.post("/api/ams/blog", express.raw({ type: "application/json" }), async (req, res) => {
  const body = req.body.toString("utf8");
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
  if (req.header("x-ams-signature") !== expected) return res.status(401).json({ error: "bad signature" });

  const post = JSON.parse(body);
  res.json({ publishedUrl: `https://example.com/blog/${post.slug}` });
});
```

## Next.js API Route

```ts
import crypto from "node:crypto";
import type { NextApiRequest, NextApiResponse } from "next";

export const config = { api: { bodyParser: false } };

async function readRaw(req: NextApiRequest) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const raw = await readRaw(req);
  const expected = "sha256=" + crypto.createHmac("sha256", process.env.AMS_BLOG_SECRET!).update(raw).digest("hex");
  if (req.headers["x-ams-signature"] !== expected) return res.status(401).json({ error: "bad signature" });

  const post = JSON.parse(raw);
  res.json({ publishedUrl: `https://example.com/blog/${post.slug}` });
}
```

## Supabase Insert

```ts
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

await supabase.from("blog_posts").insert({
  title: post.title,
  slug: post.slug,
  body_html: post.html,
  meta_description: post.metaDescription,
  featured_image_url: post.featuredImageUrl,
  tags: post.tags,
  schema_markup: post.schemaMarkup,
  published_at: post.publishedAt,
  author: post.author,
});
```
