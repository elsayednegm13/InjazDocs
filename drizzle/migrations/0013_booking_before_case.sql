-- A sea booking can be issued before an export case exists.
-- SQLite cannot drop NOT NULL in place. Child tables are rebuilt first so
-- the drop succeeds while foreign keys stay enabled, and every row keeps its id.
CREATE TABLE bookings_v2 (
  id TEXT PRIMARY KEY,
  case_id TEXT REFERENCES export_cases(id) ON DELETE CASCADE,
  booking_number TEXT NOT NULL,
  ucr TEXT,
  shipping_line TEXT,
  vessel TEXT,
  voyage TEXT,
  port_of_loading TEXT,
  port_of_discharge TEXT,
  expected_containers INTEGER NOT NULL DEFAULT 0 CHECK (expected_containers >= 0),
  status TEXT NOT NULL,
  planned_loading_date TEXT,
  actual_loading_date TEXT,
  cutoff_date TEXT,
  planned_etd TEXT,
  actual_etd TEXT,
  planned_eta TEXT,
  actual_eta TEXT,
  notes TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO bookings_v2 (
  id, case_id, booking_number, ucr, shipping_line, vessel, voyage, port_of_loading, port_of_discharge,
  expected_containers, status, planned_loading_date, actual_loading_date, cutoff_date, planned_etd, actual_etd,
  planned_eta, actual_eta, notes, version, created_at, updated_at
)
SELECT
  id, case_id, booking_number, ucr, shipping_line, vessel, voyage, port_of_loading, port_of_discharge,
  expected_containers, status, planned_loading_date, actual_loading_date, cutoff_date, planned_etd, actual_etd,
  planned_eta, actual_eta, notes, version, created_at, updated_at
FROM bookings;

CREATE TABLE containers_v2 (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL REFERENCES bookings_v2(id) ON DELETE CASCADE,
  case_id TEXT REFERENCES export_cases(id) ON DELETE CASCADE,
  slot_index INTEGER NOT NULL,
  official_number TEXT,
  official_number_override INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  weight_grams INTEGER,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (booking_id, slot_index)
);

INSERT INTO containers_v2 (
  id, booking_id, case_id, slot_index, official_number, official_number_override, status, weight_grams, version, created_at, updated_at
)
SELECT
  id, booking_id, case_id, slot_index, official_number, official_number_override, status, weight_grams, version, created_at, updated_at
FROM containers;

CREATE TABLE container_events_v2 (
  id TEXT PRIMARY KEY,
  container_id TEXT NOT NULL REFERENCES containers_v2(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  event_at TEXT NOT NULL,
  is_actual INTEGER NOT NULL DEFAULT 1,
  note TEXT,
  actor_id TEXT REFERENCES user(id),
  created_at TEXT NOT NULL
);

INSERT INTO container_events_v2 (id, container_id, status, event_at, is_actual, note, actor_id, created_at)
SELECT id, container_id, status, event_at, is_actual, note, actor_id, created_at
FROM container_events;

CREATE TABLE booking_attachments_v2 (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL REFERENCES bookings_v2(id) ON DELETE CASCADE,
  document_version_id TEXT REFERENCES document_versions(id),
  r2_key TEXT NOT NULL,
  original_name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'BOOKING_CONFIRMATION',
  created_at TEXT NOT NULL
);

INSERT INTO booking_attachments_v2 (id, booking_id, document_version_id, r2_key, original_name, kind, created_at)
SELECT id, booking_id, document_version_id, r2_key, original_name, kind, created_at
FROM booking_attachments;

DROP TABLE container_events;
DROP TABLE booking_attachments;
DROP TABLE containers;
DROP TABLE bookings;

ALTER TABLE bookings_v2 RENAME TO bookings;
ALTER TABLE containers_v2 RENAME TO containers;
ALTER TABLE container_events_v2 RENAME TO container_events;
ALTER TABLE booking_attachments_v2 RENAME TO booking_attachments;

CREATE UNIQUE INDEX bookings_number_idx ON bookings(booking_number) WHERE status != 'CANCELLED';
CREATE INDEX bookings_case_idx ON bookings(case_id);
CREATE INDEX bookings_schedule_idx ON bookings(planned_etd, planned_eta, planned_loading_date);
CREATE UNIQUE INDEX containers_official_number_idx
  ON containers(official_number)
  WHERE official_number IS NOT NULL AND status != 'CANCELLED';
CREATE INDEX containers_case_idx ON containers(case_id, status);
