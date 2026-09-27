// SPDX-License-Identifier: MIT
// Pons Family: tool definitions and executors for Jay, the pons.family support agent.

import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { PonsChainReader } from "../chain/robinhood.js";
import { searchKnowledge, type PonsKnowledgeBase } from "../knowledge/loader.js";
import { PonsToolInputError } from "../errors.js";
import type { PonsJayDecision } from "../types.js";

export const SUBMIT_DECISION = "submit_decision";

const CATEGORIES = [
  "launching",
  "trading",
  "fees",
  "graduation",
  "wallet_network",
  "transaction_issue",
  "security_scam",
  "partnership_business",
  "feedback_bug",
  "general",
  "off_topic",
] as const;

/**
 * Tool definitions sent on every request.
 *
 * Order and content are fixed: tools render before the system prompt in the
 * cached prefix, so a reordered or edited tool list is a full cache miss.
 */
export const JAY_TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "search_knowledge",
    description:
      "Search the Pons knowledge base and return the most relevant sections verbatim. Use it to double-check an exact number, address, or step before quoting it.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Keywords, e.g. 'creator fee split' or 'anti-snipe limits'.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "lookup_pons_token",
    description:
      "Look up a token contract on Robinhood Chain: whether it was launched through Pons, its creator, graduation progress (ETH paired vs threshold), whether launch anti-snipe limits are still active, and name/symbol/holders.",
    input_schema: {
      type: "object",
      properties: { address: { type: "string", description: "0x token contract address." } },
      required: ["address"],
      additionalProperties: false,
    },
  },
  {
    name: "check_transaction",
    description:
      "Check a transaction hash on Robinhood Chain: found or not, success/reverted/pending, from, to, value, and an explorer link.",
    input_schema: {
      type: "object",
      properties: {
        hash: { type: "string", description: "0x-prefixed 32-byte transaction hash." },
      },
      required: ["hash"],
      additionalProperties: false,
    },
  },
  {
    name: "check_wallet_balance",
    description:
      "Return a wallet's native ETH balance on Robinhood Chain. Useful when a user cannot pay gas.",
    input_schema: {
      type: "object",
      properties: { address: { type: "string", description: "0x wallet address." } },
      required: ["address"],
      additionalProperties: false,
    },
  },
  {
    name: SUBMIT_DECISION,
    description:
      "Record the final decision for this message. Call exactly once, last. 'reply' posts `reply`; 'escalate' posts `reply` as a handoff and alerts the human team; 'ignore' posts nothing.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["reply", "escalate", "ignore"] },
        category: { type: "string", enum: [...CATEGORIES] },
        reply: { type: ["string", "null"], description: "Exact text to post. Null for ignore." },
        internal_note: {
          type: ["string", "null"],
          description: "Brief for the human team. Never posted.",
        },
        severity: { type: ["string", "null"], enum: ["low", "medium", "high", "critical", null] },
        confidence: {
          type: "number",
          description: "0 to 1: how sure you are the reply is correct and complete.",
        },
      },
      required: ["action", "category", "reply", "internal_note", "severity", "confidence"],
      additionalProperties: false,
    },
  },
];

const decisionSchema = z.object({
  action: z.enum(["reply", "escalate", "ignore"]),
  category: z.enum(CATEGORIES),
  reply: z.string().nullable(),
  internal_note: z.string().nullable(),
  severity: z.enum(["low", "medium", "high", "critical"]).nullable(),
  confidence: z.number().min(0).max(1),
});

/** Validate and normalize a `submit_decision` call into a domain decision. */
export function parseDecision(input: unknown): PonsJayDecision {
  const r = decisionSchema.safeParse(input);
  if (!r.success) throw new PonsToolInputError(SUBMIT_DECISION, r.error.message);
  const d = r.data;
  if (d.action !== "ignore" && !d.reply?.trim()) {
    throw new PonsToolInputError(SUBMIT_DECISION, `action "${d.action}" requires a reply`);
  }
  return {
    action: d.action,
    category: d.category,
    reply: d.action === "ignore" ? undefined : d.reply!.trim(),
    internalNote: d.internal_note ?? undefined,
    severity: d.severity ?? undefined,
    confidence: d.confidence,
  };
}

const str = (key: string) => z.object({ [key]: z.string().min(1).max(200) });

/**
 * Execute a non-terminal tool and return a JSON string for the tool_result.
 *
 * Errors come back as `{ error }` payloads rather than exceptions so the model
 * can recover (e.g. ask the user to re-check a hash) instead of the run dying.
 */
export async function runTool(
  name: string,
  input: unknown,
  deps: { kb: PonsKnowledgeBase; chain: PonsChainReader },
): Promise<{ content: string; isError: boolean }> {
  try {
    switch (name) {
      case "search_knowledge": {
        const { query } = str("query").parse(input) as { query: string };
        const hits = searchKnowledge(deps.kb, query);
        return ok(
          hits.length ? hits : { note: "No matching section. Do not guess. Escalate if needed." },
        );
      }
      case "lookup_pons_token": {
        const { address } = str("address").parse(input) as { address: string };
        return ok(await deps.chain.ponsToken(address.trim()));
      }
      case "check_transaction": {
        const { hash } = str("hash").parse(input) as { hash: string };
        return ok(await deps.chain.transaction(hash.trim()));
      }
      case "check_wallet_balance": {
        const { address } = str("address").parse(input) as { address: string };
        return ok(await deps.chain.balance(address.trim()));
      }
      default:
        return { content: JSON.stringify({ error: `Unknown tool ${name}` }), isError: true };
    }
  } catch (err) {
    return {
      content: JSON.stringify({ error: String(err instanceof Error ? err.message : err) }),
      isError: true,
    };
  }
}

function ok(v: unknown) {
  return {
    content: JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)),
    isError: false,
  };
}
