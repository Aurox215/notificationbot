# Freelance Job Alert Bot

Get freelance project alerts in Telegram, filtered by each user's keywords and preferred platform.

The bot supports PeoplePerHour and Guru project data, multiple Telegram users, and SQLite storage to prevent duplicate alerts.

## What works today?

| Mode | What it does |
| --- | --- |
| **Mock** | Sends sample projects so you can test the bot. This is the default. |
| **Chrome extension** | Reads visible project cards when you click **Scan Now** on a page you opened yourself. |

**Automatic website monitoring is not enabled.** The extension does not refresh pages, log in, or bypass verification. Its extraction rules pass synthetic HTML tests but still need confirmation against the actual website layouts.

## 1. Install and configure

Open PowerShell in this project folder. Use Node.js **26.13.1** with NVM for Windows:

```powershell
nvm install 26.13.1
nvm use 26.13.1
npm.cmd ci
```

Create your local settings file only if it does not already exist:

```powershell
if (!(Test-Path .env)) { Copy-Item .env.example .env }
```

Create a Telegram bot using **@BotFather**, then edit these values in `.env`:

```dotenv
TELEGRAM_BOT_TOKEN=your_bot_token
SOURCE_MODE=mock
```

Keep your token private. Leave the other settings at their defaults for your first test.

## 2. Start the bot

```powershell
npm.cmd run dev
```

Keep this terminal open. Stop the bot with **Ctrl+C**.

Open a private Telegram chat with your bot and send:

```text
/start
/subscribe
```

In mock mode, you should receive sample projects marked **[MOCK]**. Repeated monitoring cycles will not resend the same project to the same user.

To try filtering, send:

```text
/keywords Python, React
/platforms PeoplePerHour,Guru
/status
```

Each user has separate preferences. Groups and channels are not supported.

## 3. Use the Chrome extension

Follow the [extension setup and pairing guide](extension/README.md) for full instructions.

1. Run `npm.cmd run build`.
2. Open `chrome://extensions`, enable **Developer mode**, and choose **Load unpacked**.
3. Select this project's **extension** folder.
4. Generate a separate ingestion token as explained in the guide. No extension ID registration is needed.
5. Add these settings to your existing `.env`:

```dotenv
SOURCE_MODE=extension
INGESTION_ENABLED=true
INGESTION_PORT=4318
INGESTION_TOKEN=your_separate_random_ingestion_token
```

Replace the placeholders, restart the bot, and enter the same ingestion token and port in the extension popup. **Never enter your Telegram bot token in the extension.**

Open one of these pages normally in Chrome:

- [PeoplePerHour projects](https://www.peopleperhour.com/freelance-jobs)
- [Guru work](https://www.guru.com/work/)

Complete any login or verification yourself. When listings are visible, click **Scan Now**.

**The first accepted batch for each platform is saved without sending alerts.** Later scans can notify subscribers about previously unseen projects. Repeated scans and restarts preserve duplicate protection.

Refresh pages and scan manually. An older project that appears for the first time can also trigger an alert; the bot detects newly observed projects, not guaranteed newly published ones.

The backend must run on the same computer as Chrome for this local prototype. Extension mode does not generate mock projects.

## Telegram commands

| Command | Action |
| --- | --- |
| `/start` | Register your chat and show help |
| `/subscribe` | Enable alerts |
| `/pause` | Pause alerts |
| `/resume` | Resume an existing subscription |
| `/keywords` | Show your keywords |
| `/keywords Python, React` | Replace your keywords |
| `/keywords all` | Match all projects |
| `/platforms` | Show your selected platforms |
| `/platforms Guru` | Select one platform; use a comma to select both |
| `/platforms all` | Enable both platforms |
| `/status` | Show preferences, delivery counts, and source health |
| `/help` | Show command help |

A project matches if **any** keyword appears in its title, description, category, or skills. Matching ignores letter case. Previously stored, eligible projects may be sent after you subscribe or change preferences; the extension's initial baseline always stays silent.

## Testing and useful commands

Run these checks without contacting the freelance websites or Telegram:

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run demo
```

| Command | Purpose |
| --- | --- |
| `npm.cmd run dev` | Build and start the bot |
| `npm.cmd run build` | Build the backend and extension |
| `npm.cmd start` | Start the existing build |
| `npm.cmd run health` | Read monitoring health from SQLite |
| `npm.cmd run telegram:preview` | Print a sample Telegram message |
| `npm.cmd run telegram:test` | Send a sample to `TELEGRAM_CHAT_ID` |

The direct Telegram test requires your numeric chat ID in `.env` and a private chat started with the bot. It bypasses subscriptions and duplicate history.

Health checks report local monitoring state, not successful Telegram delivery. In extension mode, source health can become stale simply because you have not scanned recently.

## Important settings

See [.env.example](.env.example) for all available settings.

| Setting | Purpose |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | Backend-only Telegram credential |
| `SOURCE_MODE` | `mock` or `extension` |
| `DATABASE_PATH` | Persistent SQLite file; default: `data/bidbot.sqlite` |
| `DEFAULT_KEYWORDS` | Starting keywords for newly registered users |
| `MONITOR_INTERVAL_MS` | Shared backend cycle; default: `5000` ms |
| `HEALTH_STALE_MS` | How old a successful check can be before it is stale |
| `INGESTION_ENABLED` | Enable the local extension endpoint; default: `false` |

In extension mode, the shared cycle dispatches stored projects. **It does not refresh or scan your browser.** Changing default keywords does not overwrite existing users' preferences.

## Troubleshooting

| Problem | What to check |
| --- | --- |
| No Telegram alert | Send `/subscribe`, check `/status`, and review keywords/platforms. The first extension batch is intentionally silent. |
| No projects detected | Confirm listings are visible. Refresh manually after loading the extension. The page may need updated extraction rules. |
| Login or verification status | Complete normal website access yourself, then scan the listing page again. |
| Extension cannot connect | Check the backend is running and the port and ingestion token match. No extension ID is required. |
| Telegram polling error | Use one bot process. A configured webhook or another polling client can prevent polling. |
| Database lock error | Stop other instances. After a crash, confirm no instance is running before removing only the stale `.lock` file. |

## Data and deployment

SQLite keeps users, preferences, projects, baselines, and notification history across restarts. Do not delete the database to restart the bot or reset a test.

Keep `.env`, tokens, and database files out of Git. Run one process per bot token and database. Uncertain Telegram deliveries are not retried automatically, which avoids possible duplicates but can miss an alert.

For a VPS, install the documented Node version, run `npm ci` and `npm run build`, then supervise `node dist/src/main.js` with systemd or your hosting provider. Use persistent local storage and stop the service before copying the database for a simple backup. The current extension endpoint is localhost-only; it cannot receive scans from Chrome on a different computer.

## More information

- [Chrome extension: setup, pairing, security, and testing](extension/README.md)
- [Live source research and authorization requirements](docs/phase-3-live-sources.md)
