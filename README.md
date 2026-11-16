> **The default extension now runs without a backend.** Distribute a personal release created with `node scripts/package-extension.mjs --chat-id USER_CHAT_ID` after building. Users click Connect and press Start; no chat-ID entry is needed in personal builds. Private installations share @Aurox_notification_bot and keep independent local chat IDs. No extension polls Telegram updates. See [standalone installation and usage](extension/README.md). The server instructions below apply only to the optional backend build.

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
3. Compare the codes and tap **Connect this browser** in Telegram. No confirmation message needs to be typed.
4. Pairing finishes automatically and scanning starts, even if the popup is closed.
5. Open PeoplePerHour or Guru in your Chrome browser. Complete any normal login or verification yourself.

Users do not run Node.js, edit .env files, enter extension IDs or ingestion tokens, or share freelance-site passwords.

The extension observes loaded project cards and polls listing HTML in the background. Use **Stop scan / Continue scan**; there is no Scan Now button. The first accepted batch for each user and platform is saved silently. Later unseen projects can produce matching alerts only for that user.

New users receive all projects by default unless the operator configures
`DEFAULT_KEYWORDS`. Existing users can send `/keywords all` and `/platforms all`
to receive all later detected projects from both platforms. Project alerts include
the direct project URL. Already delivered projects are not sent again.

## What observation does

- Reads supported visible cards already loaded by the website.
- Notices DOM changes in loaded foreground and background tabs.
- Sends metadata using that installation's authenticated session.
- Leaves login, CAPTCHA and verification screens untouched.

Version **0.4.0** requests listing HTML about every 30 seconds without reloading tabs. It queues owner-only Telegram login notices and pauses website requests on access restrictions. A JavaScript shell or unsupported HTTP response is reported explicitly. Live logged-in polling has not been verified here, and platform permission remains independently unverified. See [background polling and limits](docs/background-polling.md).

Extraction rules are tested against saved synthetic HTML fixtures. Actual account-page layouts may require selector adjustments. A newly observed project can be older than its detection time.

Platform account states are shown separately from Telegram connection. Confirmed
logout pauses that platform; public listings never prove login. See
[account authentication checks and limitations](docs/authentication-state.md).

## Telegram commands

| Command | Action |
| --- | --- |
| `/start` | Register your private chat and show help |
| `/confirm CODE` | Legacy pairing command; the normal flow uses a Telegram button |
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

Alerts include only projects with a verifiable publication time after Telegram connection approval. Reconnecting resets this cutoff and suppresses older queued projects. Missing or ambiguous publication dates stay silent. Existing accounts establish a fresh cutoff on their first startup after this upgrade. Pause/resume preserves the cutoff. Reload the extension after upgrading to extract machine-readable publication dates.

SQLite persists private browser projects, baselines, preferences, sessions and delivery histories. The same platform project can have independent private snapshots for different users. The authenticated session determines the owner; submitted chat/user IDs cannot redirect an alert.

Old browser data from the administrator-broadcast prototype is retained but excluded from delivery. It is not assigned to users automatically. Existing installations must reconnect through Telegram.

The backend stores hashes of session credentials; the extension keeps its own raw session in trusted local storage. Sessions expire after 30 days and can be revoked. Do not commit .env, tokens or database files. Use persistent disk and one Node worker initially.

A PostgreSQL migration should preserve the repository contracts, owner-qualified keys and transactional claims. Exactly-once Telegram delivery is not guaranteed: uncertain outcomes remain recorded without automatic retries.

## More information

- [Extension user guide](extension/README.md)
- [Pairing protocol, security, migration and operator cloud setup](docs/account-linking.md)
- [Platform integration and authorization research](docs/phase-3-live-sources.md)

### Platform session verification

The extension checks PeoplePerHour GET /v2/members/me and Guru?s account-only saved-search API with read-only, uncached same-origin GETs every 30 seconds while a supported tab is loaded. Navigation and completed native login/logout API requests trigger an immediate verification. Guru requests use its existing browser access token in the Authorization header, as its site does. Tokens are not sent to the bot backend or written to extension storage. PeoplePerHour uses its public web-application identifiers by default, with observed resource configuration taking precedence. No account credentials are hardcoded. Its application/vnd.api+json response is authenticated when member.id is present, and logged out when the observed shared-only guest envelope is returned?even with HTTP 200. Missing configuration, invalid application keys, redirects, challenges, HTTP 403/429, malformed responses and network errors remain unknown. For Guru, a successful account request is accepted as authenticated only if a second request without cookies or Authorization is explicitly rejected with an authentication error. Anonymous successes remain unknown. UI and successful project extraction never establish login.

Confirmed API rejection pauses that platform, including queued project dispatch. API-confirmed recovery clears the platform block and queues one Telegram recovery notice; manual Stop scan and /pause remain respected. Session checks continue while collection is stopped. Each confirmed login-to-logout transition bypasses the legacy warning cooldown; repeated unchanged states remain deduplicated. Keep one supported tab open for checks. Live account validation is still required to establish that these account-only endpoints distinguish each site's actual session states; automated tests exercise the observed contracts without using real credentials.

The backend logs a `backend.heartbeat` every 30 seconds, including scheduler health, active subscriber and pending-project counts, last browser contact, and aggregate platform statuses. A healthy heartbeat confirms the backend scheduler, not successful browser scanning. `platform.status_changed`, `platform.notice_sent`, and `platform.notice_failed` expose account-state reporting and Telegram notice delivery.

Database ownership uses an OS lock plus a PID/token marker. On Windows and Linux, a crashed process releases the OS lock automatically and the next startup replaces its stale marker after verifying its PID is gone. A second running instance is refused. Legacy empty locks require a one-time cleanup after confirming no old bot is running.
