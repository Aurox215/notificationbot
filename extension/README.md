# Manual Chrome scanner prototype

This Manifest V3 extension adds a manual browser input to the existing Node/Telegram backend. It reads rendered cards only after you click **Scan Now**. It does not refresh tabs, poll websites, read browser cookies, sign in, handle verification, open project detail pages or call private platform endpoints. The Telegram bot token remains exclusively on the backend.

The selectors are provisional and tested against saved **synthetic HTML fixtures**, not verified current logged-in layouts. Successful HTTP/fixture tests do not prove extraction works on your actual account pages. An unsupported layout reports no projects and creates no baseline. Adapt selectors using a sanitized, legitimately obtained visible-page sample if necessary. Opening a page manually is not itself a platform permission grant for collecting/redistributing its data.

## Build and load

From the repository root:

```powershell
npm.cmd ci
npm.cmd run build
npm.cmd run typecheck
npm.cmd test
```

Open chrome://extensions, turn on **Developer mode**, choose **Load unpacked**, and select the repository's **extension** directory (not extension/src or extension/dist). The manifest uses the bundled files in extension/dist; build before loading. After code changes, rebuild, click **Reload** in chrome://extensions, and manually refresh the website tab to attach the updated content script. Do not change or re-create your existing .env.

No extension ID needs to be copied, registered, or added to the backend. Different installations can connect using the ingestion token and port. Existing INGESTION_EXTENSION_ID settings are ignored and can be removed from .env.

## Pair with the backend

Generate a separate random ingestion token locally:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Keep that output private. Add these settings to your existing backend .env, without changing TELEGRAM_BOT_TOKEN or the database path:

```dotenv
SOURCE_MODE=extension
INGESTION_ENABLED=true
INGESTION_PORT=4318
INGESTION_TOKEN=the_separate_random_token
```

Replace the ingestion token placeholder; it is not a usable default. Start/restart the backend with npm.cmd run dev. The existing scheduler remains active to dispatch stored projects, but **extension mode constructs no platform-fetching adapters and no mock fixtures**. It also excludes old mock/monitor-origin projects from notification dispatch. The mock mode, offline demo, Phase 1 Telegram test and direct-live refusal remain available. Do not run a second runtime against the same database or Telegram token.

Open the extension popup, expand Local backend pairing, enter the same ingestion token and port, then click **Save pairing & test**. Never enter the Telegram token. The connection should say Connected. Installing or moving the extension does not require backend changes. Port changes require updating both sides.

Each installation still needs a pairing token: extension IDs are not authentication. The current prototype connects to a backend on the same computer. Removing ID registration does not enable remote users to reach a single hosted backend; that would require a separately designed HTTPS service and per-user pairing credentials. Do not expose this development listener publicly or distribute a backend-wide token to unrelated remote users.

Pairing is stored in chrome.storage.local (not sync), restricted to trusted extension contexts. It is not exposed to content scripts. A fresh popup password field stays blank after saving. To revoke access, rotate INGESTION_TOKEN on the backend and pair again; disabling INGESTION_ENABLED closes the listener on restart. Deleting the extension clears its local pairing data. This is a development secret stored on the local machine, not hardware-backed encryption.

## Manual scan workflow

1. In your normal Chrome session, open https://www.peopleperhour.com/freelance-jobs or https://www.guru.com/work/. Complete any permitted login/verification yourself using the website normally.
2. Wait for the listings to finish loading, open the popup, and click **Scan Now**. The extension never submits forms or interacts with verification.
3. The popup shows website, detected count, last backend-accepted extraction, page/extraction status, and connection state. Login, verification, unsupported layouts and empty results send no batch and create no baseline. Failed ingestion preserves the prior success time; retry manually after fixing the connection.
4. The **first nonempty accepted scan per platform** initializes a persistent baseline. Its projects are stored with notifications permanently disabled, including for users who subscribe later. PeoplePerHour and Guru have independent baselines. No empty or rejected scan initializes either baseline.
5. Subscribe in Telegram with /start and /subscribe; configure /keywords and /platforms as usual.
6. Manually refresh the website later and click Scan Now again. Previously unseen project IDs become eligible for the existing per-user keyword/platform/pause checks. Notification dispatch occurs on the shared backend interval. Repeated scans and restarts do not reset the baseline or resend acknowledged projects.

Only currently rendered, unhidden cards are scanned, including rendered cards below the viewport; virtualized/unloaded/infinite-scroll content is not fetched. No pagination or scrolling is automated. The initial baseline covers **only that first visible batch**. An older project revealed by later manual filtering/pagination may be new to the bot and become eligible; this prototype detects newly observed IDs, not guaranteed newly published projects. Keep the initial search/filter scope consistent. Later subscribers may receive matching non-baseline backlog, preserving the bot's existing behavior.

Projects require a recognized direct project link: PeoplePerHour freelance-job paths ending in a numeric ID or Guru /jobs/slug/numeric-ID links. Query strings/fragments are stripped and IDs are checked again on the backend. Titles are required. Budget, description, category, skills and displayed publication time are optional and omitted when absent. Relative times such as Posted today are preserved as source text, never converted into invented timestamps. Detection time is assigned by the backend. Client profile statistics are not extracted in this prototype.

## Security and data flow

Popup → content script (read visible DOM) → extension service worker → authenticated localhost ingestion → SQLite → shared filter/deduplication/Telegram scheduler.

- Manifest content scripts run only on the two named HTTPS website hosts. They can recognize login redirects on those hosts. Data extraction itself accepts only the two target listing paths.
- Page scripts cannot trigger scans through window messages. Only the extension popup can invoke the service worker's scan/pairing handlers. There are no externally connectable endpoints or web-accessible secret resources.
- Only the extension worker contacts http://127.0.0.1:PORT. Its destination is fixed to IPv4 loopback; the popup cannot configure a remote host. Redirects are rejected, credentials/cookies are omitted, and requests time out.
- The Node ingestion server binds exclusively to 127.0.0.1, checks the Host header and remote address, and authenticates requests with a timing-safe comparison of a separate bearer token. When Origin is supplied it must be a valid chrome-extension origin, with a 32-character Chrome extension ID. Different installation IDs are accepted without registration; ordinary website origins and null are rejected. CORS replies echo only the validated extension origin, never a wildcard. Privileged extension/native requests may omit Origin but still require the token. Preflights require a valid extension origin; actual requests always require the token. CORS alone is not authentication, and another extension without the token cannot ingest data.
- The token authenticates whoever possesses it; a native local client can forge an Origin. Protect the token and your Chrome profile. This endpoint is not intended for LAN access, port forwarding, remote deployment or adversarial local users. The prototype provides no signed proof that submitted DOM data is authentic.
- Bodies are limited to 256 KiB, batches to 100 projects, and field lengths/types/identities/URLs are checked. Invalid batches fail before any baseline/project writes. Submitted notification flags, recipient IDs, client metadata and detection times are ignored. Public health responses require authentication too.
- Baselines and projects are committed in one SQLite transaction. Additive schema changes preserve existing project/user/history records; no reset is required. Existing project snapshots remain unchanged. Baseline projects are suppressed in shared dispatch, not just marked sent for current users.
- Logs contain event/platform/count information, not tokens or page bodies. No login credentials or browser cookies are transmitted. All submitted projects are shared input to this backend's subscribed Telegram users; this is not isolated per-browser/per-user ingestion.

The endpoint is disabled by default. Keep .env ignored and do not put pairing data into manifest/source files. Browser-access permissions and allowed data use remain your responsibility; this prototype grants no authorization to scrape or redistribute platform content.

## Tests and known limitations

tests/fixtures/extension contains saved synthetic listings, login and verification HTML. Extraction tests cover visible cards, hidden content, duplicate links, canonical URLs, missing fields and access barriers. Ingestion tests cover local authentication/origin/Host checks, body/schema validation, silent baselines, restarts, filtering and duplicate prevention. No tests depend on live freelance sites or your Telegram credentials. No production database is used during tests.

The extension has no automatic retries/refresh/polling. If a response is lost after a batch was accepted, scanning again is safe because SQLite identities are unique. Source health in extension mode reports the age of the last accepted manual scan; it may become stale when you stop scanning. This does not fetch the website or disable manual ingestion. Increase HEALTH_STALE_MS if appropriate for your manual workflow.

If the page says login_required or verification_required, complete normal website access yourself and try only when real listings are visible. If no_projects persists, do not assume the page is empty: its selectors may differ from the provisional fixtures. If connection fails, check the running backend, port, token and browser local-network permission prompts. No extension ID setting is needed. Do not disable browser security to fix it.

Official references: [Manifest V3 content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts), [extension messaging](https://developer.chrome.com/docs/extensions/develop/concepts/messaging), [cross-origin requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests).
