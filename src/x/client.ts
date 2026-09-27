// SPDX-License-Identifier: MIT
// Pons Family: X (Twitter) API adapter for Jay, the pons.family support agent.

import { TwitterApi, type TweetV2, type UserV2 } from "twitter-api-v2";
import { PonsXPostError } from "../errors.js";
import type { PonsInboundMessage, PonsThreadMessage } from "../types.js";
import { log } from "../util/logger.js";

const TWEET_FIELDS = [
  "created_at",
  "conversation_id",
  "referenced_tweets",
  "author_id",
  "in_reply_to_user_id",
] as const;
const USER_FIELDS = ["username", "public_metrics", "created_at"] as const;

export interface PonsXCredentials {
  appKey: string;
  appSecret: string;
  accessToken: string;
  accessSecret: string;
}

/**
 * Thin adapter between X API v2 and Jay's normalized message shape.
 *
 * Why an adapter: the pipeline and agent never see X types. That keeps the
 * agent testable offline and makes adding another channel (Telegram, Discord)
 * a new adapter instead of a rewrite.
 */
export class PonsXClient {
  private readonly api: TwitterApi;
  private self: { id: string; handle: string } | null = null;

  constructor(creds: PonsXCredentials) {
    // OAuth 1.0a user context: required to post replies and read DMs as @Ljayx069.
    this.api = new TwitterApi(creds);
  }

  /** Resolve (and memoize) the authenticated account. */
  async me(knownId?: string, knownHandle?: string): Promise<{ id: string; handle: string }> {
    if (this.self) return this.self;
    if (knownId && knownHandle) return (this.self = { id: knownId, handle: knownHandle });
    const { data } = await this.api.v2.me();
    return (this.self = { id: data.id, handle: data.username });
  }

  /**
   * Mentions newer than `sinceId`, oldest first, with up to three ancestors of
   * thread context each. Returns the newest id seen as the next cursor.
   */
  async fetchMentions(
    sinceId?: string,
  ): Promise<{ messages: PonsInboundMessage[]; cursor?: string }> {
    const self = await this.me();
    const page = await this.api.v2.userMentionTimeline(self.id, {
      since_id: sinceId,
      max_results: 50,
      expansions: ["author_id", "referenced_tweets.id", "referenced_tweets.id.author_id"],
      "tweet.fields": [...TWEET_FIELDS],
      "user.fields": [...USER_FIELDS],
    });
    const tweets = page.tweets;
    if (!tweets.length) return { messages: [] };

    const users = new Map<string, UserV2>((page.includes?.users ?? []).map((u) => [u.id, u]));
    const known = new Map<string, TweetV2>((page.includes?.tweets ?? []).map((t) => [t.id, t]));
    const out: PonsInboundMessage[] = [];
    for (const t of [...tweets].reverse()) {
      const author = users.get(t.author_id ?? "");
      out.push({
        id: t.id,
        channel: "mention",
        authorId: t.author_id ?? "",
        authorHandle: author?.username ?? "unknown",
        authorFollowers: author?.public_metrics?.followers_count,
        authorCreatedAt: author?.created_at,
        text: t.text,
        createdAt: t.created_at ?? new Date().toISOString(),
        conversationId: t.conversation_id ?? t.id,
        thread: await this.ancestors(t, known, users, self.id),
      });
    }
    return { messages: out, cursor: page.meta.newest_id ?? tweets[0]?.id };
  }

  /** Walk `replied_to` links upward (max 3), oldest first. */
  private async ancestors(
    t: TweetV2,
    known: Map<string, TweetV2>,
    users: Map<string, UserV2>,
    selfId: string,
  ): Promise<PonsThreadMessage[]> {
    const chain: PonsThreadMessage[] = [];
    let parentId = t.referenced_tweets?.find((r) => r.type === "replied_to")?.id;
    for (let depth = 0; parentId && depth < 3; depth++) {
      let parent = known.get(parentId);
      if (!parent) {
        try {
          const r = await this.api.v2.singleTweet(parentId, {
            expansions: ["author_id"],
            "tweet.fields": [...TWEET_FIELDS],
            "user.fields": [...USER_FIELDS],
          });
          parent = r.data;
          for (const u of r.includes?.users ?? []) users.set(u.id, u);
        } catch {
          break; // deleted or protected parent: partial context is fine
        }
      }
      chain.unshift({
        authorHandle: users.get(parent.author_id ?? "")?.username ?? "unknown",
        text: parent.text,
        fromJay: parent.author_id === selfId,
      });
      parentId = parent.referenced_tweets?.find((r) => r.type === "replied_to")?.id;
    }
    return chain;
  }

  /**
   * Incoming DMs newer than `sinceEventId`, oldest first, with the last few
   * messages of each conversation as context.
   */
  async fetchDms(
    sinceEventId?: string,
  ): Promise<{ messages: PonsInboundMessage[]; cursor?: string }> {
    const self = await this.me();
    const page = await this.api.v2.listDmEvents({
      max_results: 50,
      event_types: ["MessageCreate"],
      "dm_event.fields": ["id", "text", "created_at", "sender_id", "dm_conversation_id"],
      expansions: ["sender_id"],
      "user.fields": [...USER_FIELDS],
    });
    const events = page.events.filter((e) => e.event_type === "MessageCreate");
    const users = new Map<string, UserV2>((page.includes?.users ?? []).map((u) => [u.id, u]));
    const fresh = events.filter((e) => !sinceEventId || BigInt(e.id) > BigInt(sinceEventId));
    const newest = events.reduce<string | undefined>(
      (m, e) => (!m || BigInt(e.id) > BigInt(m) ? e.id : m),
      sinceEventId,
    );

    const out: PonsInboundMessage[] = [];
    for (const e of fresh.reverse()) {
      if (e.event_type !== "MessageCreate" || e.sender_id === self.id) continue;
      const sender = users.get(e.sender_id ?? "");
      const history = events
        .filter(
          (h) =>
            h.event_type === "MessageCreate" &&
            h.dm_conversation_id === e.dm_conversation_id &&
            BigInt(h.id) < BigInt(e.id),
        )
        .slice(0, 6)
        .reverse();
      out.push({
        id: `dm:${e.id}`,
        channel: "dm",
        authorId: e.sender_id ?? "",
        authorHandle: sender?.username ?? "unknown",
        authorFollowers: sender?.public_metrics?.followers_count,
        authorCreatedAt: sender?.created_at,
        text: e.text ?? "",
        createdAt: e.created_at ?? new Date().toISOString(),
        conversationId: e.dm_conversation_id ?? e.sender_id ?? "",
        thread: history.map((h) => ({
          authorHandle:
            h.event_type === "MessageCreate" && h.sender_id === self.id
              ? self.handle
              : (sender?.username ?? "user"),
          text: h.event_type === "MessageCreate" ? (h.text ?? "") : "",
          fromJay: h.event_type === "MessageCreate" && h.sender_id === self.id,
        })),
      });
    }
    return { messages: out, cursor: newest };
  }

  /** Post a threaded public reply. Returns the new tweet id. */
  async reply(toTweetId: string, text: string): Promise<string> {
    try {
      const r = await this.api.v2.reply(text, toTweetId);
      return r.data.id;
    } catch (err) {
      log.error({ err, toTweetId }, "reply failed");
      throw new PonsXPostError(toTweetId, err);
    }
  }

  /** Send a DM back to the participant. Returns the DM event id. */
  async sendDm(participantId: string, text: string): Promise<string> {
    try {
      const r = await this.api.v2.sendDmToParticipant(participantId, { text });
      return r.dm_event_id;
    } catch (err) {
      log.error({ err, participantId }, "dm failed");
      throw new PonsXPostError(participantId, err);
    }
  }
}
