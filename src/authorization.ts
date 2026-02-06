import type { AuthContext } from './auth';
import type { Env } from './index';

function notFound(): Response {
  return new Response('Not found', { status: 404 });
}

interface OwnershipOptions {
  /** Allow accessing soft-deleted emails (for permanent delete) */
  includeDeleted?: boolean;
}

/**
 * Verifies the authenticated user has access to the specified email.
 * Returns the email row if authorized, throws 404 Response if not.
 *
 * Ownership rules:
 * - Admin: can access any email
 * - User: can only access emails where user_id matches their id
 * - Deleted emails require includeDeleted: true to access
 */
export async function requireEmailOwnership(
  auth: AuthContext,
  env: Env,
  emailId: string | number,
  options: OwnershipOptions = {},
): Promise<Record<string, unknown>> {
  const isAdmin = auth.user.role === 'admin';
  const conditions = ['id = ?'];
  const params: (string | number)[] = [emailId];

  if (!options.includeDeleted) {
    conditions.push('deleted_at IS NULL');
  }

  if (!isAdmin) {
    conditions.push('user_id = ?');
    params.push(auth.user.id);
  }

  const query = `SELECT * FROM emails WHERE ${conditions.join(' AND ')}`;
  const email = await env.DB.prepare(query)
    .bind(...params)
    .first<Record<string, unknown>>();

  if (!email) throw notFound();

  return email;
}
