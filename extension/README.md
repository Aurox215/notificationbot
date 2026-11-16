# Aurox Job Monitor — private standalone extension

All monitoring, history and Telegram delivery run in Chrome. No Node.js server, localhost API, VPS, worker service, or external database is needed at runtime. The existing Node.js backend and SQLite files remain available for rollback; they are not included in the private release package.

## Private shared-bot setup

All trusted users use **@Aurox_notification_bot**, with different chat IDs stored independently in their Chrome profiles.

For a preconfigured personal package:

1. Load your administrator-provided folder through chrome://extensions, Developer mode, Load unpacked. Each user must receive the package prepared for their own chat ID.
2. Click **Connect Telegram**. The extension opens @Aurox_notification_bot; press **Start** there.
3. Wait for the connection message. Setup checks about every five seconds while the popup is open, or on the roughly 30-second background alarm when it is closed. Reopen the popup to see Connected. Start itself is not read: successful delivery to your preconfigured account confirms setup. If you already started the bot, connection can complete immediately.
4. Open the first listing page, signed in, at https://www.peopleperhour.com/freelance-jobs and https://www.guru.com/work/. Allow the loaded listings to settle before expecting new-project alerts. Existing projects are silent.

Manual setup: click Find my ID, open the separate ID helper in Telegram Desktop, press Start or send /start there, copy the number beside Id, paste it into the extension, and click Connect. Click Connect Telegram. The connection activates after Telegram accepts the connection message; there is no additional confirmation code. Delivery acceptance does not prove that the entered ID belongs to you, so copy your own number carefully. A build without a token also requires the administrator's token once.

You may work in other tabs or apps. Chrome and the computer must stay running. Sleep, discarded tabs, network failures, expired platform sessions, or verification challenges can interrupt monitoring. The extension recreates its alarm on startup and saves delivery claims before network calls.

**Updating an existing installation:** keep its existing installed folder and extension ID. Reload that folder after updating its contents. Do not uninstall it or load a different folder as a replacement if you want to keep its Chrome-local history and settings. The packaged release folder is ready for new installations.

## Baselines, history and settings

- The first settled, complete live first-page listing scan of **each platform is always silent**, including projects published after connection. All projects in that baseline remain permanently non-notifying.
- Empty results require an explicit loaded no-results state. Unknown/failed/partial scans and later pagination pages cannot establish a baseline. IDs observed before baseline completion or on later pages remain silent. After a live baseline, complete background HTML scans may detect new projects; staged partial results wait for confirmation. A publication watermark at baseline completion also suppresses older projects discovered later.
- Later unseen projects must pass the existing publication cutoff and filters. Missing/ambiguous publication dates remain silent. Existing page extraction, polling and session checks are retained; no new freelance-site endpoints or login automation are added.
- **Disconnect** disables delivery and removes local connection/token overrides while preserving history, baselines and preferences. An embedded build token cannot be removed by a popup button.
- Reconnecting creates a new cutoff and connection epoch. Old pending projects and old project IDs are not replayed. Delivery history is also scoped to the recipient chat.
- **Pause monitoring** stops project collection and delivery. **Resume monitoring** resumes it. API-based account checks continue while connected. Existing saved filters and preferences remain stored; their editor has been removed from the simplified popup.
- This shared-bot extension never calls `getUpdates`, sets/deletes webhooks, or processes Telegram commands. The popup provides connection and monitoring controls. The old backend may still process commands when separately operated, but the extension does not rely on it.
- Explicit Telegram rate limits are retried after `retry_after`, with bounded attempts. Uncertain network/5xx outcomes and interrupted sending claims become `unknown` and are not automatically resent. This prioritizes avoiding duplicates; an uncertain message may be missed.
- Existing version-1 local preferences/history migrate automatically. The old dedicated-bot polling connection is retired and must be reconnected to the shared bot.

Independent local queues cannot coordinate the shared bot's global Telegram rate limit. Each installation uses conservative pacing and honors rate-limit responses.

## Token handling and private distribution

The token is intentionally shared with this trusted group. Anyone receiving a configured build can recover it and control the bot. Extension-local access restrictions keep normal content scripts away from stored configuration; they do not protect the token from installers or someone controlling the browser profile. No obfuscation/encryption claim is made.

The real token must never be committed, printed in logs, or stored in a tracked source file. The build never imports `.env`. An administrator can copy `config.example.json` to the ignored `config.private.json` and privately set `botToken`. Leave it empty to require manual token entry. `getMe` enforces the shared bot identity.

Developer commands from the repository root:

```text
npm run extension:build
npm run extension:package
# Prepare two personal copies (replace the IDs with the actual users' private numeric IDs):
node scripts/package-extension.mjs --chat-id USER_A_CHAT_ID
node scripts/package-extension.mjs --chat-id USER_B_CHAT_ID
```

Packaging creates a new ignored `release/aurox-job-monitor-...` folder containing only manifest, popup, CSS, README and required compiled JavaScript. Private configuration source, legacy backend bundles, SQLite, `.env`, source maps and tests are excluded. The configured token remains recoverable from the compiled worker, by design.

## Optional import from the old backend

The administrator may export one user's preferences and known project IDs without starting or modifying the backend:

```text
node scripts/export-extension-settings.mjs --database data/bidbot.sqlite --user NUMERIC_USER_ID --output user.aurox-settings.json
```

The exporter opens SQLite read-only, never opens the backend Store, excludes credentials/chat IDs, and refuses to overwrite an existing output file. The exporter remains available for administrators, but the import panel has been removed from the simplified popup. Existing browser-local history is retained.

## Legacy backend

The backend source under `src/` and the old extension worker/popup are retained for verification and rollback. They are excluded from the standalone package. To build the optional legacy mode, set `AUROX_EXTENSION_MODE=backend` and optionally `AUROX_BACKEND_URL` before running `npm run extension:build`. Clear that variable to return to the default standalone build.

Validation uses synthetic credentials and mocked Telegram responses. A real user should verify the connection message and one new-project alert before private rollout.
## Two-profile acceptance check

1. Stop the Node backend normally. Build once, then run the two per-user packaging commands above. Record each output folder and give it only to its intended user. Personal chat IDs are supplied privately by the administrator; pressing Start cannot discover an ID without an incoming-update service. No getUpdates or webhook configuration is performed.
2. Create Chrome profiles A and B using Chrome's profile menu, Add profile. In each profile open chrome://extensions, enable Developer mode and Load unpacked: A's personal folder in A, B's folder in B. Pin the extension.
3. Connect and press Start using the corresponding Telegram account. Verify each connection message appears only in that account. In each profile open both supported first-page listing URLs and allow both loaded listings to settle. Existing projects must produce no project alerts.
4. Leave listings open while working elsewhere. When a genuinely newly published matching project appears after baseline completion, expect one alert per monitoring profile in its own Telegram chat. Refresh/revisit the same project and verify no repeat. Do not modify a real website to manufacture a project; synthetic cases are covered by automated tests.
5. Disconnect and reconnect A. Its stored count and baselines must remain; no old projects resend. B remains connected independently. Restart Chrome with the same profiles, folders and extension IDs; history must remain.
6. To test a delivery failure, temporarily block the bot in Telegram. A failed send should show a safe error/disconnected state. Unblock, reconnect, and verify old history stays silent. An ambiguous network interruption is recorded as unknown rather than automatically resent; a message may be missed to prevent duplicates.
7. Keep the backend stopped throughout. No localhost server or external database is required. Do not uninstall the extension or clear extension data when testing restart persistence.

Automated tests use synthetic credentials and mocked Telegram/browser APIs. Actual Chrome/Telegram delivery and real site layout behavior require this acceptance check; automated tests do not claim a live two-profile end-to-end run.

## Chat ID field validation check

For manual setup, use a package without a provisioned chat ID. After rebuilding, reload the same installed extension folder in chrome://extensions and refresh the jobs tabs.

1. Stop the Node backend. Open the popup and enter `abc` as the chat ID: the field must turn red. Connect must not submit it.
2. Enter your own numeric private Telegram ID: the borderless field turns green with an ID format message. This confirms numeric syntax, not account ownership or an active connection.
3. Press Start in @Aurox_notification_bot, then click Connect Telegram. If Telegram cannot find/access that chat, the field becomes red with an explanation. A blocked bot or missing Start can cause this even when the digits are correct. Do not use another person's real ID as a test.
4. With your correct accessible chat, click Connect Telegram. After Telegram accepts the connection message, the ID field stays visible, becomes green and read-only, and the connection state becomes Connected. No code entry is needed.
5. Close/reopen the popup: confirmed green should persist. Disconnect: the field becomes editable and retains its green format feedback, while connection status changes to disconnected and history is retained. A temporary network failure must not label an ID incorrect.
6. Open both supported listing tabs, establish their silent baselines, and test a normal logout/login on each. API-confirmed state changes should notify only the Telegram account connected in that Chrome profile. Unknown/challenged API responses do not assert login/logout. Repeat with another Chrome profile and its own Telegram ID to check isolation.

## Simple Telegram setup

Telegram account ID means the numeric identifier Telegram assigns to your account, not your phone number or @username. The popup includes Find my ID, which opens https://t.me/userinfobot, a third-party ID helper. Press Start there, copy the returned ID number, and paste it into Aurox. Then open the Aurox bot, press Start, and click Connect Telegram. Preconfigured personal packages already contain the ID.

The popup no longer displays project statistics, baseline diagnostics, preferences, backend import, or technical footer notes. Connection errors and red/green ID confirmation remain visible.

## No Telegram Start button?

Telegram may show the existing conversation when you have used a bot before. The Aurox link now includes `?start=extension` to request the bot start flow. If your app still shows no Start button, unblock the bot if needed, send `/start` in its chat, and return to the extension to connect. A reply to `/start` is not required in standalone mode: the extension sends the connection message after you enter your Telegram account ID and click Connect Telegram.

## Current manual connection flow

Click Find my ID first. Open the separate ID helper in Telegram Desktop, press Start or send /start, copy your Id number, paste it into the extension, and click Connect Telegram. Successful delivery activates the connection without a confirmation code. The popup does not ask everyone to visit Aurox bot first. If Telegram cannot access your chat, it shows an Allow Aurox to message me link: start or unblock Aurox there, then retry Connect. Telegram requires each recipient to initiate contact with the sending bot at least once; using a separate ID helper does not grant Aurox that permission.

## Connection checks (0.7.1)

The Telegram client calls browser fetch using the service worker global receiver. Read-only getMe/getChat transport failures retry up to three times. sendMessage is attempted once per durable claim; uncertain sends are not blindly retried. Missing Chrome access to api.telegram.org is reported before connecting. Numeric ID syntax shows green immediately; only the separate Connected status confirms successful delivery. The account ID field uses background colors with no border.

## Jobs-page reminders (0.7.2)

After an existing read-only API check confirms that you are signed in, Aurox checks whether that platform has a supported first-page jobs tab open. If it does not, Aurox sends a private Telegram reminder with the appropriate link:

- PeoplePerHour: https://www.peopleperhour.com/freelance-jobs
- Guru: https://www.guru.com/work/

A first-page listing in another background tab counts, so working on other pages does not cause needless reminders. Discarded tabs and later pagination pages do not count as a usable first-page listing. Unknown authentication or a failed API check does not establish login or generate a new reminder. Reminders honor the selected platforms, monitoring pause and saved alert pause.

Repeated checks and service worker restarts do not resend a reminder for the same missing-page episode. Opening the jobs tab clears that episode; leaving it later, or completing a new login, can produce a new reminder. Queued reminders are suppressed if the required page opens before delivery. Existing baseline/history and Telegram retry/uncertain-delivery rules remain in force.

Manual check: reload version 0.7.2 and refresh platform tabs, connect Telegram, sign in normally, and leave only the platform dashboard open. Once login is API-confirmed, expect one reminder with its jobs URL. Wait through several 30-second checks to verify no repeats. Open that URL in another tab and return to the dashboard: no reminder should appear. Close the listing tab and allow the next check: one new reminder is expected. Repeat separately on Guru, and with a second Chrome profile to confirm recipient isolation.

## Missed new-project alerts (0.7.3)

Publication extraction now recognizes standalone age labels in project-card footers, abbreviated ages such as `7 mins ago`, and Guru posting lines with quote counts. Description text and sidebar/navigation project links are excluded from these checks. Unrelated page widgets do not prevent a listing from becoming complete, and detached HTML scans do not interpret CSS-only loader classes as proof of active loading.

Each changed publication label is paired with its observation time, while the original first-detection time stays intact. A project first observed with a missing or unreadable age can qualify when a later scan supplies a usable age. An unchanged age label is not re-anchored to the current clock, preventing old static content from gradually becoming eligible. Existing baseline membership, recipient epochs, publication cutoffs, selected filters, delivery claims and duplicate suppression remain in force.

Background scans retry the live page until its first settled successful baseline is established, then use the existing listing HTML polling. This prevents an incomplete initial scan or service-worker restart from leaving a platform permanently unable to establish its baseline.

Update the contents of the existing installed folder, reload version 0.7.3 in chrome://extensions, and refresh both supported listing tabs. Do not uninstall or clear storage. Keep monitoring enabled and the first-page listings open. Verify a genuinely new matching project posted after the retained baseline produces one alert, including when its initial age was unavailable. Projects already recorded as baseline remain silent. Automated regressions cover both platforms; actual site layout and Telegram delivery still require a live check.

## Publication-reader and monitoring-blocker fix (0.7.4)

A read-only inspection of the installed profile found 23 stored PeoplePerHour projects, all missing publication metadata. Three were new, confirmed projects outside the silent baseline, but none could pass the required publication cutoff. Their IDs were detected; missing posting times prevented delivery. No browser storage, credentials or recipient data was changed during diagnosis.

The reader now checks plain age text nodes, split labels, and adjacent footers outside an inner card. It expands the metadata boundary only while all project links belong to the same project, so a neighboring or pinned project's age is not borrowed. Complete parsed-listing-to-worker-to-Telegram regression tests cover this path for both PeoplePerHour and Guru. These use synthetic site layouts and Telegram responses; they do not claim a live-browser delivery test.

The compact popup now displays actionable monitoring blockers when a listing scan fails, remains incomplete, or finds jobs without readable posting times. Refreshing a successful listing clears the blocker. No statistics panel is restored.

The locally installed Aurox extension uses the project's extension folder. In chrome://extensions, reload that existing installation and verify version 0.7.4, then refresh the open PeoplePerHour and Guru jobs pages so their content scripts update too. Keep the existing connection and storage; do not uninstall, clear history, or reconnect solely to load this fix. Observe the next checks and any blocker message in the popup. Newly observed projects whose publication time is confirmed after the retained cutoffs can notify; baseline and previously sent projects remain silent.

## Required notification fields (0.7.5)

Every new-project message includes Budget, Category, Skills, Description, Client rating, Client reviews, and Client joined. A missing or blank source value is explicitly shown as Not provided; zero reviews remains 0. Platform, title, publication time, source link, and UTC detection time remain included. The formatter reserves all field labels, the full accepted project URL, and detection time before shortening long descriptions or oversized skill lists to fit Telegram's 4096-character limit. This does not invent client information or add profile/detail-page requests when a listing does not expose it.

## Project detail enrichment (0.7.6)

New eligible projects now receive one read-only project-detail lookup before Telegram delivery, using an existing same-platform browser tab and its normal session. An already open matching detail tab is read directly. Otherwise the content script makes one bounded same-origin GET to the canonical project URL, without following redirects, reading client profiles, requesting alternate APIs, or interacting with login/challenges. Lookups are limited to one new project per platform per 30 seconds and claimed persistently before retrieval. Baseline, old, disabled-platform and already-delivered projects do not cause detail lookups. Keyword matching can use the enriched description and skills.

The public Guru Sports highlight reel page was inspected without credentials and a sanitized HTML fixture was retained for regression testing. Verified fields include jobHeading__budget, jobDetails__category, skillsList__skill, jobDetails__description, and employer-statistic Feedback. Similar Jobs, More Jobs, Q&A and proposal panels are excluded, including their prices and tags. The PeoplePerHour screenshot labels are covered by synthetic fixtures for fixed price, Description, client percentage feedback and its parenthesized review count. PeoplePerHour live detail markup still requires browser acceptance testing.

Only explicitly available joining-date labels are accepted. Last project is not a joining date; jobs paid, paid invoices and quotes are not client review counts. Related project searches are not silently treated as project skills. If a requested field is not exposed, Not provided remains the honest value.

Enrichment is cached across rescans/retries and worker restarts. A blocked, unavailable or unrecognized detail response does not suppress the project alert: listing data is used and the popup shows a detail warning. Existing sent alerts are not resent just to add details. Reload the existing extension installation as version 0.7.6 and refresh platform tabs; no disconnect, data reset or backend is needed. Test the next newly published matching project against its detail page, checking that client/related-job metadata is not mixed with the project's own fields.
