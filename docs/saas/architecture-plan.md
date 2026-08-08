# Oksskolten SaaS Architecture Plan

> **Status:** Draft  
> **Author:** pco2699 (fork maintainer)  
> **License Blocker:** AGPL-3.0 (see §5). No commercial SaaS may be launched without upstream dual-license or permission.

---

## 1. Current-State Summary

### 1.1 Single-Node Architecture (as deployed at rss.pco2699.xyz)

```
┌─────────────────────────────────────────────────────────────┐
│  Docker Host (single VPS)                                   │
│                                                             │
│  ┌──────────┐ ┌──────────┐ ┌──────────────┐ ┌──────────┐  │
│  │ Node 22  │ │ Meili-   │ │ RSS Bridge   │ │ Cloud-   │  │
│  │ Fastify  │ │ search   │ │ (bridge)     │ │ flared   │  │
│  │ + SPA    │ │          │ │              │ │ tunnel   │  │
│  └────┬─────┘ └────┬─────┘ └──────────────┘ └──────────┘  │
│       │            │                                        │
│       └────────────┴── SQLite WAL (single .db file)         │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 Key Technical Details

| Component | Technology | Notes |
|---|---|---|
| **App server** | Fastify (Node 22) | SPA static serving + API |
| **Scheduler** | `node-cron` (in-process) | Feed sweep every 5 min |
| **Database** | SQLite (WAL mode, libsql-compatible) | Single file; migrations via `.sql` files |
| **Search** | Meilisearch (Docker sidecar) | Full-text + typo tolerance |
| **Auth** | Password (bcrypt) + WebAuthn passkeys + GitHub OAuth | JWT (30-day), token-version invalidation |
| **LLM** | OpenRouter only | API key stored per-user in DB settings table |
| **Feed fetching** | In-process semaphore (5 concurrent) | Readability/jsdom in Worker Threads (max 2) |
| **Bot bypass** | FlareSolverr + RSS Bridge | For JS-challenge / bot-gated feeds |
| **Data model** | Single-tenant SQLite schema | No `user_id` on feeds/articles/categories/chat |
| **API keys** | SHA-256 hashed, `read` or `read,write` scope | For MCP / script access |

### 1.3 Why SaaS Becomes Necessary

- **Desire:** Friends/family want hosted access without running Docker
- **Current gap:** Single-tenant DB = all users share one feed list, article state, and settings
- **Ops burden:** Backups, monitoring, and scaling currently manual on one VPS
- **Cost curiosity:** Could this be a small indie SaaS to offset hosting?

---

## 2. Target Architecture Options

### 2.1 Option A: Cloudflare Workers + D1 + Durable Objects (Edge-native)

```
┌──────────────────────────────────────────────────────────┐
│  Edge                                                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │ Worker (API  │  │ D1 SQLite    │  │ Durable Obj  │   │
│  │  + SPA)      │  │ (per-tenant) │  │ (feed fetch  │   │
│  │              │  │              │  │  scheduling) │   │
│  └──────┬───────┘  └──────────────┘  └──────────────┘   │
│         │                                                │
│         ▼                                                │
│  ┌──────────────┐                                       │
│  │ KV / R2      │  (images, caches)                     │
│  └──────────────┘                                       │
└──────────────────────────────────────────────────────────┘
```

| Pros | Cons |
|---|---|
| Zero server management; auto-scales | SQLite on D1 has 500 MB DB limit, 50k rows/query |
| Global edge latency | No persistent process → cron requires Workers Cron + DO alarm hacks |
| $5/mo Workers Paid plan covers modest usage | OpenRouter streaming from Worker = 30s CPU limit; summarization may hit wall-clock timeout |
| Built-in rate limiting / analytics | Rewriting Worker-compatible fetch pipeline (jsdom → native parsers) is significant |

**Verdict:** Promising for a *future* v2 rewrite, but too invasive for a phased migration. SQLite-in-D1 compatibility with libsql WAL mode is untested.

### 2.2 Option B: Fly.io (Docker-native, geographically distributed)

```
┌──────────────────────────────────────────────────────────┐
│  Fly.io Region(s)                                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │ App VM       │  │ LiteFS       │  │ Meilisearch  │   │
│  │ (Docker)     │  │ (SQLite repl)│  │ (Fly ext.)   │   │
│  └──────┬───────┘  └──────────────┘  └──────────────┘   │
│         │                                                │
│         ▼                                                │
│  ┌──────────────┐                                       │
│  │ Redis (Fly)  │  (rate-limit counters, session cache) │
│  └──────────────┘                                       │
└──────────────────────────────────────────────────────────┘
```

| Pros | Cons |
|---|---|
| Docker Compose → Fly `fly.toml` migration is well-documented | SQLite replication (LiteFS) adds ops complexity |
| Multi-region for low latency | LiteFS is single-writer; feed fetch concurrency needs careful design |
| Volume-based SQLite persists across deploys | Meilisearch on Fly adds ~$20/mo |
| Built-in load balancing, SSL, metrics | Cost scales faster with volume than serverless |

**Verdict:** Good middle ground. Keeps the current architecture mostly intact while gaining managed ops. Not truly multi-region for writes due to SQLite single-writer.

### 2.3 Option C: GCP Cloud Run + Cloud SQL (PostgreSQL) (Managed enterprise)

```
┌────────────────────────────────────────────────────────┐
│  GCP                                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │ Cloud Run    │  │ Cloud SQL    │  │ Cloud Memory │ │
│  │ (containers) │  │ (PostgreSQL) │  │ store (Redis)│ │
│  └──────┬───────┘  └──────────────┘  └──────────────┘ │
│         │                                              │
│         ▼                                              │
│  ┌──────────────┐  ┌──────────────┐                    │
│  │ Cloud Tasks  │  │ Secret Mgr   │                    │
│  │ (cron/jobs)  │  │              │                    │
│  └──────────────┘  └──────────────┘                    │
└────────────────────────────────────────────────────────┘
```

| Pros | Cons |
|---|---|
| Cloud SQL PostgreSQL scales well for multi-tenancy | Requires SQL dialect migration (SQLite → PostgreSQL) |
| Cloud Tasks = proper cron/queue, not in-process | GCP pricing opaque; egress, Cloud SQL connection overhead |
| Secret Manager for per-user API keys | Heaviest ops burden of the three; more services to configure |
| Cloud Run scales to zero (cost savings) | Cold-start latency for sporadic users |

**Verdict:** Overkill for a solo indie dev. The SQLite→PostgreSQL migration alone is weeks of work.

### 2.4 Option D: Managed VPS + Turso (libsql) (SQLite at scale)

```
┌──────────────────────────────────────────────────────────┐
│  VPS (Hetzner / DigitalOcean / GCP e2-small)             │
│  ┌──────────────┐                                        │
│  │ Node app     │                                        │
│  │ (Docker)     │                                        │
│  └──────┬───────┘                                        │
│         │                                                │
│         ▼                                                │
│  ┌──────────────┐  ┌──────────────┐                      │
│  │ Turso (libsql│  │ Meilisearch  │                      │
│  │  remote DB)  │  │ (Docker)     │                      │
│  └──────────────┘  └──────────────┘                      │
└──────────────────────────────────────────────────────────┘
```

| Pros | Cons |
|---|---|
| Turso = SQLite protocol, no SQL rewrite needed | Adds external DB dependency (loses "single file backup") |
| Turso has free tier (500 DBs, 500 MB each) | Enterprise pricing ($29/mo base) for high-volume |
| Edge replicas = low read latency globally | Feed fetch writes still centralize |
| Managed backups, branching, point-in-time recovery | Connection string + auth token adds complexity vs local file |

**Verdict:** Strongest candidate for Phase 1. Keeps SQLite semantics, adds managed durability, and Turso's per-DB model maps naturally to per-tenant isolation.

### 2.5 Option E: Keep Single-Node, Multi-Tenant SQLite (RPi staging → beefier VPS)

```
┌──────────────────────────────────────────────────────────┐
│  Single Host (RPi → 4-core VPS)                          │
│  ┌──────────────┐  ┌──────────────┐                      │
│  │ Node app     │  │ SQLite       │                      │
│  │ (Docker)     │  │ (multi-ten.) │                      │
│  └──────┬───────┘  └──────────────┘                      │
│         │                                                │
│         ▼                                                │
│  ┌──────────────┐  ┌──────────────┐                      │
│  │ Meilisearch  │  │ FlareSolv.   │                      │
│  │              │  │ + RSS Bridge │                      │
│  └──────────────┘  └──────────────┘                      │
└──────────────────────────────────────────────────────────┘
```

| Pros | Cons |
|---|---|
| Minimal code change | Single point of failure |
| Zero new service dependencies | Cannot scale horizontally |
| Lowest cloud bill | Manual backups remain |
| Perfect for dogfooding with ~5 users | SQLite contention under concurrent writes |

**Verdict:** Phase 0 only. Validate multi-tenancy model changes before investing in distributed infra.

### 2.6 Option Comparison Table

| Dimension | A CF Workers | B Fly.io | C GCP Cloud Run | D Turso | E Single-Node |
|---|---|---|---|---|---|
| **SQL changes** | Major (D1 limits) | None | Major (PG rewrite) | Minimal (libsql) | None |
| **Code rewrite** | Large (Worker env) | Small (LiteFS) | Medium (PG adapter) | Small (connection string) | Small (tenant scoping) |
| **Ops burden** | Very low | Medium | High | Low | High (self-managed) |
| **Monthly cost (small)** | ~$5 | ~$15 | ~$20 | ~$0-29 | ~$5-10 |
| **Monthly cost (1k users)** | ~$50-100 | ~$50-100 | ~$100-200 | ~$29-100 | ~$40-80 |
| **Horizontal scale** | Automatic | Via LiteFS (reads) | Automatic | Via Turso replicas | None |
| **Cold start** | None | ~1s | ~2-5s | App-level only | None |
| **Feed cron reliability** | Requires DO alarms | In-process (same as now) | Cloud Tasks (robust) | In-process (same as now) | In-process (same as now) |
| **Multi-region writes** | D1 is single-region | LiteFS single-writer | Cloud SQL regional | Turso primary single-region | Single host |
| **Best for** | v2 greenfield | Docker-native SaaS | Enterprise / team | Solo dev, SQLite lover | Dogfooding / prototyping |

---

## 3. Recommended Architecture: Phased Migration

### Phase 0: RPi Multi-User Dogfood (Now → 2 months)

**Goal:** Validate multi-tenancy data model, auth UX, and feed-fetch deduplication with ~3-5 real users on the existing RPi hardware.

#### 3.0.1 Data Model Changes

Add `user_id` columns to tenant-scoped tables. A new `tenants` table is **not** needed yet; `users` is the tenant boundary.

```sql
-- Migration: 0014_multi_tenancy_phase0.sql
ALTER TABLE categories ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1 REFERENCES users(id);
ALTER TABLE feeds ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1 REFERENCES users(id);
ALTER TABLE articles ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1 REFERENCES users(id);
ALTER TABLE conversations ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1 REFERENCES users(id);
ALTER TABLE settings ADD COLUMN user_id INTEGER REFERENCES users(id); -- NULL = global

-- Indexes for per-user queries
CREATE INDEX idx_feeds_user_id ON feeds(user_id);
CREATE INDEX idx_articles_user_id ON articles(user_id);
CREATE INDEX idx_categories_user_id ON categories(user_id);
CREATE INDEX idx_conversations_user_id ON conversations(user_id);

-- Existing single-user data gets user_id = 1 (the first admin user)
```

**Data isolation rules:**
- Every feed belongs to exactly one user (`feeds.user_id NOT NULL`)
- Articles inherit `user_id` from their feed at INSERT time
- Categories are per-user; the global/default category list is removed
- `settings` gains optional `user_id`; rows without `user_id` remain global (admin/system settings)

#### 3.0.2 Auth & Authorization

- Passkeys already support per-user auth; the `credentials` table should gain `user_id` to allow a user to have multiple passkeys
- JWT claims already include `email`; add `user_id` to the JWT payload
- `requireAuth` populates `request.authUserId` (numeric) alongside `request.authUser` (email)
- **All DB queries** must scope by `user_id`; audit every `db.prepare()` in `server/db/*.ts`

#### 3.0.3 Feed Fetch Deduplication (Critical)

**Problem:** 5 users subscribing to `https://news.ycombinator.com/rss` = 5 fetches every 5 minutes. Waste of bandwidth and rate-limit quota.

**Solution:** Introduce a `canonical_feeds` table (or reuse `feeds` with a `canonical_feed_id` self-reference):

```
feeds (user-scoped)
  └── canonical_feed_id → feeds.id (global/admin-managed canonical feed)
  
canonical_feed (or admin-owned feed with user_id = 0)
  └── RSS fetch writes articles into a "global pool" or per-user copies
```

**Preferred approach for Phase 0:**
1. Keep RSS fetching on the existing `feeds` table but add a `canonical_url` hash column
2. A feed deduplication service (simple in-memory cache or SQLite table `fetch_queue`) ensures only one HTTP request per unique RSS URL per sweep
3. Articles are still per-user (copied or referenced), preserving user isolation for `seen_at`, `read_at`, `bookmarked_at`, `liked_at`

```sql
-- New table: fetch_dedup
CREATE TABLE fetch_dedup (
  url_hash TEXT PRIMARY KEY,           -- SHA-256 of normalized RSS URL
  last_fetched_at TEXT,                -- ISO 8601
  etag TEXT,
  last_modified TEXT,
  next_check_at TEXT,
  check_interval INTEGER,
  xml_content TEXT                     -- Optional: cache parsed XML to avoid re-parse per user
);
```

On each sweep:
1. Build a queue of unique `url_hash` values from `feeds` where `next_check_at` is due
2. Fetch each unique URL once
3. For each feed referencing that URL, create/update its articles with `feed_id` and `user_id` populated

**Trade-off:** Articles are duplicated per-user (N users × M articles). For a modest user count this is fine. At scale, consider a shared article pool with a junction table for per-user state.

#### 3.0.4 LLM API Key Handling

| Approach | Pros | Cons | Phase 0 Decision |
|---|---|---|---|
| **A. User brings own key** | Zero marginal cost per user; aligns with AGPL ethos | Onboarding friction for non-technical users | ✅ Default |
| **B. Shared host key + metering** | Seamless UX | Host pays API bill; hard to bill fairly; key leakage risk | 🚫 Deferred |
| **C. Quota-based host key** | Simple UX for free tier; cap prevents runaway costs | Still requires host API key; quota logic to build | 🚫 Phase 1 |

Phase 0: Keep the existing per-user `api_key.openrouter` setting. Add UI validation that the key is set before enabling chat/summary/translate.

### Phase 1: Managed Hosting with Turso + VPS (2-6 months)

**Goal:** Migrate off the single-node SQLite file to Turso (libsql) for managed backups, better concurrency, and a path to horizontal read scaling.

#### 3.1.1 Database Migration

1. Create Turso organization + database
2. Replace `better-sqlite3` / `libsql` local file with `@libsql/client` remote connection
3. Turso supports SQLite WAL mode natively (it's built on libsql)
4. Keep in-process cron (node-cron); Turso handles concurrent reads well, but writes still serialize

#### 3.1.2 Deployment Target

| Service | Spec | Estimated Cost |
|---|---|---|
| VPS (Hetzner CX21 or GCP e2-small) | 2 vCPU, 4 GB RAM | $5-10/mo |
| Turso (Scaler plan) | 500 databases, 50 GB storage | $29/mo |
| Meilisearch (self-hosted on same VPS) | 1 GB RAM | included in VPS |
| Cloudflare Tunnels + R2 (image backup) | — | $0-5/mo |
| **Total** | | **$34-44/mo** |

#### 3.1.3 Architecture Diagram

```
┌──────────────────────────────────────────────────────────┐
│  User                                                      │
│     │                                                      │
│     ▼                                                      │
│  ┌──────────────┐                                          │
│  │ Cloudflare   │  (SSL + WAF + rate limit)                │
│  │ / VPS        │                                          │
│  └──────┬───────┘                                          │
│         │                                                  │
│  ┌──────┴───────┐                                          │
│  │  VPS Node    │  (Docker Compose)                        │
│  │  ┌────────┐  │                                          │
│  │  │ Node   │  │  ← Fastify API + SPA                     │
│  │  │ App    │  │                                          │
│  │  └───┬────┘  │                                          │
│  │      │       │                                          │
│  │  ┌───┴───┐   │                                          │
│  │  │Meili- │   │  ← Search index (Docker sidecar)         │
│  │  │search │   │                                          │
│  │  └───┬───┘   │                                          │
│  └──────┼───────┘                                          │
│         │                                                  │
│         ▼                                                  │
│  ┌──────────────┐                                          │
│  │ Turso        │  ← libsql remote DB (managed backups)    │
│  │ (libsql)     │                                          │
│  └──────────────┘                                          │
│                                                            │
│  ┌──────────────┐  ┌──────────────┐                        │
│  │ FlareSolverr │  │ RSS Bridge   │  (same host, Docker)   │
│  └──────────────┘  └──────────────┘                        │
└──────────────────────────────────────────────────────────┘
```

#### 3.1.4 What Changes in Code

- `server/db/connection.ts`: Swap `better-sqlite3` for `@libsql/client` HTTP client
- Migrations: Stream `.sql` files to Turso's HTTP batch endpoint instead of local `db.exec()`
- Cron: Keep `node-cron` in-process; test Turso write concurrency under feed-sweep load
- Environment: Add `TURSO_URL`, `TURSO_AUTH_TOKEN` (already referenced in `.env.example`)

### Phase 2: Horizontal Read Scaling & Queue (6-12 months, contingent)

**Goal:** If user count grows beyond what a single Node process + Turso primary can serve:

1. **Feed fetch extraction:** Move feed fetching from in-process cron to a separate worker container or queue (Turso has no native queue; use `bullmq` + Redis or Cloud Tasks)
2. **Read replicas:** Turso supports read replicas at edge locations; route API reads to the nearest replica
3. **Meilisearch cluster:** If search volume justifies it, move to Meilisearch Cloud or a dedicated instance
4. **CDN for SPA:** Serve static assets from Cloudflare Pages or R2

**Not needed until >100 active users.**

---

## 4. Multi-Tenancy Data Model

### 4.1 Proposed Schema Changes (from current → Phase 0)

| Table | Current | Phase 0 (Multi-Tenant) |
|---|---|---|
| `users` | `id`, `email`, `password_hash`, `token_version` | Unchanged |
| `credentials` | `id`, `credential_id`, `public_key`, ... | Add `user_id INTEGER NOT NULL REFERENCES users(id)` |
| `categories` | `id`, `name`, ... | Add `user_id INTEGER NOT NULL REFERENCES users(id)` |
| `feeds` | `id`, `name`, `url`, ... | Add `user_id INTEGER NOT NULL REFERENCES users(id)` |
| `articles` | `id`, `feed_id`, ... | Add `user_id INTEGER NOT NULL REFERENCES users(id)` |
| `conversations` | `id`, `article_id`, ... | Add `user_id INTEGER NOT NULL REFERENCES users(id)` |
| `chat_messages` | `id`, `conversation_id`, ... | Unchanged (isolated via `conversations.user_id`) |
| `settings` | `key`, `value` | Add `user_id INTEGER REFERENCES users(id)` (NULL = global) |
| `api_keys` | `id`, `name`, `key_hash`, ... | Add `user_id INTEGER NOT NULL REFERENCES users(id)` |
| `article_similarities` | `article_id`, `similar_to_id`, ... | **Decision needed:** per-user pool or global? |

### 4.2 New Table: `fetch_dedup`

```sql
CREATE TABLE fetch_dedup (
  url_hash TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  last_fetched_at TEXT,
  etag TEXT,
  last_modified TEXT,
  last_content_hash TEXT,
  next_check_at TEXT,
  check_interval INTEGER,
  error_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  disabled INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_fetch_dedup_next_check ON fetch_dedup(next_check_at);
CREATE INDEX idx_fetch_dedup_disabled ON fetch_dedup(disabled);
```

Feed sweeps query `fetch_dedup` instead of `feeds` for scheduling. `feeds` holds user-facing metadata (name, category, user_id); `fetch_dedup` holds the technical fetch state.

### 4.3 Shared vs Isolated Data

| Data | Isolation | Rationale |
|---|---|---|
| Feeds | Per-user | Users curate their own feed lists |
| Articles | Per-user | `seen_at`, `read_at`, `liked_at`, `bookmarked_at` are personal |
| Article content (full_text) | Deduplicated | The same URL's text is identical for all users; store once per URL, reference from per-user rows |
| Categories | Per-user | Personal organization |
| Conversations / Chat messages | Per-user | Private |
| Settings | Per-user + global | Personal preferences vs system defaults |
| API keys | Per-user | Security isolation |
| Search index (Meilisearch) | Per-user index? | Decision: shared index with `user_id` filter vs per-user index |

**Search index decision:** Use a single Meilisearch index with `user_id` as a filterable attribute. Meilisearch handles filtered queries efficiently. Per-user indices scale poorly (index overhead × N users).

---

## 5. AGPL Licensing Strategy

### 5.1 The Problem

Oksskolten is licensed under **AGPL-3.0** (see `LICENSE`). AGPL's key network-use clause (§13) requires that users interacting with the software over a network be offered the source code of the *modified* version running on the server.

This means:
- **Self-hosting for personal use:** Fully compliant. No distribution = no obligation.
- **Offering a hosted SaaS to others (even non-commercially):** The hosted instance is a "distribution" under AGPL. Every user must be able to download the complete, corresponding source code of the running version. **Commercial SaaS charging money is still AGPL-covered** and requires source availability.

### 5.2 Options (No External Contact Permitted)

| Option | Description | Feasibility | Recommendation |
|---|---|---|---|
| **A. AGPL-Compliant Free Hosting** | Host as a free service, provide source download link, keep everything AGPL | **Fully feasible** | **Phase 0 default** |
| **B. Dual-License Negotiation** | Request upstream (babarot/oksskolten) to dual-license or grant a commercial exception | Requires contacting author | **Phase 1 consideration** (author may decline) |
| **C. Rewrite (Clean-Room)** | Reimplement feed fetching, DB layer, and UI from scratch; keep only conceptual inspiration | 6-12 months full-time | **Not recommended** unless Option B fails and revenue justifies it |
| **D. SaaS Wrapper (Frowned Upon)** | Keep core AGPL, build proprietary admin/billing/dashboard around it | Legally risky; AGPL "creeps" to wrapper if tightly coupled | **Avoid** |
| **E. Donation / Tip Model** | Keep AGPL, accept voluntary payments (Ko-fi, GitHub Sponsors) | No licensing friction | **Always viable** |

### 5.3 Recommended Licensing Path

1. **Phase 0 (RPi dogfood):** Pure AGPL. Share with friends; source is on GitHub. No commercial intent.
2. **Phase 1 (managed hosting):** Continue AGPL. Provide prominent "Source Code" link in footer. Consider:
   - "Sponsor" or "Tip" button (no license change needed)
   - "Premium features" must also be AGPL-licensed and source-available
3. **Future (if revenue > $1k/mo desired):** Contact upstream author with a polite request for dual-licensing or a commercial exception. Be prepared for "no." If "no," evaluate whether a clean-room rewrite is worth the engineering investment.

**Important:** Do NOT contact anyone external until the project has proven product-market fit and revenue warrants the conversation.

---

## 6. Rough Cost Estimates

### 6.1 Phase 0: RPi Dogfood

| Item | Cost | Notes |
|---|---|---|
| RPi hardware | $0 (already owned) | Power + SD card wear negligible |
| Domain (rss.pco2699.xyz) | ~$12/year | Already owned |
| Cloudflare Tunnel | $0 | Free tier |
| **Monthly** | **~$1** | |

### 6.2 Phase 1: Turso + VPS (~50-200 users)

| Item | Cost | Notes |
|---|---|---|
| Hetzner CX21 (2 vCPU, 4 GB) | $5.35/mo | Or GCP e2-small ~$13/mo |
| Turso Scaler | $29/mo | 500 DBs, 50 GB |
| Meilisearch (self-hosted) | $0 | On same VPS |
| Cloudflare R2 (image backup) | ~$2/mo | 50 GB egress |
| Domain + DNS | ~$1/mo | |
| **Total Monthly** | **~$37-45/mo** | |
| **Per-user cost** | **~$0.20-0.90/mo** | At 50-200 users |

### 6.3 Revenue Model Scenarios

| Users | Hosting Cost | Price/User | Monthly Revenue | Margin |
|---|---|---|---|---|
| 50 (free/tips only) | $40 | $0 | $0-50 (tips) | ❌ |
| 100 @ $3/mo | $40 | $3 | $300 | $260 (87%) |
| 500 @ $3/mo | $80 (beefier VPS) | $3 | $1,500 | $1,420 (95%) |
| 1000 @ $3/mo | $150 (multi-node) | $3 | $3,000 | $2,850 (95%) |

**Note:** These margins assume users bring their own OpenRouter API key (Option A). If providing shared LLM access, API costs dominate (~$0.01-0.10 per chat turn) and necessitate usage-based billing or much higher prices.

### 6.4 LLM Cost Sensitivity

| Feature | Avg tokens | Cost/req @ $0.20/M in, $0.60/M out | Usage/user/day | Monthly/user |
|---|---|---|---|---|
| Summarize | 4k in, 500 out | $0.0011 | 5 articles | ~$0.17 |
| Translate | 4k in, 4k out | $0.0032 | 2 articles | ~$0.19 |
| Chat | 8k in, 2k out | $0.0028 | 10 turns | ~$0.84 |
| **Total** | | | | **~$1.20/mo/user** |

At 1,000 users with host-provided LLM: **~$1,200/mo in API costs alone**. This is why "user brings own key" is the default.

---

## 7. Billing & Rate Limits

### 7.1 Stripe Integration (Phase 1)

| Component | Approach |
|---|---|
| **Billing model** | Flat monthly fee ($3-5/mo) OR "free + tip" (AGPL-friendly) |
| **Metered billing** | Defer until host-provided LLM (Option B/C) is implemented |
| **Stripe elements** | Checkout Session for signup, Customer Portal for management |
| **Webhook** | `invoice.paid` → activate account; `invoice.payment_failed` → grace period → deactivate |
| **Subscription state** | Add `users.subscription_status` enum: `inactive`, `active`, `past_due`, `cancelled` |

### 7.2 Rate Limiting

Current: `@fastify/rate-limit` with global limits.

Phase 1: Per-user tiered limits.

```typescript
// server/lib/rateLimits.ts
interface RateLimitTier {
  name: 'free' | 'basic'
  feedsMax: number          // e.g., 50 feeds
  articlesPerDay: number    // e.g., 500 fetches/day (affects deduped fetches, not user-visible)
  chatPerDay: number        // e.g., 50 chat turns/day
  summarizePerDay: number   // e.g., 20 summaries/day
  apiCallsPerMinute: number // HTTP API rate limit
}
```

Implementation: Redis or in-memory store keyed by `user_id` + endpoint category.

---

## 8. Open Questions

| # | Question | Priority | Phase |
|---|---|---|---|
| 1 | Should we keep `users` as the tenant boundary, or introduce a formal `tenants` table for future team/organization support? | Medium | Phase 0 |
| 2 | How to handle Meilisearch index rebuilds when adding `user_id` filterable attribute? Rebuild time for 50k articles? | High | Phase 0 |
| 3 | Is `fetch_dedup` caching XML content worth the storage vs re-parsing per user? | Medium | Phase 0 |
| 4 | Should per-user article deduplication (shared content pool) happen in Phase 0 or Phase 1? | Medium | Phase 1 |
| 5 | Do we need a separate worker process for feed fetching before moving to Turso (to reduce write contention)? | Low | Phase 1 |
| 6 | How to handle image archival (`images_archived_at`) in a multi-tenancy context? Per-user S3/R2 prefixes? | Medium | Phase 1 |
| 7 | MCP server (`/mcp` endpoint) currently assumes single-user DB. How does per-user MCP auth work with API keys? | High | Phase 0 |
| 8 | Passkey/WebAuthn `rpID` is currently derived from request headers. For a custom domain per user? | Low | Phase 1 |
| 9 | Should we implement invitation-only signup (admin creates accounts) or open registration for SaaS? | Medium | Phase 0 |
| 10 | What is the exact Turso latency from a VPS in ? How does it affect feed-sweep performance? | High | Phase 1 |
| 11 | Upstream (babarot/oksskolten) release cadence: how painful will rebasing feature branches be? | Medium | Ongoing |
| 12 | GDPR/CCPA implications for a solo-hosted SaaS with EU/US users. Privacy policy requirement? | Medium | Phase 1 |

---

## 9. Immediate Next Steps (Post-PR Merge)

1. **Create tracking issue** for Phase 0: "Implement multi-tenant data model (user_id scoping)"
2. **Audit all SQL queries** in `server/db/*.ts` for `user_id` injection points
3. **Design `fetch_dedup` table** and refactor `fetcher.ts` to use it
4. **Update auth middleware** to return numeric `user_id` alongside `email`
5. **Test RPi deployment** with 3 volunteer users (friends/family)
6. **Document onboarding flow** (signup → add first feed → configure OpenRouter key)
7. **Monitor sqlite WAL growth** under concurrent multi-user writes

---

*This document is a living plan. Update as constraints, costs, or licensing realities change.*
