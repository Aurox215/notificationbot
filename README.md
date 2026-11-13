# Freelance Job Alert Bot

Multi-user Telegram bot with SQLite preferences/history, independent PeoplePerHour and Guru source interfaces, keyword filtering, a shared scheduler and per-user duplicate detection. **Sources are mock fixtures only. No live freelance website, Gmail or API integration is enabled.** All fixture projects and client information are synthetic.

## Windows setup

Use Node.js 26.13.1 LTS and npm. With NVM for Windows:

```powershell
nvm install 26.13.1
nvm use 26.13.1
npm.cmd ci
if (!(Test-Path .env)) { Copy-Item .env.example .env }
```

NVM for Windows does not automatically consume .nvmrc. Open a new VS Code terminal if PATH has changed. SQLite uses Node's bundled node:sqlite module; no native npm compilation is needed. Its upstream stability is currently release candidate: keep Node pinned and verify upgrades in tests.

Create a bot through the official @BotFather account and put its token in .env. Existing .env files are not modified; add the new optional settings manually:

```dotenv
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_TIMEOUT_MS=15000
SOURCE_MODE=mock
MONITOR_INTERVAL_MS=5000
DATABASE_PATH=data/bidbot.sqlite
DEFAULT_KEYWORDS=AI,automation,Python,PHP,Laravel,React,Next.js,Node.js,TypeScript,WordPress,WooCommerce,Shopify,API,full-stack
```

TELEGRAM_CHAT_ID is required only by the preserved Phase 1 telegram:test command. The multi-user runtime discovers recipients through private Telegram messages. Default keywords apply to newly registered users; existing preferences persist. The administrator controls the shared interval (1000–3600000 ms). Users cannot change it. Command retrieval uses independent 25-second Telegram long polling.

## Verification and startup

Offline verification without credentials or network requests:

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run demo
npm.cmd run telegram:preview
```

The demo registers two simulated users with different preferences, delivers one matching fixture to each, and confirms a second cycle sends no duplicates. Tests cover commands, isolation, keyword boundaries, SQLite restart persistence, atomic claims, crash recovery, rate limits, failures, cancellation and persisted polling offsets.

Start the actual Telegram bot:

```powershell
npm.cmd run dev
```

Or run npm.cmd run build once, then npm.cmd start. Stop with Ctrl+C. Only Telegram is contacted; PeoplePerHour/Guru are never fetched.

In your private chat with the bot:

```text
/start
/keywords Python
/platforms PeoplePerHour
/subscribe
/status
```

Within the next cycle you should receive [MOCK] Python AI automation. In a second user's private chat, use /start, /platforms Guru, /subscribe to receive the Guru fixture independently. Wait several cycles and restart with the same database: no repeat alerts should arrive, and preferences/history should persist.

Use /pause then /status to verify pause, and /resume to continue. Previously delivered fixtures are not resent. For a new alert in the first chat, use /platforms all and /keywords all to make the unsent Guru fixture eligible. To simulate new projects repeatedly, add a fixture with a new sourceId in a mock adapter and rebuild. Avoid deleting a deployment database to reset testing.

Anyone can register, with no allowlist. Only private chats are supported; groups/channels are ignored. Registration does not automatically subscribe.

| Command | Behavior |
| --- | --- |
| /start | Register private chat; preserve preferences; show help |
| /subscribe | Enable alerts and clear pause |
| /pause | Pause without losing history/preferences |
| /resume | Resume an existing subscription |
| /keywords | Show keywords |
| /keywords Python, React, API | Replace keywords: up to 30 values, 60 characters each |
| /keywords all | Match all projects |
| /platforms | Show platforms |
| /platforms PeoplePerHour,Guru | Replace platforms; case-insensitive |
| /platforms all | Enable both |
| /status | Show mock mode, preferences, interval and delivery counts |
| /help | Command usage |

Matching uses any configured literal keyword, case-insensitively, across title, description, category and skills, with letter/number boundaries. AI does not match paid; punctuation in Next.js and C++ is literal. Configure aliases such as React,React.js explicitly. Stored projects are reevaluated after subscription, resume and preference changes, so matching backlog fixtures can be delivered.

## Preserved Phase 1 smoke test

telegram:preview prints the synthetic sample without sending. To use npm.cmd run telegram:test, set TELEGRAM_CHAT_ID to your numeric private chat ID, send /start to your bot, then run the command. It sends directly, bypassing subscriptions/history; repeated manual tests intentionally repeat the sample.

To discover your chat ID, stop the bot first, send it a message, then run locally:

```powershell
$botSecret = Read-Host 'Bot token' -AsSecureString
$botCredential = [System.Net.NetworkCredential]::new('', $botSecret)
$updates = Invoke-RestMethod -Uri ('https://api.telegram.org/bot' + $botCredential.Password + '/getUpdates')
$updates.result.message.chat.id | Sort-Object -Unique
Remove-Variable botSecret,botCredential,updates
```

Do not share the token/response. An existing webhook or another polling client prevents long polling. Use a dedicated bot without a webhook; the app does not silently delete webhooks.

## Modules and data

- src/config: environment validation and central interval
- src/bot: private-chat commands and durable-offset polling
- src/telegram: preserved notification client, per-recipient sending and updates
- src/domain: project model and plain-text formatting
- src/sources: separate platform contracts/mock adapters
- src/filtering: per-user literal keyword matching
- src/persistence: SQLite users/preferences, projects, history and polling state
- src/monitoring: shared non-overlapping scheduler and dispatch
- src/logging: timestamped JSON records without tokens/user payloads
- src/cli: smoke test and offline demo

Schema initializes automatically, with WAL, foreign keys, busy timeout and prepared statements. Project identity is (platform, sourceId); delivery identity is (userId, projectId), enforced by unique constraints. First-observed project snapshots and detection timestamps persist. A SQLite claim precedes each send. A database .lock file prevents a second runtime on the same database. Only one runtime per bot token is supported, even with different databases.

Each source is fetched once per cycle regardless of subscriber count. Cycles never overlap. Project sends are serialized with at least 1.1 seconds between requests. Slow sources or many users extend a cycle beyond the interval; five-second scheduling is not a delivery guarantee. Synchronous SQLite and scans of stored projects suit this initial infrastructure; indexed/batched dispatch and retention are needed before large-scale use.

Delivery states:

- pending: eligible, unsent or explicitly rate-limited; respects retry_after, with at most five attempts
- sending: claimed before Telegram request
- sent: Telegram acknowledged success
- failed: explicit non-rate-limit client rejection or exhausted retry budget
- unknown: network/response uncertainty, server error or interrupted in-flight send recovered after restart

Failed/unknown sends are not retried automatically. A timeout may follow successful delivery; avoiding automatic retry prevents a possible duplicate but can miss an alert. Exactly-once delivery is not guaranteed. A 403 pauses that user; other users continue. Command replies are separate from notification history. Preferences are saved before replying; reply failure does not roll them back. Polling retries transient failures with bounded exponential backoff. A crash after handling a command but before storing its offset may repeat its reply; preference changes are idempotent.

## Adding authorized sources later

Implement fetchProjects(signal) separately for each platform, returning stable sourceId, platform, title, detectedAt and source-supplied optional fields. Honor cancellation and timeouts. The model supports category, budget, skills, summary, URL, client rating score, review count and join date; missing fields remain absent. Mock links use example.com.

Only mock mode is accepted now. Authorized emails, feeds or APIs can be added without changing commands/deduplication. There is no scraping, CAPTCHA bypass, proxy rotation or unverified endpoint integration.

## VPS deployment

With Node.js 26.13.1, run npm ci and npm run build, then node dist/src/main.js under systemd or a host supervisor. Set its working directory, inject environment variables through a protected file/secret manager, and enable restart backoff. Use one process, not cluster mode. No inbound HTTP port is needed.

Keep DATABASE_PATH on a persistent local disk, not ephemeral or network storage. Run as a dedicated OS user with restrictive file permissions; Telegram IDs/preferences are stored unencrypted. Use a SQLite-aware backup tool, or stop the service before copying the database. Do not copy just the database while WAL writes are active.

SIGINT/SIGTERM cancel polling/scheduling and close SQLite after active sends finish (up to the send timeout). A hard kill can leave DATABASE_PATH.lock; confirm no instance is running before removing only that lock. Do not delete the database. Interrupted sending rows become unknown on restart.

Never commit .env, OAuth credentials, database/journal files or database locks. Existing secret exclusions are preserved. Revoke exposed Telegram tokens through BotFather. Automated tests mock Telegram; live delivery is verified by the manual steps above.

References: [Telegram Bot API](https://core.telegram.org/bots/api), [Node.js SQLite](https://nodejs.org/api/sqlite.html).
