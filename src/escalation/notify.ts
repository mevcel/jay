// SPDX-License-Identifier: MIT
// Pons Family: human escalation notifier for Jay, the pons.family support agent.

import type { PonsInboundMessage, PonsJayDecision } from "../types.js";
import { log } from "../util/logger.js";

/**
 * Posts an escalation card to the human team's Discord or Slack webhook.
 *
 * Why a webhook and not email: escalations include "my wallet was drained"
 * reports where minutes matter. A channel ping reaches the on-call human
 * fastest, and both Discord and Slack accept the same `content`/`text` shape.
 */
export class PonsEscalationNotifier {
  constructor(private readonly webhookUrl: string) {}

  async notify(msg: PonsInboundMessage, d: PonsJayDecision): Promise<void> {
    const link =
      msg.channel === "mention"
        ? `https://x.com/${msg.authorHandle}/status/${msg.id}`
        : `DM from @${msg.authorHandle}`;
    const sev = (d.severity ?? "medium").toUpperCase();
    const body = [
      `**[${sev}] Jay escalation: ${d.category}**`,
      `From: @${msg.authorHandle} · ${link}`,
      `> ${msg.text.replace(/\n/g, "\n> ").slice(0, 900)}`,
      d.internalNote ? `Jay's note: ${d.internalNote}` : null,
      d.reply ? `Jay replied: "${d.reply}"` : "Jay did not reply publicly.",
    ]
      .filter(Boolean)
      .join("\n");

    if (!this.webhookUrl) {
      log.warn({ messageId: msg.id, severity: sev }, "escalation (no webhook configured)\n" + body);
      return;
    }
    try {
      const res = await fetch(this.webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: body, text: body }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok)
        log.error({ status: res.status, messageId: msg.id }, "escalation webhook rejected");
    } catch (err) {
      // Never let a webhook outage stop Jay from answering everyone else.
      log.error({ err, messageId: msg.id }, "escalation webhook failed");
    }
  }
}
