import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/index';
import { hashApiKey } from '../src/auth';
import type { MockD1Database } from './helpers/mockD1';
import { createMockD1Database } from './helpers/mockD1';

function createExecutionContext(): ExecutionContext {
  return {
    waitUntil: () => {},
    passThroughOnException: () => {},
  };
}

function buildRequest(path: string, init?: RequestInit): Request {
  return new Request(`https://example.com${path}`, init);
}

describe('api keys', () => {
  let db: MockD1Database;
  let env: { DB: MockD1Database; API_SECRET: string; RESEND_API_KEY: string };
  let userA: ReturnType<MockD1Database['insertUser']>;
  let userB: ReturnType<MockD1Database['insertUser']>;

  async function insertKeyForUser(userId: number, token: string, scopes = 'read,write,send') {
    const keyHash = await hashApiKey(token);
    return db.insertApiKey({
      user_id: userId,
      key_hash: keyHash,
      prefix: token.slice(0, 11),
      scopes,
    });
  }

  beforeEach(() => {
    db = createMockD1Database({ now: () => '2026-02-02T09:00:00.000Z' });
    env = { DB: db, API_SECRET: 'secret', RESEND_API_KEY: 'test-key' };
    userA = db.insertUser({ email: 'user-a@example.com', role: 'user' });
    userB = db.insertUser({ email: 'user-b@example.com', role: 'user' });
  });

  describe('handleCreateApiKey', () => {
    it('should reject admin scope for non-admin user', async () => {
      const token = 'mk_user_a_token';
      await insertKeyForUser(userA.id, token, 'read,write,send');

      const response = await worker.fetch(
        buildRequest('/api-keys', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ scopes: 'admin' }),
        }),
        env as never,
        createExecutionContext(),
      );

      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body).toEqual({ error: 'Invalid scope: admin' });
    });

    it('should reject unknown scopes', async () => {
      const token = 'mk_user_a_token';
      await insertKeyForUser(userA.id, token, 'read,write,send');

      const response = await worker.fetch(
        buildRequest('/api-keys', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ scopes: 'read,write,unknown' }),
        }),
        env as never,
        createExecutionContext(),
      );

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body).toEqual({ error: 'Unknown scope: unknown' });
    });

    it('should only allow scopes the user already has', async () => {
      const token = 'mk_user_a_token';
      await insertKeyForUser(userA.id, token, 'read,write');

      const response = await worker.fetch(
        buildRequest('/api-keys', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ scopes: 'read,write,send' }),
        }),
        env as never,
        createExecutionContext(),
      );

      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body).toEqual({ error: 'Cannot grant scope: send' });
    });

    it('should allow admin to grant admin scope', async () => {
      const response = await worker.fetch(
        buildRequest('/api-keys', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer secret',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ scopes: 'admin,read,write' }),
        }),
        env as never,
        createExecutionContext(),
      );

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.scopes).toBe('admin,read,write');
      expect(db.apiKeys[0].scopes).toBe('admin,read,write');
    });

    it('should reject unknown scopes even for admin', async () => {
      const response = await worker.fetch(
        buildRequest('/api-keys', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer secret',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ scopes: 'admin,custom' }),
        }),
        env as never,
        createExecutionContext(),
      );

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body).toEqual({ error: 'Unknown scope: custom' });
    });

    it('should default to read,write,send for empty scopes', async () => {
      const token = 'mk_user_a_token';
      await insertKeyForUser(userA.id, token, 'read,write,send');

      const response = await worker.fetch(
        buildRequest('/api-keys', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ scopes: '' }),
        }),
        env as never,
        createExecutionContext(),
      );

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.scopes).toBe('read,write,send');
      expect(db.apiKeys[0].scopes).toBe('read,write,send');
    });

    it('should enforce max 10 active keys per user', async () => {
      const token = 'mk_user_a_token';
      await insertKeyForUser(userA.id, token);
      for (let i = 0; i < 9; i += 1) {
        await insertKeyForUser(userA.id, `mk_user_a_token_${i}`);
      }

      const response = await worker.fetch(
        buildRequest('/api-keys', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ name: 'Overflow' }),
        }),
        env as never,
        createExecutionContext(),
      );

      expect(response.status).toBe(429);
      const body = await response.json();
      expect(body).toEqual({
        error: 'Maximum of 10 active API keys per user. Revoke unused keys first.',
      });
    });

    it('should allow creating keys after revoking old ones', async () => {
      const token = 'mk_user_a_token';
      await insertKeyForUser(userA.id, token);
      const keyIds: number[] = [];
      for (let i = 0; i < 9; i += 1) {
        const key = await insertKeyForUser(userA.id, `mk_user_a_token_${i}`);
        keyIds.push(key.id);
      }

      const revokeResponse = await worker.fetch(
        buildRequest(`/api-keys/${keyIds[0]}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        }),
        env as never,
        createExecutionContext(),
      );

      expect(revokeResponse.status).toBe(200);

      const response = await worker.fetch(
        buildRequest('/api-keys', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ name: 'Replacement' }),
        }),
        env as never,
        createExecutionContext(),
      );

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(typeof body.key).toBe('string');
    });
  });

  it('should return full api key once', async () => {
    const response = await worker.fetch(
      buildRequest('/api-keys', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer secret',
          'Content-Type': 'application/json',
          'X-Mercury-User': userA.email,
        },
        body: JSON.stringify({ name: 'CLI' }),
      }),
      env as never,
      createExecutionContext(),
    );

    expect(response.status).toBe(201);
    const body = await response.json();

    expect(typeof body.key).toBe('string');
    expect(body.key.startsWith('mk_')).toBe(true);
    expect(body.prefix).toBe(body.key.slice(0, 11));

    const stored = db.apiKeys[0];
    expect(stored.key_hash).toBeTruthy();
    expect(stored.key_hash).not.toBe(body.key);

    const listResponse = await worker.fetch(
      buildRequest('/api-keys', {
        headers: {
          Authorization: 'Bearer secret',
          'X-Mercury-User': userA.email,
        },
      }),
      env as never,
      createExecutionContext(),
    );

    expect(listResponse.status).toBe(200);
    const listBody = await listResponse.json();
    expect(listBody.keys).toHaveLength(1);
    expect(listBody.keys[0].key).toBeUndefined();
    expect(listBody.keys[0].key_hash).toBeUndefined();
  });

  it('should list keys without hashes', async () => {
    const token = 'mk_user_a_token';
    await insertKeyForUser(userA.id, token);

    const response = await worker.fetch(
      buildRequest('/api-keys', {
        headers: { Authorization: `Bearer ${token}` },
      }),
      env as never,
      createExecutionContext(),
    );

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.keys).toHaveLength(1);
    expect(body.keys[0].prefix).toBe(token.slice(0, 11));
    expect(body.keys[0].key_hash).toBeUndefined();
    expect(body.keys[0].key).toBeUndefined();
  });

  it('should revoke keys for owner', async () => {
    const token = 'mk_owner_token';
    const key = await insertKeyForUser(userA.id, token);

    const response = await worker.fetch(
      buildRequest(`/api-keys/${key.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      }),
      env as never,
      createExecutionContext(),
    );

    expect(response.status).toBe(200);
    const revoked = db.apiKeys.find((item) => item.id === key.id);
    expect(revoked?.revoked_at).toBe('2026-02-02T09:00:00.000Z');
  });

  it('should limit user to own keys', async () => {
    const tokenA = 'mk_user_a_token';
    const tokenB = 'mk_user_b_token';
    const keyA = await insertKeyForUser(userA.id, tokenA);
    const keyB = await insertKeyForUser(userB.id, tokenB);

    const listResponse = await worker.fetch(
      buildRequest('/api-keys', {
        headers: { Authorization: `Bearer ${tokenA}` },
      }),
      env as never,
      createExecutionContext(),
    );

    expect(listResponse.status).toBe(200);
    const listBody = await listResponse.json();
    expect(listBody.keys).toHaveLength(1);
    expect(listBody.keys[0].id).toBe(keyA.id);

    const revokeResponse = await worker.fetch(
      buildRequest(`/api-keys/${keyB.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${tokenA}` },
      }),
      env as never,
      createExecutionContext(),
    );

    expect(revokeResponse.status).toBe(404);
    const untouched = db.apiKeys.find((item) => item.id === keyB.id);
    expect(untouched?.revoked_at).toBeNull();
  });

  it('should allow admin to see and revoke any key', async () => {
    const tokenA = 'mk_admin_user_a';
    const tokenB = 'mk_admin_user_b';
    const keyA = await insertKeyForUser(userA.id, tokenA);
    const keyB = await insertKeyForUser(userB.id, tokenB);

    const listResponse = await worker.fetch(
      buildRequest('/api-keys', {
        headers: { Authorization: 'Bearer secret' },
      }),
      env as never,
      createExecutionContext(),
    );

    expect(listResponse.status).toBe(200);
    const listBody = await listResponse.json();
    const ids = listBody.keys.map((item: { id: number }) => item.id).sort();
    expect(ids).toEqual([keyA.id, keyB.id].sort());

    const revokeResponse = await worker.fetch(
      buildRequest(`/api-keys/${keyB.id}`, {
        method: 'DELETE',
        headers: { Authorization: 'Bearer secret' },
      }),
      env as never,
      createExecutionContext(),
    );

    expect(revokeResponse.status).toBe(200);
    const revoked = db.apiKeys.find((item) => item.id === keyB.id);
    expect(revoked?.revoked_at).toBe('2026-02-02T09:00:00.000Z');
  });
});
