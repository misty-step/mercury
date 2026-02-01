# Mercury Mail 📬

Self-hosted email system using Cloudflare Email Workers + D1.

**Zero servers. Zero monthly cost. Complete email solution.**

## Features

- 📥 **Receive** - Cloudflare Email Routing → Worker → D1
- 📤 **Send** - REST API → Resend (or other providers)
- 🖥️ **CLI** - Full-featured command-line client
- 🔐 **Secure** - API key authentication, HTTPS only
- 💰 **Free** - Runs entirely on Cloudflare's free tier

## Project Structure

```
mercury/
├── src/              # Worker source code (Cloudflare Worker)
├── cli/              # Command-line client
│   ├── mercury       # CLI executable
│   └── README.md     # CLI documentation
├── scripts/          # Utility scripts
├── tests/            # Test suite
├── schema.sql        # D1 database schema
└── wrangler.toml     # Cloudflare configuration
```

## Quick Start

### Server Setup

```bash
# Clone and install
git clone https://github.com/misty-step/mercury.git
cd mercury
npm install

# Login to Cloudflare
wrangler login

# Create D1 database
wrangler d1 create mailbox
# Copy database_id to wrangler.toml

# Initialize schema
npm run db:init

# Set secrets
wrangler secret put API_SECRET      # Strong random string
wrangler secret put RESEND_API_KEY  # From resend.com (for sending)

# Deploy
npm run deploy
```

### CLI Setup

```bash
# Build CLI
cd cli
go build -o mercury
sudo cp mercury /usr/local/bin/
cd ..

# Configure (choose one):
# Option 1: Environment variable
export MERCURY_API_SECRET="your-secret"

# Option 2: 1Password (automatic)
# Store secret at: op://Personal/Mercury Mail API/API_SECRET

# Use it!
mercury inbox
mercury read 1
mercury send
```

## CLI Usage

```bash
mercury inbox           # List emails
mercury inbox 50        # List 50 emails
mercury read <id>       # Read email
mercury send            # Compose new email (interactive)
mercury reply <id>      # Reply to email
mercury delete <id>     # Delete email
mercury stats           # Mailbox statistics
mercury health          # Check server health
```

## Architecture

```
Inbound:
  Email → Cloudflare MX → Email Routing → Worker → D1 Database

Outbound:
  CLI/API → Worker → Resend API → Recipient

Access:
  CLI/Scripts → REST API → D1 Database
```

## API Reference

All endpoints require `Authorization: Bearer <API_SECRET>` header.

| Method   | Endpoint      | Description                       |
| -------- | ------------- | --------------------------------- |
| `GET`    | `/health`     | Health check (no auth)            |
| `GET`    | `/emails`     | List emails                       |
| `GET`    | `/emails/:id` | Get email                         |
| `PATCH`  | `/emails/:id` | Update email (read, star, folder) |
| `DELETE` | `/emails/:id` | Delete email                      |
| `POST`   | `/send`       | Send email                        |
| `GET`    | `/stats`      | Mailbox statistics                |

### Query Parameters (GET /emails)

- `limit` - Max results (default: 50, max: 100)
- `offset` - Pagination offset
- `folder` - Filter by folder (inbox, trash, archive)
- `unread` - Filter unread only (true/false)

### Send Email (POST /send)

```json
{
  "from": "you@yourdomain.com",
  "to": "recipient@example.com",
  "subject": "Hello",
  "text": "Plain text body",
  "html": "<p>HTML body</p>"
}
```

## Email Routing Setup

1. **Cloudflare Dashboard** → Your domain → Email → Email Routing
2. Enable Email Routing
3. Add DNS records (MX, SPF, DKIM as instructed)
4. Create catch-all rule → Route to Worker → `cloudflare-mailbox`

## Cost

| Component     | Free Tier      | Cost   |
| ------------- | -------------- | ------ |
| Email Routing | Unlimited      | $0     |
| Workers       | 100k req/day   | $0     |
| D1 Storage    | 500 MB         | $0     |
| D1 Operations | 5M reads/day   | $0     |
| Resend        | 100 emails/day | $0     |
| **Total**     |                | **$0** |

## Security

- 🔐 All API endpoints require Bearer token authentication
- 🔒 HTTPS only (Cloudflare handles TLS)
- 🗄️ Database encrypted at rest (Cloudflare D1)
- 🔑 Secrets stored securely (Cloudflare Secrets)

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Type check
npm run typecheck

# Lint
npm run lint

# Local development
wrangler dev
```

## License

MIT
