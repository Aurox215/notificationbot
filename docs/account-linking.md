# Connecting Chrome to Telegram

Aurox Job Monitor sends projects from **each user's own Chrome browser** only to **that user's Telegram account**.

One shared backend and one Telegram bot serve all users. Users do not need Node.js, .env files, extension IDs, ingestion tokens, or to share their freelance-site passwords.

**Current status:** the software is implemented and tested, but the cloud service has not been deployed. The default extension build is for local developer testing.

## How users connect

1. Install the configured extension and click **Connect Telegram**.
2. Open the Telegram tab created by the extension.
3. Compare the code in Telegram with the code in the extension.
4. If you started the connection and the codes match, send `/confirm CODE`.
5. Return to the extension to finish connecting.

Confirmation enables alerts. Connection requests expire after **5 minutes**. Each installation gets a separate session that expires after **30 days**.

Only approve a connection you started. Opening a Telegram link alone does not authorize a browser.

## How alerts work

```text
Your Chrome page → Your authenticated session → Your projects and filters → Your Telegram
```

- The backend identifies the user from the session, not a user ID submitted with a scan.
- Projects, preferences, baselines, and notification history are kept separate for each user.
- The first accepted nonempty batch for each user and platform stays silent.
- Later unseen projects can trigger alerts that match that user's preferences.
- Multiple installations connected to the same Telegram account share its duplicate history.

Old projects from the shared administrator prototype are retained but never broadcast or automatically assigned to users. Existing installations must reconnect through Telegram.

## What the extension monitors

The extension watches changes to visible project cards on supported pages. **Scan Now** remains available.

It does **not** refresh pages or retrieve new listings. If the website does not update its cards, the user must refresh normally. No automatic 30-second refresh is enabled because permission and a permitted frequency remain unverified.

Login, CAPTCHA, and verification pages stop project submission. The extension does not bypass them or send website passwords/cookies to the backend.

Extraction rules pass saved HTML fixture tests but still need confirmation against actual account-page layouts. Older projects revealed by filtering, pagination, or delayed loading can be new to the bot.

## Disconnecting

| Action | Result |
| --- | --- |
| **Disconnect** in the extension | Revokes this installation's session and clears its local credentials |
| `/disconnect` in Telegram | Revokes all browser sessions and pending connections for that user |
| `/pause` in Telegram | Pauses alerts while preserving the connection and preferences |

If the backend was unreachable during disconnection, use Telegram `/disconnect` to revoke any remaining server session.

## Local testing — developer only

End users do not perform these steps.

Keep your existing `TELEGRAM_BOT_TOKEN` and `DATABASE_PATH` in the backend's .env. Add:

```dotenv
SOURCE_MODE=extension
INGESTION_ENABLED=true
INGESTION_PORT=4318
TELEGRAM_BOT_USERNAME=YourBotUsername
PUBLIC_BASE_URL=http://127.0.0.1:4318
```

Use the username of the bot that owns your token, without `@`. Old `INGESTION_TOKEN` and `INGESTION_EXTENSION_ID` settings are ignored.

Start the backend:

```powershell
npm.cmd run dev
```

Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the project's **extension** folder. Reopen or manually refresh an existing website tab, then test **Connect Telegram**.

Use `SOURCE_MODE=mock` for sample projects and offline development.

## Cloud setup — operator only, not deployed

Before distribution, the operator needs an approved HTTPS hosting address.

1. Set the server's `PUBLIC_BASE_URL` to that address.
2. Build the extension for the same address:

```powershell
$env:AUROX_BACKEND_URL = 'https://your-actual-host'
npm.cmd run build
Remove-Item Env:AUROX_BACKEND_URL
```

3. Run the backend on persistent storage behind an HTTPS reverse proxy on the same server. Keep the Node listener restricted to `127.0.0.1`.
4. Test with two separate Chrome/Telegram accounts before distributing the extension.

The build includes only the public backend address, not bot tokens or .env secrets. Users install the already-configured extension.

**Building without `AUROX_BACKEND_URL` produces a local development build.** Do not distribute that build as the hosted release. No cloud deployment, paid service, or Chrome Web Store publication has been performed.

## Security and storage notes

- Pairing requires both private Telegram confirmation and a secret held by the requesting extension. Requests can be claimed only once.
- SQLite stores hashes of session credentials. Raw sessions stay in trusted extension storage, inaccessible to content scripts.
- Every ingestion request requires a valid session. Extension IDs are not authentication.
- Private browser projects use a unique key of `user + platform + project ID`. Notification records also enforce project ownership.
- Existing database records are preserved through additive tables. Use persistent local disk, one Node worker, and SQLite-aware backups.
- A future PostgreSQL migration must preserve the same ownership keys and transactional pairing/delivery claims.

Before public launch, configure TLS, proxy limits, backups, and abuse protection. Current limits are 20 pairing starts/minute and 180 approval checks/minute per socket IP, plus 120 authenticated requests/minute per user. Users behind the same proxy share its unauthenticated limit. Never log credentials or request bodies.

## Verification

```powershell
npm.cmd run build
npm.cmd run typecheck
npm.cmd test
```

Tests cover pairing, expiration, replay prevention, session authentication, revocation, user isolation, duplicate prevention, notification routing, and DOM observation. They use fixtures and temporary databases, not live accounts.

The hosted browser-to-Telegram flow still needs a two-account acceptance test after deployment is approved.

See the [extension user guide](../extension/README.md) and [project README](../README.md) for everyday use.
