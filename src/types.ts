// SPDX-License-Identifier: MIT
// Pons Family: shared domain types for Jay, the pons.family support agent.

/** Where an inbound message arrived. Mentions are public; DMs are private. */
export type PonsInboundChannel = "mention" | "dm";

/** One prior message in the same conversation, oldest first. */
export interface PonsThreadMessage {
  authorHandle: string;
  text: string;
  /** True when @Ljayx069 (Jay) wrote it, so the model can see its own history. */
  fromJay: boolean;
}

/** A normalized inbound support request, independent of the X API shape. */
export interface PonsInboundMessage {
  id: string;
  channel: PonsInboundChannel;
  authorId: string;
  authorHandle: string;
  authorFollowers?: number;
  authorCreatedAt?: string;
  text: string;
  createdAt: string;
  /** X conversation id (mentions) or DM conversation id. */
  conversationId: string;
  thread: PonsThreadMessage[];
}

/** What Jay decided to do with a message. */
export type PonsJayAction = "reply" | "escalate" | "ignore";

/** Coarse topic label. Drives analytics and the escalation digest. */
export type PonsSupportCategory =
  | "launching"
  | "trading"
  | "fees"
  | "graduation"
  | "wallet_network"
  | "transaction_issue"
  | "security_scam"
  | "partnership_business"
  | "feedback_bug"
  | "general"
  | "off_topic";

/** The structured result of one agent run. */
export interface PonsJayDecision {
  action: PonsJayAction;
  category: PonsSupportCategory;
  /** Text to post. Present for `reply`, and for `escalate` as the public handoff line. */
  reply?: string;
  /** Internal note for the human team. Never posted. */
  internalNote?: string;
  severity?: "low" | "medium" | "high" | "critical";
  confidence: number;
}
