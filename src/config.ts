// SPDX-License-Identifier: MIT
// Pons Family: environment configuration for Jay, the pons.family support agent.

import { z } from "zod";
import { PonsConfigError } from "./errors.js";

const bool = z
  .enum(["true", "false", "1", "0", ""])
  .default("false")
  .transform((v) => v === "true" || v === "1");

const schema = z.object({
  ANTHROPIC_API_KEY: z.string().optional(),
  JAY_MODEL: z.string().default("claude-opus-5"),
  JAY_EFFORT: z.enum(["low", "medium", "high", "xhigh", "max"]).default("medium"),

  X_API_KEY: z.string().default(""),
  X_API_SECRET: z.string().default(""),
  X_ACCESS_TOKEN: z.string().default(""),
  X_ACCESS_SECRET: z.string().default(""),
  X_USER_ID: z.string().default(""),
  X_HANDLE: z.string().default("Ljayx069"),
  X_ENABLE_DMS: bool,

  POLL_INTERVAL_SECONDS: z.coerce.number().int().min(15).default(120),
  DRY_RUN: bool,
  MAX_REPLIES_PER_HOUR: z.coerce.number().int().min(1).default(40),
  MAX_MENTION_AGE_MINUTES: z.coerce.number().int().min(1).default(180),
  DATABASE_PATH: z.string().default("./data/jay.db"),

  ROBINHOOD_RPC_URL: z.string().url().default("https://rpc.mainnet.chain.robinhood.com"),
  BLOCKSCOUT_API_URL: z.string().url().default("https://robinhoodchain.blockscout.com/api/v2"),

  ESCALATION_WEBHOOK_URL: z.string().default(""),
  HUMAN_HANDOFF_HANDLES: z.string().default("ponsdotfamily"),
});

export type PonsJayConfig = ReturnType<typeof loadConfig>;

/**
 * Parse and validate the environment once, at boot.
 *
 * X credentials are only required when Jay will actually talk to X; the
 * `chat` and `eval` commands run with a model API key alone, which keeps
 * local iteration on the persona free of X API quota.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env, opts = { requireX: true }) {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    throw new PonsConfigError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  }
  const c = parsed.data;
  if (opts.requireX) {
    const missing = (
      ["X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_SECRET"] as const
    ).filter((k) => !c[k]);
    if (missing.length) throw new PonsConfigError(missing.map((k) => `${k}: required`));
  }
  return {
    model: c.JAY_MODEL,
    effort: c.JAY_EFFORT,
    x: {
      appKey: c.X_API_KEY,
      appSecret: c.X_API_SECRET,
      accessToken: c.X_ACCESS_TOKEN,
      accessSecret: c.X_ACCESS_SECRET,
      userId: c.X_USER_ID,
      handle: c.X_HANDLE.replace(/^@/, ""),
      enableDms: c.X_ENABLE_DMS,
    },
    runtime: {
      pollIntervalMs: c.POLL_INTERVAL_SECONDS * 1000,
      dryRun: c.DRY_RUN,
      maxRepliesPerHour: c.MAX_REPLIES_PER_HOUR,
      maxMentionAgeMs: c.MAX_MENTION_AGE_MINUTES * 60_000,
      databasePath: c.DATABASE_PATH,
    },
    chain: {
      rpcUrl: c.ROBINHOOD_RPC_URL,
      blockscoutApiUrl: c.BLOCKSCOUT_API_URL.replace(/\/$/, ""),
    },
    escalation: {
      webhookUrl: c.ESCALATION_WEBHOOK_URL,
      handoffHandles: c.HUMAN_HANDOFF_HANDLES.split(",")
        .map((h) => h.trim().replace(/^@/, ""))
        .filter(Boolean),
    },
  };
}
