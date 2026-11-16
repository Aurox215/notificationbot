# Aurox Job Monitor

Standalone Chrome extension for PeoplePerHour and Guru project alerts. Chrome performs monitoring, session checks, local history, and direct Telegram delivery. There is no application server, Node runtime service, SQLite integration, or localhost API.

## Install

Use a prepared folder inside `release/`: Chrome -> `chrome://extensions` -> Developer mode -> Load unpacked -> select the folder containing `manifest.json`.

In the popup, click Find my ID, open the separate Telegram ID helper, copy your numeric account ID, paste it, and click Connect Telegram. If Telegram denies bot access, use the displayed link to start/unblock Aurox once and retry. Keep Chrome running and the supported jobs pages open:

- https://www.peopleperhour.com/freelance-jobs
- https://www.guru.com/work/

When updating, replace files in the same installed folder and reload the same extension ID. Refresh the platform tabs too. Do not uninstall or clear storage if you want to retain connection, settings, baseline, and history.

## Behavior

- Listing checks run about every 30 seconds, with DOM changes detected sooner. Network delays, website timing, sleep and discarded tabs can delay detection.
- Each platform's first confirmed complete live listing scan is a silent baseline. Old, already-sent, ambiguous-date and baseline projects are not replayed.
- New-project detail reads are paced about 1.1 seconds apart, not queued for another 30 seconds each. Only new eligible projects are read; there are no profile crawls or challenge bypasses.
- Alerts include title, budget, category, skills, publication time, client rating/reviews/joining date when exposed, project link, and detection time. Descriptions are not included. Missing fields say Not provided.
- Confirmed login/logout and missing-jobs-page notices go privately to the connected account. A jobs listing open in another tab counts.
- Guru allows a short refresh grace, then confirms repeated API rejection. Navigation checks also verify the cookie-based protected dashboard session so a surviving bearer token cannot hide logout. Consent/challenges do not prove logout.
- Storage and durable send claims are per Chrome profile. Uncertain Telegram sends are not automatically repeated.

## Build and test (developers only)

Node is required only for development and packaging, not for extension users.

```text
npm ci
npm run typecheck
npm test
npm run extension:package
```

See [extension instructions](extension/README.md) and [architecture](docs/architecture.md).

Source is in `extension/src` and `extension/shared`; tests are in `tests`. `src/`, legacy workers/popups, backend commands, database integration and the database exporter were removed. Existing local data files and credentials were preserved; they are not runtime dependencies or part of packages.

Private bot configuration belongs in ignored `extension/config.private.json` (see `config.example.json`). It is never imported from `.env`. Anyone receiving a configured extension can recover its shared token; distribute only within the trusted group and never commit configured bundles or tokens.

## Updating an installed release in place

Creating a new release folder does not update an extension installed from an older folder. Reloading that old Chrome entry continues to use the old files. To preserve its extension ID, local history and connection, build and replace its runtime files in place:

```text
npm run extension:build
node scripts/package-extension.mjs --update-existing release/EXISTING_INSTALLED_FOLDER
```

Then reload that same entry in chrome://extensions and refresh the platform tabs. Verify its displayed version. The updater only accepts an existing standalone Aurox folder inside this project's release directory and refuses changed bot/recipient configuration before overwriting anything. It does not access Chrome-local storage. Use the same private build configuration as the installed package.
