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
  user_id: number | null;
  deleted_at: string | null;
  synced_at: string | null;
};

type UserRecord = {
  id: number;
  email: string;
  name: string | null;
  role: string;
  created_at: string;
  deleted_at: string | null;
};

type UserAliasRecord = {
  id: number;
  user_id: number;
  address: string;
  is_primary: number;
  created_at: string;
};

type ApiKeyRecord = {
  id: number;
  user_id: number | null;
  prefix: string;
  key_hash: string;
  scopes: string | null;
  name: string | null;
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
  revoked_at: string | null;
};

type NowFn = () => string;

type PreparedResult<T> = {
  results: T[];
};

type MockD1Snapshot = {
  emails: EmailRecord[];
  users: UserRecord[];
  userAliases: UserAliasRecord[];
  apiKeys: ApiKeyRecord[];
  nextId: number;
  nextUserId: number;
  nextUserAliasId: number;
  nextApiKeyId: number;
};

class MockD1PreparedStatement {
  private params: unknown[] = [];

  constructor(
    private db: MockD1Database,
    private sql: string,
  ) {}

  bind(...params: unknown[]) {
    this.params = params;
    return this;
  }

  async run(): Promise<{ meta: { changes: number } }> {
    const changes = this.db.executeRun(this.sql, this.params);
    return { meta: { changes } };
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
  users: UserRecord[] = [];
  userAliases: UserAliasRecord[] = [];
  apiKeys: ApiKeyRecord[] = [];
  private nextId = 1;
  private nextUserId = 1;
  private nextUserAliasId = 1;
  private nextApiKeyId = 1;
  private now: NowFn;

  constructor(options?: { now?: NowFn }) {
    this.now = options?.now ?? (() => new Date().toISOString());
  }

  prepare(sql: string): MockD1PreparedStatement {
    return new MockD1PreparedStatement(this, sql);
  }

  async batch(statements: MockD1PreparedStatement[]): Promise<{ success: boolean }[]> {
    const snapshot = this.snapshot();
    try {
      const results: { success: boolean }[] = [];
      for (const statement of statements) {
        await statement.run();
        results.push({ success: true });
      }
      return results;
    } catch (error) {
      this.restore(snapshot);
      throw error;
    }
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
      user_id: partial.user_id ?? null,
      deleted_at: partial.deleted_at ?? null,
      synced_at: partial.synced_at ?? null,
    };

    this.emails.push(record);
    return record;
  }

  insertUser(partial: Partial<UserRecord>): UserRecord {
    const record: UserRecord = {
      id: this.nextUserId++,
      email: partial.email ?? 'user@example.com',
      name: partial.name ?? null,
      role: partial.role ?? 'user',
      created_at: partial.created_at ?? this.now(),
      deleted_at: partial.deleted_at ?? null,
    };

    this.users.push(record);
    return record;
  }

  insertUserAlias(partial: Partial<UserAliasRecord>): UserAliasRecord {
    if (partial.user_id === undefined || partial.user_id === null) {
      throw new Error('user_id is required for insertUserAlias');
    }
    const record: UserAliasRecord = {
      id: this.nextUserAliasId++,
      user_id: partial.user_id,
      address: partial.address ?? 'user@example.com',
      is_primary: partial.is_primary ?? 0,
      created_at: partial.created_at ?? this.now(),
    };

    this.userAliases.push(record);
    return record;
  }

  insertApiKey(partial: Partial<ApiKeyRecord>): ApiKeyRecord {
    const record: ApiKeyRecord = {
      id: this.nextApiKeyId++,
      user_id: partial.user_id ?? null,
      prefix: partial.prefix ?? 'mk_',
      key_hash: partial.key_hash ?? '',
      scopes: partial.scopes ?? 'read,write,send',
      name: partial.name ?? null,
      last_used_at: partial.last_used_at ?? null,
      expires_at: partial.expires_at ?? null,
      created_at: partial.created_at ?? this.now(),
      revoked_at: partial.revoked_at ?? null,
    };

    this.apiKeys.push(record);
    return record;
  }

  executeRun(sql: string, params: unknown[]): number {
    const normalized = normalizeSql(sql);

    if (normalized.includes('INSERT INTO EMAILS')) {
      const [messageId, sender, recipient, subject, rawEmail, headersJson, userId] = params as [
        string,
        string,
        string,
        string,
        string,
        string,
        number | null | undefined,
      ];
      this.insertEmail({
        message_id: messageId,
        sender,
        recipient,
        subject,
        raw_email: rawEmail,
        headers_json: headersJson,
        user_id: userId === undefined || userId === null ? null : Number(userId),
        received_at: this.now(),
      });
      return 1;
    }

    if (normalized.startsWith('INSERT INTO USERS')) {
      const [email, name, role] = params as [string, string | null, string];
      if (this.users.some((user) => user.email === email)) {
        throw new Error('UNIQUE constraint failed: users.email');
      }
      this.insertUser({
        email,
        name: name ?? null,
        role: role ?? 'user',
        created_at: this.now(),
      });
      return 1;
    }

    if (normalized.startsWith('INSERT INTO USER_ALIASES')) {
      if (normalized.includes('SELECT ID')) {
        const [address, email] = params as [string, string];
        const user = this.users.find((record) => record.email === email);
        if (!user) return 0;
        if (this.userAliases.some((alias) => alias.address === address)) {
          throw new Error('UNIQUE constraint failed: user_aliases.address');
        }
        this.insertUserAlias({
          user_id: user.id,
          address,
          is_primary: 1,
          created_at: this.now(),
        });
        return 1;
      }

      const [userId, address] = params as [number | string, string];
      if (this.userAliases.some((alias) => alias.address === address)) {
        throw new Error('UNIQUE constraint failed: user_aliases.address');
      }
      this.insertUserAlias({
        user_id: Number(userId),
        address,
        is_primary: 1,
        created_at: this.now(),
      });
      return 1;
    }

    if (normalized.startsWith('INSERT INTO API_KEYS')) {
      const [userId, prefix, keyHash, scopes, name] = params as [
        number | string | null,
        string,
        string,
        string | null,
        string | null,
      ];
      this.insertApiKey({
        user_id: userId === null || userId === undefined ? null : Number(userId),
        prefix,
        key_hash: keyHash,
        scopes: scopes ?? null,
        name: name ?? null,
        created_at: this.now(),
      });
      return 1;
    }

    if (normalized.startsWith('UPDATE API_KEYS SET LAST_USED_AT = DATETIME')) {
      const [id] = params as [number | string];
      const record = this.apiKeys.find((item) => item.id === Number(id));
      if (record) {
        record.last_used_at = this.now();
        return 1;
      }
      return 0;
    }

    if (normalized.startsWith('UPDATE API_KEYS SET REVOKED_AT = DATETIME')) {
      const [id] = params as [number | string];
      const record = this.apiKeys.find(
        (item) => item.id === Number(id) && item.revoked_at === null,
      );
      if (record) {
        record.revoked_at = this.now();
        return 1;
      }
      return 0;
    }

    if (
      normalized.startsWith('UPDATE EMAILS SET') &&
      normalized.includes('DELETED_AT = DATETIME')
    ) {
      const [id] = params as [string];
      const record = this.findById(id);
      if (record) {
        record.deleted_at = this.now();
        record.folder = 'trash';
      }
      return 1;
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
        if (
          assignment.startsWith("synced_at = datetime('now')") ||
          assignment.startsWith('synced_at = datetime("now")')
        ) {
          record.synced_at = this.now();
          continue;
        }
      }
      return 1;
    }

    if (normalized.startsWith('DELETE FROM EMAILS')) {
      const [id] = params as [string];
      const numericId = Number(id);
      this.emails = this.emails.filter((record) => record.id !== numericId);
      return 1;
    }

    throw new Error(`MockD1Database cannot execute run for SQL: ${sql}`);
  }

  executeAll<T>(sql: string, params: unknown[]): T[] {
    const normalized = normalizeSql(sql);

    if (normalized.startsWith('SELECT USER_ID FROM USER_ALIASES WHERE LOWER(ADDRESS) = ?')) {
      const [address] = params as [string];
      const record = this.userAliases.find(
        (alias) => alias.address.toLowerCase() === address.toLowerCase(),
      );
      if (!record) return [];
      return [{ user_id: record.user_id }] as T[];
    }

    if (normalized.startsWith("SELECT ID FROM USERS WHERE EMAIL = 'SHARED@MISTYSTEP.IO'")) {
      const record = this.users.find(
        (user) => user.email.toLowerCase() === 'shared@mistystep.io' && user.deleted_at === null,
      );
      if (!record) return [];
      return [{ id: record.id }] as T[];
    }

    if (normalized.startsWith('SELECT ID, EMAIL, NAME, ROLE, CREATED_AT FROM USERS WHERE ID = ?')) {
      const [id] = params as [number | string];
      const record = this.findUserById(id);
      if (!record || record.deleted_at !== null) return [];
      return [pickUser(record) as unknown as T];
    }

    if (
      normalized.startsWith('SELECT ID, EMAIL, NAME, ROLE, CREATED_AT FROM USERS WHERE EMAIL = ?')
    ) {
      const [email] = params as [string];
      const record = this.users.find((user) => user.email === email && user.deleted_at === null);
      if (!record) return [];
      return [pickUser(record) as unknown as T];
    }

    if (normalized.startsWith('SELECT ID, EMAIL, NAME, ROLE, CREATED_AT FROM USERS WHERE ROLE =')) {
      const admin = this.users.find((user) => user.role === 'admin' && user.deleted_at === null);
      if (!admin) return [];
      return [pickUser(admin) as unknown as T];
    }

    if (
      normalized.startsWith(
        'SELECT ID, EMAIL, NAME, ROLE, CREATED_AT FROM USERS WHERE DELETED_AT IS NULL',
      )
    ) {
      return this.users
        .filter((user) => user.deleted_at === null)
        .map((user) => pickUser(user) as unknown as T);
    }

    if (
      normalized.startsWith(
        'SELECT ID, USER_ID, SCOPES, EXPIRES_AT FROM API_KEYS WHERE KEY_HASH = ?',
      )
    ) {
      const [hash] = params as [string];
      const record = this.apiKeys.find(
        (item) => item.key_hash === hash && item.revoked_at === null,
      );
      if (!record) return [];
      return [
        {
          id: record.id,
          user_id: record.user_id,
          scopes: record.scopes,
          expires_at: record.expires_at,
        } as unknown as T,
      ];
    }

    if (normalized.startsWith('SELECT USER_ID FROM API_KEYS WHERE ID = ? AND REVOKED_AT IS NULL')) {
      const [id] = params as [number | string];
      const record = this.apiKeys.find(
        (item) => item.id === Number(id) && item.revoked_at === null,
      );
      if (!record) return [];
      return [{ user_id: record.user_id }] as T[];
    }

    if (
      normalized.startsWith(
        'SELECT ID, PREFIX, SCOPES, NAME, CREATED_AT, LAST_USED_AT FROM API_KEYS WHERE REVOKED_AT IS NULL',
      )
    ) {
      let results = this.apiKeys.filter((item) => item.revoked_at === null);
      if (normalized.includes('AND USER_ID = ?')) {
        const [userId] = params as [number | string];
        results = results.filter((item) => item.user_id === Number(userId));
      }

      results = results.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

      return results.map((record) => ({
        id: record.id,
        prefix: record.prefix,
        scopes: record.scopes,
        name: record.name,
        created_at: record.created_at,
        last_used_at: record.last_used_at,
      })) as T[];
    }

    if (normalized.startsWith('SELECT COUNT(*) AS COUNT FROM API_KEYS')) {
      let results = this.apiKeys.filter((item) => item.revoked_at === null);
      if (normalized.includes('USER_ID = ?')) {
        const [userId] = params as [number | string];
        results = results.filter((item) => item.user_id === Number(userId));
      }
      return [{ count: results.length }] as T[];
    }

    if (normalized.startsWith('SELECT ID, MESSAGE_ID')) {
      const { filters, limit, offset } = parseEmailFilters(normalized, params, true);
      let results = applyEmailFilters(this.emails, filters);

      results = results.sort((a, b) => (a.received_at < b.received_at ? 1 : -1));

      const sliced = results.slice(offset ?? 0, (offset ?? 0) + (limit ?? results.length));

      return sliced.map((record) => ({
        id: record.id,
        message_id: record.message_id,
        sender: record.sender,
        recipient: record.recipient,
        subject: record.subject,
        received_at: record.received_at,
        is_read: record.is_read,
        is_starred: record.is_starred,
        folder: record.folder,
      })) as T[];
    }

    if (normalized.startsWith('SELECT COUNT(*) AS COUNT')) {
      const { filters } = parseEmailFilters(normalized, params, false);
      const count = applyEmailFilters(this.emails, filters).length;
      return [{ count }] as T[];
    }

    if (normalized.startsWith('SELECT * FROM EMAILS WHERE ID = ?')) {
      const [id] = params as [string];
      const record = this.findById(id);
      if (!record) return [];
      // Only filter by deleted_at if the query explicitly includes that condition
      const checksDeleted = normalized.includes('DELETED_AT IS NULL');
      if (checksDeleted && record.deleted_at !== null) return [];
      if (normalized.includes('USER_ID = ?')) {
        const userId = Number(params[1]);
        if (record.user_id !== userId) return [];
      }
      return [record as unknown as T];
    }

    if (normalized.startsWith('SELECT COUNT(*) AS TOTAL')) {
      let active = this.emails.filter((record) => record.deleted_at === null);
      if (normalized.includes('USER_ID = ?')) {
        const [userId] = params as [number];
        active = active.filter((record) => record.user_id === Number(userId));
      }
      const stats = {
        total: active.length,
        unread: active.filter((record) => record.is_read === 0).length,
        starred: active.filter((record) => record.is_starred === 1).length,
        inbox: active.filter((record) => record.folder === 'inbox').length,
        trash: active.filter((record) => record.folder === 'trash').length,
      };
      return [stats as unknown as T];
    }

    throw new Error(`MockD1Database cannot execute query for SQL: ${sql}`);
  }

  private findById(id: string): EmailRecord | undefined {
    const numericId = Number(id);
    return this.emails.find((record) => record.id === numericId);
  }

  private snapshot(): MockD1Snapshot {
    return {
      emails: this.emails.map((record) => ({ ...record })),
      users: this.users.map((record) => ({ ...record })),
      userAliases: this.userAliases.map((record) => ({ ...record })),
      apiKeys: this.apiKeys.map((record) => ({ ...record })),
      nextId: this.nextId,
      nextUserId: this.nextUserId,
      nextUserAliasId: this.nextUserAliasId,
      nextApiKeyId: this.nextApiKeyId,
    };
  }

  private restore(snapshot: MockD1Snapshot): void {
    this.emails = snapshot.emails.map((record) => ({ ...record }));
    this.users = snapshot.users.map((record) => ({ ...record }));
    this.userAliases = snapshot.userAliases.map((record) => ({ ...record }));
    this.apiKeys = snapshot.apiKeys.map((record) => ({ ...record }));
    this.nextId = snapshot.nextId;
    this.nextUserId = snapshot.nextUserId;
    this.nextUserAliasId = snapshot.nextUserAliasId;
    this.nextApiKeyId = snapshot.nextApiKeyId;
  }

  private findUserById(id: number | string): UserRecord | undefined {
    const numericId = Number(id);
    return this.users.find((record) => record.id === numericId);
  }
}

export function createMockD1Database(options?: { now?: NowFn }): MockD1Database {
  return new MockD1Database(options);
}

type EmailFilters = {
  folder: string;
  userId: number | null;
  recipient: string | null;
  unreadOnly: boolean;
  since: string | null;
  unsyncedOnly: boolean;
};

function parseEmailFilters(
  normalized: string,
  params: unknown[],
  includeLimitOffset: boolean,
): { filters: EmailFilters; limit?: number; offset?: number } {
  let index = 0;
  const folder = String(params[index++]);
  const userId = normalized.includes('USER_ID = ?') ? Number(params[index++]) : null;
  const recipient = normalized.includes('RECIPIENT = ?') ? String(params[index++]) : null;
  const since = normalized.includes('RECEIVED_AT > ?') ? String(params[index++]) : null;

  const filters: EmailFilters = {
    folder,
    userId,
    recipient,
    unreadOnly: normalized.includes('IS_READ = 0'),
    since,
    unsyncedOnly: normalized.includes('SYNCED_AT IS NULL'),
  };

  if (!includeLimitOffset) return { filters };

  return {
    filters,
    limit: Number(params[params.length - 2]),
    offset: Number(params[params.length - 1]),
  };
}

function applyEmailFilters(emails: EmailRecord[], filters: EmailFilters): EmailRecord[] {
  let results = emails.filter(
    (record) => record.deleted_at === null && record.folder === filters.folder,
  );

  if (filters.userId !== null) {
    results = results.filter((record) => record.user_id === filters.userId);
  }

  if (filters.recipient !== null) {
    results = results.filter((record) => record.recipient === filters.recipient);
  }

  if (filters.unreadOnly) {
    results = results.filter((record) => record.is_read === 0);
  }

  if (filters.since !== null) {
    results = results.filter((record) => record.received_at > filters.since);
  }

  if (filters.unsyncedOnly) {
    results = results.filter((record) => record.synced_at === null);
  }

  return results;
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

function pickUser(user: UserRecord): Omit<UserRecord, 'deleted_at'> {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    created_at: user.created_at,
  };
}
