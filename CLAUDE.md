# CLAUDE.md — Mercury Mail

Mercury is a self-hosted, agent-friendly email server built on Cloudflare Workers + D1.

## Philosophy

- **Agent-first:** APIs designed for programmatic access, not just humans
- **Deep modules:** Each module does one thing well (Ousterhout)
- **Boring over clever:** Simple, obvious code beats terse magic
- **TDD:** Tests first, always

## Architecture

```
Inbound:  Cloudflare Email Routing → Worker → D1
Outbound: API → Resend → Recipient
Storage:  D1 (SQLite)
```

## Quality Standards

### Tests
- **Coverage target:** 80%+
- **Test naming:** `describe('module')` → `it('should behavior')`
- **Run before commit:** `pnpm test`

### Code Style
- TypeScript strict mode
- No `any` types
- Explicit return types on exports
- ESLint + Prettier enforced

### Git
- Conventional commits: `feat:`, `fix:`, `test:`, `docs:`
- Pre-commit: lint + typecheck
- Pre-push: full test suite

### Modules
- **src/email/**: Inbound email handling
- **src/api/**: HTTP API routes
- **src/send/**: Outbound sending (Resend)
- **src/db/**: D1 database operations

## Commands

```bash
pnpm dev          # Local dev server
pnpm test         # Run tests
pnpm test:watch   # Watch mode
pnpm lint         # ESLint
pnpm typecheck    # TypeScript check
pnpm deploy       # Deploy to Cloudflare
```

## Environment

Required secrets (Cloudflare dashboard or wrangler.toml):
- `API_SECRET` — Bearer token for API auth
- `RESEND_API_KEY` — Outbound email sending

## API

See `docs/API.md` for full reference.

### Core Endpoints
- `GET /emails` — List emails (with filters)
- `GET /emails/:id` — Get single email
- `POST /send` — Send email (via Resend)
- `PATCH /emails/:id` — Update (read, star, folder)
- `DELETE /emails/:id` — Soft delete
