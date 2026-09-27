// SPDX-License-Identifier: MIT
// Pons Family: outbound reply guardrails for Jay, the pons.family support agent.

import type { PonsInboundChannel, PonsInboundMessage } from "../types.js";

/** Domains Jay may link to. Anything else in a reply is treated as a phishing risk. */
export const PONS_LINK_ALLOWLIST = [
  "ponsfamily.com",
  "docs.ponsfamily.com",
  "pons.family",
  "robinhoodchain.blockscout.com",
  "github.com/ponsdotdev",
  "x.com/ponsdotfamily",
] as const;

/** Every address in knowledge/60-contracts.md, lowercased. */
export const PONS_OFFICIAL_ADDRESSES = new Set(
  [
    "0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB",
    "0x736D76699C26D0d966744cAe304C000d471f7F35",
    "0x0c37a24F5D23A486FA692d1500881d698B1F77a4",
    "0x31ca5E101941A93A7DD6d0497928700625CF54B5",
    "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e",
    "0x1f7d7550B1b028f7571E69A784071F0205FD2EfA",
    "0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3",
    "0xCaf681a66D020601342297493863E78C959E5cb2",
    "0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7",
    "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
  ].map((a) => a.toLowerCase()),
);

export const PONS_MAX_LEN: Record<PonsInboundChannel, number> = { mention: 280, dm: 1_000 };

export interface PonsGuardrailContext {
  channel: PonsInboundChannel;
  inbound: PonsInboundMessage;
  /** Handles Jay may @-mention: the author, official accounts, human handoff reps. */
  allowedHandles: string[];
}

export interface PonsGuardrailResult {
  ok: boolean;
  violations: string[];
}

interface Rule {
  name: string;
  test: (reply: string, ctx: PonsGuardrailContext) => string | null;
}

/** Asking for secrets: the one sentence a support account must never produce. */
const SECRET_REQUEST =
  /\b(send|share|dm|tell|give|provide|paste|enter|type|confirm)\b[^.?!]{0,40}\b(seed|secret|recovery)\s*(phrase|words?)|\b(send|share|dm|tell|give|provide|paste|enter)\b[^.?!]{0,40}\b(private\s*key|mnemonic|password|2fa|otp)\b/i;
const WALLET_BAIT =
  /\b(validate|verify|sync|rectify|restore|connect)\s+(your\s+)?wallet\s+(at|on|via|here|using)\b/i;
const FIN_ADVICE =
  /\b(guarantee[sd]?|will (moon|pump|10x|100x|go up)|you should (buy|sell|ape|hold)|good (investment|entry|buy)|price target|financial advice:|safe bet|can'?t lose)\b/i;
const PROMISE =
  /\b(refund|reimburs|compensat|make you whole|recover your funds|get your (funds|money) back)\w*/i;
const NEGATION_NEAR =
  /\b(no|not|can'?t|cannot|never|unable|isn'?t|won'?t|doesn'?t)\b[^.?!]{0,30}$/i;
/** "never share your seed phrase" is a warning, not a request. */
const PROHIBITION_BEFORE =
  /\b(never|don'?t|do not|no one should|nobody should|won'?t ever|will never)\s+(\w+\s+){0,2}$/i;

/** True when `re` matches somewhere not directly preceded by a prohibition. */
function matchesUnnegated(re: RegExp, text: string): boolean {
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  for (const m of text.matchAll(g)) {
    if (!PROHIBITION_BEFORE.test(text.slice(0, m.index))) return true;
  }
  return false;
}

const RULES: Rule[] = [
  {
    name: "length",
    test: (r, c) =>
      r.length > PONS_MAX_LEN[c.channel]
        ? `reply is ${r.length} chars; limit ${PONS_MAX_LEN[c.channel]}`
        : null,
  },
  { name: "empty", test: (r) => (r.trim().length < 2 ? "reply is empty" : null) },
  {
    name: "secret-request",
    test: (r) => (matchesUnnegated(SECRET_REQUEST, r) ? "asks the user for a secret" : null),
  },
  {
    name: "wallet-bait",
    test: (r) => (WALLET_BAIT.test(r) ? "uses wallet-drainer phrasing" : null),
  },
  {
    name: "financial-advice",
    test: (r) => (FIN_ADVICE.test(r) ? "reads as price or investment advice" : null),
  },
  {
    name: "promise",
    test: (r) => {
      const m = PROMISE.exec(r);
      if (!m) return null;
      const before = r.slice(0, m.index);
      return NEGATION_NEAR.test(before) ? null : `promises "${m[0]}"`;
    },
  },
  {
    name: "link-allowlist",
    test: (r) => {
      const urls = r.match(/\b(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/\S*)?/gi) ?? [];
      for (const raw of urls) {
        const u = raw
          .replace(/^https?:\/\//i, "")
          .replace(/[).,!?]+$/, "")
          .toLowerCase();
        if (/^\d/.test(u) || /^[a-z]\.[a-z]\.$/.test(u)) continue;
        if (!/\.[a-z]{2,}(\/|$)/.test(u)) continue;
        if (
          !PONS_LINK_ALLOWLIST.some(
            (ok) => u === ok || u.startsWith(`${ok}/`) || u.endsWith(`.${ok}`),
          )
        ) {
          return `links to non-allowlisted "${u}"`;
        }
      }
      return null;
    },
  },
  {
    name: "address-provenance",
    test: (r, c) => {
      const inbound = c.inbound.text.toLowerCase();
      for (const a of r.match(/0x[a-fA-F0-9]{40}\b/g) ?? []) {
        const l = a.toLowerCase();
        if (!PONS_OFFICIAL_ADDRESSES.has(l) && !inbound.includes(l))
          return `mentions unknown address ${a}`;
      }
      return null;
    },
  },
  {
    name: "mention-scope",
    test: (r, c) => {
      const allowed = new Set(c.allowedHandles.map((h) => h.toLowerCase()));
      for (const m of r.match(/@(\w{1,15})/g) ?? []) {
        if (!allowed.has(m.slice(1).toLowerCase())) return `tags unrelated account ${m}`;
      }
      return null;
    },
  },
  {
    name: "cashtag",
    test: (r, c) => {
      for (const t of r.match(/\$[A-Za-z][A-Za-z0-9]{1,9}\b/g) ?? []) {
        if (!c.inbound.text.toLowerCase().includes(t.toLowerCase())) return `promotes cashtag ${t}`;
      }
      return null;
    },
  },
];

/**
 * House style for posted text: em and en dashes become plain punctuation,
 * and stray whitespace is collapsed. Runs before the guardrails.
 */
export function tidyReply(reply: string): string {
  return reply
    .replace(/\s*[\u2014\u2013]\s*/g, ", ")
    .replace(/,\s*([.,!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/**
 * Deterministic checks every drafted reply must pass before it is posted.
 *
 * Why regex on top of a careful prompt: the prompt makes violations rare; the
 * guardrails make them impossible to ship. A support account's worst day is
 * one reply that asks for a seed phrase or links a drainer. Those cases get a
 * hard, testable wall that does not depend on the model.
 */
export function checkReply(reply: string, ctx: PonsGuardrailContext): PonsGuardrailResult {
  const violations: string[] = [];
  for (const rule of RULES) {
    const v = rule.test(reply, ctx);
    if (v) violations.push(`${rule.name}: ${v}`);
  }
  return { ok: violations.length === 0, violations };
}
