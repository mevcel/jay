// SPDX-License-Identifier: MIT
// Pons Family: tool-use loop tests (stubbed API client) for Jay, the pons.family support agent.

import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { PonsJayAgent } from "../src/agent/jay.js";
import type { PonsChainReader } from "../src/chain/robinhood.js";
import { PonsNoDecisionError, PonsRefusalError } from "../src/errors.js";
import { loadKnowledgeBase } from "../src/knowledge/loader.js";
import { mention } from "./fixtures.js";

const usage = {
  input_tokens: 10,
  output_tokens: 5,
  cache_read_input_tokens: 4000,
  cache_creation_input_tokens: 0,
};
const turn = (content: unknown[], stop_reason = "tool_use", extra = {}) => ({
  content,
  stop_reason,
  usage,
  ...extra,
});
const submit = (input: object) => ({ type: "tool_use", id: "s1", name: "submit_decision", input });
const decision = {
  action: "reply",
  category: "graduation",
  reply: "graduated, 100%",
  internal_note: null,
  severity: null,
  confidence: 0.9,
};

function agentWith(responses: unknown[]) {
  const create = vi.fn(async () => responses.shift());
  const chain = {
    ponsToken: vi.fn(async () => ({ isPonsToken: true, graduation: { progressPct: 100 } })),
  };
  const agent = new PonsJayAgent({
    model: "claude-opus-5",
    effort: "medium",
    kb: loadKnowledgeBase(),
    chain: chain as unknown as PonsChainReader,
    client: { beta: { messages: { create } } } as unknown as Anthropic,
  });
  return { agent, create, chain };
}

describe("PonsJayAgent loop", () => {
  it("runs a tool, feeds the result back, and returns the decision", async () => {
    const { agent, create, chain } = agentWith([
      turn([
        {
          type: "tool_use",
          id: "t1",
          name: "lookup_pons_token",
          input: { address: "0x39dBED3a2bd333467115dE45665cC57F813C4571" },
        },
      ]),
      turn([submit(decision)]),
    ]);
    const { decision: d, usage: u } = await agent.decide(
      mention("did 0x39dBED3a2bd333467115dE45665cC57F813C4571 graduate?"),
    );
    expect(d).toMatchObject({ action: "reply", reply: "graduated, 100%" });
    expect(chain.ponsToken).toHaveBeenCalledOnce();
    expect(u).toMatchObject({ iterations: 2, cacheReadTokens: 8000 });

    const second = (create.mock.calls[1] as unknown[])[0] as {
      messages: Array<{ role: string; content: unknown }>;
    };
    const toolResult = (
      second.messages[2]!.content as Array<{ type: string; tool_use_id: string }>
    )[0]!;
    expect(toolResult).toMatchObject({ type: "tool_result", tool_use_id: "t1" });
  });

  it("sends a cache breakpoint on the knowledge base and the fallback beta", async () => {
    const { agent, create } = agentWith([turn([submit(decision)])]);
    await agent.decide(mention("q"));
    const req = (create.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(req.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(req.fallbacks).toBe("default");
    const system = req.system as Array<{ text: string; cache_control?: unknown }>;
    expect(system[1]!.text).toContain("<knowledge_base>");
    expect(system[1]!.cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
  });

  it("lets the model correct an invalid decision", async () => {
    const { agent } = agentWith([
      turn([submit({ ...decision, reply: null })]),
      turn([submit(decision)]),
    ]);
    expect((await agent.decide(mention("q"))).decision.action).toBe("reply");
  });

  it("nudges once when the model answers in prose, then gives up", async () => {
    const prose = turn([{ type: "text", text: "hi" }], "end_turn");
    const { agent } = agentWith([prose, { ...prose }]);
    await expect(agent.decide(mention("q"))).rejects.toBeInstanceOf(PonsNoDecisionError);
  });

  it("surfaces refusals as a named error", async () => {
    const { agent } = agentWith([
      turn([], "refusal", { stop_details: { type: "refusal", category: "cyber" } }),
    ]);
    await expect(agent.decide(mention("q"))).rejects.toBeInstanceOf(PonsRefusalError);
  });
});
