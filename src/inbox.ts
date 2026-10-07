import { DurableObject } from "cloudflare:workers";

export interface ContactInput {
  id: string;
  name: string;
  contact: string;
  message: string;
}

export interface ContactRow extends ContactInput {
  rowid: number;
  created_at: string;
}

export class Inbox extends DurableObject {
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env);
    ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS contacts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        contact TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
    );
    ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS kv (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )`,
    );
    ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS rate_limits (
        key TEXT PRIMARY KEY,
        day TEXT NOT NULL,
        "count" INTEGER NOT NULL
      )`,
    );
  }

  addContact(input: ContactInput): { received: boolean; id: string } {
    const inserted = this.ctx.storage.sql
      .exec(
        `INSERT OR IGNORE INTO contacts (id, name, contact, message, created_at)
         VALUES (?, ?, ?, ?, ?) RETURNING id`,
        input.id,
        input.name,
        input.contact,
        input.message,
        new Date().toISOString(),
      )
      .toArray();
    return { received: inserted.length > 0, id: input.id };
  }

  listContacts(after = 0): ContactRow[] {
    const since = Number.isFinite(after) && after > 0 ? Math.floor(after) : 0;
    return this.ctx.storage.sql
      .exec(
        `SELECT rowid, id, name, contact, message, created_at
         FROM contacts WHERE rowid > ? ORDER BY rowid DESC LIMIT 100`,
        since,
      )
      .toArray() as unknown as ContactRow[];
  }

  hitRateLimit(key: string, day: string): number {
    // Lazy cleanup: the day is baked into each caller's key, so rows from
    // earlier days can never be hit again and would grow the table without
    // bound.
    this.ctx.storage.sql.exec(`DELETE FROM rate_limits WHERE day < ?`, day);
    const rows = this.ctx.storage.sql
      .exec(
        `INSERT INTO rate_limits (key, day, "count") VALUES (?, ?, 1)
         ON CONFLICT(key) DO UPDATE SET
           day = excluded.day,
           "count" = CASE WHEN rate_limits.day = excluded.day
                          THEN rate_limits."count" + 1 ELSE 1 END
         RETURNING "count"`,
        key,
        day,
      )
      .toArray();
    return Number(rows[0].count);
  }

  rateLimitRows(): { key: string; day: string; count: number }[] {
    return this.ctx.storage.sql
      .exec(`SELECT key, day, "count" FROM rate_limits ORDER BY key`)
      .toArray() as unknown as { key: string; day: string; count: number }[];
  }

  kvGet(key: string): string | null {
    const rows = this.ctx.storage.sql
      .exec("SELECT value FROM kv WHERE key = ?", key)
      .toArray();
    return rows.length > 0 ? String(rows[0].value) : null;
  }

  kvSet(key: string, value: string): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO kv (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      key,
      value,
    );
  }
}
