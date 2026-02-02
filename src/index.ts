/**
 * Cloudflare Mailbox - Email Worker
 *
 * Receives email via Cloudflare Email Routing, stores in D1,
 * and exposes a REST API for retrieval.
 */

import { requireAuth, type AuthContext } from './auth';
import { handleCreateApiKey, handleListApiKeys, handleRevokeApiKey } from './api-keys';
import { sendEmail } from './send/resend';
import { handleCreateUser, handleGetMe, handleGetUser, handleGetUsers } from './users';

export interface Env {
  DB: D1Database;
  API_SECRET: string;
  RESEND_API_KEY: string;
}

interface EmailMessage {
  readonly from: string;
  readonly to: string;
  readonly headers: Headers;
  readonly raw: ReadableStream;
  readonly rawSize: number;
}

// ============== Email Handler ==============

async function resolveAliasUserId(db: D1Database, address: string): Promise<number | null> {
  const normalized = address.toLowerCase().trim();

  const alias = await db
    .prepare('SELECT user_id FROM user_aliases WHERE LOWER(address) = ?')
    .bind(normalized)
    .first<{ user_id: number }>();

  if (alias) return alias.user_id;

  const plusIndex = normalized.indexOf('+');
  if (plusIndex !== -1) {
    const atIndex = normalized.indexOf('@');
    if (atIndex > plusIndex) {
      const baseAddress = normalized.slice(0, plusIndex) + normalized.slice(atIndex);
      const baseAlias = await db
        .prepare('SELECT user_id FROM user_aliases WHERE LOWER(address) = ?')
        .bind(baseAddress)
        .first<{ user_id: number }>();
      if (baseAlias) return baseAlias.user_id;
    }
  }

  return null;
}

async function getUserIdForRecipient(db: D1Database, address: string): Promise<number | null> {
  const aliasUserId = await resolveAliasUserId(db, address);
  if (aliasUserId !== null) return aliasUserId;

  const shared = await db
    .prepare("SELECT id FROM users WHERE email = 'shared@mistystep.io'")
    .first<{ id: number }>();

  return shared?.id ?? null;
}

async function handleEmail(message: EmailMessage, env: Env): Promise<void> {
  try {
    const rawEmail = await new Response(message.raw).text();
    const messageId = message.headers.get('message-id') || crypto.randomUUID();
    const subject = message.headers.get('subject') || '(no subject)';
    const normalizedRecipient = message.to.toLowerCase().trim();
    const userId = await getUserIdForRecipient(env.DB, normalizedRecipient);

    // Extract useful headers as JSON
    const headersObj: Record<string, string> = {};
    for (const [key, value] of message.headers.entries()) {
      headersObj[key.toLowerCase()] = value;
    }

    await env.DB.prepare(
      `
      INSERT INTO emails (message_id, sender, recipient, subject, raw_email, headers_json, received_at, user_id)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?)
    `,
    )
      .bind(
        messageId,
        message.from,
        normalizedRecipient,
        subject,
        rawEmail,
        JSON.stringify(headersObj),
        userId,
      )
      .run();

    console.log(`✅ Stored email from ${message.from}: ${subject}`);
  } catch (error) {
    console.error('❌ Failed to store email:', error);
    // Don't throw - we don't want to bounce the email
  }
}

// ============== HTTP API ==============

function notFound(): Response {
  return new Response('Not found', { status: 404 });
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function listEmails(auth: AuthContext, env: Env, url: URL): Promise<Response> {
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100);
  const offset = parseInt(url.searchParams.get('offset') || '0');
  const folder = url.searchParams.get('folder') || 'inbox';
  const unreadOnly = url.searchParams.get('unread') === 'true';
  const since = url.searchParams.get('since'); // ISO timestamp
  const unsynced = url.searchParams.get('unsynced') === 'true';
  const isAdmin = auth.user.role === 'admin';
  const recipientFilter = isAdmin ? url.searchParams.get('recipient') : null;
  const userIdFilter = isAdmin ? url.searchParams.get('user_id') : String(auth.user.id);

  const conditions = ['deleted_at IS NULL', 'folder = ?'];
  const params: (string | number)[] = [folder];

  if (userIdFilter) {
    conditions.push('user_id = ?');
    params.push(userIdFilter);
  }

  if (recipientFilter) {
    conditions.push('recipient = ?');
    params.push(recipientFilter);
  }

  if (unreadOnly) {
    conditions.push('is_read = 0');
  }
  if (since) {
    conditions.push('received_at > ?');
    params.push(since);
  }
  if (unsynced) {
    conditions.push('synced_at IS NULL');
  }

  const query = `
      SELECT id, message_id, sender, recipient, subject, received_at, is_read, is_starred, folder
      FROM emails
      WHERE ${conditions.join(' AND ')}
      ORDER BY received_at DESC
      LIMIT ? OFFSET ?
    `;
  const listParams = [...params, limit, offset];

  const result = await env.DB.prepare(query)
    .bind(...listParams)
    .all();

  const countQuery = `SELECT COUNT(*) as count FROM emails WHERE ${conditions.join(' AND ')}`;
  const countResult = await env.DB.prepare(countQuery)
    .bind(...params)
    .first<{ count: number }>();

  return jsonResponse({
    emails: result.results,
    total: countResult?.count || 0,
    limit,
    offset,
  });
}

async function getEmail(auth: AuthContext, env: Env, id: string): Promise<Response> {
  const isAdmin = auth.user.role === 'admin';
  let query = 'SELECT * FROM emails WHERE id = ? AND deleted_at IS NULL';
  const params: (string | number)[] = [id];

  if (!isAdmin) {
    query += ' AND user_id = ?';
    params.push(auth.user.id);
  }

  const email = await env.DB.prepare(query)
    .bind(...params)
    .first();

  if (!email) return notFound();
  return jsonResponse({ email });
}

async function updateEmail(
  _auth: AuthContext,
  env: Env,
  request: Request,
  id: string,
): Promise<Response> {
  const body = (await request.json()) as Record<string, unknown>;

  const updates: string[] = [];
  const params: (string | number)[] = [];

  if (typeof body.is_read === 'boolean' || typeof body.is_read === 'number') {
    updates.push('is_read = ?');
    params.push(body.is_read ? 1 : 0);
  }
  if (typeof body.is_starred === 'boolean' || typeof body.is_starred === 'number') {
    updates.push('is_starred = ?');
    params.push(body.is_starred ? 1 : 0);
  }
  const VALID_FOLDERS = new Set(['inbox', 'trash', 'archive', 'sent', 'drafts']);
  if (typeof body.folder === 'string') {
    if (!VALID_FOLDERS.has(body.folder)) {
      return jsonResponse(
        { error: 'Invalid folder. Valid: inbox, trash, archive, sent, drafts' },
        400,
      );
    }
    updates.push('folder = ?');
    params.push(body.folder);
  }
  if (body.mark_synced === true) {
    updates.push("synced_at = datetime('now')");
  }

  if (updates.length === 0) {
    return jsonResponse({ error: 'No valid fields to update' }, 400);
  }

  params.push(id);
  await env.DB.prepare(`UPDATE emails SET ${updates.join(', ')} WHERE id = ?`)
    .bind(...params)
    .run();

  return jsonResponse({ success: true });
}

async function deleteEmail(_auth: AuthContext, env: Env, url: URL, id: string): Promise<Response> {
  const permanent = url.searchParams.get('permanent') === 'true';

  if (permanent) {
    await env.DB.prepare('DELETE FROM emails WHERE id = ?').bind(id).run();
  } else {
    await env.DB.prepare(
      "UPDATE emails SET deleted_at = datetime('now'), folder = 'trash' WHERE id = ?",
    )
      .bind(id)
      .run();
  }

  return jsonResponse({ success: true });
}

async function sendOutboundEmail(
  auth: AuthContext,
  env: Env,
  request: Request,
  defaultFrom: string,
): Promise<Response> {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  if (!isRecord(payload)) {
    return jsonResponse({ error: 'Invalid request body' }, 400);
  }

  const to = typeof payload.to === 'string' ? payload.to.trim() : '';
  const subject = typeof payload.subject === 'string' ? payload.subject.trim() : '';
  const html = typeof payload.html === 'string' ? payload.html : undefined;
  const text = typeof payload.text === 'string' ? payload.text : undefined;
  const explicitFrom = typeof payload.from === 'string' ? payload.from.trim() : '';
  const from = explicitFrom.length > 0 ? explicitFrom : defaultFrom;

  if (to.length === 0) {
    return jsonResponse({ error: 'Missing "to"' }, 400);
  }

  const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!EMAIL_REGEX.test(to)) {
    return jsonResponse({ error: 'Invalid email address format' }, 400);
  }

  if (subject.length === 0) {
    return jsonResponse({ error: 'Missing "subject"' }, 400);
  }

  if (!html && !text) {
    return jsonResponse({ error: 'Missing "html" or "text"' }, 400);
  }

  if (auth.user.role !== 'admin' && explicitFrom.length > 0) {
    const aliasUserId = await resolveAliasUserId(env.DB, from);
    if (aliasUserId !== auth.user.id) {
      return jsonResponse({ error: 'From address not allowed' }, 403);
    }
  }

  const sendResult = await sendEmail(env.RESEND_API_KEY, {
    to,
    subject,
    from,
    html,
    text,
  });

  if (sendResult.success && sendResult.messageId) {
    await env.DB.prepare(
      `
        INSERT INTO sent_emails (message_id, sender, recipient, subject, html, text, status, sent_at)
        VALUES (?, ?, ?, ?, ?, ?, 'sent', datetime('now'))
      `,
    )
      .bind(sendResult.messageId, from, to, subject, html ?? null, text ?? null)
      .run();

    return jsonResponse({ success: true, messageId: sendResult.messageId });
  }

  await env.DB.prepare(
    `
      INSERT INTO sent_emails (message_id, sender, recipient, subject, html, text, status, error, sent_at)
      VALUES (?, ?, ?, ?, ?, ?, 'error', ?, datetime('now'))
    `,
  )
    .bind(
      sendResult.messageId ?? null,
      from,
      to,
      subject,
      html ?? null,
      text ?? null,
      sendResult.error ?? 'Unknown error',
    )
    .run();

  return jsonResponse({ error: sendResult.error || 'Failed to send email' }, 502);
}

async function getStats(_auth: AuthContext, env: Env): Promise<Response> {
  const stats = await env.DB.prepare(
    `
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END) as unread,
        SUM(CASE WHEN is_starred = 1 THEN 1 ELSE 0 END) as starred,
        SUM(CASE WHEN folder = 'inbox' THEN 1 ELSE 0 END) as inbox,
        SUM(CASE WHEN folder = 'trash' THEN 1 ELSE 0 END) as trash
      FROM emails WHERE deleted_at IS NULL
    `,
  ).first();

  return jsonResponse({ stats });
}

async function handleFetch(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const defaultFrom = 'hello@mistystep.io';

  // Health check (no auth required)
  if (url.pathname === '/health') {
    return jsonResponse({ status: 'ok', timestamp: new Date().toISOString(), version: 'v3' });
  }

  let auth: AuthContext;
  try {
    auth = await requireAuth(request, env, env.DB);
  } catch (error) {
    if (error instanceof Response) return error;
    throw error;
  }

  try {
    if (url.pathname === '/users' && request.method === 'GET') {
      return handleGetUsers(env, auth);
    }

    if (url.pathname.match(/^\/users\/\d+$/) && request.method === 'GET') {
      const id = url.pathname.split('/')[2];
      return handleGetUser(id, env, auth);
    }

    if (url.pathname === '/users' && request.method === 'POST') {
      return handleCreateUser(request, env, auth);
    }

    if (url.pathname === '/me' && request.method === 'GET') {
      return handleGetMe(env, auth);
    }

    if (url.pathname === '/api-keys' && request.method === 'POST') {
      return handleCreateApiKey(request, env, auth);
    }

    if (url.pathname === '/api-keys' && request.method === 'GET') {
      return handleListApiKeys(env, auth);
    }

    if (url.pathname.match(/^\/api-keys\/\d+$/) && request.method === 'DELETE') {
      const id = url.pathname.split('/')[2];
      return handleRevokeApiKey(id, env, auth);
    }

    if (url.pathname === '/emails' && request.method === 'GET') {
      return listEmails(auth, env, url);
    }

    if (url.pathname.match(/^\/emails\/\d+$/) && request.method === 'GET') {
      const id = url.pathname.split('/')[2];
      return getEmail(auth, env, id);
    }

    if (url.pathname.match(/^\/emails\/\d+$/) && request.method === 'PATCH') {
      const id = url.pathname.split('/')[2];
      return updateEmail(auth, env, request, id);
    }

    if (url.pathname.match(/^\/emails\/\d+$/) && request.method === 'DELETE') {
      const id = url.pathname.split('/')[2];
      return deleteEmail(auth, env, url, id);
    }

    if (url.pathname === '/send' && request.method === 'POST') {
      return sendOutboundEmail(auth, env, request, defaultFrom);
    }

    if (url.pathname === '/stats' && request.method === 'GET') {
      return getStats(auth, env);
    }

    return notFound();
  } catch (error) {
    if (error instanceof Response) return error;
    throw error;
  }
}

// ============== Export ==============

export default {
  async email(message: EmailMessage, env: Env, _ctx: ExecutionContext): Promise<void> {
    await handleEmail(message, env);
  },

  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    return handleFetch(request, env);
  },
};
