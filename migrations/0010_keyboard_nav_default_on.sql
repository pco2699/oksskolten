-- Every browser that has ever loaded the app already backfilled
-- reading.keyboard_navigation = 'off' to the server (the frontend hydration
-- logic writes the local value back when the server has none). A stored
-- 'off' is therefore indistinguishable from that backfill noise, not a
-- deliberate user choice. Flip existing installs to 'on' to match the new
-- default so Feedly-style keyboard shortcuts work out of the box; users can
-- still turn it off in Settings.
UPDATE settings SET value = 'on' WHERE key = 'reading.keyboard_navigation' AND value = 'off';
