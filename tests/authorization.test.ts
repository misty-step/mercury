import { beforeEach, describe, expect, it } from 'vitest';
import type { AuthContext } from '../src/auth';
import { requireEmailOwnership } from '../src/authorization';
import type { MockD1Database } from './helpers/mockD1';
import { createMockD1Database } from './helpers/mockD1';

describe('requireEmailOwnership', () => {
  let db: MockD1Database;
  let env: { DB: MockD1Database; API_SECRET: string; RESEND_API_KEY: string };
  let user: ReturnType<MockD1Database['insertUser']>;
  let otherUser: ReturnType<MockD1Database['insertUser']>;
  let userAuth: AuthContext;
  let adminAuth: AuthContext;

  beforeEach(() => {
    db = createMockD1Database({ now: () => '2026-02-02T10:00:00.000Z' });
    env = { DB: db, API_SECRET: 'secret', RESEND_API_KEY: 'test-key' };
    user = db.insertUser({ email: 'user@example.com', role: 'user' });
    otherUser = db.insertUser({ email: 'other@example.com', role: 'user' });
    userAuth = {
      user: { id: user.id, email: user.email, role: 'user' },
      isImpersonating: false,
      scopes: new Set(['read']),
    };
    adminAuth = {
      user: { id: -1, email: 'admin', role: 'admin' },
      isImpersonating: false,
      scopes: new Set(['read', 'write', 'send', 'admin']),
    };
  });

  async function expectNotFound(promise: Promise<unknown>): Promise<void> {
    try {
      await promise;
      throw new Error('Expected not found');
    } catch (error) {
      expect(error).toBeInstanceOf(Response);
      expect((error as Response).status).toBe(404);
    }
  }

  it('should return email when user owns it', async () => {
    const email = db.insertEmail({ user_id: user.id });

    const result = await requireEmailOwnership(userAuth, env as never, email.id);

    expect(result).toMatchObject({ id: email.id, user_id: user.id });
  });

  it('should throw 404 when user does not own email', async () => {
    const email = db.insertEmail({ user_id: otherUser.id });

    await expectNotFound(requireEmailOwnership(userAuth, env as never, email.id));
  });

  it('should return email for admin regardless of ownership', async () => {
    const email = db.insertEmail({ user_id: otherUser.id });

    const result = await requireEmailOwnership(adminAuth, env as never, email.id);

    expect(result).toMatchObject({ id: email.id });
  });

  it('should throw 404 when email does not exist', async () => {
    await expectNotFound(requireEmailOwnership(userAuth, env as never, 999));
  });

  it('should throw 404 for deleted emails', async () => {
    const email = db.insertEmail({
      user_id: user.id,
      deleted_at: '2026-02-01T10:00:00.000Z',
    });

    await expectNotFound(requireEmailOwnership(userAuth, env as never, email.id));
  });
});
