type EmailRecord = {
  id: number;
  message_id: string;
  sender: string;
  recipient: string;
  subject: string;
  raw_email: string;
  headers_json: string;
  received_at: string;
  is_read: number;
  is_starred: number;
  folder: string;
  deleted_at: string | null;
  synced_at: string | null;
};

type NowFn = () => string;

type PreparedResult<T> = {
  results: T[];
};

class MockD1PreparedStatement {
  private params: unknown[] = [];

  constructor(private db: MockD1Database, private sql: string) {}

  bind(...params: unknown[]) {
    this.params = params;
    return this;
  }

  async run(): Promise<void> {
    this.db.executeRun(this.sql, this.params);
  }

  async all<T = Record<string, unknown>>(): Promise<PreparedResult<T>> {
    const results = this.db.executeAll<T>(this.sql, this.params);
    return { results };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const results = this.db.executeAll<T>(this.sql, this.params);
    return results[0] ?? null;
  }
}

export class MockD1Database {
  emails: EmailRecord[] = [];
  private nextId = 1;
  private now: NowFn;

  constructor(options?: { now?: NowFn }) {
    this.now = options?.now ?? (() => new Date().toISOString());
  }

  prepare(sql: string): MockD1PreparedStatement {
    return new MockD1PreparedStatement(this, sql);
  }

  insertEmail(partial: Partial<EmailRecord>): EmailRecord {
    const record: EmailRecord = {
      id: this.nextId++,
      message_id: partial.message_id ?? fallbackUuid(),
      sender: partial.sender ?? 'sender@example.com',
      recipient: partial.recipient ?? 'recipient@example.com',
      subject: partial.subject ?? '(no subject)',
      raw_email: partial.raw_email ?? '',
      headers_json: partial.headers_json ?? '{}',
      received_at: partial.received_at ?? this.now(),
      is_read: partial.is_read ?? 0,
      is_starred: partial.is_starred ?? 0,
      folder: partial.folder ?? 'inbox',
      deleted_at: partial.deleted_at ?? null,
      synced_at: partial.synced_at ?? null
    };

    this.emails.push(record);
    return record;
  }

  executeRun(sql: string, params: unknown[]): void {
    const normalized = normalizeSql(sql);

    if (normalized.includes('INSERT INTO EMAILS')) {
      const [messageId, sender, recipient, subject, rawEmail, headersJson] = params as [
        string,
        string,
        string,
        string,
        string,
        string
      ];
      this.insertEmail({
        message_id: messageId,
        sender,
        recipient,
        subject,
        raw_email: rawEmail,
        headers_json: headersJson,
        received_at: this.now()
      });
      return;
    }

    if (normalized.startsWith('UPDATE EMAILS SET') && normalized.includes('DELETED_AT = DATETIME')) {
      const [id] = params as [string];
      const record = this.findById(id);
      if (record) {
        record.deleted_at = this.now();
        record.folder = 'trash';
      }
      return;
    }

    if (normalized.startsWith('UPDATE EMAILS SET')) {
      const setClause = extractSetClause(sql);
      const id = params[params.length - 1] as string;
      const record = this.findById(id);
      if (!record) return;

      let paramIndex = 0;
      const assignments = setClause.split(',').map((part) => part.trim());
      for (const assignment of assignments) {
        if (assignment.startsWith('is_read = ?')) {
          record.is_read = Number(params[paramIndex++]);
          continue;
        }
        if (assignment.startsWith('is_starred = ?')) {
          record.is_starred = Number(params[paramIndex++]);
          continue;
        }
        if (assignment.startsWith('folder = ?')) {
          record.folder = String(params[paramIndex++]);
          continue;
        }
        if (assignment.startsWith("synced_at = datetime('now')") || assignment.startsWith('synced_at = datetime("now")')) {
          record.synced_at = this.now();
          continue;
        }
      }
      return;
    }

    if (normalized.startsWith('DELETE FROM EMAILS')) {
      const [id] = params as [string];
      const numericId = Number(id);
      this.emails = this.emails.filter((record) => record.id !== numericId);
      return;
    }

    throw new Error(`MockD1Database cannot execute run for SQL: ${sql}`);
  }

  executeAll<T>(sql: string, params: unknown[]): T[] {
    const normalized = normalizeSql(sql);

    if (normalized.startsWith('SELECT ID, MESSAGE_ID')) {
      const folder = String(params[0]);
      let results = this.emails.filter(
        (record) => record.deleted_at === null && record.folder === folder
      );

      if (normalized.includes('IS_READ = 0')) {
        results = results.filter((record) => record.is_read === 0);
      }

      if (normalized.includes('RECEIVED_AT > ?')) {
        const since = String(params[1]);
        results = results.filter((record) => record.received_at > since);
      }

      if (normalized.includes('SYNCED_AT IS NULL')) {
        results = results.filter((record) => record.synced_at === null);
      }

      results = results.sort((a, b) => (a.received_at < b.received_at ? 1 : -1));

      const limit = Number(params[params.length - 2]);
      const offset = Number(params[params.length - 1]);
      const sliced = results.slice(offset, offset + limit);

      return sliced.map((record) => ({
        id: record.id,
        message_id: record.message_id,
        sender: record.sender,
        recipient: record.recipient,
        subject: record.subject,
        received_at: record.received_at,
        is_read: record.is_read,
        is_starred: record.is_starred,
        folder: record.folder
      })) as T[];
    }

    if (normalized.startsWith('SELECT COUNT(*) AS COUNT')) {
      const folder = String(params[0]);
      const count = this.emails.filter(
        (record) => record.deleted_at === null && record.folder === folder
      ).length;
      return [{ count }] as T[];
    }

    if (normalized.startsWith('SELECT * FROM EMAILS WHERE ID = ?')) {
      const [id] = params as [string];
      const record = this.findById(id);
      if (!record || record.deleted_at !== null) return [];
      return [record as unknown as T];
    }

    if (normalized.startsWith('SELECT COUNT(*) AS TOTAL')) {
      const active = this.emails.filter((record) => record.deleted_at === null);
      const stats = {
        total: active.length,
        unread: active.filter((record) => record.is_read === 0).length,
        starred: active.filter((record) => record.is_starred === 1).length,
        inbox: active.filter((record) => record.folder === 'inbox').length,
        trash: active.filter((record) => record.folder === 'trash').length
      };
      return [stats as unknown as T];
    }

    throw new Error(`MockD1Database cannot execute query for SQL: ${sql}`);
  }

  private findById(id: string): EmailRecord | undefined {
    const numericId = Number(id);
    return this.emails.find((record) => record.id === numericId);
  }
}

export function createMockD1Database(options?: { now?: NowFn }): MockD1Database {
  return new MockD1Database(options);
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim().toUpperCase();
}

function extractSetClause(sql: string): string {
  const match = sql.match(/SET([\s\S]*?)WHERE/i);
  if (!match) return '';
  return match[1].trim();
}

function fallbackUuid(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `mock-${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
}
