import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/index';
import type { MockD1Database } from './helpers/mockD1';
import { createMockD1Database } from './helpers/mockD1';

function createExecutionContext(): ExecutionContext {
  return {
    waitUntil: () => {},
    passThroughOnException: () => {}
  };
}

function buildRequest(path: string, init?: RequestInit): Request {
  return new Request(`https://example.com${path}`, init);
}

describe('api', () => {
  let db: MockD1Database;
  let env: { DB: MockD1Database; API_SECRET: string };

  beforeEach(() => {
    db = createMockD1Database({ now: () => '2026-01-31T13:00:00.000Z' });
    env = { DB: db, API_SECRET: 'secret' };
  });

  it('should reject unauthorized requests', async () => {
    const response = await worker.fetch(
      buildRequest('/emails'),
      env as never,
      createExecutionContext()
    );

    expect(response.status).toBe(401);
  });

  it('should list emails with pagination', async () => {
    db.insertEmail({ subject: 'First', received_at: '2026-01-31T10:00:00.000Z' });
    db.insertEmail({ subject: 'Second', received_at: '2026-01-31T11:00:00.000Z' });

    const response = await worker.fetch(
      buildRequest('/emails?limit=1&offset=0', {
        headers: { Authorization: 'Bearer secret' }
      }),
      env as never,
      createExecutionContext()
    );

    expect(response.status).toBe(200);
    const body = (await response.json());

    expect(body.total).toBe(2);
    expect(body.limit).toBe(1);
    expect(body.offset).toBe(0);
    expect(body.emails).toHaveLength(1);
    expect(body.emails[0].subject).toBe('Second');
  });

  it('should return a single email by id', async () => {
    const record = db.insertEmail({ subject: 'Lookup' });

    const response = await worker.fetch(
      buildRequest(`/emails/${record.id}`, {
        headers: { Authorization: 'Bearer secret' }
      }),
      env as never,
      createExecutionContext()
    );

    expect(response.status).toBe(200);
    const body = (await response.json());
    expect(body.email.id).toBe(record.id);
    expect(body.email.subject).toBe('Lookup');
  });

  it('should update email fields', async () => {
    const record = db.insertEmail({ is_read: 0, is_starred: 0, folder: 'inbox' });

    const response = await worker.fetch(
      buildRequest(`/emails/${record.id}`, {
        method: 'PATCH',
        headers: {
          Authorization: 'Bearer secret',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ is_read: true, is_starred: true, folder: 'archive', mark_synced: true })
      }),
      env as never,
      createExecutionContext()
    );

    expect(response.status).toBe(200);
    const updated = db.emails.find((email) => email.id === record.id);
    expect(updated?.is_read).toBe(1);
    expect(updated?.is_starred).toBe(1);
    expect(updated?.folder).toBe('archive');
    expect(updated?.synced_at).toBe('2026-01-31T13:00:00.000Z');
  });

  it('should soft delete and permanently delete emails', async () => {
    const record = db.insertEmail({ folder: 'inbox' });

    const softResponse = await worker.fetch(
      buildRequest(`/emails/${record.id}`, {
        method: 'DELETE',
        headers: { Authorization: 'Bearer secret' }
      }),
      env as never,
      createExecutionContext()
    );

    expect(softResponse.status).toBe(200);
    const softDeleted = db.emails.find((email) => email.id === record.id);
    expect(softDeleted?.folder).toBe('trash');
    expect(softDeleted?.deleted_at).toBe('2026-01-31T13:00:00.000Z');

    const permanentResponse = await worker.fetch(
      buildRequest(`/emails/${record.id}?permanent=true`, {
        method: 'DELETE',
        headers: { Authorization: 'Bearer secret' }
      }),
      env as never,
      createExecutionContext()
    );

    expect(permanentResponse.status).toBe(200);
    expect(db.emails.find((email) => email.id === record.id)).toBeUndefined();
  });

  it('should return mailbox stats', async () => {
    db.insertEmail({ is_read: 0, is_starred: 1, folder: 'inbox' });
    db.insertEmail({ is_read: 1, is_starred: 0, folder: 'trash' });
    db.insertEmail({ is_read: 0, is_starred: 0, folder: 'inbox', deleted_at: '2026-01-31T12:00:00.000Z' });

    const response = await worker.fetch(
      buildRequest('/stats', {
        headers: { Authorization: 'Bearer secret' }
      }),
      env as never,
      createExecutionContext()
    );

    expect(response.status).toBe(200);
    const body = (await response.json());

    expect(body.stats.total).toBe(2);
    expect(body.stats.unread).toBe(1);
    expect(body.stats.starred).toBe(1);
    expect(body.stats.inbox).toBe(1);
    expect(body.stats.trash).toBe(1);
  });
});
