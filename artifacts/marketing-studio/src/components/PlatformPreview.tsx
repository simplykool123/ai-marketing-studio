import { Heart, MessageCircle, Send, Repeat2, ThumbsUp, Share2, Bookmark } from "lucide-react";

interface PlatformPreviewProps {
  platform: string;
  caption: string;
  hashtags?: string;
  imageUrl?: string;
  title?: string;
  longFormBody?: string;
  brandName?: string;
}

function truncate(text: string, max: number) {
  return text.length > max ? text.slice(0, max) + "…" : text;
}

function InstagramPreview({ caption, hashtags, imageUrl, brandName }: PlatformPreviewProps) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden w-full max-w-sm mx-auto shadow-sm">
      <div className="flex items-center gap-2.5 px-3 py-2.5 border-b border-gray-100">
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-pink-400 to-violet-500 flex items-center justify-center text-white text-xs font-bold">
          {(brandName ?? "B")[0]}
        </div>
        <div>
          <p className="text-xs font-semibold">{brandName ?? "yourbrand"}</p>
          <p className="text-[10px] text-gray-400">Sponsored</p>
        </div>
      </div>
      {imageUrl ? (
        <img src={imageUrl} alt="Post" className="w-full aspect-square object-cover" />
      ) : (
        <div className="w-full aspect-square bg-gradient-to-br from-pink-50 to-violet-100 flex items-center justify-center">
          <p className="text-xs text-gray-400">Image preview</p>
        </div>
      )}
      <div className="px-3 py-2.5">
        <div className="flex items-center justify-between mb-2">
          <div className="flex gap-3">
            <Heart className="w-5 h-5 text-gray-700" />
            <MessageCircle className="w-5 h-5 text-gray-700" />
            <Send className="w-5 h-5 text-gray-700" />
          </div>
          <Bookmark className="w-5 h-5 text-gray-700" />
        </div>
        <p className="text-xs font-semibold mb-0.5">1,234 likes</p>
        <p className="text-xs text-gray-800 leading-relaxed">
          <span className="font-semibold">{brandName ?? "yourbrand"}</span>{" "}
          {truncate(caption, 120)}
        </p>
        {hashtags && <p className="text-xs text-blue-500 mt-0.5">{truncate(hashtags, 60)}</p>}
      </div>
    </div>
  );
}

function FacebookPreview({ caption, hashtags, imageUrl, brandName }: PlatformPreviewProps) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden w-full max-w-sm mx-auto shadow-sm">
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <div className="w-9 h-9 rounded-full bg-blue-500 flex items-center justify-center text-white text-sm font-bold">
          {(brandName ?? "B")[0]}
        </div>
        <div>
          <p className="text-xs font-semibold">{brandName ?? "Your Brand"}</p>
          <p className="text-[10px] text-gray-400">Just now · <span>🌐</span></p>
        </div>
      </div>
      <p className="px-3 pb-2 text-xs text-gray-800 leading-relaxed">{truncate(caption, 150)}</p>
      {imageUrl ? (
        <img src={imageUrl} alt="Post" className="w-full aspect-video object-cover" />
      ) : (
        <div className="w-full aspect-video bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
          <p className="text-xs text-gray-400">Image preview</p>
        </div>
      )}
      <div className="px-3 py-2 border-t border-gray-100 flex items-center gap-4">
        <button className="flex items-center gap-1 text-[11px] text-gray-500"><ThumbsUp className="w-3.5 h-3.5" />Like</button>
        <button className="flex items-center gap-1 text-[11px] text-gray-500"><MessageCircle className="w-3.5 h-3.5" />Comment</button>
        <button className="flex items-center gap-1 text-[11px] text-gray-500"><Share2 className="w-3.5 h-3.5" />Share</button>
      </div>
    </div>
  );
}

function LinkedInPreview({ caption, imageUrl, brandName }: PlatformPreviewProps) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden w-full max-w-sm mx-auto shadow-sm">
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <div className="w-10 h-10 rounded-lg bg-indigo-600 flex items-center justify-center text-white text-sm font-bold">
          {(brandName ?? "B")[0]}
        </div>
        <div>
          <p className="text-xs font-semibold">{brandName ?? "Your Brand"}</p>
          <p className="text-[10px] text-gray-400">1,240 followers · Just now</p>
        </div>
      </div>
      <p className="px-3 pb-2 text-xs text-gray-800 leading-relaxed">{truncate(caption, 180)}</p>
      {imageUrl ? (
        <img src={imageUrl} alt="Post" className="w-full aspect-video object-cover" />
      ) : (
        <div className="w-full aspect-video bg-gradient-to-br from-indigo-50 to-blue-100 flex items-center justify-center">
          <p className="text-xs text-gray-400">Image preview</p>
        </div>
      )}
      <div className="px-3 py-2 border-t border-gray-100 flex items-center gap-4">
        <button className="flex items-center gap-1 text-[11px] text-gray-500"><ThumbsUp className="w-3.5 h-3.5" />Like</button>
        <button className="flex items-center gap-1 text-[11px] text-gray-500"><MessageCircle className="w-3.5 h-3.5" />Comment</button>
        <button className="flex items-center gap-1 text-[11px] text-gray-500"><Repeat2 className="w-3.5 h-3.5" />Repost</button>
        <button className="flex items-center gap-1 text-[11px] text-gray-500"><Send className="w-3.5 h-3.5" />Send</button>
      </div>
    </div>
  );
}

function TwitterPreview({ caption, hashtags, imageUrl, brandName }: PlatformPreviewProps) {
  const fullText = [truncate(caption, 240), hashtags].filter(Boolean).join(" ");
  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden w-full max-w-sm mx-auto shadow-sm p-3">
      <div className="flex gap-2.5">
        <div className="w-9 h-9 rounded-full bg-sky-400 flex items-center justify-center text-white text-sm font-bold shrink-0">
          {(brandName ?? "B")[0]}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1 mb-0.5">
            <p className="text-xs font-semibold">{brandName ?? "Your Brand"}</p>
            <p className="text-[10px] text-gray-400">@yourbrand · now</p>
          </div>
          <p className="text-xs text-gray-800 leading-relaxed mb-2">{truncate(fullText, 280)}</p>
          {imageUrl && <img src={imageUrl} alt="Post" className="w-full aspect-video object-cover rounded-lg mb-2" />}
          <div className="flex items-center gap-5 text-gray-400">
            <MessageCircle className="w-3.5 h-3.5" />
            <Repeat2 className="w-3.5 h-3.5" />
            <Heart className="w-3.5 h-3.5" />
            <Share2 className="w-3.5 h-3.5" />
          </div>
        </div>
      </div>
    </div>
  );
}

function BlogPreview({ title, caption, longFormBody, imageUrl, brandName }: PlatformPreviewProps) {
  const body = longFormBody || caption;
  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden w-full max-w-sm mx-auto shadow-sm">
      {imageUrl ? (
        <img src={imageUrl} alt="Post" className="w-full aspect-video object-cover" />
      ) : (
        <div className="w-full aspect-video bg-gradient-to-br from-amber-50 to-orange-100 flex items-center justify-center">
          <p className="text-xs text-gray-400">Featured image</p>
        </div>
      )}
      <div className="p-3">
        <p className="text-[10px] text-amber-600 font-medium uppercase tracking-wide mb-1">{brandName ?? "Your Brand"}</p>
        <h3 className="text-sm font-bold text-gray-900 mb-1.5 leading-snug">{title || truncate(caption, 60)}</h3>
        <p className="text-xs text-gray-500 leading-relaxed">{truncate(body, 120)}</p>
        <p className="text-xs text-amber-600 font-medium mt-2">Read more →</p>
      </div>
    </div>
  );
}

function NewsletterPreview({ title, caption, longFormBody, brandName }: PlatformPreviewProps) {
  const body = longFormBody || caption;
  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden w-full max-w-sm mx-auto shadow-sm">
      <div className="bg-violet-50 px-4 py-3 border-b border-violet-100">
        <p className="text-[10px] text-violet-500 mb-0.5">From: {brandName ?? "Your Brand"} &lt;hello@brand.com&gt;</p>
        <p className="text-xs font-semibold text-gray-800">{title || truncate(caption, 60)}</p>
      </div>
      <div className="p-4">
        <div className="w-16 h-5 bg-violet-100 rounded mb-3" />
        <p className="text-xs text-gray-700 leading-relaxed">{truncate(body, 200)}</p>
        <div className="mt-3 pt-3 border-t border-gray-100">
          <div className="inline-block bg-violet-600 text-white text-xs px-3 py-1.5 rounded-md font-medium">
            Read Full Story →
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PlatformPreview(props: PlatformPreviewProps) {
  const { platform } = props;
  return (
    <div className="mt-4">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">Preview</p>
      {platform === "instagram" && <InstagramPreview {...props} />}
      {platform === "facebook" && <FacebookPreview {...props} />}
      {platform === "linkedin" && <LinkedInPreview {...props} />}
      {platform === "twitter" && <TwitterPreview {...props} />}
      {platform === "blog" && <BlogPreview {...props} />}
      {platform === "newsletter" && <NewsletterPreview {...props} />}
      {!["instagram","facebook","linkedin","twitter","blog","newsletter"].includes(platform) && (
        <InstagramPreview {...props} />
      )}
    </div>
  );
}
