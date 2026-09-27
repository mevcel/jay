// SPDX-License-Identifier: MIT
// Pons Family: shared test fixtures for Jay, the pons.family support agent.

import type { PonsInboundMessage } from "../src/types.js";

export function mention(text: string, over: Partial<PonsInboundMessage> = {}): PonsInboundMessage {
  return {
    id: "1001",
    channel: "mention",
    authorId: "u1",
    authorHandle: "alice",
    text,
    createdAt: new Date().toISOString(),
    conversationId: "1001",
    thread: [],
    ...over,
  };
}
