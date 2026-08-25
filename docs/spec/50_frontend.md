# Oksskolten Spec — Frontend

> [Back to Overview](./01_overview.md)

## Frontend

### Route Definitions

```
/                              → Redirect to /all
/all                           → All feeds, aggregated (same unread-only toggle as feed and category views)
/inbox                         → Redirect to /all (legacy bookmarks/PWA shortcuts)
/bookmarks                     → Bookmarked articles list
/likes                         → Liked articles list
/history                       → Read articles list (read_at IS NOT NULL)
/clips                         → Clipped articles list
/feeds/:feedId                 → Articles by feed (clip feeds also use this route)
/categories/:categoryId        → Articles by category
/settings                      → Redirect to /settings/general
/settings/:tab                 → Settings page (general / appearance / ai / security / plugins / viewer / about)
/chat                          → Chat page (new conversation)
/chat/:conversationId          → Chat page (conversation detail)
/*                             → Article detail (catch-all, original article URL with scheme removed)
```

The display URL for an article is the original article URL with the scheme removed:
```
https://blog.cloudflare.com/new-features-2025
→ /blog.cloudflare.com/new-features-2025
```

The frontend prepends `https://` to the splat path to reconstruct the original article URL, then fetches the article data via `GET /api/articles/by-url?url=...`.

Paths ending with `.md` are treated as Markdown source view pages (`ArticleRawPage`).


### Command Palette & Keyboard Shortcuts

The command palette (`Cmd+K`) provides unified access to navigation, actions, feeds, and appearance settings. It uses `cmdk` (shadcn/ui `CommandDialog`).

| Shortcut | Action |
|---|---|
| `Cmd+K` | Open command palette |
| `Cmd+Shift+K` | Open article search |
| `Cmd+N` | Add new feed |
| `Cmd+,` | Open settings |
| `Cmd+1`–`5` | Navigate to All / Bookmarks / Likes / History / Chat |

Command palette groups:
- **Navigation** — All, Bookmarks, Likes, History, Chat, Settings
- **Actions** — Search articles, Add feed, Import/Export OPML
- **Feeds** — Dynamic list from SWR, shown only when search input is non-empty (clip feeds excluded)
- **Appearance** — Theme, layout, and color mode switching

All items include English `keywords` for cross-language matching (e.g., typing "chat" matches the localized label in Japanese locale).

Global shortcuts are managed by `useGlobalShortcuts` hook in `src/hooks/use-global-shortcuts.ts` and registered in `FeedList`.


### Data Fetching

| Item | Approach |
|---|---|
| Library | SWR |
| Pagination | Infinite scroll (`useSWRInfinite`, `limit=20` per page) |
| Unread-only filter | A toggle above the article list, shown on feed, category and All views. Backed by the `reading.category_unread_only` preference, so the choice persists and is also editable in Settings → Reading. While it is on, every page of the view sends the same `unread_since` anchor so paging does not skip articles as they get marked read (see [API spec](./20_api.md)) |
| Display range limit | Smart Floor — For feed/category views, adopts whichever range contains the most articles among three candidates: "last 1 week", "latest 20 articles", and "up to the oldest unread". Skipped if fewer than 20 articles exist. Not applied to All/Bookmarks/Likes/History/Clips |
| Show older articles | When Smart Floor hides articles, a "show older articles (N)" button appears at the end of the list. Clicking it re-fetches with `no_floor=1` to show all articles |
| Scroll stop condition | Stops when response `has_more === false` |
| Loading | Skeleton UI |
| Error | Inline message + retry button |
| Empty state | "No articles" (centered with `text-muted`) |

**Fetch completion toast**: Displays results via `sonner` toast upon completion of manual fetch (refresh button / right-click → Fetch) and pull-to-refresh (individual feed pages only).

| Condition | Toast |
|---|---|
| New articles found | `Fetched {count} new article(s)` (success) |
| No new articles | `No new articles` (default) |
| Error | `Fetch failed` (error) |

Pull-to-refresh calls `startFeedFetch(feedId)` on individual feed pages to fetch from the RSS source. On aggregate pages (All, etc.), it only performs SWR `mutate()` as before.

**Fetch progress sharing**: The `useFetchProgress` hook is shared via `FetchProgressContext`, allowing the sidebar and article list to reference the same progress state.

**Cache invalidation**: After mutations, related caches are revalidated using `mutate()`.

| Operation | Revalidation target |
|---|---|
| Add feed (`POST /api/feeds`) | `/api/feeds` |
| Delete feed (`DELETE /api/feeds/:id`) | `/api/feeds`, `/api/articles` |
| Update feed (`PATCH /api/feeds/:id`) | `/api/feeds` |
| Seen/read update (`PATCH .../seen`, `POST .../read`) | `/api/feeds` (to update unread_count) |

Revalidating `/api/feeds` only works while something is subscribed to that key. On the article **page** route the sidebar is unmounted, so a read marked from there has no revalidator to run and the cached counts would stay stale (the global config sets `revalidateIfStale: false`). Two things cover that: `adjustFeedUnread()` in `src/lib/feedCounts.ts` writes the ±1 straight into the cached feed list, and `FeedList` subscribes with `revalidateOnMount: true` so the server value is refetched as soon as the sidebar comes back.


### Sidebar Feed Filtering

The sidebar feed list can hide feeds that have nothing left to read.

| Item | Detail |
|---|---|
| Preference | `reading.hide_zero_unread_feeds` (on/off, **default: on**), editable in Settings → Reading |
| Effect when on | A feed whose `unread_count` is 0 is not rendered in the sidebar feed list |
| Exception — selected feed | The feed matching the `/feeds/:feedId` route stays visible even at 0 unread, so reading the last unread article does not pull the entry out from under the reader. It drops out on the next navigation |
| Exception — disabled feeds | Disabled feeds always stay visible; they carry no unread count and hiding them would leave no way to re-enable or delete them |
| Categories | Category rows are never hidden, even when all of their feeds are. They stay navigable and remain valid drag-and-drop targets |
| Unaffected | Unread totals (All badge, category badges), category actions (Fetch, Mark All Read), drag and drop, multi-select and bulk actions all still operate on the full feed list — fetching a category must reach the fully-read feeds too. The clip feed nav entry is looked up in the unfiltered list |

The filter is pure and lives in `src/lib/feedVisibility.ts` (`isFeedVisible` / `filterVisibleFeeds`). `FeedList` groups the complete feed list by category first and hands that grouping to `useFeedActions`, then narrows a second copy for rendering only.

### Feed Metrics

Displays update frequency and activity level for feeds.

**Sidebar (Inactive indicator)**
- When `showFeedActivity === 'on'` and the feed is inactive, an `inactive` label is shown next to the feed name
- Inactive criteria: `latest_published_at` is more than 90 days ago, or the feed has articles but `latest_published_at` is null
- This is a separate concept from `disabled` (automatic deactivation due to fetch errors)
- Display controlled by setting `reading.show_feed_activity` (on/off, default: on)

**Metrics bar (below article list header)**
- Shown only on individual feed views (`/feeds/:feedId`). Hidden on All and category views
- Displayed items: total article count, update frequency (X.X/wk), last updated (relative time), average article length
- Lightweight data (article count, update frequency, last updated) is obtained from the `/api/feeds` SWR cache
- Heavy data (average article length) is fetched on demand from `/api/feeds/:id/metrics`
- Not displayed for clip feeds

### Markdown Rendering

All Markdown-to-HTML rendering goes through `renderMarkdown()` in `src/lib/markdown.ts`. This function applies a preprocessing pipeline before passing the result to `marked` (GFM mode, with `highlight.js` syntax highlighting).

**Pipeline architecture**

```
renderMarkdown(md, [optional preprocessors])
  → [...optional, ...default] preprocessors (reduce)
  → markedInstance.parse()
```

Each preprocessor is a pure function `(md: string) => string`. The pipeline runs optional (caller-specified) preprocessors first, then the default pipeline.

| Preprocessor | Pipeline | Description |
|---|---|---|
| `fixLegacyMarkdown` | Default | Repairs malformed HTML in articles stored before server-side normalization (e.g. `<picture>` → `![](src)`, multi-line link collapsing) |
| `escapeNestedBrackets` | Default | Escapes `[` `]` inside link text so titles like `[AINews] Title` render correctly |
| `rewriteLinksToAppPaths` | Optional (chat) | Rewrites external URLs in links to in-app paths |

**Usage by context**

| Context | Call | Files |
|---|---|---|
| Article body | `renderMarkdown(md)` | `article-detail.tsx` |
| Article summary | `renderMarkdown(summary)` | `use-summarize.ts` |
| Translation preview | `renderMarkdown(text)` | `use-streaming-ai.ts` |
| Chat messages | `renderMarkdown(md, [rewriteLinksToAppPaths])` | `chat-message-bubble.tsx` |

**Shared utilities**

`walkLinks(s, visitor)` provides bracket-aware markdown link scanning (handles nested brackets, skips image links). Used by both `escapeNestedBrackets` and `rewriteLinksToAppPaths` to avoid duplicated link-parsing logic.

**Implementation files**
- `src/lib/markdown.ts` — `renderMarkdown`, `walkLinks`, preprocessors, `markedInstance`


### YouTube Video Embed

Some subscribed feeds are RSS proxies over YouTube channels (e.g. `yt.chocolatemoo53.com/watch?v=<id>`), whose articles the fetcher cannot scrape — `full_text` ends up as unusable placeholder text. When the article's original URL identifies a YouTube video, `ArticleDetail` renders an embedded player instead of relying on the scraped content.

- `extractYouTubeVideoId(url)` (`src/lib/youtube.ts`) extracts the 11-character video ID from `article.url`, or returns `null`
  - Canonical hosts (`youtube.com`, `www.youtube.com`, `m.youtube.com`, `music.youtube.com`, `youtu.be`): recognizes `/watch?v=`, `/shorts/:id`, `/embed/:id`, `/live/:id`
  - Any other host: only `/watch?v=` is recognized (proxy/invidious-style mirrors), to limit false positives
- `YouTubeEmbed` (`src/components/article/youtube-embed.tsx`) renders a responsive 16:9 `<iframe>` pointed at `youtube-nocookie.com`, as a real React element — not injected through the Markdown/sanitize pipeline, since `sanitizeHtml` intentionally strips iframes
- Rendered in `ArticleDetail` right after the summary section, above the scraped `full_text` body (which may still contain a usable description)
- The server's `Content-Security-Policy` (`server/index.ts`) allows framing via `frame-src https://www.youtube-nocookie.com`
- Extracting video transcripts for AI features (summarize/chat) is out of scope for this feature

### Article List Display Layouts

Four layout options are available for the article list. Independent from the theme (color), allowing free combination.

| Layout | Key | Description |
|---|---|---|
| List | `list` | Classic single-column list. Shows excerpt, domain, and thumbnail. Default |
| Card | `card` | 2-column grid. Large thumbnail (aspect-video) placed at the top. Visual-oriented |
| Magazine | `magazine` | Mixed layout with the first article as a hero (large card) and the rest as smaller cards |
| Compact | `compact` | High-density list with title and date only. No thumbnails |

- Setting key: `appearance.list_layout` (allowed values: `list` / `card` / `magazine` / `compact`)
- Settings page: Selectable with preview in the layout section of `/settings/appearance`
- Persistence: `localStorage` (instant reflection) + DB sync (500ms debounced PATCH)
- Layout definitions: `src/data/layouts.ts`
- Hook: `src/hooks/useLayout.ts` (based on `createLocalStorageHook`)
- Skeleton UI: Dedicated skeletons corresponding to each layout

### Reading Overlay Width

When `articleOpenMode` is `overlay`, `ArticleOverlay` slides a reading panel in from the right. Below the `md` breakpoint the panel is full width. Above it, the panel's left edge is `var(--article-overlay-left)` (`src/index.css`):

```css
--article-overlay-left: max(3rem, calc(100% - 1200px));
```

The panel is therefore capped at 1200px and the peek strip absorbs any extra viewport width. A fixed 3rem strip is fine on laptop widths, but on a 4K display it buried the sidebar and article list behind a panel whose own content column is only ~850px wide.

| Viewport | Peek strip | Panel |
|---|---|---|
| 800px | 48px | 752px |
| 1440px | 240px | 1200px |
| 1920px | 720px | 1200px |
| 3840px | 2640px | 1200px |

### Mobile Gestures

Touch gestures below the `md` breakpoint. All of them are no-ops for mouse/keyboard users.

| Gesture | Where | Behavior |
|---|---|---|
| Swipe right | Anywhere on a list page | Opens the sidebar drawer (`useSwipeDrawer`) |
| Swipe left | Sidebar drawer open | Closes the drawer via `history.back()` |
| Swipe left | Article card | Opens the article (`SwipeableArticleCard`) |
| Swipe left / right | Article overlay panel | Closes the overlay (`useSwipeDismiss`) |
| Back gesture / back button | Sidebar drawer or article overlay open | Dismisses that layer instead of navigating the page behind it away |

#### History-Backed Dismissal

In-app layers that visually behave like a page (sidebar drawer, `ArticleOverlay`) are pure React state, so a back gesture would otherwise navigate the underlying route away while leaving the layer on screen.

`useHistoryDismiss` (`src/hooks/use-history-dismiss.ts`) fixes that: it pushes a marker history entry (`history.pushState({ [stateKey]: true }, '')`) while the layer is open, dismisses the layer on `popstate`, and pops the entry back off when the layer is closed by other means (close button, Escape, swipe) so the stack stays balanced and back never has to be pressed twice. `ArticleOverlay` uses the `article-overlay` key; the drawer keeps its own equivalent handling in `useSwipeDrawer` under the `drawer-open` key.

Because `popstate` is a global event, every layer hears every pop. `useSwipeDrawer` therefore only closes the drawer when the pop was actually its own:

- Above the `md` breakpoint the sidebar is a layout element and never pushes an entry, so a pop is never the drawer's — the sidebar stays open when an overlay above it is dismissed.
- Below the breakpoint, a still-present `drawer-open` marker in `history.state` means a layer stacked above the drawer popped its own entry, so the drawer stays open.

#### Gesture Precedence

`useSwipeDrawer` listens on `document`, so it would otherwise also react to swipes made inside a modal layered above the page. It ignores any swipe while an open Radix dialog (`[role="dialog"][data-state="open"]`, including `alertdialog`) is present, leaving those gestures to the topmost layer.

`useSwipeDismiss` (`src/hooks/use-swipe-dismiss.ts`) requires ≥60px of horizontal travel dominating vertical travel by 1.5×, ignores multi-touch (pinch zoom), and ignores gestures that start inside a horizontally scrollable descendant (wide code blocks, tables) so scrolling that content never closes the panel.

### PWA Support

Progressive Web App support via `vite-plugin-pwa`.

| Item | Configuration |
|---|---|
| Registration method | `autoUpdate` |
| Display mode | `standalone` |
| Start URL | `/all` |
| App ID | `/all` (explicit, so a later `start_url` change does not read as a different app) |
| Related applications | The manifest lists itself (`platform: webapp`) so `navigator.getInstalledRelatedApps()` can report the PWA as installed |
| Cache strategy (Favicon) | CacheFirst (30 days) |
| Cache strategy (Article detail API) | StaleWhileRevalidate (7 days) |
| Cache strategy (General API) | NetworkFirst (24 hours, 5s timeout) |
| Cache strategy (Images) | CacheFirst (30 days) |
| Offline queue | Accumulates unsynced read IDs in IndexedDB (`reader-offline` DB) and batch-syncs via `POST /api/articles/batch-seen` when back online |
| Update notification | When a new service worker is available, a persistent toast ("New version available") with a reload button is displayed via `sonner`. Clicking reload activates the new worker and refreshes the page |

#### Install Section (Settings > About)

`InstallSettings` (`src/components/settings/install-settings.tsx`) renders one of three states, driven by `useInstallPrompt` (`src/hooks/use-install-prompt.ts`):

| State | Condition | UI |
|---|---|---|
| Installable | `beforeinstallprompt` was captured | "Install" button that re-opens the native install dialog |
| Installed | `display-mode: standalone`, iOS `navigator.standalone`, an `appinstalled` event, or `getInstalledRelatedApps()` reporting a `webapp` entry | "Installed" badge |
| Neither | No captured event and not detected as installed | Manual hint (iOS: Share → Add to Home Screen; otherwise: browser menu → Install app) |

The `beforeinstallprompt` listener is registered at startup from `main.tsx`, before the lazily-loaded settings page mounts, and stores the event in a module-level store so the button works no matter when the browser fired it. The handler calls `preventDefault()`, which is what defers the prompt and keeps the event usable for a later `prompt()` call.

The section never renders empty: Android Chrome stops firing `beforeinstallprompt` once the app is installed, and a normal browser tab still reports `display-mode: browser`, so an empty section was indistinguishable from a broken one.

Note that a missing install option is not always the app's fault. Android hands home-screen pinning to the active launcher, and a third-party launcher that does not implement it makes Chrome drop "Install app" from its own menu and never fire `beforeinstallprompt` — the same symptoms as a manifest that fails the installability criteria, but with nothing to fix on the web side. Before changing the manifest, confirm the browser's verdict directly: `chrome://inspect` from a desktop (Application > Manifest) names the actual installability error, and `chrome://webapks` on the device lists what Chrome already considers installed.

### Custom Theme Import

Users can import custom color themes via JSON in `/settings/appearance`.

| Item | Detail |
|---|---|
| Import method | Paste JSON into syntax-highlighted editor dialog, or load from file |
| Sample theme | "Sample" button loads an Everforest theme as a starting point |
| Edit | Previously imported custom themes can be edited via the same dialog |
| Validation | Theme name must match `[a-z0-9_-]+`, cannot override builtin names, must include both `light` and `dark` variants with all required color keys |
| Max custom themes | 20 |
| Persistence | localStorage + DB sync |
| Required color keys | `background`, `background.sidebar`, `background.subtle`, `background.avatar`, `text`, `text.muted`, `accent`, `accent.text`, `error`, `border`, `hover`, `overlay` |
| Optional fields | `indicatorStyle` (`'line'` / `'dot'`), `highlight` (code block theme, default: `'github'`) |

### Feed Multi-Select and Bulk Actions

Multiple feeds can be selected in the sidebar for bulk operations.

| Item | Detail |
|---|---|
| Select | Cmd/Ctrl + Click to toggle individual feed, Shift + Click for range selection |
| Deselect | Escape key clears selection |
| Exclusion | Clip feeds are excluded from multi-select |
| Context menu | Right-click on selection to open bulk action menu |

Supported bulk actions:

| Action | Behavior |
|---|---|
| Move to Category | `POST /api/feeds/bulk-move` — moves selected feeds to a category |
| Mark All Read | Calls `POST /api/feeds/:id/mark-all-seen` for each feed |
| Fetch | Fetches each selected enabled feed sequentially |
| Delete | Requires confirmation dialog. Deletes each feed via `DELETE /api/feeds/:id` |
