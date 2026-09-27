// SPDX-License-Identifier: MIT
// Pons Family: durable state (SQLite) for Jay, the pons.family support agent.

import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { PonsInboundMessage, PonsJayDecision } from "../types.js";

/**
 * Everything Jay must remember across restarts: which messages were already
 * handled, the X pagination cursors, every decision (for audit), open
 * escalations, and a per-user interaction count.
 *
 * Why SQLite: the bot is a single long-running process. A file database gives
 * crash-safe idempotency ("never reply twice") with zero infrastructure.
 */
export class PonsStateStore {
  private readonly db: Database.Database;

  constructor(file: string) {
    if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
    this.db = new Database(file);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cursors (
        name TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS handled (
        message_id   TEXT PRIMARY KEY,
        channel      TEXT NOT NULL,
        author_id    TEXT NOT NULL,
        author       TEXT NOT NULL,
        text         TEXT NOT NULL,
        action       TEXT NOT NULL,
        category     TEXT,
        reply        TEXT,
        reply_id     TEXT,
        note         TEXT,
        confidence   REAL,
        handled_at   INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS handled_author ON handled(author_id, handled_at);
      CREATE TABLE IF NOT EXISTS escalations (
        message_id   TEXT PRIMARY KEY,
        severity     TEXT NOT NULL,
        note         TEXT NOT NULL,
        status       TEXT NOT NULL DEFAULT 'open',
        created_at   INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sent (
        reply_id     TEXT PRIMARY KEY,
        sent_at      INTEGER NOT NULL
      );
    `);
  }

  getCursor(name: string): string | undefined {
    const row = this.db.prepare("SELECT value FROM cursors WHERE name = ?").get(name) as
      { value: string } | undefined;
    return row?.value;
  }

  setCursor(name: string, value: string): void {
    this.db
      .prepare(
        "INSERT INTO cursors(name, value) VALUES(?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value",
      )
      .run(name, value);
  }

  isHandled(messageId: string): boolean {
    return !!this.db.prepare("SELECT 1 FROM handled WHERE message_id = ?").get(messageId);
  }

  /** Record the outcome. Written before posting completes is fine: posting is idempotent by `isHandled`. */
  recordDecision(msg: PonsInboundMessage, d: PonsJayDecision, replyId?: string): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO handled
         (message_id, channel, author_id, author, text, action, category, reply, reply_id, note, confidence, handled_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        msg.id,
        msg.channel,
        msg.authorId,
        msg.authorHandle,
        msg.text,
        d.action,
        d.category,
        d.reply ?? null,
        replyId ?? null,
        d.internalNote ?? null,
        d.confidence,
        Date.now(),
      );
    if (d.action === "escalate") {
      this.db
        .prepare(
          "INSERT OR IGNORE INTO escalations(message_id, severity, note, created_at) VALUES (?, ?, ?, ?)",
        )
        .run(msg.id, d.severity ?? "medium", d.internalNote ?? "", Date.now());
    }
  }

  recordSent(replyId: string): void {
    this.db
      .prepare("INSERT OR IGNORE INTO sent(reply_id, sent_at) VALUES (?, ?)")
      .run(replyId, Date.now());
  }

  /** Public replies in the trailing hour (the spam-safety budget). */
  sentInLastHour(): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS n FROM sent WHERE sent_at > ?")
      .get(Date.now() - 3_600_000) as { n: number };
    return row.n;
  }

  /** How many times Jay has already answered this user in the last day. */
  recentRepliesTo(authorId: string): number {
    const row = this.db
      .prepare(
        "SELECT COUNT(*) AS n FROM handled WHERE author_id = ? AND action = 'reply' AND handled_at > ?",
      )
      .get(authorId, Date.now() - 86_400_000) as { n: number };
    return row.n;
  }

  openEscalations() {
    return this.db
      .prepare("SELECT * FROM escalations WHERE status = 'open' ORDER BY created_at DESC")
      .all() as Array<{ message_id: string; severity: string; note: string; created_at: number }>;
  }

  /** Aggregate counts for the `stats` command. */
  stats(sinceMs: number) {
    return this.db
      .prepare(
        "SELECT action, category, COUNT(*) AS n FROM handled WHERE handled_at > ? GROUP BY action, category ORDER BY n DESC",
      )
      .all(Date.now() - sinceMs) as Array<{ action: string; category: string; n: number }>;
  }

  close(): void {
    this.db.close();
  }
}
