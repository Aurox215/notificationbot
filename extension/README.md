# Aurox Job Monitor - Chrome extension

## Setup

1. Open chrome://extensions, enable Developer mode, and Load unpacked using your prepared folder containing manifest.json.
2. Open the popup and click Find my ID. Open the separate helper in Telegram, press Start or send /start, and copy its Id number. This is not your phone number or @username.
3. Paste that number and click Connect Telegram. Green means valid ID format; the Connected status confirms successful delivery. If Telegram needs you to start or unblock Aurox, follow the displayed access link and retry.
4. Keep Chrome and these first-page listing tabs open while signed in:
   - https://www.peopleperhour.com/freelance-jobs
   - https://www.guru.com/work/

## Monitoring

Checks normally run every 30 seconds; DOM changes can trigger scans sooner. Browser sleep, tab discarding, network delays and the website's own publication timing affect latency. Detail lookups no longer add a 30-second wait for each project in a batch.

The first complete settled listing scan is silent. Later eligible new projects receive one alert, subject to stored filters and publication cutoffs. Notifications contain the project title, budget, category, skills, publication time, client rating, review count, joining date, link and detection timestamp. Description is omitted. Values not exposed by the listing or detail page say Not provided.

Login/logout notifications use server evidence, not just page labels. Guru rechecks after a short token-refresh grace and verifies its protected browser dashboard on navigation/guest-page checks; redirects to the actual login page confirm a missing browser session even if an old API token survives. Other redirects and challenges do not prove logout.

When signed in without a usable first-page listing tab, a private reminder includes the correct jobs URL. A listing open in a background tab prevents the reminder. Opening a listing resets the reminder episode; moving away can notify again. Repeated checks and worker restarts do not send duplicates.

Detail reads use the existing tab's normal session and canonical project URL, once per eligible new project, without profile crawling or challenge bypasses. Failure falls back to available listing information and displays a warning. Details are cached across retries. Descriptions may still be read internally for existing keyword filters, but are never placed in the Telegram message.

## Updates and troubleshooting

Update the same installed folder, reload the existing extension ID, and refresh platform tabs. Do not uninstall, clear storage or reconnect merely to update. Disconnect retains history and settings.

If an alert is missing, check Connected, monitoring enabled, and the popup's blocker message. Missing/unreadable publication times, partial scans, website restrictions and expired sessions are not treated as new projects. A Telegram send with an uncertain result is not automatically resent.

## Private distribution

The package runs independently of this repository. No backend or database is needed. Build dependencies are for developers only. An embedded shared bot token is recoverable by recipients; no encryption or hidden-token protection is claimed. Keep configured packages private.

An administrator can prepare a personal package with `node scripts/package-extension.mjs --chat-id NUMERIC_ID` after building, or distribute the ordinary manual-ID package. There is no Telegram getUpdates polling, webhook receiver, backend session pairing, or database import tool.

## Acceptance test

Reload version 0.8.1 and refresh both platform tabs. Connect Telegram, establish silent listing baselines, and verify a newly posted eligible project alerts once. Check that multiple new projects do not wait thirty seconds apart and descriptions are absent. In Guru, keep only its dashboard open and expect one jobs-page reminder; open /work/, then leave it again and verify a new reminder. Log out and refresh: expect one private logout notice after confirmation, with no repeats. Repeat with a second Chrome profile and different recipient. Automated tests use mocks and an actual sanitized public Guru fixture; live account/Telegram acceptance remains necessary.

## Guru verification update (0.8.1)

Guru is now checked through a fresh credentialed GET of its protected /pro/ Dashboard, independently of the saved-search API. Signed-in proof requires the server Dashboard with a numeric Guru ID and a separate anonymous request denied by the route. A server redirect to Guru's login form confirms logout. Inconclusive Dashboard responses can fall back to the account-only API check. Account IDs and response bodies stay in the content script.

The first confirmed Guru session after this update sends a signed-in status and re-evaluates the missing-listing episode once. Old pending page reminders are suppressed before this refresh, preventing duplicates. Later login/logout transitions and missing-page episodes stay deduplicated across worker restarts. Check connection now rechecks platform sessions as well as Telegram. Unknown or unavailable checks are visible in the popup.

Reload the existing installation, refresh Guru, stay on Dashboard with no /work/ listing tab open, and click Check connection. Expect one signed-in status and an open-/work/ reminder after successful server verification. Log out, refresh and check again for one logout notice, then sign in again for recovery. Public/guest Dashboard shells and verification challenges do not count as authenticated. The anonymous /pro/ route was verified to redirect to /login.aspx; positive private-account responses are regression tested with fixtures and require live acceptance in your own session.
