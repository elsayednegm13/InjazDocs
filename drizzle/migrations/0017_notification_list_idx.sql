CREATE INDEX IF NOT EXISTS notification_deliveries_created_idx
  ON notification_deliveries(created_at DESC, reminder_id);

CREATE INDEX IF NOT EXISTS notification_deliveries_reminder_idx
  ON notification_deliveries(reminder_id, created_at DESC);
