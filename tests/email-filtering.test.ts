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

function seedEmails(db: MockD1Database) {
  const userA = db.insertUser({ email: 'user-a@example.com', role: 'user' });
  const userB = db.insertUser({ email: 'user-b@example.com', role: 'user' });
  const emailA = db.insertEmail({
    subject: 'A1',
    recipient: 'alice@example.com',
    user_id: userA.id,
  });
  const emailB = db.insertEmail({
    subject: 'B1',
    recipient: 'bob@example.com',
    user_id: userB.id,
  });

  return { userA, userB, emailA, emailB };
}

describe('email filtering', () => {
  let db: MockD1Database;
  let env: { DB: MockD1Database; API_SECRET: string; RESEND_API_KEY: string };

  beforeEach(() => {
    db = createMockD1Database({ now: () => '2026-02-01T11:00:00.000Z' });
    env = { DB: db, API_SECRET: 'secret', RESEND_API_KEY: 'test-key' };
  });

  it('should scope non-admin list to user id', async () => {
    const { userA } = seedEmails(db);

    const response = await worker.fetch(
      buildRequest('/emails?recipient=bob@example.com', {
        headers: {
          Authorization: 'Bearer secret',
          'X-Mercury-User': userA.email,
        },
      }),
      env as never,
      createExecutionContext(),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.emails).toHaveLength(1);
    expect(body.emails[0].subject).toBe('A1');
    expect(body.total).toBe(1);
  });

  it('should allow admin to see all emails', async () => {
    seedEmails(db);

    const response = await worker.fetch(
      buildRequest('/emails', {
        headers: { Authorization: 'Bearer secret' },
      }),
      env as never,
      createExecutionContext(),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.emails).toHaveLength(2);
    expect(body.total).toBe(2);
  });

  it('should allow admin to filter by recipient', async () => {
    seedEmails(db);

    const response = await worker.fetch(
      buildRequest('/emails?recipient=bob@example.com', {
        headers: { Authorization: 'Bearer secret' },
      }),
      env as never,
      createExecutionContext(),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.emails).toHaveLength(1);
    expect(body.emails[0].subject).toBe('B1');
    expect(body.total).toBe(1);
  });

  it('should allow admin to filter by user_id', async () => {
    const { userA } = seedEmails(db);

    const response = await worker.fetch(
      buildRequest(`/emails?user_id=${userA.id}`, {
        headers: { Authorization: 'Bearer secret' },
      }),
      env as never,
      createExecutionContext(),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.emails).toHaveLength(1);
    expect(body.emails[0].subject).toBe('A1');
    expect(body.total).toBe(1);
  });

  it('should prevent non-admin from reading other user emails by id', async () => {
    const { userA, emailB } = seedEmails(db);

    const response = await worker.fetch(
      buildRequest(`/emails/${emailB.id}`, {
        headers: {
          Authorization: 'Bearer secret',
          'X-Mercury-User': userA.email,
        },
      }),
      env as never,
      createExecutionContext(),
    );

    expect(response.status).toBe(404);
  });
});

describe('Email ownership enforcement', () => {
  let db: MockD1Database;
  let env: { DB: MockD1Database; API_SECRET: string; RESEND_API_KEY: string };

  beforeEach(() => {
    db = createMockD1Database({ now: () => '2026-02-01T11:00:00.000Z' });
    env = { DB: db, API_SECRET: 'secret', RESEND_API_KEY: 'test-key' };
  });

  it('should prevent user from updating another user email', async () => {
    const { userA, emailB } = seedEmails(db);

    const response = await worker.fetch(
      buildRequest(`/emails/${emailB.id}`, {
        method: 'PATCH',
        headers: {
          Authorization: 'Bearer secret',
          'X-Mercury-User': userA.email,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ is_read: true }),
      }),
      env as never,
      createExecutionContext(),
    );

    expect(response.status).toBe(404);
    const unchanged = db.emails.find((email) => email.id === emailB.id);
    expect(unchanged?.is_read).toBe(0);
  });

  it('should allow user to update own email', async () => {
    const { userA, emailA } = seedEmails(db);

    const response = await worker.fetch(
      buildRequest(`/emails/${emailA.id}`, {
        method: 'PATCH',
        headers: {
          Authorization: 'Bearer secret',
          'X-Mercury-User': userA.email,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ is_read: true }),
      }),
      env as never,
      createExecutionContext(),
    );

    expect(response.status).toBe(200);
    const updated = db.emails.find((email) => email.id === emailA.id);
    expect(updated?.is_read).toBe(1);
  });

  it('should allow admin to update any email', async () => {
    const { emailB } = seedEmails(db);

    const response = await worker.fetch(
      buildRequest(`/emails/${emailB.id}`, {
        method: 'PATCH',
        headers: {
          Authorization: 'Bearer secret',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ is_starred: true }),
      }),
      env as never,
      createExecutionContext(),
    );

    expect(response.status).toBe(200);
    const updated = db.emails.find((email) => email.id === emailB.id);
    expect(updated?.is_starred).toBe(1);
  });

  it('should prevent user from deleting another user email', async () => {
    const { userA, emailB } = seedEmails(db);

    const response = await worker.fetch(
      buildRequest(`/emails/${emailB.id}`, {
        method: 'DELETE',
        headers: {
          Authorization: 'Bearer secret',
          'X-Mercury-User': userA.email,
        },
      }),
      env as never,
      createExecutionContext(),
    );

    expect(response.status).toBe(404);
    const unchanged = db.emails.find((email) => email.id === emailB.id);
    expect(unchanged?.deleted_at).toBeNull();
    expect(unchanged?.folder).toBe('inbox');
  });

  it('should allow user to delete own email', async () => {
    const { userA, emailA } = seedEmails(db);

    const response = await worker.fetch(
      buildRequest(`/emails/${emailA.id}`, {
        method: 'DELETE',
        headers: {
          Authorization: 'Bearer secret',
          'X-Mercury-User': userA.email,
        },
      }),
      env as never,
      createExecutionContext(),
    );

    expect(response.status).toBe(200);
    const deleted = db.emails.find((email) => email.id === emailA.id);
    expect(deleted?.deleted_at).toBe('2026-02-01T11:00:00.000Z');
    expect(deleted?.folder).toBe('trash');
  });

  it('should allow admin to delete any email', async () => {
    const { emailB } = seedEmails(db);

    const response = await worker.fetch(
      buildRequest(`/emails/${emailB.id}`, {
        method: 'DELETE',
        headers: {
          Authorization: 'Bearer secret',
        },
      }),
      env as never,
      createExecutionContext(),
    );

    expect(response.status).toBe(200);
    const deleted = db.emails.find((email) => email.id === emailB.id);
    expect(deleted?.deleted_at).toBe('2026-02-01T11:00:00.000Z');
    expect(deleted?.folder).toBe('trash');
  });
});

describe('getStats', () => {
  let db: MockD1Database;
  let env: { DB: MockD1Database; API_SECRET: string; RESEND_API_KEY: string };

  beforeEach(() => {
    db = createMockD1Database({ now: () => '2026-02-01T11:00:00.000Z' });
    env = { DB: db, API_SECRET: 'secret', RESEND_API_KEY: 'test-key' };
  });

  it('should return only own stats for non-admin', async () => {
    const userA = db.insertUser({ email: 'user-a@example.com', role: 'user' });
    const userB = db.insertUser({ email: 'user-b@example.com', role: 'user' });

    db.insertEmail({ user_id: userA.id, is_read: 0, is_starred: 1, folder: 'inbox' });
    db.insertEmail({ user_id: userA.id, is_read: 1, is_starred: 0, folder: 'trash' });
    db.insertEmail({ user_id: userB.id, is_read: 0, is_starred: 0, folder: 'inbox' });

    const response = await worker.fetch(
      buildRequest('/stats', {
        headers: {
          Authorization: 'Bearer secret',
          'X-Mercury-User': userA.email,
        },
      }),
      env as never,
      createExecutionContext(),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.stats.total).toBe(2);
    expect(body.stats.unread).toBe(1);
    expect(body.stats.starred).toBe(1);
    expect(body.stats.inbox).toBe(1);
    expect(body.stats.trash).toBe(1);
  });

  it('should return global stats for admin', async () => {
    const userA = db.insertUser({ email: 'user-a@example.com', role: 'user' });
    const userB = db.insertUser({ email: 'user-b@example.com', role: 'user' });

    db.insertEmail({ user_id: userA.id, is_read: 0, is_starred: 1, folder: 'inbox' });
    db.insertEmail({ user_id: userA.id, is_read: 1, is_starred: 0, folder: 'trash' });
    db.insertEmail({ user_id: userB.id, is_read: 0, is_starred: 0, folder: 'inbox' });

    const response = await worker.fetch(
      buildRequest('/stats', {
        headers: { Authorization: 'Bearer secret' },
      }),
      env as never,
      createExecutionContext(),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.stats.total).toBe(3);
    expect(body.stats.unread).toBe(2);
    expect(body.stats.starred).toBe(1);
    expect(body.stats.inbox).toBe(2);
    expect(body.stats.trash).toBe(1);
  });
});
