import { describe, expect, it } from 'vitest';
import worker from '../src/index';
import { createMockD1Database } from './helpers/mockD1';

function createExecutionContext(): ExecutionContext {
  return {
    waitUntil: () => {},
    passThroughOnException: () => {},
  };
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

describe('email handler', () => {
  it('should store inbound email with headers and assign user id for known alias', async () => {
    const db = createMockD1Database({ now: () => '2026-01-31T12:00:00.000Z' });
    const user = db.insertUser({ email: 'kaylee@mistystep.io' });
    db.insertUserAlias({ user_id: user.id, address: 'kaylee@mistystep.io', is_primary: 1 });
    db.insertUser({ email: 'shared@mistystep.io' });
    const env = { DB: db, API_SECRET: 'secret', RESEND_API_KEY: 'resend' };

    const message = {
      from: 'alice@example.com',
      to: 'kaylee@mistystep.io',
      headers: new Headers({
        'message-id': '<test-id>',
        subject: 'Hello',
        'X-Custom': 'Value',
      }),
      raw: streamFrom('Email body'),
      rawSize: 10,
    };

    await worker.email(message as never, env as never, createExecutionContext());

    expect(db.emails).toHaveLength(1);
    const stored = db.emails[0];
    expect(stored.message_id).toBe('<test-id>');
    expect(stored.subject).toBe('Hello');
    expect(stored.raw_email).toBe('Email body');
    expect(stored.user_id).toBe(user.id);

    const headers = JSON.parse(stored.headers_json) as Record<string, string>;
    expect(headers['message-id']).toBe('<test-id>');
    expect(headers.subject).toBe('Hello');
    expect(headers['x-custom']).toBe('Value');
  });

  it('should fall back to shared user for unknown recipient', async () => {
    const db = createMockD1Database();
    const shared = db.insertUser({ email: 'shared@mistystep.io' });
    const env = { DB: db, API_SECRET: 'secret', RESEND_API_KEY: 'resend' };

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

  it('should match plus-addressed recipient to base alias', async () => {
    const db = createMockD1Database();
    const user = db.insertUser({ email: 'kaylee@mistystep.io' });
    db.insertUserAlias({ user_id: user.id, address: 'kaylee@mistystep.io', is_primary: 1 });
    db.insertUser({ email: 'shared@mistystep.io' });
    const env = { DB: db, API_SECRET: 'secret', RESEND_API_KEY: 'resend' };

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
