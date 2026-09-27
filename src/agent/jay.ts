// SPDX-License-Identifier: MIT
// Pons Family: Jay, the pons.family customer service agent (tool-use loop).

import Anthropic from "@anthropic-ai/sdk";
import type { PonsChainReader } from "../chain/robinhood.js";
import { PonsNoDecisionError, PonsRefusalError, PonsToolInputError } from "../errors.js";
import type { PonsKnowledgeBase } from "../knowledge/loader.js";
import type { PonsInboundMessage, PonsJayDecision } from "../types.js";
import { log } from "../util/logger.js";
import { JAY_SYSTEM_PROMPT } from "./persona.js";
import { JAY_TOOLS, parseDecision, runTool, SUBMIT_DECISION } from "./tools.js";

type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface PonsJayAgentOptions {
  model: string;
  effort: Effort;
  kb: PonsKnowledgeBase;
  chain: PonsChainReader;
  client?: Anthropic;
  /** Upper bound on model round-trips per inbound message. */
  maxIterations?: number;
}

/** Extra context the pipeline passes alongside a message. */
export interface PonsJayRunContext {
  hints?: string[];
  /** Guardrail feedback from a rejected previous draft; triggers a rewrite. */
  revisionNotes?: string[];
}

/** Token accounting for one run. Logged so cache health is visible in production. */
export interface PonsJayUsage {
  iterations: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/**
 * Jay: turns one inbound mention or DM into a structured decision.
 *
 * The loop is written by hand rather than with the SDK tool runner because the
 * terminal tool (`submit_decision`) ends the run without a tool_result, and
 * because every request carries the server-side refusal fallback beta.
 *
 * Prompt layout (cache-friendly, stable to volatile):
 *   tools, system[persona], system[knowledge base, cache breakpoint], user turn
 * The persona and knowledge base are identical for every message, so after the
 * first request each run pays only for the user turn and the model's output.
 */
export class PonsJayAgent {
  private readonly client: Anthropic;
  private readonly system: Anthropic.Beta.BetaTextBlockParam[];
  private readonly maxIterations: number;

  constructor(private readonly opts: PonsJayAgentOptions) {
    this.client = opts.client ?? new Anthropic({ maxRetries: 3 });
    this.maxIterations = opts.maxIterations ?? 6;
    this.system = [
      { type: "text", text: JAY_SYSTEM_PROMPT },
      {
        type: "text",
        text: `<knowledge_base>\n${opts.kb.fullText}\n</knowledge_base>`,
        // 1h TTL: mentions arrive in bursts with quiet gaps longer than 5 minutes.
        cache_control: { type: "ephemeral", ttl: "1h" },
      },
    ];
  }

  /** Run the agent on one message and return its decision plus usage. */
  async decide(
    msg: PonsInboundMessage,
    ctx: PonsJayRunContext = {},
  ): Promise<{ decision: PonsJayDecision; usage: PonsJayUsage }> {
    const messages: Anthropic.Beta.BetaMessageParam[] = [
      { role: "user", content: renderInbound(msg, ctx) },
    ];
    const usage: PonsJayUsage = {
      iterations: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    };
    let nudged = false;
    let lastStop: string | null = null;

    while (usage.iterations < this.maxIterations) {
      usage.iterations++;
      const res = await this.client.beta.messages.create({
        model: this.opts.model,
        max_tokens: 16_000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        thinking: { type: "adaptive" },
        output_config: { effort: this.opts.effort },
        system: this.system,
        tools: JAY_TOOLS,
        tool_choice: { type: "auto" },
        messages,
      });
      usage.inputTokens += res.usage.input_tokens;
      usage.outputTokens += res.usage.output_tokens;
      usage.cacheReadTokens += res.usage.cache_read_input_tokens ?? 0;
      usage.cacheWriteTokens += res.usage.cache_creation_input_tokens ?? 0;
      lastStop = res.stop_reason;

      if (res.stop_reason === "refusal") {
        throw new PonsRefusalError(msg.id, res.stop_details?.category ?? null);
      }

      const toolUses = res.content.filter(
        (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use",
      );
      const submit = toolUses.find((t) => t.name === SUBMIT_DECISION);
      if (submit) {
        try {
          return { decision: parseDecision(submit.input), usage };
        } catch (err) {
          if (!(err instanceof PonsToolInputError)) throw err;
          // Hand the validation error back so the model can correct itself.
          messages.push({ role: "assistant", content: res.content });
          messages.push({
            role: "user",
            content: toolUses.map((t) => ({
              type: "tool_result" as const,
              tool_use_id: t.id,
              is_error: t.id === submit.id,
              content: t.id === submit.id ? err.detail : "Not executed; resubmit the decision.",
            })),
          });
          continue;
        }
      }

      if (res.stop_reason === "pause_turn") {
        messages.push({ role: "assistant", content: res.content });
        continue;
      }

      if (toolUses.length === 0) {
        if (nudged) break;
        // The model answered in prose; ask it to finish through the tool.
        nudged = true;
        messages.push({ role: "assistant", content: res.content });
        messages.push({
          role: "user",
          content: "Finish by calling submit_decision with your final decision.",
        });
        continue;
      }

      messages.push({ role: "assistant", content: res.content });
      const results = await Promise.all(
        toolUses.map(async (t) => {
          const r = await runTool(t.name, t.input, this.opts);
          log.debug(
            { messageId: msg.id, tool: t.name, input: t.input, isError: r.isError },
            "tool call",
          );
          return {
            type: "tool_result" as const,
            tool_use_id: t.id,
            content: r.content,
            is_error: r.isError,
          };
        }),
      );
      messages.push({ role: "user", content: results });
    }

    throw new PonsNoDecisionError(msg.id, lastStop, usage.iterations);
  }
}

/** Escape angle brackets so user text cannot close or forge our XML-ish tags. */
function esc(s: string): string {
  return s.replace(/</g, "‹").replace(/>/g, "›");
}

/**
 * Render the per-message user turn. Everything volatile lives here, after the
 * cache breakpoint, so the cached prefix never changes.
 */
export function renderInbound(msg: PonsInboundMessage, ctx: PonsJayRunContext = {}): string {
  const lines: string[] = [];
  lines.push(
    `Channel: ${msg.channel === "dm" ? "direct message (private)" : "public mention (reply is public, 280 chars max)"}`,
  );
  lines.push(
    `From: @${msg.authorHandle}${msg.authorFollowers !== undefined ? ` (${msg.authorFollowers} followers)` : ""}`,
  );
  lines.push(`Received: ${msg.createdAt}`);
  if (ctx.hints?.length) lines.push(`Triage notes:\n${ctx.hints.map((h) => `- ${h}`).join("\n")}`);
  lines.push("<inbound>");
  if (msg.thread.length) {
    lines.push('<thread oldest_first="true">');
    for (const t of msg.thread)
      lines.push(`${t.fromJay ? "Jay (you)" : `@${esc(t.authorHandle)}`}: ${esc(t.text)}`);
    lines.push("</thread>");
  }
  lines.push(`<message author="@${esc(msg.authorHandle)}">${esc(msg.text)}</message>`);
  lines.push("</inbound>");
  if (ctx.revisionNotes?.length) {
    lines.push(
      `Your previous draft was blocked by the outbound safety checks:\n${ctx.revisionNotes
        .map((n) => `- ${n}`)
        .join("\n")}\nWrite a new decision that avoids these problems.`,
    );
  }
  return lines.join("\n");
}
