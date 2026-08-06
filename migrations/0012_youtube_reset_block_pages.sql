-- Queue YouTube videos whose stored body is a block page for a refetch.
--
-- Before the captions pipeline existed, a YouTube article's body came from
-- scraping the watch page, which from a server IP is usually the "unusual
-- traffic" interstitial. Those bodies are longer than MIN_EXTRACTED_LENGTH, so
-- the stale-article refresh never looks at them, and any summary or translation
-- stored alongside them describes the interstitial rather than the video.
--
-- Dropping the body (and everything derived from it) with a last_error set puts
-- the article back in the retry queue, where the fetch now rebuilds it from the
-- video's captions and description. Only bodies positively identified as block
-- pages are touched — a genuine body is never discarded.
UPDATE articles
SET full_text = NULL,
    excerpt = NULL,
    summary = NULL,
    full_text_translated = NULL,
    translated_lang = NULL,
    last_error = 'youtube: rebuilding body from captions',
    retry_count = 0,
    last_retry_at = NULL,
    last_refresh_attempt_at = NULL
WHERE purged_at IS NULL
  AND full_text IS NOT NULL
  AND (
    url LIKE '%youtube.com/watch%'
    OR url LIKE '%youtu.be/%'
    OR url LIKE '%youtube.com/shorts/%'
    OR url LIKE '%youtube.com/live/%'
  )
  AND (
    lower(full_text) LIKE '%unusual traffic from your computer network%'
    OR lower(full_text) LIKE '%our systems have detected unusual traffic%'
    OR lower(full_text) LIKE '%before you continue to youtube%'
    OR lower(full_text) LIKE '%not a bot%'
    OR lower(full_text) LIKE '%sign in to confirm your age%'
    -- "Why did this happen?" is ordinary prose on its own; paired with the
    -- interstitial's heading it is not.
    OR (lower(full_text) LIKE '%about this page%' AND lower(full_text) LIKE '%why did this happen%')
  );
