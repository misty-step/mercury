import { requireScope } from './auth';
import type { AuthContext } from './auth';

interface Env {
  DB: D1Database;
  API_SECRET: string;
  RESEND_API_KEY: string;
}

const ALLOWED_USER_SCOPES = new Set(['read', 'write', 'send']);

// Generate a secure API key with mk_ prefix
export function generateApiKey(): { key: string; hash: string; prefix: string } {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const key =
    'mk_' +
    btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  const prefix = key.slice(0, 11); // 'mk_' + 8 chars
  // Hash will be computed in handler
  return { key, hash: '', prefix };
}

async function hashKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

// POST /api-keys - Generate new key for current user
export async function handleCreateApiKey(
  request: Request,
  env: Env,
  ctx: AuthContext,
): Promise<Response> {
  requireScope(ctx, 'write');

  let body: { name?: string; scopes?: string };
  try {
    body = (await request.json()) as { name?: string; scopes?: string };
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const scopesInput =
    typeof body.scopes === 'string' && body.scopes.trim().length > 0
      ? body.scopes
      : 'read,write,send';
  const requestedScopes = scopesInput
    .split(',')
    .map((scope) => scope.trim())
    .filter(Boolean);
  if (requestedScopes.length === 0) {
    requestedScopes.push('read', 'write', 'send');
  }
  const scopes = requestedScopes.join(',');
  const name = typeof body.name === 'string' && body.name.trim().length > 0 ? body.name : null;

  if (ctx.user.role !== 'admin') {
    if (ctx.user.id <= 0) {
      return new Response(JSON.stringify({ error: 'API key must be associated with a user' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    for (const scope of requestedScopes) {
      if (!ALLOWED_USER_SCOPES.has(scope)) {
        return new Response(JSON.stringify({ error: `Invalid scope: ${scope}` }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (!ctx.scopes.has(scope)) {
        return new Response(JSON.stringify({ error: `Cannot grant scope: ${scope}` }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }
  }

  const { key, prefix } = generateApiKey();
  const hash = await hashKey(key);

  await env.DB.prepare(
    `INSERT INTO api_keys (user_id, prefix, key_hash, scopes, name, created_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`,
  )
    .bind(ctx.user.id > 0 ? ctx.user.id : null, prefix, hash, scopes, name)
    .run();

  return new Response(
    JSON.stringify({
      key, // Only shown once!
      prefix,
      scopes,
      name,
    }),
    {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    },
  );
}

// GET /api-keys - List user's keys (admin sees all)
export async function handleListApiKeys(env: Env, ctx: AuthContext): Promise<Response> {
  requireScope(ctx, 'read');

  let query =
    'SELECT id, prefix, scopes, name, created_at, last_used_at FROM api_keys WHERE revoked_at IS NULL';
  const params: (number | string)[] = [];

  if (ctx.user.role !== 'admin') {
    query += ' AND user_id = ?';
    params.push(ctx.user.id);
  }

  query += ' ORDER BY created_at DESC';

  const result = await env.DB.prepare(query)
    .bind(...params)
    .all();

  return new Response(JSON.stringify({ keys: result.results }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

// DELETE /api-keys/:id - Revoke key
export async function handleRevokeApiKey(
  id: string,
  env: Env,
  ctx: AuthContext,
): Promise<Response> {
  requireScope(ctx, 'write');

  // Check ownership if not admin
  if (ctx.user.role !== 'admin') {
    const key = await env.DB.prepare(
      'SELECT user_id FROM api_keys WHERE id = ? AND revoked_at IS NULL',
    )
      .bind(id)
      .first<{ user_id: number | null }>();

    if (!key || key.user_id !== ctx.user.id) {
      return new Response('Not found', { status: 404 });
    }
  }

  const result = await env.DB.prepare(
    "UPDATE api_keys SET revoked_at = datetime('now') WHERE id = ? AND revoked_at IS NULL",
  )
    .bind(id)
    .run();

  if (result.meta.changes === 0) {
    return new Response('Not found', { status: 404 });
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
