#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_DIR="$ROOT_DIR/.wrangler/state/v3/d1"
SCHEMA_FILE="$ROOT_DIR/schema.sql"
MIGRATIONS_DIR="$ROOT_DIR/migrations"

echo "Resetting local D1 database..."
rm -rf "$DB_DIR"

echo "Applying schema..."
wrangler d1 execute mailbox --local --file="$SCHEMA_FILE"

for migration in 0002_multi_user.sql 0003_foreign_key_actions.sql 0004_api_key_hash_index.sql; do
  echo "Applying migration $migration..."
  wrangler d1 execute mailbox --local --file="$MIGRATIONS_DIR/$migration"
done

hash_api_key() {
  node -e "const crypto=require('crypto'); const key=process.argv[1]; const hash=crypto.createHash('sha256').update(key).digest('hex'); console.log(hash);" "$1"
}

PHAEDRUS_KEY="mk_test_phaedrus"
KAYLEE_KEY="mk_test_kaylee"
SHARED_KEY="mk_test_shared"

PHAEDRUS_HASH="$(hash_api_key "$PHAEDRUS_KEY")"
KAYLEE_HASH="$(hash_api_key "$KAYLEE_KEY")"
SHARED_HASH="$(hash_api_key "$SHARED_KEY")"

PHAEDRUS_PREFIX="${PHAEDRUS_KEY:0:11}"
KAYLEE_PREFIX="${KAYLEE_KEY:0:11}"
SHARED_PREFIX="${SHARED_KEY:0:11}"

SEED_SQL="$(mktemp)"
trap 'rm -f "$SEED_SQL"' EXIT

cat > "$SEED_SQL" <<SQL

INSERT INTO users (email, name, role, deleted_at) VALUES
  ('shared@mistystep.io', NULL, 'system', NULL),
  ('phaedrus@mistystep.io', 'Phaedrus', 'admin', NULL),
  ('kaylee@mistystep.io', 'Kaylee', 'user', NULL)
ON CONFLICT(email) DO UPDATE SET
  name = excluded.name,
  role = excluded.role,
  deleted_at = NULL;

INSERT OR IGNORE INTO user_aliases (user_id, address, is_primary)
SELECT id, email, 1
FROM users
WHERE email IN (
  'shared@mistystep.io',
  'phaedrus@mistystep.io',
  'kaylee@mistystep.io'
);

DELETE FROM api_keys;
INSERT INTO api_keys (user_id, prefix, key_hash, scopes, name, created_at)
VALUES
  ((SELECT id FROM users WHERE email = 'phaedrus@mistystep.io'), '$PHAEDRUS_PREFIX', '$PHAEDRUS_HASH', 'read,write,send', 'local-dev-phaedrus', datetime('now')),
  ((SELECT id FROM users WHERE email = 'kaylee@mistystep.io'), '$KAYLEE_PREFIX', '$KAYLEE_HASH', 'read,write,send', 'local-dev-kaylee', datetime('now')),
  ((SELECT id FROM users WHERE email = 'shared@mistystep.io'), '$SHARED_PREFIX', '$SHARED_HASH', 'read,write,send', 'local-dev-shared', datetime('now'));

DELETE FROM emails;
INSERT INTO emails (
  message_id,
  sender,
  recipient,
  subject,
  raw_email,
  headers_json,
  received_at,
  is_read,
  is_starred,
  folder,
  user_id
)
VALUES
  (
    '<seed-phaedrus-1@local>',
    'kaylee@mistystep.io',
    'phaedrus@mistystep.io',
    'Welcome to Mercury',
    'From: kaylee@mistystep.io; To: phaedrus@mistystep.io; Subject: Welcome to Mercury; Body: Hello Phaedrus.',
    '{"from":"kaylee@mistystep.io","to":"phaedrus@mistystep.io","subject":"Welcome to Mercury"}',
    datetime('now', '-2 hours'),
    0,
    1,
    'inbox',
    (SELECT id FROM users WHERE email = 'phaedrus@mistystep.io')
  ),
  (
    '<seed-kaylee-1@local>',
    'phaedrus@mistystep.io',
    'kaylee@mistystep.io',
    'Kaylee onboarding',
    'From: phaedrus@mistystep.io; To: kaylee@mistystep.io; Subject: Kaylee onboarding; Body: Hello Kaylee.',
    '{"from":"phaedrus@mistystep.io","to":"kaylee@mistystep.io","subject":"Kaylee onboarding"}',
    datetime('now', '-1 hours'),
    1,
    0,
    'inbox',
    (SELECT id FROM users WHERE email = 'kaylee@mistystep.io')
  ),
  (
    '<seed-shared-1@local>',
    'phaedrus@mistystep.io',
    'shared@mistystep.io',
    'System digest',
    'From: phaedrus@mistystep.io; To: shared@mistystep.io; Subject: System digest; Body: Shared system mailbox.',
    '{"from":"phaedrus@mistystep.io","to":"shared@mistystep.io","subject":"System digest"}',
    datetime('now', '-30 minutes'),
    1,
    0,
    'inbox',
    (SELECT id FROM users WHERE email = 'shared@mistystep.io')
  );

SQL

echo "Seeding data..."
wrangler d1 execute mailbox --local --file="$SEED_SQL"

cat <<EOF

=== API KEYS ===
  phaedrus: $PHAEDRUS_KEY
  kaylee:   $KAYLEE_KEY
  shared:   $SHARED_KEY

=== START SERVER ===
  pnpm dev

=== TEST API KEY MANAGEMENT ===
  curl -X POST http://localhost:8787/api-keys \\
    -H "Authorization: Bearer $PHAEDRUS_KEY" \\
    -H "Content-Type: application/json" \\
    -d '{"name":"local-dev","scopes":"read,write,send"}'
  curl -H "Authorization: Bearer $PHAEDRUS_KEY" http://localhost:8787/api-keys

=== TEST USER ISOLATION ===
  # Phaedrus sees all emails (expected: 3)
  curl -H "Authorization: Bearer $PHAEDRUS_KEY" http://localhost:8787/emails
  # Kaylee sees only her email (expected: 1)
  curl -H "Authorization: Bearer $KAYLEE_KEY" http://localhost:8787/emails
  # Kaylee can't access email ID 1 (expected: Not found)
  curl -H "Authorization: Bearer $KAYLEE_KEY" http://localhost:8787/emails/1

=== TEST TUI ===
  cd cli && go build && ./mercury tui

=== TEST ADMIN IMPERSONATION ===
  curl -H "Authorization: Bearer secret" \\
    -H "X-Mercury-User: kaylee@mistystep.io" \\
    http://localhost:8787/emails
EOF
