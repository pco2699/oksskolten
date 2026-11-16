-- Archive a feed without deleting it.
--
-- An archived feed keeps every article it already has: they remain listed,
-- readable, and searchable exactly as before. What stops is fetching — the
-- scheduled sweep, article retries, and manual refresh all skip archived
-- feeds until they are unarchived. The timestamp doubles as the marker so the
-- UI can show when a feed was archived.
ALTER TABLE feeds ADD COLUMN archived_at TEXT DEFAULT NULL;
