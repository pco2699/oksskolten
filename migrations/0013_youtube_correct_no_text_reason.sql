-- Correct the recorded reason for YouTube articles that never got a body.
--
-- These rows were stamped "youtube: no captions or description available",
-- which read as though the videos themselves were textless. They are not.
-- The message was produced whenever the fetch ended with no description and
-- no transcript, and by far the most common way to reach that state was the
-- InnerTube player call being refused outright — the ANDROID client answering
-- HTTP 400 FAILED_PRECONDITION on a pinned client version YouTube retired, and
-- the WEB client answering playabilityStatus LOGIN_REQUIRED ("Sign in to
-- confirm you're not a bot") from a datacenter IP. oEmbed still answers 200
-- for those videos, but it carries no description field, so it could never
-- distinguish the two cases and the article was filed under the wrong one.
--
-- `fetchYouTubeContent` now splits them: a refused player is an error, and
-- only a *successful* player call reporting an empty description box and no
-- caption tracks counts as settled.
--
-- Only the message is rewritten here. `retry_count` and `last_retry_at` are
-- deliberately left alone: these articles are still failing for the original
-- reason, so requeueing them now would refill the retry batch budget with
-- work that cannot yet succeed. Requeue them once YouTube access itself is
-- repaired.
UPDATE articles
SET last_error = 'youtube: could not retrieve video metadata'
WHERE purged_at IS NULL
  AND full_text IS NULL
  AND last_error = 'youtube: no captions or description available';
