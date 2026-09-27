// SPDX-License-Identifier: MIT
// Pons Family: per-message pipeline (triage, draft, guardrails, post) for Jay.

import type { PonsJayAgent } from "../agent/jay.js";
import type { PonsEscalationNotifier } from "../escalation/notify.js";
import { PonsJayError, PonsRateBudgetExceeded } from "../errors.js";
import { checkReply, tidyReply } from "../safety/guardrails.js";
import type { PonsStateStore } from "../store/state.js";
import type { PonsInboundMessage, PonsJayDecision } from "../types.js";
import { log } from "../util/logger.js";
import { triage } from "./triage.js";

/** Where replies go. Implemented by `PonsXClient`; faked in tests and dry runs. */
export interface PonsOutbox {
  reply(toTweetId: string, text: string): Promise<string>;
  sendDm(participantId: string, text: string): Promise<string>;
}

export interface PonsProcessorOptions {
  agent: PonsJayAgent;
  store: PonsStateStore;
  outbox: PonsOutbox;
  notifier: PonsEscalationNotifier;
  self: { id: string; handle: string };
  officialHandles: string[];
  handoffHandles: string[];
  maxRepliesPerHour: number;
  maxMentionAgeMs: number;
  dryRun: boolean;
  /** Below this, a drafted reply is held for a human instead of posted. */
  minConfidence?: number;
}

export type PonsProcessOutcome =
  | { status: "skipped"; reason: string }
  | { status: "done"; decision: PonsJayDecision; postedId?: string };

/**
 * Runs one inbound message through the whole pipeline, exactly once.
 *
 * Ordering matters: triage is free and deterministic, the agent is expensive,
 * guardrails are the last word before anything becomes public. A draft that
 * fails guardrails gets one rewrite; if the rewrite fails too, nothing is
 * posted and a human is paged. Silence beats a harmful reply.
 */
export class PonsMessageProcessor {
  private readonly minConfidence: number;

  constructor(private readonly o: PonsProcessorOptions) {
    this.minConfidence = o.minConfidence ?? 0.5;
  }

  /** @throws PonsRateBudgetExceeded when the hourly public reply budget is spent (caller retries later). */
  async process(msg: PonsInboundMessage): Promise<PonsProcessOutcome> {
    const { store } = this.o;
    if (store.isHandled(msg.id)) return { status: "skipped", reason: "already handled" };

    const t = triage(msg, {
      selfHandle: this.o.self.handle,
      selfId: this.o.self.id,
      officialHandles: this.o.officialHandles,
      maxMentionAgeMs: this.o.maxMentionAgeMs,
      repliesToAuthorToday: store.recentRepliesTo(msg.authorId),
    });
    if (t.route === "skip") {
      store.recordDecision(msg, {
        action: "ignore",
        category: "off_topic",
        internalNote: `triage: ${t.reason}`,
        confidence: 1,
      });
      log.info({ messageId: msg.id, author: msg.authorHandle, reason: t.reason }, "triage skip");
      return { status: "skipped", reason: t.reason };
    }

    if (msg.channel === "mention") {
      const sent = store.sentInLastHour();
      if (sent >= this.o.maxRepliesPerHour)
        throw new PonsRateBudgetExceeded(sent, this.o.maxRepliesPerHour);
    }

    const decision = await this.decideSafely(msg, t.hints);
    let postedId: string | undefined;
    if (decision.reply && decision.action !== "ignore") {
      postedId = await this.post(msg, decision.reply);
    }
    store.recordDecision(msg, decision, postedId);
    if (decision.action === "escalate") await this.o.notifier.notify(msg, decision);

    log.info(
      {
        messageId: msg.id,
        channel: msg.channel,
        author: msg.authorHandle,
        action: decision.action,
        category: decision.category,
        confidence: decision.confidence,
        reply: decision.reply,
        postedId,
      },
      "handled",
    );
    return { status: "done", decision, postedId };
  }

  /** Agent + guardrails + confidence gate. Never throws for model-side problems. */
  private async decideSafely(msg: PonsInboundMessage, hints: string[]): Promise<PonsJayDecision> {
    const allowedHandles = [
      msg.authorHandle,
      this.o.self.handle,
      ...this.o.officialHandles,
      ...this.o.handoffHandles,
    ];
    let revisionNotes: string[] | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      let d: PonsJayDecision;
      try {
        const r = await this.o.agent.decide(msg, { hints, revisionNotes });
        d = r.decision;
        log.debug({ messageId: msg.id, usage: r.usage }, "agent usage");
      } catch (err) {
        if (!(err instanceof PonsJayError)) throw err;
        log.warn({ err, messageId: msg.id }, "agent failed; escalating silently");
        return {
          action: "escalate",
          category: "general",
          internalNote: `Agent error: ${err.message}`,
          severity: "medium",
          confidence: 0,
        };
      }
      if (!d.reply || d.action === "ignore") return d;
      const reply = tidyReply(d.reply);
      d = { ...d, reply };

      const g = checkReply(reply, { channel: msg.channel, inbound: msg, allowedHandles });
      if (!g.ok) {
        log.warn(
          { messageId: msg.id, violations: g.violations, draft: d.reply },
          "guardrail blocked draft",
        );
        revisionNotes = g.violations;
        continue;
      }
      if (d.action === "reply" && d.confidence < this.minConfidence) {
        return {
          ...d,
          action: "escalate",
          reply: undefined,
          severity: d.severity ?? "low",
          internalNote:
            `Held for review (confidence ${d.confidence}). Draft: "${d.reply}". ${d.internalNote ?? ""}`.trim(),
        };
      }
      return d;
    }
    return {
      action: "escalate",
      category: "general",
      severity: "medium",
      confidence: 0,
      internalNote: `Two drafts failed guardrails (${revisionNotes?.join("; ")}). Nothing was posted.`,
    };
  }

  private async post(msg: PonsInboundMessage, text: string): Promise<string> {
    if (this.o.dryRun) {
      log.info({ messageId: msg.id, channel: msg.channel, text }, "[dry-run] would post");
      return `dry-run:${msg.id}`;
    }
    const id =
      msg.channel === "dm"
        ? await this.o.outbox.sendDm(msg.authorId, text)
        : await this.o.outbox.reply(msg.id, text);
    if (msg.channel === "mention") this.o.store.recordSent(id);
    return id;
  }
}
