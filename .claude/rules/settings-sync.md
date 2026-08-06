---
paths:
  - "src/hooks/use-settings.ts"
  - "server/routes/settings.ts"
  - "shared/preferences.ts"
---

# Settings Preferences: Shared Schema

Preference keys and their allowed values live in **one place**: `shared/preferences.ts`.

| Concern | Source |
|---|---|
| Key list, allowed values | `shared/preferences.ts` (`PREFERENCE_SCHEMA`) |
| Server validation | `server/routes/settings.ts` — derives `PREF_KEYS` and validation from the schema |
| Frontend hydration | `src/hooks/use-settings.ts` — `hydrationMap` says *how* to apply a key, not what is valid |

## Adding a preference

1. Add the key to `PREFERENCE_SCHEMA`, with either an allowed-value array or `null` (any string).
2. If the frontend needs to react to it, add a `hydrationMap` entry: key + setter, plus `backfillRef` if the local value should be pushed to the DB when unset.

Do not restate allowed values in the hydration map — validation is derived via
`isAllowedPreferenceValue`. `shared/preferences.test.ts` fails if the hydration
map references a key that is not in the schema.

Per-key constraints the schema cannot express (numeric ranges for `retention.*`
and `*.max_tokens`, JSON shape for `reading.keybindings`) stay in
`server/routes/settings.ts`, layered on top of the schema check.
