# Podcst Modernization Plan

## Current State Analysis

### Architecture

- Next.js 15.2.6 with App Router, React 19, TypeScript 5.7.2
- Zustand for state management, SWR for data fetching
- Redis (ioredis) for server-side caching - hosted in Frankfurt (Hetzner)
- Fly.io deployment in Amsterdam
- ~5,360 lines of TypeScript
- 7 years of development, recently modernized core dependencies

### Performance Bottlenecks

1. **Redis latency**: Frankfurt Redis → Amsterdam app = ~20-30ms per query
2. **Next.js SSR overhead**: Full server rendering on every request
   - In current model we waste a lot of bandwith for navigation between feed and episodes.
   - They both share the same data, that we already have when the the feed page is shown.
   - Episode page is rendering a single episode from the feed, so we could just hydrate the data on client side.
   - But currently we re-fetch everything from server again. For a feed like "The Daily" with 150 episodes, this is a lot of wasted data.

3. **No edge caching**: All requests hit origin

### Strengths

- Clean architecture with clear separation
- Modern dependency versions
- Solid feature set (Chromecast, Airplay, private feeds, media session integration)
- Multi-layer caching strategy (Redis + IndexedDB + LocalStorage)
- Good fail over handling, Redis can be entirely down without breaking the core app

---

## Phase 1: Performance - Kill Redis Latency

Deploy Upstash Redis on Fly.io in Amsterdam (same region as app).

```bash
fly redis create --region ams
```

Benefits:

- Sub-millisecond latency (same datacenter)
- Managed service, no ops overhead
- Built-in replication if needed later

Migration:

1. Create Fly Redis instance in `ams`
2. Update environment variables
3. Migrate short URLs (permanent data) via script
4. Cached data (top podcasts, feeds) will self-heal

---

## Phase 2: Architecture - Static Shell, Dynamic Data

Transform from SSR-heavy to static-first architecture.

### Current

```
Request → SSR → Redis → iTunes API → Render → Response
```

### Target

```
Request → Static Shell (instant)
       → Client hydration
       → API routes (parallel data fetch)
       → Progressive render
```

### Implementation

1. **Convert pages to static shells**
   - `/feed/top` - static shell, client fetches top podcasts
   - `/feed/[feed]` - static shell, client fetches episodes
   - Keep `/api/*` routes for data

2. **Preload critical data**
   - Service worker caches API responses
   - Stale-while-revalidate on client

3. **Remove SWR, use native fetch cache**
   - React 19 + Next.js 15 have built-in cache
   - Simplify data layer

---

## Phase 3: UI Modernization - Magazine Editorial Design

### Design Vision

Inspired by high-end editorial publications like Monocle, The New Yorker, and Kinfolk.
The interface should feel like reading a beautifully designed magazine - sophisticated,
calm, and focused on content. Every element earns its place.

### Core Principles

1. **Typography is the interface** - Serif headings, generous line heights, careful kerning
2. **Restraint over decoration** - No gradients, no shadows unless essential, no visual noise
3. **Asymmetric balance** - Editorial layouts use tension and white space deliberately
4. **Content hierarchy through scale** - Large headlines, clear sections, scannable
5. **Quiet confidence** - The design doesn't shout; quality speaks for itself

### Typography System

Primary: **Instrument Serif** (Google Fonts) - elegant, modern serif
Secondary: **Inter** (Google Fonts) - clean, readable sans-serif for UI

```css
--font-serif: "Instrument Serif", Georgia, serif;
--font-sans: "Inter", system-ui, sans-serif;

--text-xs: 0.75rem; /* 12px - captions */
--text-sm: 0.875rem; /* 14px - secondary text */
--text-base: 1rem; /* 16px - body */
--text-lg: 1.125rem; /* 18px - emphasized body */
--text-xl: 1.5rem; /* 24px - section headers */
--text-2xl: 2rem; /* 32px - page titles */
--text-3xl: 2.5rem; /* 40px - hero headlines */
--text-4xl: 3.5rem; /* 56px - display */

--leading-tight: 1.1;
--leading-snug: 1.25;
--leading-normal: 1.5;
--leading-relaxed: 1.75;

--tracking-tight: -0.02em;
--tracking-normal: 0;
--tracking-wide: 0.05em;
```

### Color Palette

Warm, paper-like tones with a single accent color.

```css
--color-paper: #faf9f7; /* Warm off-white background */
--color-surface: #ffffff; /* Cards, elevated surfaces */
--color-ink: #1a1a1a; /* Primary text */
--color-ink-secondary: #6b6b6b; /* Secondary text */
--color-ink-tertiary: #9a9a9a; /* Captions, metadata */
--color-rule: #e8e6e3; /* Dividers, borders */
--color-accent: #c84b31; /* Warm terracotta - used sparingly */
--color-accent-subtle: #fdf6f4; /* Accent backgrounds */
```

### Spacing Scale

Based on 8px grid with generous margins.

```css
--space-1: 0.25rem; /* 4px */
--space-2: 0.5rem; /* 8px */
--space-3: 0.75rem; /* 12px */
--space-4: 1rem; /* 16px */
--space-6: 1.5rem; /* 24px */
--space-8: 2rem; /* 32px */
--space-12: 3rem; /* 48px */
--space-16: 4rem; /* 64px */
--space-24: 6rem; /* 96px */
--space-32: 8rem; /* 128px */
```

### Layout Philosophy

No sidebar. No hamburger menu. Clean, single-column layouts with intentional
negative space. Navigation is minimal and contextual.

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│     Podcst                              Search    Library       │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│                                                                 │
│                         Featured                                │
│                                                                 │
│     ┌─────────────────────────────────────────────────┐        │
│     │                                                 │        │
│     │                                                 │        │
│     │              Large Hero Image                   │        │
│     │                                                 │        │
│     │                                                 │        │
│     └─────────────────────────────────────────────────┘        │
│                                                                 │
│     The Daily                                                   │
│     The New York Times                                          │
│                                                                 │
│     ─────────────────────────────────────────────────          │
│                                                                 │
│     Trending This Week                                          │
│                                                                 │
│     ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐             │
│     │        │  │        │  │        │  │        │             │
│     │        │  │        │  │        │  │        │             │
│     └────────┘  └────────┘  └────────┘  └────────┘             │
│     Title       Title       Title       Title                   │
│     Author      Author      Author      Author                  │
│                                                                 │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│     Now Playing: Episode Title                     advancement   │
│     Podcast Name                           ▶      ━━━━━○━━━━━━  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Component Design

**Header**

- Wordmark left, minimal nav right
- No icons, just text links
- Thin rule underneath

**Podcast Card**

- Square artwork with subtle 1px border
- Title in serif, author in sans
- No shadows, no hover effects except subtle opacity

**Episode Row**

- Date on left (small, muted)
- Title in serif (medium weight)
- Duration on right
- Play button appears on hover
- Thin rule separator

**Player**

- Fixed bottom, full width
- Artwork small, left aligned
- Title/author centered
- Controls right
- Progress bar full width, thin, at very top
- Background: paper color with subtle top border

**Search**

- Opens as full-page overlay
- Large search input
- Results appear immediately below
- Clean list, no cards

### Visual Rules

1. **Borders over shadows** - 1px rules define space
2. **No rounded corners** - Sharp edges feel more editorial
3. **Images have borders** - Subtle 1px border on all artwork
4. **Consistent rhythm** - Same spacing between all sections
5. **Left-aligned by default** - Centered only for hero elements
6. **Muted interactions** - Hover states are subtle opacity changes
7. **No loading spinners** - Use skeleton states or nothing

---

## Phase 4: Tech Stack Evaluation

### Keep

- React 19 - Stable, well-supported
- Zustand - Simple, effective state management
- Howler.js - Best web audio library
- TypeScript - Non-negotiable

### Evaluate

| Current     | Alternative                  | Decision                        |
| ----------- | ---------------------------- | ------------------------------- |
| Next.js     | Remix, Astro, Vite+React     | Evaluate Astro for static-first |
| CSS Modules | Tailwind, vanilla-extract    | Tailwind for rapid iteration    |
| SWR         | TanStack Query, native fetch | Replace with TanStacke          |
| ioredis     | Upstash SDK, Turso           | Upstash for serverless Redis    |

- Gradually drop CSS modules in favour of Tailwind utility classes.
- We can't depend on native fetch cache, because the feed responses are too large
  to be cached. TanStack query gives us shared cache with more control.
  Deduplication between multiple components requesting the same feed.
  Like the feed page and the episode page requesting the same feed data.

---

## Phase 5: Code Health

### Remove

- Console.error → structured logging

### Add

- Vitest for unit tests
- Playwright for E2E (core flows)
- Sentry for error tracking
- Environment validation (Zod schema)

### Refactor

- Extract hardcoded URLs to config
- Remove @ts-expect-error in AudioUtils
- Type-safe environment variables

---

## Implementation Order

```
┌─────────────────────────────────────────────────────┐
│  Week 1-2: Performance Foundation                   │
│  ├── Migrate Redis to Fly.io Amsterdam              │
│  ├── Add environment validation                     │
│  └── Remove Vercel-specific code                    │
├─────────────────────────────────────────────────────┤
│  Week 3-4: UI Foundation                            │
│  ├── Install Tailwind CSS                           │
│  ├── Create design tokens                           │
│  └── Redesign Player Bar                            │
├─────────────────────────────────────────────────────┤
│  Week 5-6: Core UI                                  │
│  ├── Redesign Episode List                          │
│  ├── Redesign Podcast Grid                          │
│  └── Redesign Search                                │
├─────────────────────────────────────────────────────┤
│  Week 7-8: Polish & Testing                         │
│  ├── Animations and transitions                     │
│  ├── Mobile optimization                            │
│  ├── Add core E2E tests                             │
│  └── Performance audit                              │
└─────────────────────────────────────────────────────┘
```

---

## Immediate Actions

1. **Redis Migration** - Highest impact, lowest risk

   ```bash
   fly redis create --name podcst-redis --region ams
   ```

---

## Metrics to Track

- Time to First Byte (TTFB): Target < 200ms
- First Contentful Paint (FCP): Target < 1s
- Largest Contentful Paint (LCP): Target < 2.5s
- Core Web Vitals: All green

---

## Phase 6: Backend - User Accounts & Persistence

### Vision

Transform from client-only storage to server-backed persistence with user accounts.

### Database: PostgreSQL (Hetzner)

Single PostgreSQL database for everything - user data AND podcast content.

Why PostgreSQL over Turso:

- Podcast data requires concurrent writes (polling 6300+ feeds)
- Proper relational model: subscriptions → podcasts → episodes
- No cross-database joins needed
- GIN indexes for full-text transcript search
- Already running at postgres.watercooler.studio (no new costs)

### Database Migrations

Migrations live in `migrations/` directory, numbered sequentially:

```
migrations/
├── 0000-schema.sql           # Initial schema
├── 0001-podcast-fields.sql   # Podcast Index fields
├── 0002-poll-fields.sql      # Polling state fields
└── 0003-poll-metrics.sql     # Feed hash + metrics table
```

Run all migrations:
```bash
bun db:migrate
```

Run a specific migration:
```bash
bun db:migrate 0002-poll-fields.sql
```

Migration rules:
- Use `IF NOT EXISTS` / `IF EXISTS` for idempotency
- Number files sequentially (0000, 0001, ...)
- Descriptive suffix after number
- Keep `schema.sql` in sync as the canonical reference

### Data Model

See [schema.sql](./schema.sql) for the complete schema.

**Content tables:**

- `authors` - podcast creators
- `genres` - iTunes genre hierarchy
- `countries` - for top charts by region
- `podcasts` - feed metadata (no episodes stored inline)
- `episodes` - individual episodes with file URLs
- `podcasts_genres` - many-to-many
- `top_podcasts` - ranked charts per country/genre

**User tables:**

- `users` - accounts with email
- `sessions` - auth sessions with expiry
- `passkeys` - WebAuthn credentials
- `oauth_accounts` - Google/Apple login
- `subscriptions` - user → podcast relationships
- `playback_progress` - per-episode position tracking
- `transcripts` - episode transcripts with GIN full-text index

Key design decisions:

- Subscriptions reference podcast_id (not feed_url) - proper foreign keys
- Playback progress references episode_id - enables "continue listening" across devices
- Cascading deletes for clean user data removal
- GIN index on transcripts for fast full-text search

### Authentication: Passkeys + OAuth

Modern passwordless auth:

- WebAuthn/Passkeys as primary (no passwords to leak)
- OAuth fallback (Google, Apple)
- Session tokens in HttpOnly cookies

Library: `@simplewebauthn/server` or `lucia-auth`

```
┌─────────────────────────────────────────────────────┐
│  Auth Flow                                          │
│                                                     │
│  New User:                                          │
│  Email → Create Passkey → Session Cookie            │
│                                                     │
│  Returning User:                                    │
│  Email → Passkey Challenge → Session Cookie         │
│                                                     │
│  OAuth:                                             │
│  Provider → Callback → Link/Create User → Session   │
└─────────────────────────────────────────────────────┘
```

### Sync Strategy

```
┌─────────────────────────────────────────────────────┐
│  Current: Client-Only                               │
│                                                     │
│  IndexedDB ←→ Zustand Store                         │
│  (subscriptions, playback state)                    │
└─────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────┐
│  Target: Hybrid (offline-first)                     │
│                                                     │
│  IndexedDB ←→ Zustand ←→ Turso                      │
│       ↑                      ↑                      │
│  Offline cache         Source of truth              │
│                                                     │
│  Sync triggers:                                     │
│  - On login (pull server state)                     │
│  - On subscription change (push)                    │
│  - On playback pause (debounced push)               │
│  - On app focus (pull if stale)                     │
└─────────────────────────────────────────────────────┘
```

### Phase E: Feed Reliability & Search

**Podcast Index Database Sync**

The Podcast Index maintains a public SQLite dump of 4M+ podcasts:
https://public.podcastindex.org/podcastindex_feeds.db.tgz

Sync strategy:
- Daily download of the compressed dump (~500MB)
- Incremental update: only sync where their `lastUpdate` > our `updated_at`
- Batch upserts using `ON CONFLICT DO UPDATE`
- Run as ephemeral Fly Machine (pay only when running)

Schema additions to `podcasts` table:
- `podcast_index_id INTEGER UNIQUE` - their canonical ID
- `is_active BOOLEAN DEFAULT true` - false if feed is dead
- `language VARCHAR(10)` - ISO language code
- `popularity_score INTEGER` - for ranking/prioritization
- `priority INTEGER` - crawl priority
- `update_frequency INTEGER` - expected update interval in seconds

**Search Architecture**

Before (dependent on feed_url):
```
iTunes API → raw results → client requests /api/feed?url=... → parse RSS → return
```

After (database-first):
```
User query → parallel race:
  ├─ PostgreSQL (GIN full-text on title, description, author)
  └─ iTunes API (fallback for new/obscure podcasts)
→ merge by feed_url, dedupe
→ return database entities with podcast_id
```

Benefits:
- Instant results from our index
- No RSS parsing on search
- Clean URLs from the start (`/episodes/123`)
- iTunes as fallback for coverage

**Smart Feed Polling**

Crawl priority based on:
1. `update_frequency` - respect the podcast's cadence
2. `popularity_score` - popular podcasts polled more often
3. `last_published` - stale feeds deprioritized
4. `is_active = false` - skip dead feeds entirely

---

### Transcripts

Source options:

1. **Podcast Index API** - Many podcasts now publish transcripts
2. **Whisper API** - Generate on-demand for podcasts without
3. **User-uploaded** - Allow manual transcript upload

Storage:

- Full text in `transcripts.content`
- Timestamped segments in `transcripts.segments` (JSON)
- FTS5 index for search across all transcripts

Search UI:

- Global search: "Find episodes where they discuss X"
- Episode search: Jump to timestamp where X is mentioned

```
GET /api/transcripts/search?q=machine+learning
→ [{ episode_id, podcast_id, matches: [{text, start, end}] }]
```

### API Routes

```
/api/auth
├── POST /register     → Create user + passkey
├── POST /login        → Passkey challenge
├── POST /oauth/:provider → OAuth flow
├── DELETE /logout     → Clear session

/api/user
├── GET  /me           → Current user + preferences
├── PATCH /me          → Update preferences
├── DELETE /me         → Delete account + data

/api/subscriptions
├── GET    /             → List subscriptions
├── POST   /             → Add subscription
├── DELETE /:podcast_id  → Remove subscription

/api/progress
├── GET    /             → All progress
├── GET    /current      → Latest unfinished episode
├── GET    /:episode_id  → Single episode progress
├── PUT    /:episode_id  → Update progress

/api/transcripts
├── GET    /:episode_id  → Get transcript
├── GET    /search       → Full-text search
├── POST   /:episode_id  → Request transcript generation
```

### Migration Path

1. **Anonymous users continue working** - No forced login
2. **Optional account creation** - "Save your subscriptions"
3. **One-click import** - Pull from IndexedDB on first login
4. **Gradual feature unlock** - Sync, transcripts, cross-device

---

## Implementation Priority (Revised)

```
┌─────────────────────────────────────────────────────┐
│  Phase A: UI Foundation                    ✅ DONE   │
│  ├── ✅ Tailwind CSS v4 setup                       │
│  ├── ✅ Design tokens (Instrument Serif + Inter)    │
│  ├── ✅ Global styles (global.css)                  │
│  ├── ✅ SiteHeader (wordmark, nav, search, settings)│
│  ├── ✅ Player Bar redesign (needs polish)          │
│  ├── ✅ Episode List/Item redesign                  │
│  ├── ✅ Podcast Grid/Tile redesign                  │
│  ├── ✅ PodcastInfo/EpisodeInfo pages               │
│  ├── ✅ Search in header                            │
│  ├── ✅ Button styles                               │
│  ├── ✅ Loading/LoadBar components                  │
│  ├── ✅ Empty states (Library)                      │
│  └── ✅ Deleted legacy theme.css                    │
├─────────────────────────────────────────────────────┤
│  Phase B: Backend Foundation               ✅ DONE   │
│  ├── ✅ PostgreSQL schema migration (Hetzner)       │
│  ├── ✅ Database client setup (postgres.js)         │
│  ├── ✅ Auth system (passkeys + email codes)        │
│  └── ✅ Session management                          │
├─────────────────────────────────────────────────────┤
│  Phase C: Feed Ingestion Pipeline          ✅ DONE   │
│  ├── ✅ Podcast/episode storage in PostgreSQL       │
│  ├── ✅ iTunes API → podcasts table sync            │
│  ├── ✅ RSS parsing → episodes table                │
│  ├── ✅ Three-layer cache (Redis → PG → API)        │
│  └── Background feed polling (cron or queue)        │
├─────────────────────────────────────────────────────┤
│  Phase D: User Data                          ✅ DONE │
│  ├── ✅ Subscriptions API (CRUD)                    │
│  ├── ✅ SSR subscriptions page (/profile/subs)      │
│  ├── ✅ Import from device (local → server sync)    │
│  ├── ✅ OPML export from server subscriptions       │
│  ├── ✅ Playback progress sync                      │
│  └── ⊘ Preferences sync (N/A - nothing to sync)    │
├─────────────────────────────────────────────────────┤
│  Phase E: Feed Reliability & Search        ✅ DONE   │
│  ├── ✅ Podcast Index database sync (daily)         │
│  ├── ✅ Schema additions (is_active, language, etc.)│
│  ├── ⏸ PostgreSQL search (disabled - needs tuning) │
│  ├── ✅ iTunes search (current)                     │
│  └── ✅ Smart feed polling (priority-based)         │
├─────────────────────────────────────────────────────┤
│  Phase F: Transcripts                               │
│  ├── Podcast Index transcript API                   │
│  ├── Transcript UI (timestamped, clickable)         │
│  └── Episode-level search                           │
├─────────────────────────────────────────────────────┤
│  Phase G: OAuth Authentication                      │
│  ├── Google OAuth provider                          │
│  ├── Apple OAuth provider                           │
│  └── Link OAuth accounts to existing users          │
├─────────────────────────────────────────────────────┤
│  Phase H: Polish                                    │
│  ├── Redis migration (Fly.io AMS)                   │
│  ├── Performance audit                              │
│  └── E2E tests for critical flows                   │
└─────────────────────────────────────────────────────┘
```

---

## Progress Log

### 2025-12-21: Phase A Complete

UI Foundation shipped:

- Tailwind CSS v4 with CSS-based @theme configuration
- Editorial design system: Instrument Serif + Inter fonts
- Warm paper palette (#FAF9F7 background, #C84B31 terracotta accent)
- All major components redesigned with magazine aesthetic
- Stroke-based icons, 1px borders, no rounded corners
- Responsive layouts for mobile

Remaining UI polish (deferred):

- Player controls refinement
- Animations/transitions

### 2025-12-21: Code Cleanup

Removed deprecated code:

- ✅ Removed `experimental: { esmExternals: false }` from next.config.ts
- ✅ Removed `@vercel/analytics` (unused)
- ✅ Removed `@shopify/react-web-worker` (replaced with simple useMemo)
- ✅ Removed `"deploy": "vercel"` script
- ✅ Deleted sortFilterEpisodes.ts worker (unnecessary complexity)
- ✅ Simplified useEpisodesFilter to use useMemo instead of web worker

Bundle size reduced: 101 kB → 100 kB shared JS

### 2025-12-21: SWR → TanStack Query

Replaced SWR with TanStack Query:

- ✅ Installed @tanstack/react-query
- ✅ Created QueryProvider with sensible defaults
- ✅ Migrated useSearch hook
- ✅ Removed SWR dependency

Benefits:

- Shared query cache for feed deduplication
- Better control over stale time and garbage collection
- Foundation for client-side feed caching

### 2025-12-23: Phase B & C Complete

Backend foundation and feed ingestion shipped:

- ✅ PostgreSQL schema (`schema.sql`) with all tables
- ✅ Database client (`postgres.js`) connected to Hetzner
- ✅ Passkey authentication with `@simplewebauthn/server`
- ✅ Session management with HttpOnly cookies
- ✅ Feed ingestion pipeline (RSS → PostgreSQL)
- ✅ Top podcasts ingestion (iTunes API → PostgreSQL)
- ✅ Three-layer cache: Redis (hot) → PostgreSQL (warm) → API (cold)
- ✅ Upsert-based ingestion to avoid race conditions during build

### 2025-12-23: User Subscriptions

Server-synced subscriptions for logged-in users:

- ✅ `/api/subscriptions` - CRUD endpoints (single + bulk import)
- ✅ `/profile/subscriptions` - SSR page for authenticated users
- ✅ Header nav switches between `/subs` (anon) and `/profile/subscriptions` (auth)
- ✅ "Import from Device" in profile - syncs local IndexedDB to server
- ✅ OPML export now pulls from server subscriptions
- ✅ Bulk import uses single request instead of N parallel requests

### 2025-12-24: Clean URLs

Simplified URL structure using database IDs:

- ✅ `/episodes/123` - podcast with database ID 123
- ✅ `/episodes/123/456` - podcast 123, episode 456
- ✅ Legacy URLs (`/episodes/https%3A%2F%2F...`) automatically redirect to clean format
- ✅ Added `id` and `podcastId` to `IEpisodeInfo` type
- ✅ Added `id` to `IPodcastEpisodesInfo` type
- ✅ Updated all link generation (PodcastTile, EpisodeItem, EpisodeInfo, Player, Schema)
- ✅ API supports both `?id=123` and `?url=...` for feed lookup
- ✅ Search results (from iTunes) use legacy URLs until podcast is ingested

URL detection: numeric-only first slug = database ID, otherwise = legacy encoded URL.

### 2025-12-24: Auth Security Fix

Email verification before passkey registration:

- ✅ Added `email_verifications` table for verification codes
- ✅ Integrated Resend for transactional email
- ✅ `/api/auth/verify` - sends and verifies 6-digit codes
- ✅ Auth flow: email → login attempt → verification code → passkey creation
- ✅ Existing passkey users skip verification (direct login)

Environment variables required:

- `RESEND_API_KEY` - API key from resend.com
- `EMAIL_FROM` - Optional, defaults to `Podcst <noreply@podcst.app>`

### 2025-12-24: Subscription Architecture

Clean separation between local and server subscriptions:

- ✅ `SubscribeButton` checks session state to determine behavior
- ✅ Logged out: uses Zustand store → IndexedDB (offline-capable)
- ✅ Logged in: uses TanStack Query → `/api/subscriptions` (server-synced)
- ✅ No dual-write: users migrate to server via "Import from Device" in profile
- ✅ After import, `clearSubs([])` empties local storage
- ✅ API uses `podcastId` (database ID) instead of `feedUrl` for subscribe/unsubscribe
- ✅ `importSubscriptions` (OPML import) still uses `feedUrls` and ingests podcasts as needed

### 2025-12-28: Episode Pagination & SPA Navigation Cleanup

Optimized episode loading for large podcasts (e.g., Joe Rogan with 2600+ episodes):

**Backend Changes:**
- ✅ Added `getPodcastInfoById()` - fetches podcast metadata without episodes
- ✅ Added `getEpisodeById()` - fetches single episode by ID
- ✅ Added `getPaginatedEpisodes()` - fetches episodes with pagination, search, and sort
- ✅ New API routes:
  - `GET /api/feed/info?id=123` - podcast metadata only
  - `GET /api/feed/episodes?id=123&page=1&pageSize=20&query=&sort=releaseDesc` - paginated episodes

**Frontend Changes:**
- ✅ `PaginatedEpisodesList` component with infinite scroll using `@tanstack/react-virtual`
- ✅ Backend search (query parameter) instead of client-side filtering
- ✅ Backend sorting with SQL ORDER BY
- ✅ Single episode page fetches only that episode, not entire podcast feed
- ✅ `useEpisodes` hook with `useInfiniteQuery` for pagination

**Navigation Simplification:**
- ✅ Removed `SpaLink` component (was using `history.pushState` hack)
- ✅ Replaced with standard Next.js `Link` for proper server navigation
- ✅ Fixed episode item structure: link and buttons now siblings (not nested)
- ✅ Buttons have `opacity: 0` but link is always clickable

**Types Added:**
- `IPodcastInfo` - podcast metadata without episodes array
- `IPaginatedEpisodes` - paginated response wrapper

**Files Deleted:**
- `src/shared/spa/SpaLink.tsx`
- `src/shared/spa/index.ts`
- `src/app/episodes/[...slugs]/EpisodesSpaClient.tsx` - moved logic to server component

**Key Simplification:**
- Removed the `EpisodesSpaClient` wrapper entirely
- Schema components render directly in server component with URL computed from params
- `PaginatedEpisodesList` is the only client component needed (for infinite scroll)
- Single episode view is fully server-rendered with `EpisodeInfo` component

This eliminates the 8000-episode fetch for podcasts like ID 180, loading only 20 episodes at a time with infinite scroll.

---

Architecture:

```
Logged Out:                    Logged In + podcastId:
┌─────────────┐               ┌─────────────┐
│ Zustand     │               │ TanStack    │
│ Store       │               │ Query       │
└─────┬───────┘               └─────┬───────┘
      ↓                             ↓
┌─────────────┐               ┌─────────────┐
│ IndexedDB   │               │ PostgreSQL  │
│ (local)     │               │ (server)    │
└─────────────┘               └─────────────┘
```

API endpoints:

- `POST /api/subscriptions` - `{ podcastId }` or `{ feedUrls }` (bulk import)
- `DELETE /api/subscriptions?podcastId=123`

### 2025-12-24: Phase E - Feed Reliability & Search

Podcast Index database sync infrastructure:

- ✅ Schema additions: `podcast_index_id`, `is_active`, `language`, `popularity_score`, `priority`, `update_frequency`
- ✅ Migration script: `scripts/migrate-podcast-fields.sql`
- ✅ GIN index for full-text search on `title` + `description`
- ✅ Sync script: `scripts/sync-podcast-index.ts` (Bun + SQLite)
  - Downloads ~1.6GB compressed dump from Podcast Index
  - Incremental sync based on `lastUpdate` timestamp
  - Batch upserts with author deduplication

Scripts:
- `yarn db:migrate:podcasts` - run the ALTER TABLE migration
- `yarn sync:podcast-index` - sync from Podcast Index dump

Search implementation:

- ✅ `src/server/search.ts` - PostgreSQL search (ILIKE-based)
- ⏸ Local DB search disabled - iTunes ranking is significantly better
- ✅ iTunes API search (current default)
- ✅ Search results return `id` when available (from iTunes lookup)

**TODO: Revisit local search with:**
- `pg_trgm` extension for trigram similarity
- Dedicated search index (Meilisearch, Typesense, or Algolia)
- Better ranking: combine popularity_score with text relevance

Current issue: ILIKE `%term%` doesn't rank results well. iTunes API has
superior relevance ranking (e.g., "99" → "99% Invisible" as top result).

### 2025-12-24: Playback Progress Sync

Server-synced playback progress for authenticated users:

- ✅ `GET /api/progress` - returns most recent unfinished episode with position
- ✅ `PUT /api/progress` - upserts `{ episodeId, position, completed }`
- ✅ `usePlaybackSync` hook in Player component
- ✅ Auto-save every 30 seconds while playing
- ✅ Save on pause
- ✅ Save on page unload (via `sendBeacon`)
- ✅ Mark completed when episode ends or position ≥ 95% of duration
- ✅ Restore last unfinished episode on app mount (authenticated users)

Architecture:

```
On Mount (authenticated):
  GET /api/progress → queue episode + set seek position

While Playing:
  Every 30s → PUT /api/progress { position, completed: false }

On Pause/Unload:
  PUT /api/progress { position, completed: false }

On Episode End:
  PUT /api/progress { position: 0, completed: true }
```

### 2025-12-26: Smart Feed Polling

Background polling system for feed freshness:

**Polling Schema Additions:**
- `last_polled_at TIMESTAMPTZ` - when feed was last fetched
- `next_poll_at TIMESTAMPTZ` - scheduled next poll time
- `poll_failures INTEGER DEFAULT 0` - consecutive failure count
- `feed_etag TEXT` - ETag header for conditional requests
- `feed_last_modified TEXT` - Last-Modified header for conditional requests
- `feed_hash TEXT` - SHA256 of feed content (fallback change detection)

**Metrics Table:**
- `poll_metrics` - tracks polling statistics over time
- Queryable metrics: `feeds_updated`, `feeds_unchanged`, `feeds_failed`, `top_charts_new_podcasts`

**Polling Scripts:**
- `scripts/poll-top-charts.ts` - fetches iTunes top charts
  - Uses countries from DB (falls back to DEFAULT_LOCALES on first run)
  - Tracks new podcasts discovered per run
  - Run daily (iTunes charts update once every 24h)

- `scripts/poll-feeds.ts` - polls individual podcast RSS feeds
  - HTTP conditional requests (`If-None-Match`, `If-Modified-Since`)
  - SHA256 hash comparison to skip unchanged feeds
  - Priority-based queue (popularity_score + priority)
  - Smart scheduling: `next_poll_at = now() + update_frequency`
  - Exponential backoff on failures (1h → 2h → 4h → ... → 7d max)
  - Deactivates feed after 5 consecutive failures
  - Run every 5 minutes

**Scalability Notes:**
- With 4.5M podcasts, hash/ETag optimization is critical
- Most feeds don't change daily → high `unchanged` rate expected
- Stale feeds (`last_published` > 6 months ago) excluded from polling
- Batch size adjustable via `BATCH_SIZE` constant
- Can run multiple workers in parallel (stateless design)

**Active Feed Criteria:**
- `is_active = true` (not deactivated due to failures)
- `next_poll_at <= now()` (due for polling)
- `last_published` within last 180 days (or NULL for new feeds)

**Throughput:**
- BATCH_SIZE=500 every 5min = 144K polls/day
- ~315K active feeds (published in last 6 months)
- Full coverage in ~2.2 days worst case
- With hash/ETag, most return quickly as unchanged

**API Routes Simplified:**
- ✅ `/api/top` - DB-only, no iTunes fallback
- ✅ `/api/feed` - DB-only, returns 404 if not found (no RSS fallback)
- ✅ `/api/search` - DB-only for URL searches, iTunes for term searches
- ✅ Removed automatic refresh from `getPodcastById`
- ✅ Kept `ingestPodcast` for OPML imports and SSR episode pages
- ✅ Kept `refreshPodcast` for manual `/api/feed/refresh` endpoint

**Architecture:**

```
Background Jobs (cron):
┌─────────────────────────────────────────────────────┐
│  poll-top-charts.ts                                 │
│  └── Runs daily → iTunes top 100 → top_podcasts    │
│      └── Sets next_poll_at = now() for new entries │
├─────────────────────────────────────────────────────┤
│  poll-feeds.ts                                      │
│  └── Runs every 5min → SELECT due podcasts         │
│      └── Fetch RSS → upsert episodes               │
│      └── Update next_poll_at based on frequency    │
└─────────────────────────────────────────────────────┘

API Routes (DB-only):
┌─────────────────────────────────────────────────────┐
│  GET /api/top                                       │
│  └── Redis cache → PostgreSQL → return             │
│                                                     │
│  GET /api/feed?id=123                               │
│  └── PostgreSQL → return                           │
│                                                     │
│  GET /api/feed?url=...                              │
│  └── Redis cache → PostgreSQL → return or 404      │
└─────────────────────────────────────────────────────┘
```

### 2025-12-28: Email Code Login

Added email-only login as alternative to passkeys:

- ✅ `/api/auth/email-login` endpoint - verifies code and creates session
- ✅ `useEmailLogin` hook for client-side login flow
- ✅ Updated auth page: "Verify" button logs in directly, "Use passkey instead" optional
- ✅ Updated translations

Flow:
1. User enters email
2. If existing passkey → passkey challenge (existing flow)
3. If no passkey → send verification code
4. User enters code → logged in immediately
5. Optional: "Use passkey instead" to create passkey for faster future logins

### 2026-01-03: Auth Flow Redesign

Streamlined login/signup flow inspired by Uber and GitHub:

**Login flow:**
1. Enter email → "Sign in"
2. Check if user exists and has passkeys
   - Has passkey → trigger browser passkey prompt
   - Passkey fails/cancelled → fall back to email code
   - No passkey → send email code directly
3. After email code login → offer optional passkey setup

**Signup flow:**
1. Click "Create account" (explicit mode toggle)
2. Enter email → send verification code
3. Verify code → account created, logged in
4. Offer passkey setup (skip for now available)

**Changes:**
- ✅ `checkUserPasskeys()` function - returns `{ exists, hasPasskey, userId }`
- ✅ Login API returns structured response instead of throwing errors
- ✅ `useLoginCheck` hook - checks user state before auth
- ✅ `usePasskeyLogin` hook - separate passkey authentication
- ✅ Auth page with clear login/signup mode toggle
- ✅ Post-login passkey setup prompt with skip option
- ✅ Updated all 7 language files with new auth strings

---

## Open Questions

1. Should we support offline playback (service worker + caching)?

- Not at the moment, service workers add too much complexity.

2. Multi-region deployment - is Amsterdam sufficient for user base?

- Yes eventually we want to have one additonal region in the US.

3. Custom domain for assets CDN or continue with Fly.io?

- Right now primary legacy instance is on Vercel at pocst.app.
- For fly we have podcst.fly.dev, which is fine for now.

4. Analytics: Plausible, PostHog, or none?

- Plausible is lightweight and privacy-focused, good fit.

5. Transcript generation: Whisper self-hosted vs API vs Podcast Index only?

- Podcast Index first, then Whisper API as fallback.

6. Rate limiting strategy for API routes?

- Exponential backoff on client, 429 responses from server.
