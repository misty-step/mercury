-- 0002: Multi-user support

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user', 'system')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

CREATE TABLE user_aliases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  address TEXT NOT NULL UNIQUE,
  is_primary INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  prefix TEXT NOT NULL UNIQUE,
  key_hash TEXT NOT NULL,
  scopes TEXT DEFAULT 'read,write,send',
  name TEXT,
  last_used_at TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT
);

ALTER TABLE emails ADD COLUMN user_id INTEGER REFERENCES users(id);

CREATE INDEX idx_emails_user_id ON emails(user_id);

INSERT INTO users (email, name, role) VALUES
  ('shared@mistystep.io', NULL, 'system'),
  ('phaedrus@mistystep.io', 'Phaedrus', 'admin'),
  ('kaylee@mistystep.io', 'Kaylee', 'user');

INSERT INTO user_aliases (user_id, address, is_primary)
SELECT id, email, 1
FROM users
WHERE email IN (
  'shared@mistystep.io',
  'phaedrus@mistystep.io',
  'kaylee@mistystep.io'
);
