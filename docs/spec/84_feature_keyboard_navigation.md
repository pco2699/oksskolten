# Oksskolten Spec — Keyboard Navigation

> [Back to Overview](./01_overview.md)

## Overview

Vim-like keyboard navigation for the article list. Enables reading and performing actions on articles without using a mouse. Can be toggled on/off in Settings → Reading. Key bindings are customizable per action.

## Motivation

Keyboard-driven article navigation is a standard feature in major RSS readers (Feedly, Inoreader, Miniflux). Enables efficient reading workflows without reaching for the mouse.

## Scope

Keyboard navigation targets the **article list** only. The feed list (sidebar) is out of scope.

### State Management

A `KeyboardNavigationContext` (React Context) is created and its Provider placed in `PageLayout`.

Managed state:
- `focusedItemId`: `string | null` — ID of the currently focused article

### Initial Focus

When `focusedItemId` is `null` and the next or prev key is pressed, focus moves to the first item in the list.

## Design

### Enable/Disable Toggle: Default State & Storage

Keyboard navigation defaults to **on**. `useKeyboardNavSetting` (`src/hooks/use-keyboard-nav-setting.ts`) persists it client-side under localStorage key `keyboard-navigation-v2`, and it also syncs to the `reading.keyboard_navigation` server preference (same dual-storage pattern as other settings, see [ADR-001](../adr/001-settings-dual-storage.md)).

The localStorage key was migrated from `keyboard-navigation` to `keyboard-navigation-v2` (with a one-time removal of the old key) because the local hook eagerly persists its current value on every mount — every browser that had ever loaded the app already had the old key stored as `'off'` before the default changed, which would have kept overriding the new default. A companion one-time DB migration (`migrations/0010_keyboard_nav_default_on.sql`) flips any existing `reading.keyboard_navigation = 'off'` row to `'on'` for the same reason, since a stored `'off'` from that era is indistinguishable from settings-hydration backfill noise rather than a deliberate user choice. Users can still switch it off in Settings → Reading.

### Existing Shortcuts

Global shortcuts implemented in `src/hooks/use-global-shortcuts.ts`:

| Shortcut | Action |
|---|---|
| `Cmd/Ctrl + K` | Open command palette |
| `Cmd/Ctrl + Shift + K` | Open search dialog |
| `Cmd/Ctrl + N` | Open add feed modal |
| `Cmd/Ctrl + ,` | Navigate to settings |
| `Cmd/Ctrl + 1` | Navigate to All |
| `Cmd/Ctrl + 2` | Navigate to Bookmarks |
| `Cmd/Ctrl + 3` | Navigate to Likes |
| `Cmd/Ctrl + 4` | Navigate to History |
| `Cmd/Ctrl + 5` | Navigate to Chat |

In `src/components/feed/feed-list.tsx`:

| Shortcut | Action |
|---|---|
| `Escape` | Clear multi-selection |

### Supported Layouts

Of the four article list layouts (list / card / magazine / compact), keyboard navigation is enabled only for single-column layouts: **list** and **compact**. Grid layouts (card / magazine) are deferred to future work.

### Behavior by articleOpenMode

Keyboard navigation behavior depends on the "Article Open Mode" setting (`articleOpenMode`).

#### Page Navigation Mode (`articleOpenMode === 'page'`)

Default key bindings (customizable via Settings → Reading → Key Bindings):

| Shortcut | Action |
|---|---|
| `j` (default) | Move focus to the next article (does not open the article) |
| `k` (default) | Move focus to the previous article (does not open the article) |
| `Enter` | Open the focused article as a full page (`useNavigate` route transition) |
| `Escape` | Clear focus |

#### Overlay Mode (`articleOpenMode === 'overlay'`)

| Shortcut | Action |
|---|---|
| `j` (default) | If the overlay is closed, move focus to the next article only (does not open it). If the overlay is already open, move focus and swap the article displayed in it |
| `k` (default) | Mirror of `j` for the previous article |
| `Enter` / `o` | Open the focused article in the ArticleOverlay |
| `Escape` | If the overlay is open, close it (focus is preserved). Press Escape again to clear focus |

`j`/`k` never auto-open the overlay from the list view — they only move the selection. Once the overlay has been opened (via `Enter`/`o` or a mouse click), `j`/`k` keep swapping the article shown in it in place, staying in sync with list focus, until the overlay is closed.

#### Actions (Both Modes)

| Shortcut | Action |
|---|---|
| `b` (default, customizable) | Read Later (toggle bookmark: add if not bookmarked, remove if bookmarked) |
| `;` (default, customizable) | Open the original article in a new browser tab (`window.open(url, '_blank')`) |
| `m` (default, customizable) | Toggle read/unread status of the focused (list) or current (detail/overlay) article |

#### Feedly-Style Fixed Keys

In addition to the customizable bindings above, a set of fixed (non-customizable) keys mirrors Feedly's default shortcuts. These are always active regardless of what the user has configured for next/prev/bookmark/openExternal/toggleRead:

| Shortcut | Action |
|---|---|
| `o` | Open the focused article — same as `Enter` (list view only; no-op in the detail/overlay reader) |
| `v` | Open the original article in a new tab — fixed alias for the open-external binding |
| `s` | Toggle Read Later — fixed alias for the bookmark binding |
| `Shift + A` | Mark all articles currently loaded in this list view as read (shows a confirmation dialog first) |
| `?` | Show the keyboard shortcuts help dialog (works globally, including on the article detail page) |

`o`, `v`, and `s` are implemented in `use-keyboard-navigation.ts` as additional key checks that reuse the same `onEnter` / `onOpenExternal` / `onBookmarkToggle` callbacks as the configurable bindings, so no extra wiring is needed at call sites. `Shift+A` has its own callback (`onMarkAllRead`). `?` is handled by a separate hook (`use-keyboard-shortcuts-help.ts`) mounted at the top of the app so it works on every page, including the standalone article detail route which has no `PageLayout`/sidebar.

Read/unread toggling (`toggleRead`, default `m`) is a full customizable binding like next/prev/bookmark/openExternal, not a fixed key — it went through this migration after initially shipping as a hardcoded `m` check. It uses the existing `PATCH /api/articles/:id/seen` endpoint (`{ seen: boolean }`), which already supports un-marking an article as read (`seen_at` is cleared). No new server endpoint was needed.

### Prev/Next Edge Arrows

Feedly-style chevron buttons (`ChevronLeft`/`ChevronRight`) are pinned to the far left/right edges of the reading view, vertically centered. Hidden below the `md` breakpoint via CSS only — shown regardless of pointer type, since touch-capable desktops (e.g. touchscreen laptops) report `pointer: coarse` and would otherwise wrongly lose the arrows.

Implemented in `src/components/article/article-nav-arrows.tsx` (`ArticleNavArrows`). It reads `articleIds`/`articleUrls` from `KeyboardNavigationContext`, resolves the current article's position via a reverse URL lookup, and renders disabled/hidden buttons at the ends of the list.

Rendered in both reading modes:

- **Page mode**: mounted in `ArticleDetailPage` (`src/app.tsx`) with `variant="page"`. Positioned `fixed` relative to the viewport; navigates using `useNavigate()` + `articleUrlToPath()`, the same mechanism as `ArticleZapNavigation`.
- **Overlay mode**: mounted inside `ArticleOverlay` (`src/components/article/article-overlay.tsx`) with `variant="overlay"`. Positioned `absolute` relative to the dialog's `Content` element (which is itself `position: fixed`, establishing the containing block) — this keeps the arrows pinned to the overlay panel's actual edges without hardcoding its width. An `onNavigate` callback is threaded from `article-list.tsx` (owner of the `overlayUrl` state) through `ArticleOverlay` down to `ArticleNavArrows`, so clicking an arrow swaps the article shown in the overlay instead of navigating the router. The overlay's scrollable content was moved into an inner wrapper `div` (`h-full overflow-y-auto`) so the arrows, as direct children of `Content`, don't scroll away with the article body.

A phone screen has no room for edge chevrons floating over full-bleed article text, so the overlay renders a third `variant="header"`: the same two buttons inline in the overlay's action bar, right-aligned next to the close button, and `md:hidden` so exactly one of the two presentations is visible at any width. That action bar is a direct child of `Content` (`absolute`, like the edge arrows) and swaps ends by breakpoint: pinned to the bottom of the panel below `md`, where the close and prev/next buttons stay within thumb reach, and back to the top of the panel from `md` up. The scroll wrapper carries matching padding (`pb` below `md`, `pt` from `md` up) so the article body is never hidden behind it, and the overlay sets `--article-bottom-bar` so the article's chat FAB lifts clear of the bar on mobile. Disabled ends stay visible but dimmed (`disabled:opacity-30`) rather than fully hidden, so the pair doesn't shift position at the list boundaries. Page mode does not use the header variant: its header is the shared `Header` component, and on mobile it relies on back/forward navigation instead.

### Keyboard Shortcuts Help Overlay

Pressing `?` opens `KeyboardShortcutsDialog` (`src/components/ui/keyboard-shortcuts-dialog.tsx`), a simple dialog listing all shortcuts (next/prev, open, open-external, bookmark, toggle-read, mark-all-read, close, and `?` itself), reflecting the user's current custom key bindings. Standard dialog z-index (`z-[70]` via the shared `Dialog` component).

### Custom Key Bindings

Users can reassign the five navigation/action keys via Settings → Reading → Key Bindings (visible only when keyboard navigation is enabled). Below the editable bindings, the same section also lists the fixed (non-configurable) shortcuts — `o`/`Enter`, `s`, `v`, `Shift+A`, `?`, `Esc` — as read-only chips, so all shortcuts are discoverable from Settings, not just the `?` help dialog.

#### KeyBindings Interface

```typescript
interface KeyBindings {
  next: string         // default: 'j'
  prev: string         // default: 'k'
  bookmark: string     // default: 'b'
  openExternal: string // default: ';'
  toggleRead: string   // default: 'm'
}
```

#### Constraints

- Each value must be a single character
- Duplicate key assignments are not allowed — the UI shows a warning and does not persist changes until duplicates are resolved
- Invalid or incomplete data falls back to defaults

#### Storage

- **Client:** `localStorage` key `keybindings` (JSON string)
- **Server:** `reading.keybindings` preference key (JSON string, validated on write)

The `useKeybindingsSetting` hook manages local state and localStorage persistence. Server sync follows the same dual-storage pattern as other settings (see [ADR-001](../adr/001-settings-dual-storage.md)).

`toggleRead` was added after `next`/`prev`/`bookmark`/`openExternal` shipped, so values stored before that point only have the original 4 fields. Both the client (`use-keybindings-setting.ts`) and the server (`server/routes/settings.ts`) treat `toggleRead` as optional on read/validation: a stored 4-field value is still considered valid and is backfilled with the `toggleRead` default (`'m'`) rather than being discarded as invalid. Anything written going forward (via the Settings UI) always includes all 5 fields.

#### Server Validation

`PATCH /api/settings/preferences` validates `reading.keybindings`:

- Must be valid JSON
- Must contain the 4 required keys `next`, `prev`, `bookmark`, `openExternal`, and may optionally include `toggleRead`; no other keys are allowed
- Each value must be a single character string

Returns `400` with a descriptive error if validation fails.

### Visual Feedback

The keyboard-focused article receives the following styles:

- 2px accent-color left border (`border-left: 2px solid var(--color-accent)`)
- Light accent-color background (`background: color-mix(in srgb, var(--color-accent) 10%, transparent)`)

Distinguished from the existing unread indicator (`border-l-accent`) by the thicker (2px) border combined with a background color.

### Accessibility

Minimal ARIA attributes are applied:

- `aria-selected="true"` on the focused item
- `role="listbox"` on the list container

### Boundary Behavior

- Pressing the prev key at the top of the list: no action (stays at the top)
- Pressing the next key at the bottom of the loaded list: no action (stays at the bottom)

### Prefetch on Near-End Navigation

When the user navigates with the next key and the focused article is within **5 items of the end** of the currently loaded list, the next page of articles is prefetched via `useSWRInfinite`'s `setSize`. This ensures seamless reading — new articles load before the user reaches the end, so keyboard-driven reading never hits a dead end while unread articles remain.

The threshold of 5 items provides enough buffer for the fetch to complete before the user reaches the last loaded article. The `onNearEnd` callback in `useKeyboardNavigation` fires only when `has_more` is true, avoiding unnecessary requests.

### Scroll Control

When focus moves to an off-screen item via the next/prev key, `scrollIntoView({ behavior: 'smooth', block: 'nearest' })` scrolls minimally to bring the focused item into view.

### Read Status

Beyond the scroll-triggered auto-read (via `scrollIntoView`), advancing focus with the next key (`j`) also marks the article being left as read: when focus moves from article A to article B and B comes after A in `articleIds`, A is marked read if it is currently unread. Moving backward with the prev key (`k`) never marks anything, and the initial focus (no previous item) never marks anything either. This only happens when the auto-mark-read setting (`autoMarkRead`) is `'on'` — if the setting is off, `j`/`k` never mark articles read.

The marking reuses the same `autoReadIds` + batched-queue pipeline as the scroll-based auto-read in `article-list.tsx` (see "Auto-mark-as-read on scroll" in `50_frontend.md` or the inline comments in `article-list.tsx`), so the unread indicator clears instantly in the UI while the server PATCH is batched every ~1.5s. The batch queue is a `Set`, so an id enqueued by both the keyboard advance and the scroll observer is deduped naturally.

In overlay mode, when the overlay is open, `j`/`k` swap the article shown in it, and `ArticleDetail` already marks the newly shown article read on mount; the advance-mark of the departed article described above still runs but is a no-op since that article is already read by the time it happens.

### Conflict Avoidance

#### Input Fields

Follows the pattern already implemented in `use-global-shortcuts.ts:21-24`:

```typescript
const isInput =
  ['INPUT', 'TEXTAREA', 'SELECT'].includes(
    (e.target as HTMLElement).tagName,
  ) || (e.target as HTMLElement).isContentEditable
```

Navigation and action shortcuts (default: j/k/b/;) are disabled when an input field is focused.

#### Modals, Dialogs, and Command Palette

Keyboard navigation is disabled while the command palette (`Cmd+K`), search dialog, or other modals are open. However, ArticleOverlay (marked with the `data-keyboard-nav-passthrough` attribute) is an exception — next/prev article navigation remains active while the overlay is displayed.

### Mouse Coexistence

When an article is clicked with the mouse, the keyboard focus is updated to that article (`focusedItemId` is set to the clicked article's ID). Mouse and keyboard operations naturally stay in sync.

### Focus Persistence

Focus state is not automatically reset on page navigation. After pressing Escape to close the overlay in overlay mode, focus is preserved, and pressing the next/prev key resumes from that article. To explicitly clear focus, press Escape when the overlay is closed.

### Empty List

When the article list is empty (no articles), pressing the next/prev key does nothing.

### Key Files

| File | Description |
|---|---|
| `src/contexts/keyboard-navigation-context.tsx` | KeyboardNavigationContext and Provider |
| `src/hooks/use-keyboard-navigation.ts` | Key event handling and focus movement logic (accepts optional `keyBindings`) |
| `src/hooks/use-keybindings-setting.ts` | Custom key bindings state management and localStorage persistence |
| `src/hooks/use-keybindings-setting.test.ts` | Tests for keybindings setting hook |
| `src/components/layout/page-layout.tsx` | Provider placement |
| `src/components/article/article-list.tsx` | Article list keyboard nav integration, visual feedback, overlay coordination, mark-all-read confirm dialog |
| `src/components/article/article-overlay.tsx` | `data-keyboard-nav-passthrough` attribute for j/k passthrough; hosts `ArticleNavArrows` (overlay + header variants); back-gesture and swipe dismissal |
| `src/components/article/article-nav-arrows.tsx` | Prev/next chevrons: edge variants for page/overlay reading modes, inline header variant for mobile |
| `src/components/article/article-zap-navigation.tsx` | j/k/o/v/s/m navigation and actions in the page-mode article detail reader |
| `src/hooks/use-article-actions.ts` | `isRead`/`toggleReadState` (backs the `m` shortcut in the detail/overlay reader) |
| `src/hooks/use-keyboard-shortcuts-help.ts` | Global `?` shortcut, mounted in `AppLayout` |
| `src/components/ui/keyboard-shortcuts-dialog.tsx` | `?` help dialog listing all shortcuts |
| `src/pages/settings/sections/reading-section.tsx` | KeybindingsEditor UI (shown when keyboard navigation is on) |