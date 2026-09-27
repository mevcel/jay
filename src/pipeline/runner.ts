// SPDX-License-Identifier: MIT
// Pons Family: polling run loop for Jay, the pons.family support agent.

import { PonsRateBudgetExceeded } from "../errors.js";
import type { PonsStateStore } from "../store/state.js";
import type { PonsInboundMessage } from "../types.js";
import { log } from "../util/logger.js";
import { sleep } from "../util/sleep.js";
import type { PonsMessageProcessor } from "./processor.js";

/** A source of inbound messages with a resumable cursor (mentions, DMs). */
export interface PonsInboundSource {
  name: string;
  fetch(cursor?: string): Promise<{ messages: PonsInboundMessage[]; cursor?: string }>;
}

/**
 * Poll every source, process messages oldest first, advance each cursor only
 * past messages that were fully handled.
 *
 * Why cursor-after-success: if the process dies or the reply budget runs out
 * mid-batch, the next poll re-fetches from the last handled message. Combined
 * with the `handled` table this gives at-least-once fetching and exactly-once
 * replying.
 */
export class PonsRunner {
  constructor(
    private readonly sources: PonsInboundSource[],
    private readonly processor: PonsMessageProcessor,
    private readonly store: PonsStateStore,
  ) {}

  async pollOnce(): Promise<number> {
    let handled = 0;
    for (const src of this.sources) {
      const key = `cursor:${src.name}`;
      const cursor = this.store.getCursor(key);
      let batch;
      try {
        batch = await src.fetch(cursor);
      } catch (err) {
        log.error({ err, source: src.name }, "fetch failed");
        continue;
      }
      // First boot: don't answer the account's entire history. Start from now.
      if (!cursor && batch.cursor && process.env.JAY_BACKFILL !== "true") {
        this.store.setCursor(key, batch.cursor);
        log.info(
          { source: src.name, cursor: batch.cursor },
          "initialized cursor; skipping backlog",
        );
        continue;
      }
      let lastOk: string | undefined;
      for (const msg of batch.messages) {
        try {
          await this.processor.process(msg);
          handled++;
          lastOk = msg.id.replace(/^dm:/, "");
        } catch (err) {
          if (err instanceof PonsRateBudgetExceeded) {
            log.warn(
              { source: src.name, sent: err.sent },
              "reply budget exhausted; pausing source",
            );
            break;
          }
          log.error({ err, messageId: msg.id }, "processing failed; will retry next poll");
          break;
        }
      }
      const lastId = batch.messages.at(-1)?.id.replace(/^dm:/, "");
      // Whole batch handled (or nothing new): jump to the source's newest cursor.
      const next = batch.messages.length === 0 || lastOk === lastId ? batch.cursor : lastOk;
      if (next) this.store.setCursor(key, next);
    }
    return handled;
  }

  /** Poll until `signal` aborts. */
  async run(intervalMs: number, signal: AbortSignal): Promise<void> {
    log.info({ intervalMs, sources: this.sources.map((s) => s.name) }, "Jay is on shift");
    while (!signal.aborted) {
      const started = Date.now();
      const n = await this.pollOnce();
      if (n) log.info({ handled: n }, "poll complete");
      await sleep(Math.max(0, intervalMs - (Date.now() - started)), signal);
    }
    log.info("Jay is off shift");
  }
}
