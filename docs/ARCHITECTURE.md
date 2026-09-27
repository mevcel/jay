# Architecture

This document explains how Jay is put together and, more importantly, why. For day-to-day operation see [`RUNBOOK.md`](RUNBOOK.md).

## Components

| Module                      | Responsibility                                 | Talks to                                                      |
| --------------------------- | ---------------------------------------------- | ------------------------------------------------------------- |
| `src/index.ts`              | CLI; wires everything together                 | all                                                           |
| `src/pipeline/runner.ts`    | Poll loop, per-source cursors, backpressure    | `PonsInboundSource`, `PonsMessageProcessor`, `PonsStateStore` |
| `src/pipeline/processor.ts` | One message end to end, exactly once           | triage, agent, guardrails, outbox, notifier, store            |
| `src/pipeline/triage.ts`    | Pure function: skip or route, plus hints       | none                                                          |
| `src/agent/jay.ts`          | Tool-use loop producing a `PonsJayDecision`    | Model API, tools                                              |
| `src/agent/tools.ts`        | Tool schemas and executors                     | knowledge base, chain reader                                  |
| `src/safety/guardrails.ts`  | Pure function: is this draft safe to post      | none                                                          |
| `src/chain/robinhood.ts`    | Read-only RPC reads (viem public client)       | Robinhood Chain RPC, Blockscout                               |
| `src/x/client.ts`           | X API v2 adapter to/from `PonsInboundMessage`  | X API                                                         |
| `src/store/state.ts`        | SQLite: cursors, decisions, escalations, sends | disk                                                          |
| `src/escalation/notify.ts`  | Human paging                                   | Discord / Slack webhook                                       |

The pipeline only sees `PonsInboundMessage` and `PonsOutbox`. X is one adapter; a Telegram or Discord support channel would be another adapter implementing the same two shapes.

## The reply loop

```
user turn (message, thread, filter hints)
  -> messages.create(tools, system[instructions, knowledge base (cached)], messages)
       tool_use: search_knowledge / lookup_pons_token / check_transaction / check_wallet_balance
         -> run in parallel, send all results back in one turn, loop
       tool_use: submit_decision
         -> validate with zod, return the decision
         -> invalid: send the error back, loop so it can fix it
       text only
         -> one nudge to call submit_decision, loop, then PonsNoDecisionError
       pause_turn
         -> append and continue
       refusal
         -> PonsRefusalError (the message is handed off, nothing posted)
```

- **Model settings.** Model id from `JAY_MODEL`, effort from `JAY_EFFORT` (default `medium`). Support replies are short and factual, and higher effort costs more without making them better. Tune both against the scenario set.
- **Fallback.** Requests set `fallbacks: "default"`, so if the provider declines a request by mistake it is retried on its side instead of failing the message.
- **Round-trip cap.** Six per message. A support answer that needs more than that should go to a person.

## Prompt caching

Render order is `tools`, then `system`, then `messages`. Jay keeps everything before the user turn byte-identical across messages:

1. Tool definitions: a fixed array, fixed order.
2. `JAY_SYSTEM_PROMPT`: a constant, no timestamps.
3. The knowledge base: files concatenated in sorted filename order, with `cache_control: { type: "ephemeral", ttl: "1h" }`.

The inbound message, thread, triage hints and any guardrail revision notes go in the user turn. The scenario runner prints the share of input tokens read from cache; it should be well above 90% after the first case. If it drops to zero, something volatile has leaked into the prefix.

## Safety layers

| Layer              | Kind                      | Stops                                                                                             |
| ------------------ | ------------------------- | ------------------------------------------------------------------------------------------------- |
| Triage             | deterministic, pre-model  | self-replies, official accounts, impersonator handles, empty tags, stale mentions, per-user loops |
| Input framing      | prompt                    | prompt injection inside tweets (`<inbound>` data, brackets neutralized)                           |
| Persona hard rules | prompt                    | secret requests, off-site links, price talk, promises, stray tags                                 |
| Guardrails         | deterministic, post-model | the same hard rules, enforced in code, plus length and address provenance                         |
| Confidence gate    | deterministic             | low-confidence drafts are held for a human                                                        |
| Reply budget       | deterministic             | runaway posting (`MAX_REPLIES_PER_HOUR`)                                                          |
| Read-only chain    | architectural             | any path to moving funds                                                                          |

The prompt and the guardrails intentionally overlap. The prompt keeps violations rare, so the guardrails rarely trigger a rewrite; the guardrails guarantee that a violation never ships even when the model errs.

## State and delivery guarantees

- `handled` is keyed by message id (DMs are prefixed `dm:`). A message that is already in `handled` is never processed again.
- Cursors (`cursor:mentions`, `cursor:dms`) advance only past messages that were fully processed. A crash mid-batch re-fetches from the last success.
- On first boot with no cursor, Jay records the newest id and skips the backlog, so turning Jay on never floods old threads. Set `JAY_BACKFILL=true` to answer the backlog instead.
- When the hourly budget is exhausted the runner stops that source for the poll and resumes next poll from the same place.

## Extending Jay

- **New fact or changed fee:** edit the right file in `knowledge/`, add or update a case in `evals/cases.jsonl`, run `npm run eval`.
- **New official contract or domain:** add it to `knowledge/60-contracts.md` and to `PONS_OFFICIAL_ADDRESSES` / `PONS_LINK_ALLOWLIST` in `src/safety/guardrails.ts`.
- **New tool:** add the schema to `JAY_TOOLS` (append only, the order is part of the cache key), add the executor to `runTool`, keep it read-only, add a unit test.
- **New channel:** implement `PonsInboundSource.fetch` and `PonsOutbox`, register the source in `src/index.ts`.
