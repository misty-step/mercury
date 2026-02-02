import type { Env } from './index';

export interface AuthContext {
  user: { id: number; email: string; role: string };
  isImpersonating: boolean;
  scopes: Set<string>;
}

type ApiKeyRow = {
  id: number;
  user_id: number;
  scopes: string | null;
  expires_at: string | null;
};

type UserRow = {
  id: number;
  email: string;
  role: string;
};

const ADMIN_SCOPES = new Set(['read', 'write', 'send', 'admin']);

export async function hashApiKey(key: string): Promise<string> {
  const data = new TextEncoder().encode(key);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Constant-time string comparison to prevent timing attacks.
 * Compares all bytes regardless of early mismatch.
 */
export function timingSafeCompare(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  const maxLength = Math.max(aBytes.length, bBytes.length);

  let result = aBytes.length ^ bBytes.length;
  for (let i = 0; i < maxLength; i += 1) {
    const aByte = aBytes[i] ?? 0;
    const bByte = bBytes[i] ?? 0;
    result |= aByte ^ bByte;
  }

  return result === 0;
}

export async function authenticate(
  request: Request,
  env: Env,
  db: D1Database,
): Promise<AuthContext | null> {
  const token = extractBearerToken(request.headers.get('Authorization'));
  if (!token) return null;

  if (timingSafeCompare(token, env.API_SECRET)) {
    const impersonateEmail = request.headers.get('X-Mercury-User')?.trim();
    if (impersonateEmail) {
      const user = await db
        .prepare(
          'SELECT id, email, name, role, created_at FROM users WHERE email = ? AND deleted_at IS NULL',
        )
        .bind(impersonateEmail)
        .first<UserRow>();

      if (!user) return null;

      const contextUser = { id: user.id, email: user.email, role: user.role };

      return {
        user: contextUser,
        isImpersonating: true,
        scopes: new Set(ADMIN_SCOPES),
      };
    }

    return {
      user: { id: -1, email: 'admin', role: 'admin' },
      isImpersonating: false,
      scopes: new Set(ADMIN_SCOPES),
    };
  }

  // User API keys (mk_*) - authenticate via database
  // SECURITY: User API keys intentionally do NOT support the X-Mercury-User
  // impersonation header. This is a security boundary - only the admin API_SECRET
  // can impersonate users. Do not add impersonation support here.
  if (token.startsWith('mk_')) {
    const hash = await hashApiKey(token);
    const keyRow = await db
      .prepare(
        'SELECT id, user_id, scopes, expires_at FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL',
      )
      .bind(hash)
      .first<ApiKeyRow>();

    if (!keyRow) return null;

    if (keyRow.expires_at) {
      const expiresAt = Date.parse(keyRow.expires_at);
      if (Number.isNaN(expiresAt) || expiresAt <= Date.now()) return null;
    }

    const user = await db
      .prepare(
        'SELECT id, email, name, role, created_at FROM users WHERE id = ? AND deleted_at IS NULL',
      )
      .bind(keyRow.user_id)
      .first<UserRow>();

    if (!user) return null;

    // Update last_used_at for audit trail (don't block auth on this)
    db.prepare("UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?")
      .bind(keyRow.id)
      .run()
      .catch((err) => console.error('Failed to update api_key last_used_at:', err));

    const contextUser = { id: user.id, email: user.email, role: user.role };

    return {
      user: contextUser,
      isImpersonating: false,
      scopes: parseScopes(keyRow.scopes),
    };
  }

  return null;
}

export async function requireAuth(
  request: Request,
  env: Env,
  db?: D1Database,
): Promise<AuthContext> {
  const ctx = await authenticate(request, env, db ?? env.DB);
  if (!ctx) throw new Response('Unauthorized', { status: 401 });
  return ctx;
}

export function requireScope(ctx: AuthContext, scope: string): void {
  if (!ctx.scopes.has(scope)) {
    throw new Response('Forbidden', { status: 403 });
  }
}

function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const [scheme, token] = authHeader.trim().split(/\s+/);
  if (scheme !== 'Bearer' || !token) return null;
  return token;
}

function parseScopes(scopes: string | null): Set<string> {
  if (!scopes) return new Set();
  return new Set(
    scopes
      .split(',')
      .map((scope) => scope.trim())
      .filter(Boolean),
  );
}
