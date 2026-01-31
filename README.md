# Cloudflare Mailbox 📬

Self-hosted email inbox using Cloudflare Email Workers + D1.

**Zero servers. Zero monthly cost. ISP-friendly.**

## Why?

- Your ISP blocks port 25
- You don't want to run a full mail server
- You want email for a custom domain without paying for a hosted service
- You want programmatic access to your inbox via REST API

## Architecture

```
                    ┌─────────────────────────────────────┐
                    │           INTERNET                  │
                    └─────────────────┬───────────────────┘
                                      │
                          Email to you@yourdomain.com
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      CLOUDFLARE (Free Tier)                         │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐ │
│  │  Email Routing  │───▶│  Email Worker   │───▶│   D1 Database   │ │
│  │  (MX records)   │    │  (this code)    │    │  (stores email) │ │
│  └─────────────────┘    └────────┬────────┘    └────────┬────────┘ │
│                                  │ REST API             │          │
└──────────────────────────────────┼──────────────────────┼──────────┘
                                   │                      │
                                   ▼                      │
                         Your app / sync script ◀─────────┘
                                   │
                                   ▼
                          Local maildir / CLI
```

## Quick Start

### 1. Prerequisites

- Cloudflare account (free)
- Domain on Cloudflare (nameservers pointed to Cloudflare)
- Node.js 18+
- `wrangler` CLI: `npm install -g wrangler`

### 2. Setup

```bash
# Clone this repo
git clone https://github.com/misty-step/cloudflare-mailbox.git
cd cloudflare-mailbox

# Install dependencies
npm install

# Login to Cloudflare
wrangler login

# Create D1 database
wrangler d1 create mailbox

# Copy the database_id from output and update wrangler.toml

# Initialize schema
npm run db:init

# Set API secret (generate a strong random string)
wrangler secret put API_SECRET

# Deploy
npm run deploy
```

### 3. Configure Email Routing

1. Go to Cloudflare Dashboard → Your domain → Email → Email Routing
2. Enable Email Routing
3. Add a route: `youraddress@yourdomain.com` → Worker → `cloudflare-mailbox`

### 4. Test

Send an email to your address, then:

```bash
curl -X GET "https://cloudflare-mailbox.YOUR-SUBDOMAIN.workers.dev/emails" \
  -H "Authorization: Bearer YOUR_API_SECRET"
```

## API Reference

All endpoints require `Authorization: Bearer <API_SECRET>` header.

### List Emails
```
GET /emails
  ?limit=50        (max 100)
  ?offset=0
  ?folder=inbox    (inbox, trash, archive)
  ?unread=true
  ?since=ISO8601
  ?unsynced=true
```

### Get Email
```
GET /emails/:id
```

### Update Email
```
PATCH /emails/:id
{
  "is_read": true,
  "is_starred": true,
  "folder": "archive",
  "mark_synced": true
}
```

### Delete Email
```
DELETE /emails/:id
  ?permanent=true  (hard delete, otherwise soft delete to trash)
```

### Stats
```
GET /stats
```

### Health Check (no auth)
```
GET /health
```

## Local Sync

Use `scripts/sync.sh` to sync emails to local maildir format:

```bash
export MAILBOX_API_URL="https://cloudflare-mailbox.YOUR-SUBDOMAIN.workers.dev"
export MAILBOX_API_SECRET="your-secret"
export MAILBOX_MAILDIR="$HOME/.mail/inbox"

./scripts/sync.sh
```

Then use any maildir-compatible client (mutt, himalaya, etc.).

## Cost

| Component | Free Tier | Expected Usage | Cost |
|-----------|-----------|----------------|------|
| Email Routing | Unlimited | Any | $0 |
| Workers | 100k req/day | ~1k/day | $0 |
| D1 Storage | 500 MB | ~100 MB | $0 |
| D1 Reads | 5M/day | ~5k/day | $0 |
| D1 Writes | 100k/day | ~100/day | $0 |
| **Total** | | | **$0** |

## Limitations

- Max email size: 25 MB (Cloudflare limit)
- No SMTP sending (use a separate service like Resend, Postmark, etc.)
- No IMAP/POP3 (use REST API or sync script instead)

## License

MIT
