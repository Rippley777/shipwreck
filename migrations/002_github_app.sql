CREATE TABLE IF NOT EXISTS github_app_connections (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  app_id TEXT NOT NULL,
  github_user_id TEXT NOT NULL,
  login TEXT NOT NULL,
  encrypted_token TEXT NOT NULL,
  encrypted_refresh_token TEXT,
  expires_at TIMESTAMPTZ,
  refresh_expires_at TIMESTAMPTZ,
  refresh_lock_token TEXT,
  refresh_lock_until TIMESTAMPTZ,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS github_installation_id TEXT;
