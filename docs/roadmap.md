# Roadmap

Ideas and planned improvements. Not commitments — just directions we're considering.

## Auth

- **Move the JWT out of `localStorage` into an httpOnly cookie.** Today the token
  is readable by any script on the page, so an XSS gets a 30-day credential. A
  cookie plus a CSRF token removes that entirely. Deferred because it is not a
  refactor: it touches password/passkey/OAuth login, invalidates existing
  tokens, and changes how the PWA service worker and Bearer-token API/MCP
  clients authenticate. Needs a decision on whether to keep Bearer support in
  parallel (API tokens still need it) before it can be scoped.

## Image Storage

- Purge orphaned images: detect and delete stored images whose URLs are no longer referenced by any article in the database
- Storage usage dashboard: show total size, image count, and per-feed breakdown of cached images so the user can monitor disk consumption
- **Revisit how `images.storage_path` is confined.** It currently accepts
  anything under `DATA_DIR` or under an operator-set `IMAGES_STORAGE_ROOT`,
  which keeps the "images on a separate volume" case working while blocking the
  path from reaching arbitrary host files. The stricter alternative is
  `DATA_DIR`-only, dropping the env var. Worth deciding deliberately rather than
  leaving it as an artifact of the security fix — see
  `docs/spec/81_feature_images.md`.

## Testing

- **Pin `TZ` in the client test setup.** `src/lib/dateFormat.test.ts` asserts on
  formatted dates without fixing a timezone, so four cases fail on any machine
  behind UTC and pass in CI. Setting `TZ=UTC` in `src/__tests__/setup.ts` (or
  the vitest client project `env`) makes local and CI runs agree.
