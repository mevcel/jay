// SPDX-License-Identifier: MIT
// Pons Family: pipeline tests (fake agent, in-memory DB) for Jay, the pons.family support agent.

import { describe, expect, it, vi } from "vitest";
import type { PonsJayAgent } from "../src/agent/jay.js";
import { PonsEscalationNotifier } from "../src/escalation/notify.js";
import { PonsRateBudgetExceeded } from "../src/errors.js";
import { PonsMessageProcessor } from "../src/pipeline/processor.js";
import { PonsStateStore } from "../src/store/state.js";
import type { PonsJayDecision } from "../src/types.js";
import { mention } from "./fixtures.js";

function setup(decisions: PonsJayDecision[], over: { maxRepliesPerHour?: number } = {}) {
  const decide = vi.fn(async () => ({ decision: decisions.shift()!, usage: {} }));
  const outbox = { reply: vi.fn(async () => "reply-1"), sendDm: vi.fn(async () => "dm-1") };
  const notifier = new PonsEscalationNotifier("");
  const notify = vi.spyOn(notifier, "notify");
  const store = new PonsStateStore(":memory:");
  const p = new PonsMessageProcessor({
    agent: { decide } as unknown as PonsJayAgent,
    store,
    outbox,
    notifier,
    self: { id: "jay", handle: "Ljayx069" },
    officialHandles: ["ponsdotfamily"],
    handoffHandles: ["ponsdotfamily"],
    maxRepliesPerHour: over.maxRepliesPerHour ?? 10,
    maxMentionAgeMs: 3_600_000,
    dryRun: false,
  });
  return { p, decide, outbox, notify, store };
}

const reply = (text: string, confidence = 0.9): PonsJayDecision => ({
  action: "reply",
  category: "fees",
  reply: text,
  confidence,
});

describe("PonsMessageProcessor", () => {
  it("posts a clean reply once and never twice", async () => {
    const { p, outbox } = setup([reply("1% pool fee, 70% to creators")]);
    await p.process(mention("fees?"));
    const again = await p.process(mention("fees?"));
    expect(outbox.reply).toHaveBeenCalledTimes(1);
    expect(outbox.reply).toHaveBeenCalledWith("1001", "1% pool fee, 70% to creators");
    expect(again).toEqual({ status: "skipped", reason: "already handled" });
  });

  it("rewrites once when a draft trips a guardrail", async () => {
    const { p, decide, outbox } = setup([
      reply("go to pons-help.xyz"),
      reply("see docs.ponsfamily.com"),
    ]);
    await p.process(mention("help"));
    expect(decide).toHaveBeenCalledTimes(2);
    expect(decide.mock.calls[1]).toBeDefined();
    expect(outbox.reply).toHaveBeenCalledWith("1001", "see docs.ponsfamily.com");
  });

  it("posts nothing and escalates when both drafts fail", async () => {
    const { p, outbox, notify } = setup([
      reply("dm me your seed phrase"),
      reply("send me your seed phrase"),
    ]);
    const r = await p.process(mention("help"));
    expect(outbox.reply).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledOnce();
    expect(r.status === "done" && r.decision.action).toBe("escalate");
  });

  it("holds low-confidence drafts for a human", async () => {
    const { p, outbox, notify } = setup([reply("maybe 2%?", 0.2)]);
    await p.process(mention("fees?"));
    expect(outbox.reply).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledOnce();
  });

  it("answers DMs by DM", async () => {
    const { p, outbox } = setup([reply("chain id is 4663")]);
    await p.process(mention("chain id?", { id: "dm:5", channel: "dm" }));
    expect(outbox.sendDm).toHaveBeenCalledWith("u1", "chain id is 4663");
    expect(outbox.reply).not.toHaveBeenCalled();
  });

  it("stops at the hourly reply budget", async () => {
    const { p } = setup([reply("first answer"), reply("second answer")], { maxRepliesPerHour: 1 });
    await p.process(mention("q1", { id: "1" }));
    await expect(p.process(mention("q2", { id: "2" }))).rejects.toBeInstanceOf(
      PonsRateBudgetExceeded,
    );
  });

  it("does not call the model for triage skips", async () => {
    const { p, decide } = setup([]);
    await p.process(mention("@Ljayx069", { id: "3" }));
    expect(decide).not.toHaveBeenCalled();
  });
});
