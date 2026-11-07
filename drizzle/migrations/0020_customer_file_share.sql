CREATE TABLE customer_file_shares (
  id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL UNIQUE REFERENCES document_versions(id) ON DELETE CASCADE,
  case_id TEXT NOT NULL REFERENCES export_cases(id) ON DELETE CASCADE,
  published_at TEXT NOT NULL,
  published_by TEXT REFERENCES user(id),
  unpublished_at TEXT,
  first_viewed_at TEXT,
  last_viewed_at TEXT,
  view_count INTEGER NOT NULL DEFAULT 0,
  decision TEXT,
  comment TEXT,
  decided_at TEXT,
  link_id TEXT REFERENCES customer_tracking_links(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX customer_file_shares_case_idx ON customer_file_shares(case_id, unpublished_at);
