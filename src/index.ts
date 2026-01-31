/**
 * Cloudflare Mailbox - Email Worker
 * 
 * Receives email via Cloudflare Email Routing, stores in D1,
 * and exposes a REST API for retrieval.
 */

import { sendEmail } from './send/resend';

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

async function handleEmail(message: EmailMessage, env: Env): Promise<void> {
  try {
    const rawEmail = await new Response(message.raw).text();
    const messageId = message.headers.get('message-id') || crypto.randomUUID();
    const subject = message.headers.get('subject') || '(no subject)';
    
    // Extract useful headers as JSON
    const headersObj: Record<string, string> = {};
    for (const [key, value] of message.headers.entries()) {
      headersObj[key.toLowerCase()] = value;
    }

    await env.DB.prepare(`
      INSERT INTO emails (message_id, sender, recipient, subject, raw_email, headers_json, received_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    `).bind(
      messageId,
      message.from,
      message.to,
      subject,
      rawEmail,
      JSON.stringify(headersObj)
    ).run();

    console.log(`✅ Stored email from ${message.from}: ${subject}`);
  } catch (error) {
    console.error('❌ Failed to store email:', error);
    // Don't throw - we don't want to bounce the email
  }
}

// ============== HTTP API ==============

function unauthorized(): Response {
  return new Response('Unauthorized', { status: 401 });
}

function notFound(): Response {
  return new Response('Not found', { status: 404 });
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function handleFetch(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const defaultFrom = 'hello@mistystep.io';
  
  // Authenticate all API requests
  const authHeader = request.headers.get('Authorization');
  if (authHeader !== `Bearer ${env.API_SECRET}`) {
    return unauthorized();
  }

  // GET /emails - List emails
  if (url.pathname === '/emails' && request.method === 'GET') {
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100);
    const offset = parseInt(url.searchParams.get('offset') || '0');
    const folder = url.searchParams.get('folder') || 'inbox';
    const unreadOnly = url.searchParams.get('unread') === 'true';
    const since = url.searchParams.get('since'); // ISO timestamp
    const unsynced = url.searchParams.get('unsynced') === 'true';

    let query = `
      SELECT id, message_id, sender, recipient, subject, received_at, is_read, is_starred, folder
      FROM emails
      WHERE deleted_at IS NULL AND folder = ?
    `;
    const params: (string | number)[] = [folder];

    if (unreadOnly) {
      query += ' AND is_read = 0';
    }
    if (since) {
      query += ' AND received_at > ?';
      params.push(since);
    }
    if (unsynced) {
      query += ' AND synced_at IS NULL';
    }

    query += ' ORDER BY received_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const result = await env.DB.prepare(query).bind(...params).all();
    
    // Get total count
    const countResult = await env.DB.prepare(
      'SELECT COUNT(*) as count FROM emails WHERE deleted_at IS NULL AND folder = ?'
    ).bind(folder).first<{ count: number }>();

    return jsonResponse({
      emails: result.results,
      total: countResult?.count || 0,
      limit,
      offset
    });
  }

  // GET /emails/:id - Get single email with full content
  if (url.pathname.match(/^\/emails\/\d+$/) && request.method === 'GET') {
    const id = url.pathname.split('/')[2];
    const email = await env.DB.prepare(
      'SELECT * FROM emails WHERE id = ? AND deleted_at IS NULL'
    ).bind(id).first();

    if (!email) return notFound();
    return jsonResponse({ email });
  }

  // PATCH /emails/:id - Update email (read status, star, folder)
  if (url.pathname.match(/^\/emails\/\d+$/) && request.method === 'PATCH') {
    const id = url.pathname.split('/')[2];
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
    if (typeof body.folder === 'string') {
      updates.push('folder = ?');
      params.push(body.folder as string);
    }
    if (body.mark_synced === true) {
      updates.push("synced_at = datetime('now')");
    }

    if (updates.length === 0) {
      return jsonResponse({ error: 'No valid fields to update' }, 400);
    }

    params.push(id);
    await env.DB.prepare(
      `UPDATE emails SET ${updates.join(', ')} WHERE id = ?`
    ).bind(...params).run();

    return jsonResponse({ success: true });
  }

  // DELETE /emails/:id - Soft delete email
  if (url.pathname.match(/^\/emails\/\d+$/) && request.method === 'DELETE') {
    const id = url.pathname.split('/')[2];
    const permanent = url.searchParams.get('permanent') === 'true';

    if (permanent) {
      await env.DB.prepare('DELETE FROM emails WHERE id = ?').bind(id).run();
    } else {
      await env.DB.prepare(
        "UPDATE emails SET deleted_at = datetime('now'), folder = 'trash' WHERE id = ?"
      ).bind(id).run();
    }

    return jsonResponse({ success: true });
  }

  // POST /send - Send email via Resend
  if (url.pathname === '/send' && request.method === 'POST') {
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
    const from =
      typeof payload.from === 'string' && payload.from.trim().length > 0
        ? payload.from.trim()
        : defaultFrom;

    if (to.length === 0) {
      return jsonResponse({ error: 'Missing "to"' }, 400);
    }

    if (subject.length === 0) {
      return jsonResponse({ error: 'Missing "subject"' }, 400);
    }

    if (!html && !text) {
      return jsonResponse({ error: 'Missing "html" or "text"' }, 400);
    }

    const sendResult = await sendEmail(env.RESEND_API_KEY, {
      to,
      subject,
      from,
      html,
      text
    });

    if (sendResult.success && sendResult.messageId) {
      await env.DB.prepare(`
        INSERT INTO sent_emails (message_id, sender, recipient, subject, html, text, status, sent_at)
        VALUES (?, ?, ?, ?, ?, ?, 'sent', datetime('now'))
      `)
        .bind(
          sendResult.messageId,
          from,
          to,
          subject,
          html ?? null,
          text ?? null
        )
        .run();

      return jsonResponse({ success: true, messageId: sendResult.messageId });
    }

    await env.DB.prepare(`
      INSERT INTO sent_emails (message_id, sender, recipient, subject, html, text, status, error, sent_at)
      VALUES (?, ?, ?, ?, ?, ?, 'error', ?, datetime('now'))
    `)
      .bind(
        sendResult.messageId ?? null,
        from,
        to,
        subject,
        html ?? null,
        text ?? null,
        sendResult.error ?? 'Unknown error'
      )
      .run();

    return jsonResponse({ error: sendResult.error || 'Failed to send email' }, 502);
  }

  // GET /stats - Mailbox statistics
  if (url.pathname === '/stats' && request.method === 'GET') {
    const stats = await env.DB.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END) as unread,
        SUM(CASE WHEN is_starred = 1 THEN 1 ELSE 0 END) as starred,
        SUM(CASE WHEN folder = 'inbox' THEN 1 ELSE 0 END) as inbox,
        SUM(CASE WHEN folder = 'trash' THEN 1 ELSE 0 END) as trash
      FROM emails WHERE deleted_at IS NULL
    `).first();

    return jsonResponse({ stats });
  }

  // Health check (no auth required)
  if (url.pathname === '/health') {
    return jsonResponse({ status: 'ok', timestamp: new Date().toISOString() });
  }

  return notFound();
}

// ============== Export ==============

export default {
  async email(message: EmailMessage, env: Env, _ctx: ExecutionContext): Promise<void> {
    await handleEmail(message, env);
  },

  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    return handleFetch(request, env);
  }
};
