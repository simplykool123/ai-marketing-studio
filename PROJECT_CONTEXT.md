# AI Marketing Studio - Project Context

**Last Updated:** 2026-05-31  
**Status:** ✅ Development - Database Connected, Core Features Working

---

## 🎯 Project Overview

AI Marketing Studio is a full-stack digital agency cockpit that helps agencies manage multiple clients, generate AI-powered content (social posts, images, videos, blogs), and publish to social platforms. Built with React + Express + Supabase + Drizzle ORM.

**Tech Stack:**
- **Frontend:** React 18, TypeScript, Vite, TanStack Query, Wouter, Tailwind CSS, shadcn/ui
- **Backend:** Express 5, Node.js 22, TypeScript, ESM modules
- **Database:** Supabase PostgreSQL (Drizzle ORM)
- **AI Providers:** Anthropic Claude, OpenAI, Google Gemini, Replicate, Ideogram
- **Storage:** Supabase Storage (images, videos, brand assets)
- **Auth:** Supabase Auth (email/password, magic links)

---

## 🗂️ Database Schema (23 Tables)

### Core Tables
- **`users`** (via Supabase Auth) - User accounts
- **`profiles`** - Extended user profile data
- **`clients`** - Client/brand accounts (multi-tenant)
- **`client_users`** - User-to-client memberships with roles
- **`client_invites`** - Pending team invitations

### Brand & Content
- **`brand_dna`** - Brand identity (tone, audience, colors, fonts, values)
- **`brand_assets`** - Uploaded logos, images, brochures, color palettes
- **`content_memory`** - AI memory entries (key-value JSON store for growth rules, trends, learnings)
- **`storylines`** - Content series/campaigns with recurring themes
- **`posts`** - Social media posts (drafts, approved, scheduled, published)
- **`images`** - AI-generated images (DALL-E, Flux, Ideogram)
- **`video_concepts`** - Video ideas and scripts
- **`campaigns`** - Multi-post campaign containers
- **`campaign_outputs`** - Generated campaign content
- **`ai_ideas`** - AI-suggested content ideas

### Publishing & Analytics
- **`social_accounts`** - Connected social platform accounts (OAuth tokens encrypted)
- **`posting_rules`** - Auto-scheduling rules per client
- **`posting_logs`** - Publish history and status
- **`blog_site_connections`** - WordPress/Ghost blog integrations
- **`quality_checks`** - Content quality audit logs

### System
- **`user_settings`** - User preferences and API keys (encrypted)
- **`user_api_keys`** - User-provided AI provider keys (encrypted)
- **`notifications`** - In-app notifications
- **`skill_configs`** - Custom AI skill configurations

---

## 🛣️ API Routes (38 Route Files)

### Authentication & Users
- **`/api/auth`** - Login, signup, logout, session management
- **`/api/settings`** - User settings, API keys, provider testing

### Client Management
- **`/api/clients`** - CRUD for clients, team management
- **`/api/team`** - Invite users, manage roles, remove members

### Brand Setup
- **`/api/clients/:clientId/brand-dna`** - Brand DNA CRUD, website analyzer
  - `POST /analyze-website` - Crawl website, extract brand info, colors, fonts, images
  - `POST /analyze-fallback` - Manual fallback with screenshot + text
- **`/api/clients/:clientId/brand-assets`** - Upload/manage brand assets
  - `POST /import-url` - Import image from URL
  - `GET /proxy-image` - Proxy external images
- **`/api/clients/:clientId/upload`** - Logo and asset uploads
- **`/api/clients/:clientId/memory`** - AI memory CRUD (growth rules, trends, learnings)

### Content Generation
- **`/api/clients/:clientId/posts`** - Post CRUD, AI generation, improvement, scheduling
  - `POST /` - Create post (manual or AI-generated)
  - `POST /:postId/improve` - AI improve caption/hashtags
  - `POST /:postId/regenerate-caption` - Regenerate caption
  - `POST /auto-schedule` - Auto-schedule pending posts
  - `PATCH /:postId/reschedule` - Change scheduled time
- **`/api/clients/:clientId/ai-content`** - AI content generation (posts, captions, hashtags)
- **`/api/clients/:clientId/ai`** - Legacy AI generation endpoint
- **`/api/clients/:clientId/creative`** - Creative brief generation

### Image Studio
- **`/api/clients/:clientId/images`** - AI image generation
  - `POST /generate` - Generate image (DALL-E 3, Flux, Ideogram)
  - `POST /:imageId/variations` - Generate variations
  - `POST /:imageId/upscale` - Upscale image
  - `POST /:imageId/attach-to-post` - Attach to post
- **`/api/clients/:clientId/image-studio`** - Image studio workflows

### Video Studio
- **`/api/clients/:clientId/video-studio`** - Video concept generation, script writing

### AI Brain & Ideas
- **`/api/clients/:clientId/brain`** - AI Ideas generation (8 content ideas)
  - `POST /generate` - Generate ideas based on Brand DNA + memory
  - `POST /ideas/:ideaId/draft` - Convert idea to draft post

### Trend Intelligence
- **`/api/clients/:clientId/trends`** - Trend research
  - `POST /research` - Research trends (Google News RSS, social memory, brand fit)
  - `POST /save-memory` - Save trend insight to AI memory

### Growth Advisor
- **`/api/clients/:clientId/growth-advisor`** - Growth recommendations
  - `POST /suggest-brand-fields` - AI suggest SEO keywords, CTAs, hashtags

### Campaigns & Storylines
- **`/api/clients/:clientId/campaigns`** - Campaign CRUD, generation
- **`/api/clients/:clientId/storylines`** - Storyline CRUD, post generation

### Publishing
- **`/api/clients/:clientId/publish`** - Publish posts to social platforms
  - `POST /:postId/publish` - Publish to Instagram, Facebook, LinkedIn, Twitter
- **`/api/clients/:clientId/social-accounts`** - Social account connections
- **`/api/clients/:clientId/posting-rules`** - Auto-scheduling rules
- **`/api/clients/:clientId/blog-publishing`** - Publish to WordPress/Ghost

### Analytics & Reports
- **`/api/clients/:clientId/analytics`** - Social media analytics
- **`/api/clients/:clientId/dashboard`** - Dashboard stats
- **`/api/clients/:clientId/reports`** - Generate reports

### OAuth & Integrations
- **`/api/oauth`** - OAuth flows for social platforms
  - `/connect/:platform` - Initiate OAuth
  - `/callback/:platform` - OAuth callback
- **`/api/clients/:clientId/social-intelligence`** - Social listening

### System
- **`/api/health`** - Health check
- **`/api/ai-provider-health`** - AI provider status
- **`/api/notifications`** - Notification CRUD
- **`/api/occasions`** - Occasion/holiday calendar
- **`/api/skills`** - Custom AI skills
- **`/api/storage-archive`** - Archive old content

---

## 🎨 Frontend Pages (30 Pages)

### Core Pages
- **`/`** - Landing page
- **`/login`** - Login page
- **`/signup`** - Signup page
- **`/clients`** - Client list (agency view)
- **`/clients/:clientId/dashboard`** - Client dashboard

### Content Creation
- **`/clients/:clientId/drafts`** - Review & approve posts (main content hub)
- **`/clients/:clientId/brain`** - AI Ideas (8 content suggestions)
- **`/clients/:clientId/image-studio`** - AI image generation
- **`/clients/:clientId/video-studio`** - Video concept generation
- **`/clients/:clientId/blog-studio`** - Blog post generation

### Brand Setup
- **`/clients/:clientId/brand-dna`** - Brand DNA setup, website importer
- **`/clients/:clientId/storylines`** - Content series management
- **`/clients/:clientId/campaigns`** - Campaign management

### Intelligence & Growth
- **`/clients/:clientId/trend-intelligence`** - Trend research
- **`/clients/:clientId/growth-advisor`** - Growth recommendations
- **`/clients/:clientId/social-intelligence`** - Social listening

### Publishing & Analytics
- **`/clients/:clientId/calendar`** - Content calendar
- **`/clients/:clientId/publish`** - Publishing queue
- **`/clients/:clientId/analytics`** - Analytics dashboard
- **`/clients/:clientId/reports`** - Report generation

### Settings
- **`/clients/:clientId/settings`** - Client settings, team management, social accounts
- **`/settings`** - User settings, API keys, provider testing

---

## 🔑 Environment Variables & API Keys

### Required (in `artifacts/api-server/.env`)

```env
# Server
PORT=8080
NODE_ENV=development
LOG_LEVEL=info

# Database (Supabase Postgres) - MUST USE POOLER URL FOR IPv4
DATABASE_URL=postgresql://postgres.gbpbpszoixhmwelqfiqh:[PASSWORD]@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres

# Supabase (Auth + Storage)
SUPABASE_URL=https://gbpbpszoixhmwelqfiqh.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...
SUPABASE_ANON_KEY=eyJhbGc...

# AI Providers (at least one required)
ANTHROPIC_KEY=sk-ant-api03-...
OPENAI_KEY=sk-proj-...
GEMINI_KEY=AIzaSy...

# Security
TOKEN_ENCRYPTION_KEY=a8d6bf223a2cdea63f42d06cf5bd89279ddd1c65cc108c135338e27c2b89dea4

# OAuth (optional - for social publishing)
FACEBOOK_APP_ID=
FACEBOOK_APP_SECRET=
INSTAGRAM_APP_ID=
INSTAGRAM_APP_SECRET=
LINKEDIN_CLIENT_ID=
LINKEDIN_CLIENT_SECRET=
TWITTER_CLIENT_ID=
TWITTER_CLIENT_SECRET=
```

### AI Provider Routing
- **User-provided keys** stored in `user_api_keys` table (encrypted)
- **Fallback to .env keys** if user hasn't provided their own
- **Provider resolution:** `resolveProviderAndModel()` checks DB first, then .env
- **Image generation:** `generateImageWithProvider()` routes to OpenAI DALL-E 3, Replicate Flux, or Ideogram

---

## ✅ What's Working (Latest Status)

### ✅ Core Infrastructure
- [x] Database connection via Supabase pooler (IPv4 compatible)
- [x] Environment variable loading via `--env-file` flag
- [x] Multi-tenant client system with role-based access
- [x] Supabase Auth integration
- [x] API key encryption and storage

### ✅ Brand Setup
- [x] Brand DNA CRUD
- [x] Website Brand Importer
  - Crawls homepage + up to 4 internal pages (about, services, contact prioritized)
  - Extracts: meta tags, H1/H2/H3, colors (CSS + screenshot), fonts, images, logo candidates
  - AI analysis: brand tone, audience, USP, content pillars, visual style, SEO keywords, CTAs, hashtags, platforms, service areas
  - **Direct contact extraction** (phone, email, WhatsApp, address) from HTML links + JSON-LD schema
  - **Never invents contacts** - only extracts from actual HTML
  - Fallback mode with manual screenshot + text input
- [x] Brand Profile (Growth Rules) stored in `content_memory` table
  - Fields: website, phone, email, WhatsApp, address, city, country, service areas, SEO keywords, hashtags, CTAs, platforms, image style notes
- [x] Brand Asset uploads (logo, images, brochures, color palettes)
- [x] Import review panel with confidence labels ("found on website", "AI suggested", "needs manual input")

### ✅ Content Generation
- [x] AI Ideas (8 content suggestions based on Brand DNA + memory)
- [x] Post generation (caption, hashtags, platform-specific formatting)
- [x] Post improvement (AI refine caption/hashtags)
- [x] Image generation (DALL-E 3, Replicate Flux, Ideogram)
- [x] Image variations and upscaling
- [x] Manual image upload fallback in Review panel
- [x] Video concept generation
- [x] Blog post generation

### ✅ Intelligence & Growth
- [x] Trend Intelligence
  - Google News RSS integration
  - Social memory integration
  - Brand fit scoring
  - Content opportunity generation
  - Auto-fill from Brand Profile (industry, region, platforms, SEO keywords, service areas)
  - Topic hint suggestion chips (clickable, optional)
- [x] Growth Advisor
  - AI suggest missing Brand Profile fields (SEO keywords, CTAs, hashtags, local keywords)
  - **Never invents phone/email/WhatsApp**
- [x] AI Memory system (key-value JSON store for trends, learnings, growth rules)

### ✅ Review & Publishing
- [x] Drafts page with preflight checks
  - Checks: website link, WhatsApp link, CTA, SEO keywords, hashtags presence
  - Amber warnings with "Add to Brand Profile →" link
- [x] Post scheduling (manual + auto-schedule)
- [x] Social account OAuth connections
- [x] Publishing to Instagram, Facebook, LinkedIn, Twitter
- [x] Blog publishing (WordPress, Ghost)

### ✅ Settings & Testing
- [x] User settings page
- [x] API key management (user-provided keys)
- [x] Provider testing ("Test Image AI" button)
  - Tests OpenAI DALL-E 3, Replicate Flux, Ideogram
  - Shows key source (user DB key vs .env fallback)
  - Shows key hint (last 4 chars)
  - **Never logs raw keys**

---

## 🐛 Known Issues & Pending Fixes

### 🔴 Critical
- None currently

### 🟡 Medium Priority
- **Database hostname IPv6-only issue** - FIXED by using pooler URL
- **Image key routing** - Already working, tested in Phase 40
- **Preflight checks** - Fixed in Phase 40 (info → warn, added "Add to Brand Profile →" link)

### 🟢 Low Priority / Polish
- Chunk size warning in frontend build (1.5MB bundle) - consider code splitting
- No .env.example file in root (not critical, .env is in api-server/)

---

## 📋 Recent Changes (Phase 40 & 41)

### Phase 40 (Completed)
1. Extended Brand Profile with new fields: phone, email, WhatsApp, address, city, country, service areas, secondary CTA, preferred platforms, image style notes
2. Added "Suggest with AI" button for empty SEO/CTA/hashtag fields
3. Fixed preflight checks: info → warn for missing website/WhatsApp/CTA/SEO, added "Add to Brand Profile →" link
4. Fixed image key routing (already working), added image test button in Settings
5. Added manual image upload fallback in Review panel
6. Auto-fill Trend Intelligence from Brand DNA (industry, region, platforms, content goal)

### Phase 41 (Completed)
1. **Backend (`brand_dna.ts`):**
   - Added `DirectContactData` type (phone, email, whatsappNumber, whatsappLink, address, city, country)
   - Added `extractDirectContacts(pages)` function - extracts from `tel:`, `mailto:`, `wa.me` links, JSON-LD schema only
   - Extended `BrandWebsiteAnalysis` with: brandName, seoKeywords, defaultHashtags, primaryCTA, secondaryCTA, preferredPlatforms, serviceAreas
   - Updated AI prompt to extract new fields, with explicit rule: **Do NOT include phone/email/WhatsApp - never invent contacts**
   - Added `contactData` to analyze-website response

2. **Frontend (`BrandDna.tsx`):**
   - Updated types with new fields + `DirectContactData`
   - Added `websiteContactData` and `showImportReview` state
   - Added `handleApplyToBrandProfile` - fills growthRules from AI suggestions + contacts (contacts only when found in HTML)
   - Added **Import Review panel** with confidence labels:
     - "found on website" (emerald) for direct HTML extraction
     - "AI suggested" (sky blue) for AI-inferred fields
     - "Not found — add manually or suggest with AI" for missing fields
   - "Save to Brand Profile" button saves to memory immediately

3. **Frontend (`TrendIntelligence.tsx`):**
   - Removed auto-fill of Topic Hint
   - Added `topicChips` state - populated from contentThemes, seoKeywords, serviceAreas
   - Rendered clickable suggestion chips below Topic Hint input
   - Topic Hint stays optional and blank by default

---

## 🚀 How to Run

### Prerequisites
- Node.js 22+
- pnpm 9+
- Supabase project (active, not paused)

### Setup
```bash
# Install dependencies
pnpm install

# Configure environment
# Edit artifacts/api-server/.env with your Supabase credentials and AI keys
# IMPORTANT: Use the pooler URL for DATABASE_URL (IPv4 compatible)

# Run development server
cd artifacts/api-server
pnpm run dev
```

### Development Commands
```bash
# Backend
cd artifacts/api-server
pnpm run dev          # Build + start with hot reload
pnpm run build        # Build only
pnpm run start        # Start built server
pnpm run typecheck    # Type check

# Frontend
cd artifacts/marketing-studio
pnpm run dev          # Vite dev server
pnpm run build        # Production build
pnpm run typecheck    # Type check

# Database
cd lib/db
pnpm run push         # Push schema to Supabase
pnpm run push-force   # Force push (destructive)

# Root
pnpm run build        # Build all packages
pnpm run typecheck    # Type check all packages
```

### Access
- **Frontend:** http://localhost:5173 (Vite dev server)
- **Backend:** http://localhost:8080 (Express API)
- **Database:** Supabase PostgreSQL (pooler URL)

---

## 📦 Project Structure

```
ai-marketing-studio/
├── artifacts/
│   ├── api-server/          # Express backend
│   │   ├── src/
│   │   │   ├── routes/      # 38 API route files
│   │   │   ├── lib/         # Utilities, AI providers, memory
│   │   │   ├── middleware/  # Auth, error handling
│   │   │   └── app.ts       # Express app setup
│   │   ├── .env             # Environment variables (DATABASE_URL, API keys)
│   │   └── package.json
│   └── marketing-studio/    # React frontend
│       ├── src/
│       │   ├── pages/       # 30 page components
│       │   ├── components/  # Reusable UI components
│       │   ├── hooks/       # React Query hooks
│       │   └── lib/         # Utilities
│       └── package.json
├── lib/
│   ├── db/                  # Drizzle ORM schema (23 tables)
│   │   ├── src/schema/      # Table definitions
│   │   ├── drizzle.config.ts
│   │   └── package.json
│   └── api-zod/             # Shared Zod schemas
├── package.json             # Root workspace config
└── pnpm-workspace.yaml      # pnpm workspace definition
```

---

## 🔐 Security Notes

- **API keys encrypted** using `TOKEN_ENCRYPTION_KEY` before storing in DB
- **OAuth tokens encrypted** before storing in `social_accounts` table
- **Never log raw keys** - only show last 4 chars as hints
- **Role-based access control** - `EDIT_CONTENT_ROLES`, `APPROVE_CONTENT_ROLES`, `MANAGE_CLIENT_ROLES`
- **Supabase RLS** - Row-level security on storage buckets

---

## 📝 Development Notes

### AI Provider Routing
- User-provided keys take precedence over .env keys
- `resolveProviderAndModel(settings, userId)` checks DB first
- `generateTextWithFallback()` tries primary provider, falls back to alternatives
- `generateImageWithProvider()` routes to OpenAI, Replicate, or Ideogram based on availability

### Memory System
- **Growth Rules** stored as JSON blob in `content_memory` table with key: `"Content Growth Rules / client defaults"`
- **Trends** stored with key pattern: `"Trend Memory / {topic}"`
- **Image Style** stored with key: `"Image Style Memory / {source}"`
- **SEO Keywords** stored with key: `"SEO Memory / {source}"`
- `buildClientMemoryPacket()` loads all memory entries + Brand DNA + storylines + campaigns + posts + AI ideas
- `formatClientMemoryPacket()` formats for AI context

### Database Connection
- **MUST use pooler URL** for DATABASE_URL (IPv4 compatible)
- Direct connection `db.*.supabase.co` is IPv6-only and won't work on most networks
- Pooler URL format: `aws-1-ap-northeast-1.pooler.supabase.com:5432`

### Build & Deploy
- Backend builds to `dist/` with esbuild (ESM modules)
- Frontend builds to `dist/public/` with Vite
- Source maps enabled for debugging
- `--env-file` flag loads environment variables

---

## 🎯 Next Steps / Roadmap

### Immediate
- [ ] Test full flow: signup → create client → import brand → generate content → publish
- [ ] Verify all 34 clients and 106 posts are accessible after database fix

### Short Term
- [ ] Add more AI providers (Mistral, Cohere)
- [ ] Improve image generation prompts
- [ ] Add video generation (Runway, Pika)
- [ ] Add analytics dashboard charts

### Long Term
- [ ] Multi-language support
- [ ] White-label mode for agencies
- [ ] Mobile app (React Native)
- [ ] AI voice-over generation

---

**End of Project Context**
