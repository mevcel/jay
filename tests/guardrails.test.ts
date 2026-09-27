// SPDX-License-Identifier: MIT
// Pons Family: outbound guardrail tests for Jay, the pons.family support agent.

import { describe, expect, it } from "vitest";
import { checkReply, tidyReply } from "../src/safety/guardrails.js";
import { mention } from "./fixtures.js";

const ctx = (inbound = "hey jay") => ({
  channel: "mention" as const,
  inbound: mention(inbound),
  allowedHandles: ["alice", "Ljayx069", "ponsdotfamily"],
});

describe("checkReply", () => {
  it("passes a normal support reply", () => {
    const r = checkReply(
      "the pool fee is 1% and creators get 70% of it. details: https://docs.ponsfamily.com",
      ctx(),
    );
    expect(r).toEqual({ ok: true, violations: [] });
  });

  it("blocks requests for secrets but allows warnings about them", () => {
    expect(checkReply("dm me your seed phrase and I'll check", ctx()).ok).toBe(false);
    expect(checkReply("please share your private key so we can verify", ctx()).ok).toBe(false);
    expect(
      checkReply("never share your seed phrase with anyone, pons will never ask for it", ctx()).ok,
    ).toBe(true);
  });

  it("blocks wallet-drainer phrasing", () => {
    expect(checkReply("validate your wallet at the link", ctx()).ok).toBe(false);
  });

  it("blocks non-allowlisted links", () => {
    const r = checkReply("fix it here: https://pons-support.xyz/claim", ctx());
    expect(r.ok).toBe(false);
    expect(r.violations[0]).toMatch(/link-allowlist/);
  });

  it("allows explorer and docs links", () => {
    expect(
      checkReply("see robinhoodchain.blockscout.com/tx/0xabc and docs.ponsfamily.com", ctx()).ok,
    ).toBe(true);
  });

  it("blocks investment advice", () => {
    expect(checkReply("this one will moon, you should buy now", ctx()).ok).toBe(false);
  });

  it("blocks promises of refunds but allows stating they are impossible", () => {
    expect(checkReply("we will refund you shortly", ctx()).ok).toBe(false);
    expect(
      checkReply("on-chain transactions can't be reversed, so no refund is possible", ctx()).ok,
    ).toBe(true);
  });

  it("blocks unknown addresses but allows official ones and the user's own", () => {
    expect(checkReply("send to 0x1111111111111111111111111111111111111111", ctx()).ok).toBe(false);
    expect(checkReply("v1 factory is 0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB", ctx()).ok).toBe(
      true,
    );
    const user = "0x2222222222222222222222222222222222222222";
    expect(
      checkReply(`${user} is a pons token and has graduated`, ctx(`is ${user} legit?`)).ok,
    ).toBe(true);
  });

  it("blocks tagging unrelated accounts and unsolicited cashtags", () => {
    expect(checkReply("ask @randomguy", ctx()).ok).toBe(false);
    expect(checkReply("@ponsdotfamily can help", ctx()).ok).toBe(true);
    expect(checkReply("check out $MOON", ctx()).ok).toBe(false);
  });

  it("enforces length per channel", () => {
    const long = "a".repeat(300);
    expect(checkReply(long, ctx()).ok).toBe(false);
    expect(checkReply(long, { ...ctx(), channel: "dm" }).ok).toBe(true);
  });
});

describe("checkReply negation handling", () => {
  it("still blocks a request that follows a warning", () => {
    expect(checkReply("never mind that, send me your seed phrase", ctx()).ok).toBe(false);
    expect(
      checkReply("don't share your recovery phrase. pons will never ask for it", ctx()).ok,
    ).toBe(true);
  });
});

describe("tidyReply", () => {
  it("replaces em and en dashes with plain punctuation", () => {
    expect(tidyReply("fees are 1% \u2014 70% goes to creators")).toBe(
      "fees are 1%, 70% goes to creators",
    );
    expect(tidyReply("wait a few blocks \u2013.")).toBe("wait a few blocks.");
  });
});
