import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/index';
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

describe('users', () => {
  let db: MockD1Database;
  let env: { DB: MockD1Database; API_SECRET: string; RESEND_API_KEY: string };
  let adminUser: ReturnType<MockD1Database['insertUser']>;
  let regularUser: ReturnType<MockD1Database['insertUser']>;

  beforeEach(() => {
    db = createMockD1Database({ now: () => '2026-02-01T10:00:00.000Z' });
    env = { DB: db, API_SECRET: 'secret', RESEND_API_KEY: 'test-key' };
    adminUser = db.insertUser({ email: 'admin@example.com', name: 'Admin', role: 'admin' });
    regularUser = db.insertUser({ email: 'user@example.com', name: 'User', role: 'user' });
  });

  it('should allow admin to list users', async () => {
    const response = await worker.fetch(
      buildRequest('/users', {
        headers: {
          Authorization: 'Bearer secret',
          'X-Mercury-User': adminUser.email,
        },
      }),
      env as never,
      createExecutionContext(),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.users).toHaveLength(2);
  });

  it('should reject non-admin list users', async () => {
    const response = await worker.fetch(
      buildRequest('/users', {
        headers: {
          Authorization: 'Bearer secret',
          'X-Mercury-User': regularUser.email,
        },
      }),
      env as never,
      createExecutionContext(),
    );

    expect(response.status).toBe(403);
  });

  it('should return current user for me', async () => {
    const response = await worker.fetch(
      buildRequest('/me', {
        headers: {
          Authorization: 'Bearer secret',
          'X-Mercury-User': regularUser.email,
        },
      }),
      env as never,
      createExecutionContext(),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.user.id).toBe(regularUser.id);
    expect(body.user.email).toBe('user@example.com');
  });

  it('should create user and alias', async () => {
    const response = await worker.fetch(
      buildRequest('/users', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer secret',
          'Content-Type': 'application/json',
          'X-Mercury-User': adminUser.email,
        },
        body: JSON.stringify({
          email: 'new@example.com',
          name: 'New User',
          role: 'user',
        }),
      }),
      env as never,
      createExecutionContext(),
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.user.email).toBe('new@example.com');

    const created = db.users.find((user) => user.email === 'new@example.com');
    expect(created).toBeTruthy();

    const alias = db.userAliases.find((item) => item.user_id === created?.id);
    expect(alias?.address).toBe('new@example.com');
    expect(alias?.is_primary).toBe(1);
  });

  describe('handleCreateUser', () => {
    it('should create user and alias atomically', async () => {
      db.insertUserAlias({
        user_id: adminUser.id,
        address: 'taken@example.com',
        is_primary: 1,
      });

      const response = await worker.fetch(
        buildRequest('/users', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer secret',
            'Content-Type': 'application/json',
            'X-Mercury-User': adminUser.email,
          },
          body: JSON.stringify({
            email: 'taken@example.com',
            name: 'Taken User',
            role: 'user',
          }),
        }),
        env as never,
        createExecutionContext(),
      );

      expect(response.status).toBe(500);

      const created = db.users.find((user) => user.email === 'taken@example.com');
      expect(created).toBeUndefined();
    });
  });

  it('should prevent non-admin from reading another user', async () => {
    const response = await worker.fetch(
      buildRequest(`/users/${adminUser.id}`, {
        headers: {
          Authorization: 'Bearer secret',
          'X-Mercury-User': regularUser.email,
        },
      }),
      env as never,
      createExecutionContext(),
    );

    expect(response.status).toBe(403);
  });
});
