# Oksskolten Spec — Recommendation

> [Back to Overview](./01_overview.md)

## Overview

Behaviour-based recommendation for articles the user has **not** interacted with yet. Step 0 (implemented) measures how the existing engagement score is distributed today; the later steps sketch how embeddings would fill the gap that measurement exposes.

## Motivation

The engagement score ([91_perf_score_recalculation.md](./91_perf_score_recalculation.md)) is defined as:

```
score = engagement × decay

engagement = (liked_at ? 10 : 0)
           + (bookmarked_at ? 5 : 0)
           + (full_text_translated ? 3 : 0)
           + (read_at ? 2 : 0)

decay = 1.0 / (1.0 + days_since_activity × 0.05)
```

All four engagement terms describe what the user already did to that specific article. An article nobody has touched has `engagement = 0`, therefore `score = 0` — by definition, not by accident. The score is retrospective: it re-ranks history. It cannot answer "of the 300 articles that arrived today, which are worth reading", because every one of them scores the same.

Filling that gap means introducing something the repository does not currently have — embeddings, vector similarity, and a ranking derived from them. Recommendation quality has no ground truth, so there is no way to tell afterwards whether such a change helped unless the distribution before the change was recorded. That measurement is Step 0, and it is deliberately the only part implemented so far.

## Scope

Implemented:

- Step 0 — a read-only measurement of the current score distribution, exposed as a library function and a CLI report.

Not implemented (direction only, see Design):

- Steps 1–3 — embedding storage, preference representation, and score normalization.

Step 0 changes no scoring behaviour. The score formula is untouched; `server/db/articles.ts` was refactored only to expose the existing SQL fragments (`engagementExpr`, `decayExpr`, `daysSinceActivityExpr`, `scoreExpr`) so the measurement observes the real formula instead of a copy that could drift from it.

## Design

### Step 0 — Baseline measurement

`collectScoreBaseline()` in `server/db/score-stats.ts` returns a `ScoreBaseline` snapshot. Every query reads through the `active_articles` view and writes nothing, so it is safe to run against a database the server holds open.

The snapshot answers three questions:

| Question | Fields |
|---|---|
| How much of the corpus can the score not rank at all? | `corpus`, `score.zero`, `score.zero_share`, `engagement[]` |
| How much spread does decay actually produce among the rest? | `score.nonzero_distribution`, `days_since_activity`, `decay` |
| How stale is the stored `score` column? | `drift` |

Details worth noting:

- **Percentiles use nearest-rank**, not interpolation (`index = floor((n - 1) × p) + 1`). The report is read as "the article at this rank scores X"; an interpolated value would name a score no article actually holds.
- **`score.unengaged_nonzero`** counts articles with `engagement = 0` that still carry a positive stored score. These are rows whose engagement was removed but whose score the recalculation cron has not yet refreshed — the population that `SCORED_ARTICLES_WHERE`'s `score > 0` arm keeps alive forever.
- **`candidate_windows`** measures the trailing 24h / 7d / 30d sets. A future ranker sorts within a window like these, so `zero_score_share` and `distinct_scores` show directly how many articles the current score leaves mutually indistinguishable.
- **`drift`** compares the stored `score` column against a freshly evaluated `scoreExpr()` over the same set the recalculation cron updates. It quantifies what `SCORE_RECALC_SCHEDULE` costs in accuracy — the input for deciding whether a daily schedule is acceptable.

### Step 0 — CLI

```bash
npm run score:baseline                        # human-readable report
npm run score:baseline -- --json              # JSON to stdout
npm run score:baseline -- --out baseline.json # JSON to a file
```

Save the JSON before making any scoring change and keep it; a later run diffs against it (`jq`, `git diff`). Without a stored snapshot the comparison is impossible after the fact.

### Step 1 — Hold embeddings (direction)

**Decision: store vectors in SQLite, using libsql's native vector types. Do not put them in Meilisearch.**

The deciding argument is not performance — it is which store owns the data. `rebuildSearchIndex()` runs on `0 */6 * * *` (`server/index.ts`): it deletes the staging index, repopulates it entirely from SQLite via `buildMeiliDoc()`, swaps, and deletes the old index. Meilisearch is a **derived, disposable** index in this project, rebuilt from scratch four times a day. Embeddings are the opposite: paid source data, one API call per article, unrecoverable except by paying again. Data that costs money to produce belongs in the system of record.

That plays out concretely for each embedder source:

| Meilisearch embedder source | What a 6-hourly rebuild costs |
|---|---|
| `openAi` / `rest` (auto-embedding) | Re-embeds the entire archive on every rebuild — recurring API spend. Also needs its own API key at container level, outside the BYOK settings UI |
| `userProvided` | No re-embedding, but only because SQLite must already hold every vector to re-send it. Meilisearch then holds a redundant second copy |

Either way SQLite ends up owning the vectors, so it may as well be the only store.

**libsql already has vector support built in** — no new dependency, no extension:

- Column types `F32_BLOB(n)` / `F16_BLOB(n)` / `F8_BLOB(n)`, constructors `vector32()` / `vector16()` / `vector8()`, and `vector_distance_cos()`.
- Verified working through the project's own `getDb()` and migration path, including `ON DELETE CASCADE` cleanup when retention purges an article.
- Because this is core libsql rather than a loadable extension, it is also available when `DATABASE_URL` points at Turso — which `sqlite-vec` would not be.

**Use a brute-force scan; do not build the ANN index.** Measured on this driver at 1536 dimensions:

| Vectors | `F32_BLOB` scan | `F8_BLOB` scan | Pure-JS `Float32Array` |
|---|---|---|---|
| 2,000 | 13.6 ms | 5.6 ms | 16.8 ms |
| 10,000 | 63.2 ms | 25.0 ms | 54.4 ms |

A full scan in SQL is as fast as the equivalent JS loop without keeping 60 MB of vectors resident. `F16_BLOB` is consistently *slower* than `F32_BLOB` (127 ms at 10k) and should be skipped; `F8_BLOB` is ~2.5× faster and 4× smaller (1,547 vs 6,144 bytes per vector) at the cost of quantization error.

`libsql_vector_idx()` / `vector_top_k()` measured badly at this scale: building the index over 2,000 vectors took 176 s and grew the database to 658 MB, and the resulting query (43 ms) was slower than the 13 ms full scan it replaced. Random unit vectors are the worst case for a DiskANN-style index and real embeddings cluster better, but nothing about that changes the build cost or the file size. At this corpus size the index is a liability.

Storage is 6 KB per article at `F32_BLOB` — 60 MB per 10k articles, in a separate `article_embeddings` table so the `articles` row and the `active_articles` view stay unchanged.

Whichever store is used, **L2-normalize explicitly on write**. Providers do not guarantee unit vectors, and a dot product over non-normalized vectors is not cosine similarity. A few lines at write time removes a whole class of provider-dependent breakage.

Full-text extraction (Readability) already exists, so embeddings can run over article bodies rather than feed summaries. Embedding cost is one call per article, incurred once.

Meilisearch keeps its current role — keyword and filtered search. Its vector store stopped being experimental in v1.13 (the pinned version), so it remains available later as an optional accelerator, populated from SQLite via `userProvided`. That is the correct dependency direction, and it is a decision that can be deferred until brute force actually stops being fast enough.

### Steps 2–3 — Ranking (direction)

**Step 2: no centroid.** A single mean vector over all liked articles points somewhere that resembles none of a multi-modal interest set. Use k-NN instead: an article's affinity is its similarity to the most similar article the user previously engaged with. No cluster count to tune, multiple interests handled naturally, and the existing engagement weights (like 10 / bookmark 5 / …) carry over directly as neighbour weights.

Compute affinity **at ingest, not at query time**. The whole join — 10k candidates × 200 engaged articles, 2M distance computations in one statement — takes 9.8 s, which is a batch job, not a request. Scoring one newly fetched article against the same 200 engaged vectors takes 1.44 ms, so the natural place is the fire-and-forget hook that already runs after `insertArticle()` alongside `detectAndStoreSimilarArticles()`. The batch form is still needed, but only to backfill and to re-score after the engaged set changes materially.

**Step 3: rank, not magnitude.** Do not map raw cosine similarity onto 0–100. Cosine similarity between text embeddings occupies a narrow band, so a linear mapping wastes most of the output range and collapses everything near the middle. Convert to a percentile within the candidate set instead. That also answers the question the user actually has — "is this near the top of today's batch?"

### Open questions

1. **Candidate set definition.** Today's unread, the last 7 days, or per-feed. Step 3's percentile depends entirely on this choice; `candidate_windows` in the Step 0 snapshot exists to inform it.
2. **Negative signal.** There is no dislike action. Whether "marked seen without opening" should count as a weak negative is undecided.
3. **Embedding model and cost.** One call per article, across the whole archive.
4. **Presentation.** Blended into the existing search ranking, or a separate view.

### Key Files

| File | Description |
|---|---|
| `server/db/score-stats.ts` | Read-only baseline measurement (`collectScoreBaseline`) |
| `server/db/score-stats.test.ts` | Tests for the measurement queries |
| `scripts/score-baseline.ts` | CLI that renders or exports the snapshot |
| `server/db/articles.ts` | Score SQL fragments (`engagementExpr`, `decayExpr`, `scoreExpr`) |
