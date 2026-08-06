// Canonical definition of the user preference keys exposed by
// /api/settings/preferences, and the values each one accepts.
//
// Server-side validation and client-side hydration both derive from this map.
// They used to be independent lists (PREF_KEYS + PREF_ALLOWED on the server,
// hydrationMap on the client) that had to be edited in lockstep — a key added
// to one and not the other either 400s on every page load or silently does
// nothing.

/** null = any string is accepted (open-ended values like model ids or theme names). */
export const PREFERENCE_SCHEMA = {
  'appearance.color_theme': null,
  'appearance.highlight_theme': null,
  'appearance.font_family': null,
  'appearance.list_layout': ['list', 'card', 'magazine', 'compact'],
  'appearance.mascot': ['off', 'dream-puff', 'sleepy-giant'],
  'reading.date_mode': ['relative', 'absolute'],
  'reading.auto_mark_read': ['on', 'off'],
  'reading.unread_indicator': ['on', 'off'],
  'reading.internal_links': ['on', 'off'],
  'reading.show_thumbnails': ['on', 'off'],
  'reading.show_feed_activity': ['on', 'off'],
  'reading.chat_position': ['fab', 'inline'],
  'reading.article_open_mode': ['page', 'overlay'],
  'reading.category_unread_only': ['on', 'off'],
  'reading.keyboard_navigation': ['on', 'off'],
  'reading.keybindings': null,
  // Model ids are OpenRouter catalog entries, which change constantly.
  'chat.model': null,
  'summary.model': null,
  'summary.max_tokens': null,
  'summary.reasoning': ['on', 'off'],
  'translate.model': null,
  'translate.max_tokens': null,
  'translate.reasoning': ['on', 'off'],
  'translate.target_lang': ['ja', 'en', 'zh'],
  'custom_themes': null,
  'retention.enabled': ['on', 'off'],
  'retention.read_days': null,
  'retention.unread_days': null,
} as const satisfies Record<string, readonly string[] | null>

export type PreferenceKey = keyof typeof PREFERENCE_SCHEMA

export const PREFERENCE_KEYS = Object.keys(PREFERENCE_SCHEMA) as PreferenceKey[]

/** Every preference as returned by GET /api/settings/preferences. */
export type Preferences = Record<PreferenceKey, string | null>

/**
 * Whether `value` is acceptable for `key`.
 *
 * Keys mapped to null accept any non-empty string; callers that need more
 * (numeric ranges, JSON shape) layer their own check on top.
 */
export function isAllowedPreferenceValue(key: PreferenceKey, value: string): boolean {
  const allowed: readonly string[] | null = PREFERENCE_SCHEMA[key]
  return allowed === null || allowed.includes(value)
}
