import { DurableObject } from "cloudflare:workers";

export interface ContactInput {
  id: string;
  name: string;
  contact: string;
  message: string;
}

interface ContactRow extends ContactInput {
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
    // SAFETY: the contacts table is created in the constructor with exactly
    // these columns, so the row shape is fixed.
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
    // SAFETY: the rate_limits table is created in the constructor with
    // exactly these columns, so the row shape is fixed.
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

  // --- Agent guestbook (/api/agents) — KV-backed so no schema migration.
  // One JSON array under "guestbook:agents", capped at 200 entries; one
  // registration per IP per hour under "guestbook:ip:<ip>".

  guestbookList(): { name: string; url?: string; message?: string; at: string }[] {
    const raw = this.kvGet("guestbook:agents");
    if (!raw) return [];
    try {
      const list = JSON.parse(raw);
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  guestbookRegister(
    ip: string,
    name: string,
    url?: string,
    message?: string,
  ): { created: boolean } | { error: string } {
    const now = new Date();
    const ipKey = `guestbook:ip:${ip}`;
    const last = this.kvGet(ipKey);
    if (last && now.getTime() - new Date(last).getTime() < 60 * 60 * 1000) {
      return { error: "rate_limited" };
    }
    const list = this.guestbookList();
    const existing = list.findIndex((a) => a.name === name);
    if (existing === -1 && list.length >= 200) return { error: "full" };
    const entry = {
      name,
      ...(url ? { url } : {}),
      ...(message ? { message } : {}),
      at: now.toISOString(),
    };
    if (existing === -1) list.push(entry);
    else list[existing] = entry;
    this.kvSet("guestbook:agents", JSON.stringify(list));
    this.kvSet(ipKey, now.toISOString());
    return { created: existing === -1 };
  }
}
