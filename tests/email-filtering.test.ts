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
