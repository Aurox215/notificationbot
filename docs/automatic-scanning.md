# Automatic scanning: v0.3.0

**Superseded by v0.4.0:** Scan Now and the reload loop have been removed. See [background polling and login notices](background-polling.md). The remainder records the earlier v0.3.0 behavior.

After pairing, Aurox scans your already-loaded PeoplePerHour and Guru listing tabs automatically. You do not need to keep clicking Scan Now or keep the popup open.

## Connect once

1. Click **Connect Telegram** in the extension.
2. Open the Telegram tab. Telegram may require **Start** before the bot can interact with you.
3. Compare the code with your extension and tap **Connect this browser**. No confirmation message needs to be typed.
4. The extension finishes pairing and starts scanning automatically. It checks for approval even when the popup is closed; allow up to one alarm cycle (about 30 seconds).

User consent is still required to link Telegram safely. Fully silent account linking is not implemented. The old /confirm command remains supported but is no longer the normal workflow.

## Stop or continue

The main button shows **Stop scan** while collection is enabled and **Continue scan** when stopped. This setting applies to all supported tabs in this extension installation and survives restarts. Continue immediately scans loaded listing tabs. Stop prevents subsequent scans, ingestion attempts and automatic reloads. An in-flight request or a notification already queued on the backend can still finish; use Telegram /pause to pause notification delivery.

Scan Now remains available for diagnostics while scanning is enabled.

## Background tabs and refresh

The extension scans rendered DOM changes without requiring the platform tab to be active. A Chrome service-worker alarm also checks loaded listing tabs about every 30 seconds, independently of tab timer throttling.

At your explicit request, this version reloads the two supported listing URLs on the same approximate cycle while scanning is enabled. The following conditions must all hold:

- The tab is still an open, loaded, supported listing page.
- A nonempty extraction was successfully accepted by your backend.
- At least 30 seconds have elapsed since that tab's refresh clock was initialized or last reload.
- Scanning is still enabled immediately before reloading.

Login, CAPTCHA, verification, unknown layouts, unavailable scripts, failed authentication/ingestion and discarded/loading tabs are not automatically reloaded. Resolve normal website access yourself; there is no bypass, proxy rotation or private API retrieval. A reload uses Chrome's normal cache behavior and never activates or switches tabs.

Platform permission for this reload frequency has **not been independently verified**. Your instruction to enable reloads is not presented as official platform documentation. The prior integration research remains in docs/phase-3-live-sources.md.

Thirty seconds is a target, not a real-time guarantee. Chrome may delay alarms, freeze/discard tabs, or stop work while the device sleeps. The extension cannot monitor when Chrome is closed or the computer is asleep, and it does not wake or recreate discarded tabs. Keep the relevant listing tabs open and loaded.

The first accepted batch per user/platform remains silent. Later unseen matching projects go only to that owner. Reloads and repeated scans do not reset the baseline or bypass duplicate detection.

## Update and verify

1. Restart the backend using the updated build so Telegram callback buttons are supported. Keep your existing .env and database.
2. Reload the existing extension in chrome://extensions and confirm version **0.3.0**. Existing paired sessions are retained.
3. Manually refresh existing listing tabs once to attach the new content script. Wait for normal visible cards.
4. The popup should show **Stop scan**. Leave it closed, switch to another tab, and wait for automatic scans/eligible reloads.
5. Test Stop scan: scans and reloads should stop. Continue scan should resume collection without a Scan Now click.

Tests simulate Chrome alarms, inactive tabs, stop/continue, safe reload conditions, pairing completion without an open popup, and Telegram callback ownership/replay protection. Live platform behavior and strict 30-second timing cannot be guaranteed by those tests.

References: [Chrome alarms](https://developer.chrome.com/docs/extensions/reference/api/alarms), [Telegram bot buttons and deep links](https://core.telegram.org/bots/features).
