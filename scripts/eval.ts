// SPDX-License-Identifier: MIT
// Pons Family: behavioral eval runner for Jay, the pons.family support agent.
//
// Runs every case in evals/cases.jsonl through the real agent and the real
// guardrails (no X access, nothing posted) and scores the decisions. Run it
// before changing the persona, the knowledge base, JAY_MODEL, or JAY_EFFORT.
//
//   npm run eval                 # all cases
//   npm run eval -- fees chain   # only cases whose id contains a filter

import { readFileSync } from "node:fs";
import { PonsJayAgent } from "../src/agent/jay.js";
import { PonsChainReader } from "../src/chain/robinhood.js";
import { loadConfig } from "../src/config.js";
import { loadKnowledgeBase } from "../src/knowledge/loader.js";
import { checkReply } from "../src/safety/guardrails.js";
import type { PonsInboundChannel, PonsInboundMessage, PonsJayAction } from "../src/types.js";

interface EvalCase {
  id: string;
  text: string;
  channel?: PonsInboundChannel;
  expect: {
    action: PonsJayAction | PonsJayAction[];
    category?: string;
    mustInclude?: string[];
    mustIncludeAny?: string[];
    mustNotInclude?: string[];
  };
}

const filters = process.argv.slice(2);
const cases: EvalCase[] = readFileSync(new URL("../evals/cases.jsonl", import.meta.url), "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l))
  .filter((c: EvalCase) => !filters.length || filters.some((f) => c.id.includes(f)));

const cfg = loadConfig(process.env, { requireX: false });
const agent = new PonsJayAgent({
  apiKey: cfg.apiKey,
  model: cfg.model,
  effort: cfg.effort,
  kb: loadKnowledgeBase(),
  chain: new PonsChainReader(cfg.chain.rpcUrl, cfg.chain.blockscoutApiUrl),
});

let passed = 0;
let cacheRead = 0;
let input = 0;
for (const c of cases) {
  const msg: PonsInboundMessage = {
    id: `eval-${c.id}`,
    channel: c.channel ?? "mention",
    authorId: "eval",
    authorHandle: "eval_user",
    text: c.text,
    createdAt: new Date().toISOString(),
    conversationId: c.id,
    thread: [],
  };
  const failures: string[] = [];
  let reply = "";
  let action = "error";
  try {
    const { decision, usage } = await agent.decide(msg);
    cacheRead += usage.cacheReadTokens;
    input += usage.inputTokens;
    action = decision.action;
    reply = decision.reply ?? "";
    const want = ([] as PonsJayAction[]).concat(c.expect.action);
    if (!want.includes(decision.action))
      failures.push(`action ${decision.action} not in [${want}]`);
    if (c.expect.category && decision.category !== c.expect.category)
      failures.push(`category ${decision.category}`);
    const lower = reply.toLowerCase();
    for (const s of c.expect.mustInclude ?? [])
      if (!lower.includes(s.toLowerCase())) failures.push(`missing "${s}"`);
    if (
      c.expect.mustIncludeAny &&
      !c.expect.mustIncludeAny.some((s) => lower.includes(s.toLowerCase()))
    ) {
      failures.push(`missing any of [${c.expect.mustIncludeAny.join(", ")}]`);
    }
    for (const s of c.expect.mustNotInclude ?? [])
      if (lower.includes(s.toLowerCase())) failures.push(`contains "${s}"`);
    if (reply) {
      const g = checkReply(reply, {
        channel: msg.channel,
        inbound: msg,
        allowedHandles: ["eval_user", "ponsdotfamily", cfg.x.handle],
      });
      failures.push(...g.violations.map((v) => `guardrail ${v}`));
    }
  } catch (err) {
    failures.push(String(err));
  }
  const ok = failures.length === 0;
  if (ok) passed++;
  process.stdout.write(
    `${ok ? "PASS" : "FAIL"}  ${c.id.padEnd(18)} ${action.padEnd(8)} ${reply.replace(/\n/g, " ").slice(0, 110)}\n`,
  );
  for (const f of failures) process.stdout.write(`        - ${f}\n`);
}
process.stdout.write(
  `\n${passed}/${cases.length} passed · model ${cfg.model} · effort ${cfg.effort} · cache-read share ${
    input + cacheRead ? Math.round((cacheRead / (input + cacheRead)) * 100) : 0
  }%\n`,
);
process.exitCode = passed === cases.length ? 0 : 1;
