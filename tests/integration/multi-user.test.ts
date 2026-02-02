import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import worker from '../../src/index';
import type { MockD1Database } from '../helpers/mockD1';
import { createMockD1Database } from '../helpers/mockD1';

function createExecutionContext(): ExecutionContext {
  return {
    waitUntil: () => {},
    passThroughOnException: () => {},
  };
}

function buildRequest(path: string, init?: RequestInit): Request {
  return new Request(`https://example.com${path}`, init);
}

function streamFrom(text: string): ReadableStream {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

describe('Multi-user Backend Integration', () => {
  let db: MockD1Database;
  let env: { DB: MockD1Database; API_SECRET: string; RESEND_API_KEY: string };
  let originalFetch: typeof globalThis.fetch | undefined;

  beforeAll(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error('Unexpected fetch call');
    };
  });

  afterAll(() => {
    if (originalFetch) globalThis.fetch = originalFetch;
  });

  beforeEach(() => {
    db = createMockD1Database({ now: () => '2026-02-02T10:00:00.000Z' });
    env = { DB: db, API_SECRET: 'secret', RESEND_API_KEY: 'test-key' };
  });

  function insertUserWithAlias(email: string, role = 'user') {
    const user = db.insertUser({ email, role });
    db.insertUserAlias({ user_id: user.id, address: email, is_primary: 1 });
    return user;
  }

  async function createApiKeyForUser(
    user: { email: string },
    options?: { scopes?: string; name?: string },
  ) {
    const response = await worker.fetch(
      buildRequest('/api-keys', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer secret',
          'Content-Type': 'application/json',
          'X-Mercury-User': user.email,
        },
        body: JSON.stringify(options ?? {}),
      }),
      env as never,
      createExecutionContext(),
    );

    expect(response.status).toBe(201);
    return (await response.json()) as { key: string; prefix: string; scopes: string };
  }

  describe('User Isolation', () => {
    it('should allow admin key to see all emails', async () => {
      const userA = db.insertUser({ email: 'user-a@example.com', role: 'user' });
      const userB = db.insertUser({ email: 'user-b@example.com', role: 'user' });
      db.insertEmail({ subject: 'A1', user_id: userA.id });
      db.insertEmail({ subject: 'B1', user_id: userB.id });

      const response = await worker.fetch(
        buildRequest('/emails', {
          headers: { Authorization: 'Bearer secret' },
        }),
        env as never,
        createExecutionContext(),
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.total).toBe(2);
      expect(body.emails).toHaveLength(2);
    });

    it('should scope user key to own emails', async () => {
      const userA = db.insertUser({ email: 'user-a@example.com', role: 'user' });
      const userB = db.insertUser({ email: 'user-b@example.com', role: 'user' });
      db.insertEmail({ subject: 'A1', user_id: userA.id });
      db.insertEmail({ subject: 'B1', user_id: userB.id });

      const { key } = await createApiKeyForUser(userA);

      const response = await worker.fetch(
        buildRequest('/emails', {
          headers: { Authorization: `Bearer ${key}` },
        }),
        env as never,
        createExecutionContext(),
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.total).toBe(1);
      expect(body.emails).toHaveLength(1);
      expect(body.emails[0].subject).toBe('A1');
    });

    it('should prevent user from accessing another user email by id', async () => {
      const userA = db.insertUser({ email: 'user-a@example.com', role: 'user' });
      const userB = db.insertUser({ email: 'user-b@example.com', role: 'user' });
      db.insertEmail({ subject: 'A1', user_id: userA.id });
      const emailB = db.insertEmail({ subject: 'B1', user_id: userB.id });

      const { key } = await createApiKeyForUser(userA);

      const response = await worker.fetch(
        buildRequest(`/emails/${emailB.id}`, {
          headers: { Authorization: `Bearer ${key}` },
        }),
        env as never,
        createExecutionContext(),
      );

      expect(response.status).toBe(404);
    });
  });

  describe('API Key Lifecycle', () => {
    it('should generate new api key with correct scopes', async () => {
      const user = db.insertUser({ email: 'scope@example.com', role: 'user' });

      const body = await createApiKeyForUser(user, { scopes: 'read,send', name: 'integration' });

      expect(body.key.startsWith('mk_')).toBe(true);
      expect(body.prefix).toBe(body.key.slice(0, 11));
      expect(body.scopes).toBe('read,send');
    });

    it('should authenticate with generated key', async () => {
      const user = db.insertUser({ email: 'auth@example.com', role: 'user' });
      db.insertEmail({ subject: 'Owned', user_id: user.id });

      const { key } = await createApiKeyForUser(user);

      const response = await worker.fetch(
        buildRequest('/emails', {
          headers: { Authorization: `Bearer ${key}` },
        }),
        env as never,
        createExecutionContext(),
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.total).toBe(1);
      expect(body.emails).toHaveLength(1);
    });

    it('should reject revoked key', async () => {
      const user = db.insertUser({ email: 'revoked@example.com', role: 'user' });

      const { key } = await createApiKeyForUser(user);

      const listResponse = await worker.fetch(
        buildRequest('/api-keys', {
          headers: { Authorization: `Bearer ${key}` },
        }),
        env as never,
        createExecutionContext(),
      );

      expect(listResponse.status).toBe(200);
      const listBody = await listResponse.json();
      const keyId = listBody.keys[0].id as number;

      const revokeResponse = await worker.fetch(
        buildRequest(`/api-keys/${keyId}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${key}` },
        }),
        env as never,
        createExecutionContext(),
      );

      expect(revokeResponse.status).toBe(200);

      const response = await worker.fetch(
        buildRequest('/emails', {
          headers: { Authorization: `Bearer ${key}` },
        }),
        env as never,
        createExecutionContext(),
      );

      expect(response.status).toBe(401);
    });
  });

  describe('Impersonation', () => {
    it('should allow admin to impersonate user via X-Mercury-User', async () => {
      const user = db.insertUser({ email: 'impersonate@example.com', role: 'user' });

      const response = await worker.fetch(
        buildRequest('/me', {
          headers: {
            Authorization: 'Bearer secret',
            'X-Mercury-User': user.email,
          },
        }),
        env as never,
        createExecutionContext(),
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.user.id).toBe(user.id);
      expect(body.user.email).toBe(user.email);
    });

    it('should ignore impersonation for non-admin keys', async () => {
      const userA = db.insertUser({ email: 'user-a@example.com', role: 'user' });
      const userB = db.insertUser({ email: 'user-b@example.com', role: 'user' });
      const { key } = await createApiKeyForUser(userA);

      const response = await worker.fetch(
        buildRequest('/me', {
          headers: {
            Authorization: `Bearer ${key}`,
            'X-Mercury-User': userB.email,
          },
        }),
        env as never,
        createExecutionContext(),
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.user.id).toBe(userA.id);
      expect(body.user.email).toBe(userA.email);
    });
  });

  describe('Inbound Email Routing', () => {
    it('should set user_id for known alias', async () => {
      const user = insertUserWithAlias('kaylee@mistystep.io');
      insertUserWithAlias('shared@mistystep.io', 'system');

      const message = {
        from: 'alice@example.com',
        to: 'kaylee@mistystep.io',
        headers: new Headers({ subject: 'Hello' }),
        raw: streamFrom('Email body'),
        rawSize: 10,
      };

      await worker.email(message as never, env as never, createExecutionContext());

      expect(db.emails).toHaveLength(1);
      expect(db.emails[0].user_id).toBe(user.id);
    });

    it('should route unknown address to shared user', async () => {
      const shared = insertUserWithAlias('shared@mistystep.io', 'system');

      const message = {
        from: 'alice@example.com',
        to: 'unknown@mistystep.io',
        headers: new Headers({ subject: 'Fallback' }),
        raw: streamFrom('Email body'),
        rawSize: 10,
      };

      await worker.email(message as never, env as never, createExecutionContext());

      expect(db.emails).toHaveLength(1);
      expect(db.emails[0].user_id).toBe(shared.id);
    });

    it('should route plus-addressed email to base alias', async () => {
      const user = insertUserWithAlias('kaylee@mistystep.io');
      insertUserWithAlias('shared@mistystep.io', 'system');

      const message = {
        from: 'alice@example.com',
        to: 'kaylee+test@mistystep.io',
        headers: new Headers({ subject: 'Plus' }),
        raw: streamFrom('Email body'),
        rawSize: 10,
      };

      await worker.email(message as never, env as never, createExecutionContext());

      expect(db.emails).toHaveLength(1);
      expect(db.emails[0].user_id).toBe(user.id);
    });
  });

  describe('Send Validation', () => {
    it('should reject sending from unowned alias', async () => {
      const userA = insertUserWithAlias('kaylee@mistystep.io');
      insertUserWithAlias('zoe@mistystep.io');
      const { key } = await createApiKeyForUser(userA);

      const response = await worker.fetch(
        buildRequest('/send', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: 'zoe@mistystep.io',
            to: 'wash@example.com',
            subject: 'Test',
            text: 'Hello',
          }),
        }),
        env as never,
        createExecutionContext(),
      );

      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toBe('From address not allowed');
    });
  });
});
