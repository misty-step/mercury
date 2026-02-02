import type { AuthContext } from './auth';
import type { Env } from './index';

type UserRow = {
  id: number;
  email: string;
  name: string | null;
  role: string;
  created_at: string;
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_ROLES = new Set(['admin', 'user', 'system']);

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function forbidden(): Response {
  return new Response('Forbidden', { status: 403 });
}

function notFound(): Response {
  return new Response('Not found', { status: 404 });
}

function badRequest(message: string): Response {
  return jsonResponse({ error: message }, 400);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export async function handleGetUsers(env: Env, ctx: AuthContext): Promise<Response> {
  if (ctx.user.role !== 'admin') return forbidden();

  const result = await env.DB.prepare(
    'SELECT id, email, name, role, created_at FROM users WHERE deleted_at IS NULL',
  ).all<UserRow>();

  return jsonResponse({ users: result.results });
}

export async function handleGetUser(id: string, env: Env, ctx: AuthContext): Promise<Response> {
  const numericId = Number.parseInt(id, 10);
  if (!Number.isFinite(numericId)) return badRequest('Invalid user id');

  if (ctx.user.role !== 'admin' && numericId !== ctx.user.id) return forbidden();

  const user = await env.DB.prepare(
    'SELECT id, email, name, role, created_at FROM users WHERE id = ? AND deleted_at IS NULL',
  )
    .bind(numericId)
    .first<UserRow>();

  if (!user) return notFound();
  return jsonResponse({ user });
}

export async function handleCreateUser(
  request: Request,
  env: Env,
  ctx: AuthContext,
): Promise<Response> {
  if (ctx.user.role !== 'admin') return forbidden();

  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return badRequest('Invalid JSON body');
  }

  if (!isRecord(payload)) {
    return badRequest('Invalid request body');
  }

  const email = typeof payload.email === 'string' ? payload.email.trim() : '';
  const nameValue = typeof payload.name === 'string' ? payload.name.trim() : '';
  const role = typeof payload.role === 'string' ? payload.role.trim() : 'user';

  if (email.length === 0) return badRequest('Missing "email"');
  if (!EMAIL_REGEX.test(email)) return badRequest('Invalid email address format');
  if (!VALID_ROLES.has(role)) return badRequest('Invalid role');

  const name = nameValue.length > 0 ? nameValue : null;

  const userStmt = env.DB.prepare('INSERT INTO users (email, name, role) VALUES (?, ?, ?)');
  const aliasStmt = env.DB.prepare(
    'INSERT INTO user_aliases (user_id, address, is_primary) SELECT id, ?, 1 FROM users WHERE email = ?',
  );

  try {
    await env.DB.batch([userStmt.bind(email, name, role), aliasStmt.bind(email, email)]);
  } catch {
    return jsonResponse({ error: 'Failed to create user' }, 500);
  }

  const user = await env.DB.prepare(
    'SELECT id, email, name, role, created_at FROM users WHERE email = ? AND deleted_at IS NULL',
  )
    .bind(email)
    .first<UserRow>();

  if (!user) return jsonResponse({ error: 'Failed to create user' }, 500);

  return jsonResponse({ user }, 201);
}

export function handleGetMe(_env: Env, ctx: AuthContext): Response {
  return jsonResponse({ user: ctx.user });
}
