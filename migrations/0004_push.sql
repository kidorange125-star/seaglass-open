-- Task notifications (Web Push). None of this is note content, so it doesn't go through notes.ts or history.

-- One row per device that turned notifications on. tz is the device's IANA time zone: reminder times are
-- wall-clock times, so the cron works them out per zone.
CREATE TABLE IF NOT EXISTS push_subs (
  endpoint    TEXT PRIMARY KEY,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  tz          TEXT NOT NULL,
  label       TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL,
  seen_at     INTEGER NOT NULL,
  last_error  TEXT
);

-- Reminders already sent (key = task, date, time, lead and zone), so each fires once. Pruned after a week.
CREATE TABLE IF NOT EXISTS push_sent (
  key      TEXT PRIMARY KEY,
  sent_at  INTEGER NOT NULL
);

-- "Snooze 10 min" from a notification.
CREATE TABLE IF NOT EXISTS push_snooze (
  note_id  TEXT PRIMARY KEY,
  fire_at  INTEGER NOT NULL,
  title    TEXT NOT NULL,
  body     TEXT NOT NULL DEFAULT ''
);

-- Small app settings (today: notification preferences), as JSON values.
CREATE TABLE IF NOT EXISTS prefs (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);
