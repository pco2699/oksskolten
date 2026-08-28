# Changelog

## [v0.5.22](https://github.com/pco2699/oksskolten/compare/v0.5.21...v0.5.22) - 2026-08-28
### Others
- Move article overlay action bar to the bottom on mobile by @pco2699 in https://github.com/pco2699/oksskolten/pull/59

## [v0.5.21](https://github.com/pco2699/oksskolten/compare/v0.5.20...v0.5.21) - 2026-08-27
### Others
- feat(sidebar): toggle hide-zero-unread-feeds from the FEEDS section header by @pco2699 in https://github.com/pco2699/oksskolten/pull/54

## [v0.5.20](https://github.com/pco2699/oksskolten/compare/v0.5.19...v0.5.20) - 2026-08-25
### Others
- Revert #49: the missing Android install option was a launcher, not the manifest by @pco2699 in https://github.com/pco2699/oksskolten/pull/51
- feat(ui): cap the reading overlay width and make / the all-articles list by @pco2699 in https://github.com/pco2699/oksskolten/pull/53

## [v0.5.19](https://github.com/pco2699/oksskolten/compare/v0.5.18...v0.5.19) - 2026-08-25
### Others
- fix(pwa): restore the Android install option by dropping related_applications by @pco2699 in https://github.com/pco2699/oksskolten/pull/49

## [v0.5.18](https://github.com/pco2699/oksskolten/compare/v0.5.17...v0.5.18) - 2026-08-19
### Others
- fix(pwa): make the install section visible on Android Chrome by @pco2699 in https://github.com/pco2699/oksskolten/pull/47

## [v0.5.17](https://github.com/pco2699/oksskolten/compare/v0.5.16...v0.5.17) - 2026-08-18
### Others
- feat(pwa): improve install experience on Android (manifest, install button, maskable icon) by @pco2699 in https://github.com/pco2699/oksskolten/pull/45

## [v0.5.16](https://github.com/pco2699/oksskolten/compare/v0.5.15...v0.5.16) - 2026-08-18

## [v0.5.15](https://github.com/pco2699/oksskolten/compare/v0.5.14...v0.5.15) - 2026-08-13
### Others
- fix: use julianday() to compare published_at against datetime('now', ...) by @pco2699 in https://github.com/pco2699/oksskolten/pull/40

## [v0.5.14](https://github.com/pco2699/oksskolten/compare/v0.5.13...v0.5.14) - 2026-08-12
### Others
- feat(feeds): add age filter to mark-all-seen by @pco2699 in https://github.com/pco2699/oksskolten/pull/37

## [v0.5.13](https://github.com/pco2699/oksskolten/compare/v0.5.12...v0.5.13) - 2026-08-10
### Others
- fix: distinguish collection counts from unread with CountBadge by @pco2699 in https://github.com/pco2699/oksskolten/pull/34
- feat(list): add bookmark and like toggle buttons to list layout cards (PCO-7) by @pco2699 in https://github.com/pco2699/oksskolten/pull/35

## [v0.5.12](https://github.com/pco2699/oksskolten/compare/v0.5.11...v0.5.12) - 2026-08-08
### Others
- Fix timezone bug in dateFormat causing dates to shift backward by @pco2699 in https://github.com/pco2699/oksskolten/pull/32

## [v0.5.11](https://github.com/pco2699/oksskolten/compare/v0.5.10...v0.5.11) - 2026-08-07
### Others
- Extract the entry body, not the reaction thread, on Hatena anonymous diary by @pco2699 in https://github.com/pco2699/oksskolten/pull/29

## [v0.5.10](https://github.com/pco2699/oksskolten/compare/v0.5.9...v0.5.10) - 2026-08-07
### Others
- Use the median article gap for the adaptive interval, not the mean by @pco2699 in https://github.com/pco2699/oksskolten/pull/27

## [v0.5.9](https://github.com/pco2699/oksskolten/compare/v0.5.8...v0.5.9) - 2026-08-07
### Others
- Add score distribution baseline measurement for recommendation by @pco2699 in https://github.com/pco2699/oksskolten/pull/22
- Let retries fall back to RSS content, and stop mislabelling blocked YouTube fetches by @pco2699 in https://github.com/pco2699/oksskolten/pull/24
- Upgrade node-cron to 4.6.0 so scheduled ticks stop being silently dropped by @pco2699 in https://github.com/pco2699/oksskolten/pull/26

## [v0.5.9](https://github.com/pco2699/oksskolten/compare/v0.5.8...v0.5.9) - 2026-08-06
### Others
- Add score distribution baseline measurement for recommendation by @pco2699 in https://github.com/pco2699/oksskolten/pull/22

## [v0.5.8](https://github.com/pco2699/oksskolten/compare/v0.5.7...v0.5.8) - 2026-08-06
### Others
- Fix article deduplication order in backfill transaction by @pco2699 in https://github.com/pco2699/oksskolten/pull/20

## [v0.5.7](https://github.com/pco2699/oksskolten/compare/v0.5.6...v0.5.7) - 2026-08-06
### Others
- Fix correctness, security, and consistency issues found in code review by @pco2699 in https://github.com/pco2699/oksskolten/pull/16
- Hide feeds with no unread articles from the sidebar by @pco2699 in https://github.com/pco2699/oksskolten/pull/18
- Add YouTube video transcription and bot-check page detection by @pco2699 in https://github.com/pco2699/oksskolten/pull/19

## [v0.5.6](https://github.com/pco2699/oksskolten/compare/v0.5.5...v0.5.6) - 2026-08-05
### Others
- Add reasoning token support for AI tasks and chat by @pco2699 in https://github.com/pco2699/oksskolten/pull/13
- Fix drawer popstate handling for overlays and desktop by @pco2699 in https://github.com/pco2699/oksskolten/pull/15

## [v0.5.5](https://github.com/pco2699/oksskolten/compare/v0.5.4...v0.5.5) - 2026-08-05
### Others
- Add unread-only toggle and fix unread paging / stale sidebar counts by @pco2699 in https://github.com/pco2699/oksskolten/pull/11

## [v0.5.4](https://github.com/pco2699/oksskolten/compare/v0.5.3...v0.5.4) - 2026-08-02
### Others
- Fix OPML import treating feeds from one host as duplicates by @pco2699 in https://github.com/pco2699/oksskolten/pull/9
- Close the article overlay on back gesture and swipe on mobile by @pco2699 in https://github.com/pco2699/oksskolten/pull/8

## [v0.5.3](https://github.com/pco2699/oksskolten/compare/v0.5.2...v0.5.3) - 2026-07-30
### Others
- Add skip_full_text_fetch flag to opt out of article fetching by @pco2699 in https://github.com/pco2699/oksskolten/pull/6

## [v0.5.2](https://github.com/pco2699/oksskolten/compare/v0.5.1...v0.5.2) - 2026-07-29

## [v0.5.1](https://github.com/pco2699/oksskolten/compare/v0.5.0...v0.5.1) - 2026-07-29

## [v0.5.0](https://github.com/pco2699/oksskolten/commits/v0.5.0) - 2026-07-29
### Others
- feat: add OpenRouter as an LLM provider by @pco2699 in https://github.com/pco2699/oksskolten/pull/1
- refactor: make OpenRouter the only LLM provider by @pco2699 in https://github.com/pco2699/oksskolten/pull/2

## [v0.5.0](https://github.com/babarot/oksskolten/compare/v0.4.2...v0.5.0) - 2026-06-08
### New Features
- feat: add support for vLLM LLM provider by @pju-hoge in https://github.com/babarot/oksskolten/pull/56
### Bug fixes
- Update feed items with excerpt by @asonas in https://github.com/babarot/oksskolten/pull/51
- fix: add type="button" to cancel button in FolderStep by @tenajima in https://github.com/babarot/oksskolten/pull/66
- Fix article lists not refreshing after bookmark/like toggle by @babarot in https://github.com/babarot/oksskolten/pull/76
- fix(fetcher): relax worker memory limit and clean up timeout aborts by @babarot in https://github.com/babarot/oksskolten/pull/81
### Improvements
- Add fallback mechanism for RSS description as article content by @asonas in https://github.com/babarot/oksskolten/pull/46
- feat(chat): increase tool round limit and add batch tools by @pju-hoge in https://github.com/babarot/oksskolten/pull/61
- Replace skip checkbox with two-phase choice flow for feed scope by @babarot in https://github.com/babarot/oksskolten/pull/54
- feat: implement zap keyboard navigation in article view and fix settings sync race condition by @pju-hoge in https://github.com/babarot/oksskolten/pull/68
- fix: address production memory instability — tsx→node, worker idleTimeout, SQLite soft_heap_limit by @pju-hoge in https://github.com/babarot/oksskolten/pull/78
### Others
- Refresh cloud LLM model list to latest releases by @babarot in https://github.com/babarot/oksskolten/pull/77
- Add new font option with "System Serif" by @pellaeon in https://github.com/babarot/oksskolten/pull/65
- refine(fonts): use curated stack for System Serif by @babarot in https://github.com/babarot/oksskolten/pull/80
- fix(search): raise Meilisearch waitTask timeout to 5 minutes by @babarot in https://github.com/babarot/oksskolten/pull/82

## [v0.4.2](https://github.com/babarot/oksskolten/compare/v0.4.1...v0.4.2) - 2026-03-26
### Improvements
- Add support for custom key bindings in settings by @asonas in https://github.com/babarot/oksskolten/pull/37
- Refactor `safeFetch` to exclude certain HTTP status codes as redirects by @asonas in https://github.com/babarot/oksskolten/pull/42
- Update keyboard navigation to include prefetching on near-end items by @asonas in https://github.com/babarot/oksskolten/pull/43
- Expose article original URL as data-original-url attribute on all car… by @asonas in https://github.com/babarot/oksskolten/pull/44

## [v0.4.1](https://github.com/babarot/oksskolten/compare/v0.4.0...v0.4.1) - 2026-03-23
### Bug fixes
- Fix multibyte URL lookup returning 404 by @babarot in https://github.com/babarot/oksskolten/pull/31

## [v0.4.0](https://github.com/babarot/oksskolten/compare/v0.3.0...v0.4.0) - 2026-03-20
### New Features
- Add Ollama as a self-hosted LLM provider by @asonas in https://github.com/babarot/oksskolten/pull/25
- Add retention policy with configurable article cleanup by @babarot in https://github.com/babarot/oksskolten/pull/24
### Bug fixes
- Fix mojibake on non-UTF-8 articles and feeds by @Just2enough in https://github.com/babarot/oksskolten/pull/23
### Improvements
- Perf/score recalc daily batch by @asonas in https://github.com/babarot/oksskolten/pull/19
- Update article excerpt generation to strip Markdown syntax by @asonas in https://github.com/babarot/oksskolten/pull/21
- Improve decodeResponse portability and test coverage by @babarot in https://github.com/babarot/oksskolten/pull/26

## [v0.3.0](https://github.com/babarot/oksskolten/compare/v0.2.0...v0.3.0) - 2026-03-19
### New Features
- Feature/keyboard navigation by @asonas in https://github.com/babarot/oksskolten/pull/12
### Bug fixes
- Feature/retry backoff by @asonas in https://github.com/babarot/oksskolten/pull/18
### Others
- Reject http:// URLs in feed and clip endpoints by @babarot in https://github.com/babarot/oksskolten/pull/15
- Add mocks for unused components and hooks in `article-list.test.tsx` by @asonas in https://github.com/babarot/oksskolten/pull/16

## [v0.2.0](https://github.com/babarot/oksskolten/compare/v0.1.1...v0.2.0) - 2026-03-18
### New Features
- Add similar article detection across feeds by @babarot in https://github.com/babarot/oksskolten/pull/11
### Bug fixes
- Update task model section to include Claude Code Ready in key checks by @asonas in https://github.com/babarot/oksskolten/pull/13

## [v0.1.1](https://github.com/babarot/oksskolten/compare/v0.1.0...v0.1.1) - 2026-03-17
- Fix category select dropdown not appearing above modal overlay by @gymynnym in https://github.com/babarot/oksskolten/pull/7

## [v0.1.0](https://github.com/babarot/oksskolten/commits/v0.1.0) - 2026-03-15
- Update name in Wrangler configuration file to match deployed Worker by @cloudflare-workers-and-pages[bot] in https://github.com/babarot/oksskolten/pull/2
