# Testing Guide

## Backend Tests

```bash
pnpm test        # Run all
pnpm test:watch  # Watch mode
```

## CLI Tests

```bash
cd cli && go test ./...
```

## Manual E2E: Kaylee Inbox Isolation

1. Deploy locally: `wrangler dev`
2. Run migration: `wrangler d1 migrations apply mailbox --local`
3. Create kaylee user and API key
4. Send test emails
5. Verify admin sees all, kaylee sees only hers
6. Test CLI: `mercury --profile kaylee inbox`

## Coverage

- Backend: 46+ tests (auth, users, emails, filtering, API keys, integration, e2e)
- CLI: TUI, config, API client, auth tests
