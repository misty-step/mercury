import { describe, expect, it } from 'vitest';
import worker from '../src/index';
import { createMockD1Database } from './helpers/mockD1';

function createExecutionContext(): ExecutionContext {
  return {
    waitUntil: () => {},
    passThroughOnException: () => {}
  };
}

function streamFrom(text: string): ReadableStream {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    }
  });
}

describe('email handler', () => {
  it('should store inbound email with headers and raw content', async () => {
    const db = createMockD1Database({ now: () => '2026-01-31T12:00:00.000Z' });
    const env = { DB: db, API_SECRET: 'secret' };

    const message = {
      from: 'alice@example.com',
      to: 'bob@example.com',
      headers: new Headers({
        'message-id': '<test-id>',
        subject: 'Hello',
        'X-Custom': 'Value'
      }),
      raw: streamFrom('Email body'),
      rawSize: 10
    };

    await worker.email(message as never, env as never, createExecutionContext());

    expect(db.emails).toHaveLength(1);
    const stored = db.emails[0];
    expect(stored.message_id).toBe('<test-id>');
    expect(stored.subject).toBe('Hello');
    expect(stored.raw_email).toBe('Email body');

    const headers = JSON.parse(stored.headers_json) as Record<string, string>;
    expect(headers['message-id']).toBe('<test-id>');
    expect(headers.subject).toBe('Hello');
    expect(headers['x-custom']).toBe('Value');
  });
});
