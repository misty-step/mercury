-- 0003: Add proper ON DELETE actions to foreign keys
-- D1/SQLite doesn't support ALTER TABLE for FK constraints, so recreate tables

-- Defer foreign key checks for this migration
PRAGMA defer_foreign_keys = on;

-- ============================================================
-- user_aliases: ON DELETE CASCADE (delete aliases with user)
-- ============================================================

CREATE TABLE user_aliases_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  address TEXT NOT NULL UNIQUE,
  is_primary INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO user_aliases_new SELECT * FROM user_aliases;
DROP TABLE user_aliases;
ALTER TABLE user_aliases_new RENAME TO user_aliases;

-- ============================================================
-- api_keys: ON DELETE SET NULL (preserve keys, clear user_id)
-- ============================================================

CREATE TABLE api_keys_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  prefix TEXT NOT NULL UNIQUE,
  key_hash TEXT NOT NULL,
  scopes TEXT DEFAULT 'read,write,send',
  name TEXT,
  last_used_at TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT
);

INSERT INTO api_keys_new SELECT * FROM api_keys;
DROP TABLE api_keys;
ALTER TABLE api_keys_new RENAME TO api_keys;

-- ============================================================
-- emails: ON DELETE SET NULL (preserve emails, clear user_id)
-- ============================================================

CREATE TABLE emails_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT UNIQUE,
  sender TEXT NOT NULL,
  recipient TEXT NOT NULL,
  subject TEXT,
  raw_email TEXT NOT NULL,
  headers_json TEXT,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  is_read INTEGER DEFAULT 0,
  is_starred INTEGER DEFAULT 0,
  folder TEXT DEFAULT 'inbox',
  synced_at TEXT,
  deleted_at TEXT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL
);

INSERT INTO emails_new SELECT * FROM emails;
DROP TABLE emails;
ALTER TABLE emails_new RENAME TO emails;

-- Recreate indexes on emails
CREATE INDEX idx_emails_received_at ON emails(received_at DESC);
CREATE INDEX idx_emails_is_read ON emails(is_read);
CREATE INDEX idx_emails_folder ON emails(folder);
CREATE INDEX idx_emails_sender ON emails(sender);
CREATE INDEX idx_emails_recipient ON emails(recipient);
CREATE INDEX idx_emails_synced_at ON emails(synced_at);
CREATE INDEX idx_emails_user_id ON emails(user_id);

-- Re-enable foreign keys
PRAGMA defer_foreign_keys = off;
