# Scans accepted, but no Telegram project alerts

An accepted scan means the backend stored or recognized the projects. It does not
mean a new matching project was sent to Telegram. The first batch stays silent.

On 15 November 2026 a read-only inspection found:

- 20 projects in the silent first batch and 16 later projects.
- The subscription was active for PeoplePerHour with `python` as its only keyword.
- None of the 16 later stored projects matched. No delivery was attempted.
- Descriptions and skills were absent from stored project metadata, limiting matches.

The screenshots alone cannot identify the particular project that was expected.
Publication age is not the same as first detection; a project in the first batch is
intentionally silent even if it was recently published.

## Changes

Scan results and `/status` now distinguish new IDs, the silent baseline, keyword
and platform exclusions, subscription state, and notification history. Backend logs
include insertion/filter counts and successful Telegram deliveries, without tokens,
recipient IDs or project contents.

Repeated project IDs now refresh available metadata. Previously INSERT OR IGNORE
kept an incomplete first snapshot forever, even when a later scan found useful
descriptions or skills. Missing fields in a later sparse response do not erase
previous metadata. Baseline projects remain silent, notification history remains
intact, and data stays scoped to its owner.

This does not establish new live selectors for currently missing website metadata.
A sanitized card structure is needed to diagnose a specific unsupported layout.

## Test with your bot

1. Stop the running backend with Ctrl+C, run `npm run build`, then `npm start`.
   Keep the existing database and pairing. Do not delete the database or lock file
   while the process is running.
2. Reload the extension at `chrome://extensions` and refresh the listing tab once.
3. Send `/status` in your paired Telegram chat. Check the subscription, platforms,
   keywords, matching count and delivery counts.
4. If you want every project on your selected platforms, send `/keywords all`.
   This may deliver the 16 previously filtered later projects; it does not send the
   silent first batch. Otherwise choose the keywords you actually want.
5. Allow a dispatch cycle (normally five seconds, plus Telegram spacing). Check
   `/status` again: `sent` should increase for eligible projects. Logs should include
   `notification.sent`. Failures appear as `notification.failed`.
6. Repeated scans of the same IDs must not resend already delivered projects.

Automated tests use synthetic projects and a fake Telegram transport; they never
send real messages. Real Telegram receipt needs the steps above. Session validation
is unchanged.
