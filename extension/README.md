# Aurox Job Monitor Chrome extension

Projects detected in **your browser** are delivered only to **your Telegram account**.

The shared service and Telegram bot are managed by the operator. End users do not need Node.js, .env files, extension IDs, ingestion tokens or freelance-site credential sharing.

**Release status:** the software is implemented, but no cloud service or Chrome Web Store release has been deployed. The default build targets local operator development. A configured hosted release must be supplied before end users can connect remotely.

## Connect your Telegram account

1. Install the operator-supplied extension and open its popup.
2. Click **Connect Telegram**. A Telegram tab opens in the background.
3. Compare the confirmation code in your extension with the bot's code.
4. If the codes match and you initiated the connection, tap **Connect this browser** in Telegram. You do not type a confirmation message.
5. The extension finishes pairing and starts scanning automatically, even with the popup closed. Telegram may require a one-time Start tap before displaying the approval button.

Connecting enables your subscription. Never confirm a connection someone else initiated. A Telegram link alone does not authorize a browser.

Each installation receives its own session. Multiple installations connected to your same Telegram account share your preferences and duplicate history.

## Detect projects

Open either listing page normally:

- https://www.peopleperhour.com/freelance-jobs
- https://www.guru.com/work/

Complete normal login or verification yourself. The extension does not interact with those controls.

The extension notices DOM changes in loaded foreground and background tabs and scans them automatically. Use **Stop scan / Continue scan** to control all supported tabs in this installation. The Scan Now button has been removed. Hidden/unloaded/virtualized content is not fetched. The popup shows the current website, count, last accepted scan and connection/page status.

**The first accepted nonempty batch for each user and platform stays silent.** Later unseen projects can notify only you, subject to your Telegram preferences. Repeated scans and restarts do not reset the baseline.

Version 0.4.0 requests listing HTML about every 30 seconds while enabled, without reloading tabs. Login or verification pauses polling; login reports queue a deduplicated notice only for your Telegram account. JavaScript shells and unsupported HTML are reported, not bypassed. Chrome must remain running with loaded tabs. See [background polling details](../docs/background-polling.md).

The baseline covers the initial rendered snapshot, not every project on the site. Later filtering, pagination or delayed rendering can reveal older projects that are new to your database. Missing fields remain absent; displayed relative publication times are not converted into invented dates.

## Preferences and disconnection

In Telegram, use /keywords, /platforms, /pause, /resume and /status.

Use **Disconnect** in the popup to revoke this installation. Use **/disconnect** in Telegram to revoke all your browser sessions. Sessions expire after 30 days; reconnect when requested. If the service was unreachable during disconnection, local credentials are still removed; Telegram /disconnect can revoke outstanding server sessions.

No Telegram bot token, browser cookies or platform login credentials are collected by the extension. Its session credential remains in trusted Chrome local storage and is not available to content scripts. Protect your Chrome profile.

## Troubleshooting

For extraction diagnostics, follow the [Chrome scan diagnostic steps](../docs/scan-diagnostics.md). The popup separates a fresh connection check from the last scan result and shows whether the content script responded and ingestion was attempted.

If PeoplePerHour shows recognized links but zero cards, see the [v0.2.2 card extraction fix](../docs/peopleperhour-extraction.md), including the optional sanitized developer layout report.

| Status | What to do |
| --- | --- |
| Not connected | Click Connect Telegram and complete code confirmation. |
| Pairing expired or connection unavailable | Reopen the popup or start Connect Telegram again. Requests expire after five minutes. |
| Login or verification | Complete normal website access yourself and return to listings. |
| No projects | Wait for normal page loading and the next automatic cycle. The live layout may need updated selectors. |
| No notification | Check /status and preferences. Initial baselines and repeats stay silent. |
| Backend unavailable | Retry later or contact the service operator; no local backend is required for a hosted release. |

## Development and verification

Developers: run npm.cmd run build, load the **extension** directory unpacked at chrome://extensions, then manually refresh an already-open site tab. The backend origin and permissions are set by the operator's build, not by the user.

Extraction currently passes synthetic HTML fixtures and has not been verified against current authenticated layouts. DOM tests verify change detection and access-barrier handling without network retrieval or refresh. Telegram/cloud/browser end-to-end acceptance remains a separate operator test after hosting approval.

See [operator setup and pairing security](../docs/account-linking.md) and the [project README](../README.md).
