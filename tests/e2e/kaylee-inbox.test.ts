/**
 * E2E Test: Kaylee's Isolated Inbox
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import worker from '../../src/index';
import { createMockD1Database, MockD1Database } from '../helpers/mockD1';

function createExecutionContext(): ExecutionContext {
  return { waitUntil: () => {}, passThroughOnException: () => {} };
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

describe('E2E: Kaylee Isolated Inbox', () => {
  let db: MockD1Database;
  let env: { DB: MockD1Database; API_SECRET: string; RESEND_API_KEY: string };
  let originalFetch: typeof globalThis.fetch;

  beforeAll(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error('Unexpected fetch');
    };
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  beforeEach(() => {
    db = createMockD1Database();
    env = { DB: db, API_SECRET: 'admin-secret', RESEND_API_KEY: 'test-key' };
  });

  it('should isolate kaylee inbox from other users', async () => {
    // Setup users
    const shared = db.insertUser({ email: 'shared@mistystep.io', role: 'system' });
    db.insertUserAlias({ user_id: shared.id, address: 'shared@mistystep.io', is_primary: 1 });

    const phaedrus = db.insertUser({ email: 'phaedrus@mistystep.io', role: 'admin' });
    db.insertUserAlias({ user_id: phaedrus.id, address: 'phaedrus@mistystep.io', is_primary: 1 });

    const kaylee = db.insertUser({ email: 'kaylee@mistystep.io', role: 'user' });
    db.insertUserAlias({ user_id: kaylee.id, address: 'kaylee@mistystep.io', is_primary: 1 });

    // Create API key for kaylee via impersonation
    const createKeyResp = await worker.fetch(
      buildRequest('/api-keys', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer admin-secret',
          'Content-Type': 'application/json',
          'X-Mercury-User': 'kaylee@mistystep.io',
        },
        body: JSON.stringify({ name: 'Kaylee CLI' }),
      }),
      env as never,
      createExecutionContext(),
    );
    expect(createKeyResp.status).toBe(201);
    const { key: kayleeKey } = (await createKeyResp.json()) as { key: string };

    // Send emails to different recipients
    await worker.email(
      {
        from: 'alice@example.com',
        to: 'kaylee@mistystep.io',
        headers: new Headers({ subject: 'For Kaylee' }),
        raw: streamFrom('Private'),
        rawSize: 7,
      } as never,
      env as never,
      createExecutionContext(),
    );

    await worker.email(
      {
        from: 'bob@example.com',
        to: 'phaedrus@mistystep.io',
        headers: new Headers({ subject: 'For Phaedrus' }),
        raw: streamFrom('Admin stuff'),
        rawSize: 11,
      } as never,
      env as never,
      createExecutionContext(),
    );

    await worker.email(
      {
        from: 'charlie@example.com',
        to: 'unknown@mistystep.io',
        headers: new Headers({ subject: 'For Unknown' }),
        raw: streamFrom('Catch-all'),
        rawSize: 9,
      } as never,
      env as never,
      createExecutionContext(),
    );

    // Admin sees all 3 emails
    const adminResp = await worker.fetch(
      buildRequest('/emails', { headers: { Authorization: 'Bearer admin-secret' } }),
      env as never,
      createExecutionContext(),
    );
    const adminData = (await adminResp.json()) as { total: number };
    expect(adminData.total).toBe(3);

    // Kaylee sees only 1 email
    const kayleeResp = await worker.fetch(
      buildRequest('/emails', { headers: { Authorization: `Bearer ${kayleeKey}` } }),
      env as never,
      createExecutionContext(),
    );
    const kayleeData = (await kayleeResp.json()) as {
      total: number;
      emails: { subject: string }[];
    };
    expect(kayleeData.total).toBe(1);
    expect(kayleeData.emails[0].subject).toBe('For Kaylee');

    // Kaylee cannot access phaedrus email by ID
    const phaedrusEmailId = db.emails.find(
      (email) => email.recipient === 'phaedrus@mistystep.io',
    )!.id;
    const forbiddenResp = await worker.fetch(
      buildRequest(`/emails/${phaedrusEmailId}`, {
        headers: { Authorization: `Bearer ${kayleeKey}` },
      }),
      env as never,
      createExecutionContext(),
    );
    expect(forbiddenResp.status).toBe(404);
  });
});
