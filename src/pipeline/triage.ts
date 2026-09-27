// SPDX-License-Identifier: MIT
// Pons Family: inbound triage (pre-model filters) for Jay, the pons.family support agent.

import type { PonsInboundMessage } from "../types.js";

/** Why a message will not reach the model, or the hints it carries if it does. */
export type PonsTriageResult =
  { route: "skip"; reason: string } | { route: "agent"; urgent: boolean; hints: string[] };

export interface PonsTriageContext {
  selfHandle: string;
  selfId: string;
  officialHandles: string[];
  maxMentionAgeMs: number;
  repliesToAuthorToday: number;
  now?: number;
}

/**
 * Handles that pretend to be Pons support. These accounts reply under Jay's
 * posts to lure users into "recovery" DMs, which is the single most common way users
 * of any launchpad get drained.
 */
const IMPERSONATOR =
  /(pons|ljay|jay).{0,12}(support|help|desk|care|team|admin|official|recovery)|(support|help|desk).{0,6}pons/i;

/** Signals of lost funds or an exploit: these bypass the per-user throttle. */
const URGENT =
  /\b(hack(ed)?|drain(ed|er)?|exploit(ed)?|stolen|scam(med)?|lost (my )?(funds|eth|money)|compromised|rug(ged)?|phish(ing|ed)?)\b/i;

/** Only @handles, links, cashtags, and emoji: nothing to answer. */
function isEmptyNoise(text: string): boolean {
  const stripped = text
    .replace(/@\w+/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\$[A-Za-z]\w*/g, "")
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Component}\s]/gu, "");
  return stripped.length === 0;
}

/**
 * Cheap, deterministic filters that run before any model call.
 *
 * Why before the model: they cost nothing, they are auditable, and some of
 * them (never replying to ourselves, never engaging impersonators) must hold
 * even if the model is having a bad day.
 */
export function triage(msg: PonsInboundMessage, ctx: PonsTriageContext): PonsTriageResult {
  const now = ctx.now ?? Date.now();
  const handle = msg.authorHandle.toLowerCase();

  if (msg.authorId === ctx.selfId || handle === ctx.selfHandle.toLowerCase()) {
    return { route: "skip", reason: "own message" };
  }
  if (ctx.officialHandles.some((h) => h.toLowerCase() === handle)) {
    return { route: "skip", reason: "official team account" };
  }
  if (msg.channel === "mention" && now - Date.parse(msg.createdAt) > ctx.maxMentionAgeMs) {
    return { route: "skip", reason: "stale mention" };
  }
  if (/^RT @/.test(msg.text)) return { route: "skip", reason: "retweet" };
  if (IMPERSONATOR.test(msg.authorHandle))
    return { route: "skip", reason: "suspected impersonator" };
  if (isEmptyNoise(msg.text)) return { route: "skip", reason: "no content" };

  const urgent = URGENT.test(msg.text);
  const hints: string[] = [];
  if (urgent)
    hints.push(
      "Possible lost funds or security incident. Escalate with severity high or critical.",
    );
  if (ctx.repliesToAuthorToday >= 6 && !urgent) {
    return { route: "skip", reason: "per-user daily reply cap" };
  }
  if (ctx.repliesToAuthorToday >= 3) {
    hints.push(
      "Jay has already replied to this user several times today. Prefer a concise handoff over another loop.",
    );
  }
  if (msg.authorCreatedAt && now - Date.parse(msg.authorCreatedAt) < 7 * 86_400_000) {
    hints.push("Author account is under a week old. Be alert to bait or impersonation.");
  }
  return { route: "agent", urgent, hints };
}
