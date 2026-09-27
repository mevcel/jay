#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Pons Family: command-line entry point for Jay, the pons.family support agent.

import { createInterface } from "node:readline/promises";
import { PonsJayAgent } from "./agent/jay.js";
import { PonsChainReader } from "./chain/robinhood.js";
import { loadConfig } from "./config.js";
import { PonsEscalationNotifier } from "./escalation/notify.js";
import { PonsJayError } from "./errors.js";
import { loadKnowledgeBase } from "./knowledge/loader.js";
import { PonsMessageProcessor, type PonsOutbox } from "./pipeline/processor.js";
import { PonsRunner, type PonsInboundSource } from "./pipeline/runner.js";
import { PonsStateStore } from "./store/state.js";
import type { PonsInboundChannel, PonsInboundMessage, PonsThreadMessage } from "./types.js";
import { log } from "./util/logger.js";
import { PonsXClient } from "./x/client.js";

const OFFICIAL_HANDLES = ["ponsdotfamily"];

const USAGE = `jay: Pons Family support bot for @Ljayx069

Usage:
  jay run [--dry-run]     Poll X mentions and DMs and answer them continuously
  jay once [--dry-run]    Poll once, answer, and exit (for cron / debugging)
  jay chat [--dm]         Talk to Jay locally in the terminal; nothing touches X
  jay ask "<message>"     Print Jay's decision for one message as JSON
  jay stats [hours]       Decision counts and open escalations from the local DB
`;

async function main(argv: string[]) {
  const [cmd, ...rest] = argv;
  const flag = (f: string) => rest.includes(f);
  switch (cmd) {
    case "run":
    case "once":
      return live(cmd === "once", flag("--dry-run"));
    case "chat":
      return chat(flag("--dm") ? "dm" : "mention");
    case "ask":
      return ask(rest.filter((r) => !r.startsWith("--")).join(" "));
    case "stats":
      return stats(Number(rest[0] ?? 24));
    default:
      process.stdout.write(USAGE);
      process.exitCode = cmd ? 1 : 0;
  }
}

function buildAgent(cfg: ReturnType<typeof loadConfig>) {
  const kb = loadKnowledgeBase();
  const chain = new PonsChainReader(cfg.chain.rpcUrl, cfg.chain.blockscoutApiUrl);
  return new PonsJayAgent({ model: cfg.model, effort: cfg.effort, kb, chain });
}

async function live(once: boolean, dryFlag: boolean) {
  const cfg = loadConfig();
  const dryRun = dryFlag || cfg.runtime.dryRun;
  const x = new PonsXClient(cfg.x);
  const self = await x.me(cfg.x.userId || undefined, cfg.x.handle);
  const store = new PonsStateStore(cfg.runtime.databasePath);
  const processor = new PonsMessageProcessor({
    agent: buildAgent(cfg),
    store,
    outbox: x,
    notifier: new PonsEscalationNotifier(cfg.escalation.webhookUrl),
    self,
    officialHandles: OFFICIAL_HANDLES,
    handoffHandles: cfg.escalation.handoffHandles,
    maxRepliesPerHour: cfg.runtime.maxRepliesPerHour,
    maxMentionAgeMs: cfg.runtime.maxMentionAgeMs,
    dryRun,
  });
  const sources: PonsInboundSource[] = [{ name: "mentions", fetch: (c) => x.fetchMentions(c) }];
  if (cfg.x.enableDms) sources.push({ name: "dms", fetch: (c) => x.fetchDms(c) });
  const runner = new PonsRunner(sources, processor, store);
  log.info({ handle: self.handle, model: cfg.model, effort: cfg.effort, dryRun }, "starting Jay");

  if (once) {
    await runner.pollOnce();
    store.close();
    return;
  }
  const ac = new AbortController();
  for (const sig of ["SIGINT", "SIGTERM"] as const) process.once(sig, () => ac.abort());
  await runner.run(cfg.runtime.pollIntervalMs, ac.signal);
  store.close();
}

/** Local REPL: every line is treated as a new message in one ongoing thread. */
async function chat(channel: PonsInboundChannel) {
  const cfg = loadConfig(process.env, { requireX: false });
  const store = new PonsStateStore(":memory:");
  const outbox: PonsOutbox = { reply: async () => "local", sendDm: async () => "local" };
  const processor = new PonsMessageProcessor({
    agent: buildAgent(cfg),
    store,
    outbox,
    notifier: new PonsEscalationNotifier(""),
    self: { id: "jay", handle: cfg.x.handle },
    officialHandles: OFFICIAL_HANDLES,
    handoffHandles: cfg.escalation.handoffHandles,
    maxRepliesPerHour: 10_000,
    maxMentionAgeMs: Number.MAX_SAFE_INTEGER,
    dryRun: true,
  });
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const thread: PonsThreadMessage[] = [];
  process.stdout.write(`Chatting with Jay as a ${channel}. Ctrl+C to exit.\n`);
  for (let i = 1; ; i++) {
    const text = await rl.question("\nyou › ").catch(() => null);
    if (text === null) break;
    if (!text.trim()) continue;
    const msg = localMessage(`local-${i}`, text, channel, [...thread]);
    const r = await processor.process(msg);
    thread.push({ authorHandle: "you", text, fromJay: false });
    if (r.status === "skipped") {
      process.stdout.write(`(skipped: ${r.reason})\n`);
      continue;
    }
    const d = r.decision;
    process.stdout.write(
      `jay › ${d.reply ?? "(no reply)"}\n       [${d.action} · ${d.category} · confidence ${d.confidence}]\n`,
    );
    if (d.internalNote) process.stdout.write(`       note: ${d.internalNote}\n`);
    if (d.reply) thread.push({ authorHandle: cfg.x.handle, text: d.reply, fromJay: true });
  }
  rl.close();
}

async function ask(text: string) {
  if (!text) throw new PonsJayError('Usage: jay ask "<message>"');
  const cfg = loadConfig(process.env, { requireX: false });
  const { decision, usage } = await buildAgent(cfg).decide(
    localMessage("ask", text, "mention", []),
  );
  process.stdout.write(JSON.stringify({ decision, usage }, null, 2) + "\n");
}

async function stats(hours: number) {
  const cfg = loadConfig(process.env, { requireX: false });
  const store = new PonsStateStore(cfg.runtime.databasePath);
  process.stdout.write(`Last ${hours}h:\n`);
  for (const r of store.stats(hours * 3_600_000))
    process.stdout.write(`  ${r.action.padEnd(9)} ${String(r.category).padEnd(22)} ${r.n}\n`);
  const open = store.openEscalations();
  process.stdout.write(`\nOpen escalations: ${open.length}\n`);
  for (const e of open.slice(0, 20))
    process.stdout.write(`  [${e.severity}] ${e.message_id}: ${e.note.slice(0, 100)}\n`);
  store.close();
}

function localMessage(
  id: string,
  text: string,
  channel: PonsInboundChannel,
  thread: PonsThreadMessage[],
): PonsInboundMessage {
  return {
    id,
    channel,
    authorId: "local-user",
    authorHandle: "local_user",
    text,
    createdAt: new Date().toISOString(),
    conversationId: "local",
    thread,
  };
}

main(process.argv.slice(2)).catch((err) => {
  if (err instanceof PonsJayError) {
    log.error(err.message);
  } else {
    log.fatal({ err }, "unhandled error");
  }
  process.exit(1);
});
