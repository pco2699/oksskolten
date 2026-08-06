# ADR-003: Normalize article URLs on write

## Status

Accepted

## Context

`articles.url` is the identity of an article: it carries a UNIQUE constraint, it
is how the fetcher decides whether an item is new, and it is how the frontend
looks an article up when opening the detail page.

Two sides of that identity disagreed. `insertArticle()` stored whatever string
the feed provided, while both read paths normalized before comparing:

- `getArticleByUrl()` queried `WHERE a.url = normalizeUrl(input)`
- `getExistingArticleUrls()` matched against `urls.map(normalizeUrl)`

`normalizeUrl` is `new URL(raw).href`, which rewrites more than percent-encoding:
it appends a root `/` to a bare origin, lowercases the host, and drops default
ports. For any feed item whose URL was not already in that exact form, the
stored row was invisible to both lookups:

- The fetcher treated the article as new on every run, re-downloaded it, and ran
  Readability over it again. The subsequent `INSERT` failed on the UNIQUE
  constraint, and that failure was swallowed as an expected duplicate — so the
  loop was silent, costing bandwidth and origin requests every five minutes.
- `/api/articles/by-url` returned 404, so the article could not be opened at all.

A third instance of the same mismatch sat in the fetcher, which filtered with
`existing.has(item.url)` (raw) against a set of normalized keys.

Three options were considered:

1. **Normalize on read only** — make lookups try both raw and normalized forms.
   Keeps the write path untouched, but every future read path has to remember
   the dual lookup, and the fetcher's set-membership check still needs its own fix.
2. **Drop normalization entirely** — compare raw strings everywhere. Loses the
   dedup that normalization was added for (the same article arriving
   percent-encoded from one feed and raw from another).
3. **Normalize on write** — store the canonical form, so a single comparison works.

## Decision

**Normalize on write.** `insertArticle()` stores `normalizeUrl(data.url)`, making
the normalized form the canonical representation in the database.

Two supporting changes fall out of it:

- `getExistingArticleUrls()` returns a set keyed by the **caller's** URL strings
  rather than their normalized forms, so `existing.has(item.url)` works on raw
  feed input. Returning normalized keys is what made the fetcher's filter a
  silent no-op.
- Rows written before this invariant existed are repaired by
  `backfillNormalizedArticleUrls()`, run once via `runDataMigration()` at
  startup. It cannot be a `.sql` migration because it needs the WHATWG URL
  parser. Where normalizing would collide with an existing row, the lower id
  wins and the duplicate is deleted from SQLite and the search index.

## Consequences

### Benefits

- One comparison rule; read paths do not need to know about encoding variants
- The re-fetch loop stops, removing repeated origin requests and Readability runs
  for affected articles
- Articles whose URLs were not canonical become reachable in the UI again
- New read paths get the correct behavior by default instead of having to
  remember a dual lookup

### Drawbacks

- Requires a one-time data migration that rewrites rows and can delete duplicates.
  It is idempotent and recorded in `_migrations`, but it is a destructive-by-design
  step on first boot after upgrade
- Stored URLs may differ cosmetically from the feed's original string (percent-encoded
  paths, appended root slash). This is display-visible only where the raw URL is
  echoed back
- `normalizeUrl` is now load-bearing on the write path: changing its behavior later
  would require another backfill to keep old and new rows comparable
