import { beforeEach, describe, expect, it } from 'vitest';
import type { MockD1Database } from './helpers/mockD1';
import { createMockD1Database } from './helpers/mockD1';
import { authenticate, hashApiKey, timingSafeCompare } from '../src/auth';

function buildRequest(path: string, init?: RequestInit): Request {
  return new Request(`https://example.com${path}`, init);
}

describe('auth', () => {
  let db: MockD1Database;
  let env: { DB: MockD1Database; API_SECRET: string; RESEND_API_KEY: string };

  beforeEach(() => {
    db = createMockD1Database({ now: () => '2026-02-01T10:00:00.000Z' });
    env = { DB: db, API_SECRET: 'secret', RESEND_API_KEY: 'test-key' };
  });

  it('should authenticate legacy API_SECRET as admin', async () => {
    const request = buildRequest('/emails', {
      headers: { Authorization: 'Bearer secret' },
    });

    const ctx = await authenticate(request, env as never, db as never);

    expect(ctx).not.toBeNull();
    expect(ctx?.user).toEqual({ id: -1, email: 'admin', role: 'admin' });
    expect(ctx?.isImpersonating).toBe(false);
    expect(ctx?.scopes.has('read')).toBe(true);
  });

  it('should authenticate mk_ api key', async () => {
    const user = db.insertUser({ email: 'user@example.com', role: 'user' });
    const token = 'mk_test_123';
    const keyHash = await hashApiKey(token);
    db.insertApiKey({ user_id: user.id, key_hash: keyHash, scopes: 'read,send' });

    const request = buildRequest('/emails', {
      headers: { Authorization: `Bearer ${token}` },
    });

    const ctx = await authenticate(request, env as never, db as never);

    expect(ctx?.user.id).toBe(user.id);
    expect(ctx?.user.email).toBe('user@example.com');
    expect(ctx?.scopes.has('read')).toBe(true);
    expect(ctx?.scopes.has('send')).toBe(true);
  });

  it('should return null for expired api key', async () => {
    const user = db.insertUser({ email: 'expired@example.com', role: 'user' });
    const token = 'mk_expired';
    const keyHash = await hashApiKey(token);
    db.insertApiKey({
      user_id: user.id,
      key_hash: keyHash,
      expires_at: '2000-01-01T00:00:00.000Z',
    });

    const request = buildRequest('/emails', {
      headers: { Authorization: `Bearer ${token}` },
    });

    const ctx = await authenticate(request, env as never, db as never);

    expect(ctx).toBeNull();
  });

  it('should return null for revoked api key', async () => {
    const user = db.insertUser({ email: 'revoked@example.com', role: 'user' });
    const token = 'mk_revoked';
    const keyHash = await hashApiKey(token);
    db.insertApiKey({
      user_id: user.id,
      key_hash: keyHash,
      revoked_at: '2026-02-01T09:00:00.000Z',
    });

    const request = buildRequest('/emails', {
      headers: { Authorization: `Bearer ${token}` },
    });

    const ctx = await authenticate(request, env as never, db as never);

    expect(ctx).toBeNull();
  });

  it('should allow impersonation with X-Mercury-User header', async () => {
    const user = db.insertUser({ email: 'impersonate@example.com', role: 'user' });

    const request = buildRequest('/emails', {
      headers: {
        Authorization: 'Bearer secret',
        'X-Mercury-User': user.email,
      },
    });

    const ctx = await authenticate(request, env as never, db as never);

    expect(ctx?.user.email).toBe(user.email);
    expect(ctx?.isImpersonating).toBe(true);
  });
});

describe('timingSafeCompare', () => {
  it('should return true for equal strings', () => {
    expect(timingSafeCompare('equal', 'equal')).toBe(true);
  });

  it('should return false for different strings', () => {
    expect(timingSafeCompare('equal', 'nope')).toBe(false);
  });

  it('should return false for different length strings', () => {
    expect(timingSafeCompare('short', 'longer')).toBe(false);
  });

  it('should handle empty strings', () => {
    expect(timingSafeCompare('', '')).toBe(true);
  });
});
