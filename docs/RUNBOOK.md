# Runbook

Operating guide for the team running [@Ljayx069](https://x.com/Ljayx069).

## 1. One-time setup

### X developer app

1. Sign in to [developer.x.com](https://developer.x.com) with the account that owns `@Ljayx069` and create a project and app. The Basic tier or above is required to read the mentions timeline and DMs.
2. Under **User authentication settings**, enable OAuth 1.0a with **Read and write and Direct message** permissions.
3. Generate the **API Key and Secret** (`X_API_KEY`, `X_API_SECRET`) and the **Access Token and Secret** for `@Ljayx069` (`X_ACCESS_TOKEN`, `X_ACCESS_SECRET`). Regenerate the access token after changing permissions. Old tokens keep the old scope.
4. In the `@Ljayx069` account settings, turn on the **Automated** account label and link it to the managing human account (`@ponsdotfamily`). X's automation rules require it, and it tells users up front that replies are automated.

### Model API key

Create an API key in the Pons Family console workspace and set `ANTHROPIC_API_KEY`. A workspace spend limit is recommended.

### Escalation channel

Create a Discord (or Slack) channel for the support team, add an incoming webhook, and set `ESCALATION_WEBHOOK_URL`. Turn on notifications for that channel on the on-call person's phone.

## 2. First launch

```bash
cp .env.example .env         # fill in every secret
# keep DRY_RUN=true
docker compose up -d --build
docker compose logs -f jay
```

On first boot Jay records the newest mention and skips the backlog. Leave it in dry run for a few hours: every `[dry-run] would post` log line is a reply Jay would have sent. When the drafts look right, set `DRY_RUN=false` and `docker compose up -d`.

## 3. Everyday operation

| Task                           | How                                                                         |
| ------------------------------ | --------------------------------------------------------------------------- |
| Watch live                     | `docker compose logs -f jay` (JSON; pipe through `npx pino-pretty` to read) |
| See what Jay did today         | `docker compose exec jay node dist/index.js stats 24`                       |
| Try a question before users do | `npm run chat` locally                                                      |
| Pause replies immediately      | `docker compose stop jay`                                                   |
| Pause without stopping reads   | set `DRY_RUN=true`, `docker compose up -d`                                  |
| Update a fact                  | edit `knowledge/*.md`, `npm run eval`, rebuild and redeploy                 |

## 4. Handling escalations

Each webhook card shows severity, the user's message and link, Jay's internal note, and the public handoff Jay posted (if any).

| Severity   | Typical cause                                                           | Target response                  |
| ---------- | ----------------------------------------------------------------------- | -------------------------------- |
| `critical` | Reported exploit, contract bug, site compromise, many users affected    | Immediately; loop in engineering |
| `high`     | One user's funds lost or wallet compromised, phishing in the wild       | Within the hour                  |
| `medium`   | Unanswerable question, frustrated user, processing error, blocked draft | Same day                         |
| `low`      | Held low-confidence draft, partnership or press inquiry                 | Next business day                |

Reply from the human account in the same thread so the user sees continuity. If a knowledge gap caused the escalation, add the answer to `knowledge/` so Jay handles it next time.

## 5. Incidents

- **Jay posted something wrong.** Delete the post from the X app, stop the container, find the decision (`handled` table in `data/jay.db`, or logs by `messageId`), add an eval case that reproduces it, fix the knowledge or persona, confirm with `npm run eval`, redeploy.
- **Reply storm or loop.** The hourly budget caps damage. Stop the container, check `stats`, and lower `MAX_REPLIES_PER_HOUR` if needed.
- **X API 429s.** Raise `POLL_INTERVAL_SECONDS`. The runner resumes from its cursor, so nothing is lost.
- **Model API errors.** The SDK retries transient failures; persistent failures escalate each message to a human without posting. Check the Anthropic status page and the workspace spend limit.
- **Credential leak.** Revoke and regenerate the X access token and the model API key, update `.env`, redeploy.

## 6. Backups

`/data/jay.db` holds the full decision log. Snapshot the volume daily if the audit trail matters to you:

```bash
docker compose exec jay node -e "require('better-sqlite3')('/data/jay.db').backup('/data/backup.db')"
```
