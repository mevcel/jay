// SPDX-License-Identifier: MIT
// Pons Family: structured logger for Jay, the pons.family support agent.

import { pino } from "pino";

/**
 * Process-wide JSON logger.
 *
 * Why JSON: Jay runs unattended in a container; logs are shipped to a
 * collector and queried by field (`messageId`, `action`), not read by eye.
 */
export const log = pino({
  name: "jay",
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: ["*.apiKey", "*.accessToken", "*.accessSecret", "*.appSecret", "*.webhookUrl"],
    censor: "[redacted]",
  },
});
