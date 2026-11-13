# Aurox Job Monitor

Receive Telegram alerts for freelance projects detected in **your own Chrome browser**.

Each extension installation connects securely to its user's Telegram account. Your browser's projects are sent only to you, using your own keywords and platform preferences.

## Current status

The backend, one-time Telegram linking, per-user storage, notification routing, and browser observation are implemented. **A cloud backend has not been deployed.** The current default extension build is for local operator testing.

The operator must deploy an approved HTTPS service and distribute an extension built for that service before ordinary users can use it without local setup. No paid service or deployment has been introduced.

## User experience

With a configured release extension:

1. Install **Aurox Job Monitor** and click **Connect Telegram**.
2. Open the Telegram tab created by the extension.
3. Compare the code in Telegram with the code in your extension. If you initiated the connection and the codes match, send `/confirm CODE`.
4. Return to the extension to finish connecting.
5. Open PeoplePerHour or Guru in your Chrome browser. Complete any normal login or verification yourself.

Users do not run Node.js, edit .env files, enter extension IDs or ingestion tokens, or share freelance-site passwords.

The extension observes changes to visible project cards. **Scan Now** is also available. The first accepted batch for each user and platform is saved silently. Later unseen projects can produce matching alerts only for that user.

## What observation does

- Reads supported visible cards already loaded by the website.
- Notices DOM changes while the tab is visible.
- Sends metadata using that installation's authenticated session.
- Leaves login, CAPTCHA and verification screens untouched.

**Observation does not refresh the page or retrieve new listings.** If the website does not update its cards, manually refresh it normally. No 30-second refresh/retrieval is enabled: platform permission and a permitted frequency remain unverified.

Extraction rules are tested against saved synthetic HTML fixtures. Actual account-page layouts may require selector adjustments. A newly observed project can be older than its detection time.

## Telegram commands

| Command | Action |
| --- | --- |
| `/start` | Register your private chat and show help |
| `/confirm CODE` | Approve the browser connection whose code matches yours |
| `/disconnect` | Revoke all your browser sessions |
| `/subscribe` | Enable alerts |
| `/pause` | Pause alerts |
| `/resume` | Resume an existing subscription |
| `/keywords Python, React` | Set keywords; any matching keyword is sufficient |
| `/keywords all` | Match all projects |
| `/platforms PeoplePerHour,Guru` | Select platforms |
| `/platforms all` | Enable both platforms |
| `/status` | Show your preferences and delivery counts |
| `/help` | Show command help |

Use `/keywords` or `/platforms` without arguments to view preferences. Linking explicitly enables/resumes your subscription. Private chats are supported; group/channel messages cannot approve a link.

## Operator development setup

These steps are for the developer/operator, **not end users**.

Use Node.js 26.13.1 with NVM for Windows:

```powershell
nvm install 26.13.1
nvm use 26.13.1
npm.cmd ci
if (!(Test-Path .env)) { Copy-Item .env.example .env }
```

Configure your existing Telegram bot token in .env. For local account-linking development, add:

```dotenv
TELEGRAM_BOT_USERNAME=YourBotUsername
SOURCE_MODE=extension
INGESTION_ENABLED=true
INGESTION_PORT=4318
PUBLIC_BASE_URL=http://127.0.0.1:4318
```

Set the username to the bot belonging to TELEGRAM_BOT_TOKEN, without @. Keep the existing database path. Old INGESTION_TOKEN and INGESTION_EXTENSION_ID settings are ignored.

```powershell
npm.cmd run dev
```

Load the built **extension** folder through chrome://extensions → Developer mode → Load unpacked. Reopen or manually refresh an existing website tab after reloading the extension. Test Connect Telegram using your normal Telegram account.

For hosted release configuration, see [account linking and cloud preparation](docs/account-linking.md). The backend stays on loopback behind a same-host HTTPS reverse proxy. Publishing and deployment require separate approval.

## Tests and commands

```powershell
npm.cmd run build
npm.cmd run typecheck
npm.cmd test
```

Tests use temporary SQLite databases, mocked Telegram updates, saved HTML fixtures and local HTTP requests. They do not use your live freelance accounts or production database.

| Command | Purpose |
| --- | --- |
| `npm.cmd run dev` | Build and start the backend |
| `npm.cmd start` | Start the existing build |
| `npm.cmd run demo` | Run the preserved offline multi-user mock demo |
| `npm.cmd run health` | Check local backend scheduler health |
| `npm.cmd run telegram:preview` | Print a sample notification |
| `npm.cmd run telegram:test` | Send a sample to TELEGRAM_CHAT_ID |

The manual Telegram test bypasses subscription history. SOURCE_MODE=mock preserves sample adapters; use extension mode for the real per-user service. Health in extension mode describes backend dispatch, not browser freshness or Telegram delivery.

## Data and security

SQLite persists private browser projects, baselines, preferences, sessions and delivery histories. The same platform project can have independent private snapshots for different users. The authenticated session determines the owner; submitted chat/user IDs cannot redirect an alert.

Old browser data from the administrator-broadcast prototype is retained but excluded from delivery. It is not assigned to users automatically. Existing installations must reconnect through Telegram.

The backend stores hashes of session credentials; the extension keeps its own raw session in trusted local storage. Sessions expire after 30 days and can be revoked. Do not commit .env, tokens or database files. Use persistent disk and one Node worker initially.

A PostgreSQL migration should preserve the repository contracts, owner-qualified keys and transactional claims. Exactly-once Telegram delivery is not guaranteed: uncertain outcomes remain recorded without automatic retries.

## More information

- [Extension user guide](extension/README.md)
- [Pairing protocol, security, migration and operator cloud setup](docs/account-linking.md)
- [Platform integration and authorization research](docs/phase-3-live-sources.md)
