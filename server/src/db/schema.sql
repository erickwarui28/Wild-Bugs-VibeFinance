CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  age INTEGER NOT NULL,
  risk_tolerance TEXT NOT NULL,
  max_vol REAL NOT NULL,
  holdings_json TEXT NOT NULL,
  behaviour_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bars (
  ticker TEXT NOT NULL,
  date TEXT NOT NULL,
  open REAL NOT NULL,
  high REAL NOT NULL,
  low REAL NOT NULL,
  close REAL NOT NULL,
  volume REAL NOT NULL,
  regime TEXT NOT NULL,
  spike INTEGER NOT NULL,
  fwd_ret_30 REAL,
  provenance TEXT NOT NULL DEFAULT 'SYNTHETIC',
  origin TEXT,
  fetched_at TEXT,
  PRIMARY KEY (ticker, date)
);

CREATE TABLE IF NOT EXISTS flows (
  date TEXT NOT NULL,
  sector TEXT NOT NULL,
  fii_net_cr REAL NOT NULL,
  dii_net_cr REAL NOT NULL,
  scope TEXT NOT NULL DEFAULT 'sector',
  provenance TEXT NOT NULL DEFAULT 'SYNTHETIC',
  origin TEXT,
  fetched_at TEXT,
  PRIMARY KEY (date, sector, scope)
);

CREATE TABLE IF NOT EXISTS docs (
  id TEXT PRIMARY KEY,
  ticker TEXT NOT NULL,
  type TEXT NOT NULL,
  date TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  synthetic INTEGER NOT NULL,
  source_url TEXT,
  fetched_at TEXT,
  provenance TEXT NOT NULL DEFAULT 'SYNTHETIC'
);

CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL,
  ticker TEXT NOT NULL,
  text TEXT NOT NULL,
  vec TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
  run_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  ticker TEXT NOT NULL,
  as_of TEXT NOT NULL,
  session_id TEXT,
  synthesis_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id, profile_id)
);

CREATE TABLE IF NOT EXISTS trace_steps (
  run_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  name TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  latency_ms REAL NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (run_id, seq)
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  ticker TEXT NOT NULL,
  as_of TEXT NOT NULL,
  action TEXT NOT NULL,
  size_pct REAL NOT NULL,
  composite REAL NOT NULL,
  confidence REAL NOT NULL,
  data_mode TEXT NOT NULL,
  run_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS portfolio_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  weights_json TEXT NOT NULL,
  hhi REAL NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS behaviour_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  ticker TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  ticker TEXT NOT NULL,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  citations_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS llm_cache (
  cache_key TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS snapshot_bars (
  snapshot_id TEXT NOT NULL,
  ticker TEXT NOT NULL,
  date TEXT NOT NULL,
  open REAL NOT NULL,
  high REAL NOT NULL,
  low REAL NOT NULL,
  close REAL NOT NULL,
  volume REAL NOT NULL,
  spike INTEGER NOT NULL,
  provenance TEXT NOT NULL,
  origin TEXT,
  fetched_at TEXT,
  source_url TEXT,
  PRIMARY KEY (snapshot_id, ticker, date)
);

CREATE TABLE IF NOT EXISTS snapshot_flows (
  snapshot_id TEXT NOT NULL,
  date TEXT NOT NULL,
  sector TEXT NOT NULL,
  scope TEXT NOT NULL,
  fii_net_cr REAL NOT NULL,
  dii_net_cr REAL NOT NULL,
  provenance TEXT NOT NULL,
  origin TEXT,
  fetched_at TEXT,
  PRIMARY KEY (snapshot_id, date, sector, scope)
);

CREATE TABLE IF NOT EXISTS snapshot_docs (
  snapshot_id TEXT NOT NULL,
  id TEXT NOT NULL,
  ticker TEXT NOT NULL,
  type TEXT NOT NULL,
  date TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  synthetic INTEGER NOT NULL,
  source_url TEXT,
  fetched_at TEXT,
  provenance TEXT NOT NULL,
  PRIMARY KEY (snapshot_id, id)
);

CREATE TABLE IF NOT EXISTS calibration (
  bin INTEGER PRIMARY KEY,
  predicted REAL NOT NULL,
  observed REAL NOT NULL,
  lo REAL NOT NULL,
  hi REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS api_usage_global (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  total_calls INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS api_usage_visitors (
  visitor_id TEXT PRIMARY KEY,
  total_calls INTEGER NOT NULL DEFAULT 0,
  window_calls INTEGER NOT NULL DEFAULT 0,
  window_started_at INTEGER NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS api_usage_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  visitor_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activity_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  visitor_id TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  status INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_api_usage_events_created_at ON api_usage_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_events_created_at ON activity_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_visitor_time ON api_usage_events(visitor_id, created_at);
CREATE TABLE IF NOT EXISTS usage_reset_marks (
  visitor_id TEXT PRIMARY KEY,
  last_event_id INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS admin_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL,
  scope TEXT NOT NULL,
  visitor_id TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS live_documents (
  id TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS openai_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  visitor_id TEXT NOT NULL,
  network_id TEXT,
  model TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  input_tokens INTEGER,
  cached_tokens INTEGER,
  output_tokens INTEGER,
  reserved_usd REAL NOT NULL,
  charged_usd REAL,
  rates_json TEXT NOT NULL,
  error_kind TEXT,
  created_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_openai_network_time ON openai_attempts(network_id, created_at);
CREATE INDEX IF NOT EXISTS idx_openai_visitor ON openai_attempts(visitor_id);
CREATE INDEX IF NOT EXISTS idx_activity_visitor_id ON activity_events(visitor_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_activity_path_id ON activity_events(path, id DESC);
CREATE INDEX IF NOT EXISTS idx_activity_status_id ON activity_events(status, id DESC);
CREATE INDEX IF NOT EXISTS idx_attempt_status_id ON openai_attempts(status, id DESC);
CREATE INDEX IF NOT EXISTS idx_attempt_created ON openai_attempts(created_at);
CREATE INDEX IF NOT EXISTS idx_metered_visitor_first_seen ON api_usage_visitors(first_seen_at);
CREATE TABLE IF NOT EXISTS spending_reset (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_attempt_id INTEGER NOT NULL DEFAULT 0,
  reset_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS analysis_snapshots (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  owner_id TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL
);
