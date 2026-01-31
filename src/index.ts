/**
 * Cloudflare Mailbox - Email Worker
 * 
 * Receives email via Cloudflare Email Routing, stores in D1,
 * and exposes a REST API for retrieval.
 */

export interface Env {
  DB: D1Database;
  API_SECRET: string;
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

async function handleFetch(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  
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
    const body = await request.json() as Record<string, unknown>;

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
      params.push(body.folder);
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
  async email(message: EmailMessage, env: Env, ctx: ExecutionContext): Promise<void> {
    await handleEmail(message, env);
  },

  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return handleFetch(request, env);
  }
};
