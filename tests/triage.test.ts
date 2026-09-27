// SPDX-License-Identifier: MIT
// Pons Family: inbound triage tests for Jay, the pons.family support agent.

import { describe, expect, it } from "vitest";
import { triage } from "../src/pipeline/triage.js";
import { mention } from "./fixtures.js";

const ctx = {
  selfHandle: "Ljayx069",
  selfId: "jay",
  officialHandles: ["ponsdotfamily"],
  maxMentionAgeMs: 3_600_000,
  repliesToAuthorToday: 0,
};

describe("triage", () => {
  it("routes a real question to the agent", () => {
    expect(triage(mention("@Ljayx069 how do I claim creator fees?"), ctx)).toEqual({
      route: "agent",
      urgent: false,
      hints: [],
    });
  });

  it("skips own and official messages", () => {
    expect(triage(mention("hi", { authorId: "jay", authorHandle: "Ljayx069" }), ctx).route).toBe(
      "skip",
    );
    expect(triage(mention("hi", { authorHandle: "ponsdotfamily" }), ctx).route).toBe("skip");
  });

  it("skips impersonators", () => {
    const r = triage(mention("dm me for help", { authorHandle: "PonsSupportDesk" }), ctx);
    expect(r).toEqual({ route: "skip", reason: "suspected impersonator" });
  });

  it("skips content-free tags", () => {
    expect(triage(mention("@Ljayx069 @someone $PONS https://t.co/x"), ctx).route).toBe("skip");
  });

  it("skips stale mentions", () => {
    const old = new Date(Date.now() - 2 * 3_600_000).toISOString();
    expect(triage(mention("hello?", { createdAt: old }), ctx).route).toBe("skip");
  });

  it("flags urgent security reports and exempts them from the per-user cap", () => {
    const r = triage(mention("my wallet got drained after a launch"), {
      ...ctx,
      repliesToAuthorToday: 9,
    });
    expect(r.route).toBe("agent");
    if (r.route === "agent") expect(r.urgent).toBe(true);
  });

  it("caps chatty users", () => {
    expect(triage(mention("another question"), { ...ctx, repliesToAuthorToday: 6 }).route).toBe(
      "skip",
    );
  });
});
