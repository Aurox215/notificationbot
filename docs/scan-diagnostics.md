# Diagnose Scan Now in Chrome

For **visible project links > 0 / matched cards = 0** on PeoplePerHour, use the [v0.2.2 extraction fix and reload instructions](peopleperhour-extraction.md).

The old extension used one generic “Connection unavailable” message for unrelated scan failures. A missing content script could show that message even while the backend session check succeeded. Backend rejections were also incorrectly labeled no_projects. These were diagnostic bugs, not proof that Telegram pairing had failed.

Version **0.2.1** keeps the current connection check separate from the last scan attempt and records its stage. It never displays tokens, request headers, raw exceptions, response bodies or page contents in diagnostics.

## Install the fix without resetting pairing

1. Build the extension with the same backend origin used by your current installation. The default build is for http://127.0.0.1:4318; hosted builds must preserve their approved AUROX_BACKEND_URL. No .env edit is needed for this fix.
2. Open chrome://extensions and click **Reload** on Aurox Job Monitor. Use **0.2.2 or later** for the PeoplePerHour card fix. Do not remove/reinstall it or clear extension storage.
3. **Manually refresh the PeoplePerHour listing tab after the extension reload.** Reloading an extension does not guarantee its content script is attached to a tab that was already open. Check the extension has site access to PeoplePerHour.
4. Wait for normal website loading. If login, CAPTCHA or verification is shown, complete ordinary access yourself; the extension does not interact with those controls.
5. Open the popup and click **Check connection**. Read its timestamped result. Reconnect Telegram only if authentication is expired/revoked or the extension is no longer paired.
6. Click **Scan Now** and read the last scan attempt, stage/status, content-script response, ingestion attempt and link/card counts.

## Read the result

| Status | Meaning | Next step |
| --- | --- | --- |
| content_script_unavailable | SCAN_PAGE was sent, but the tab did not return a valid response | Refresh the tab after reloading the extension; check site access |
| extraction_failed | The content script responded but could not read the page | Reload the normal page; the extraction code may need investigation |
| no_projects | Extraction ran and found no supported projects; no ingestion request was sent | Check visible listings and the link/card counts below |
| backend_unavailable | A fetch failed or timed out | Check service/network availability; pairing is not declared expired |
| authentication_expired | Backend returned HTTP 401, or the saved session expired locally | Connect Telegram again |
| request_forbidden | Backend returned HTTP 403 | Operator should check origin/Host/reverse-proxy settings; do not assume token expiration |
| scan_rejected | Backend returned HTTP 400, 413 or 415 | Operator should inspect validation/body limits; no successful ingestion was confirmed |
| ingestion_failed | Backend returned a server error | Operator should check backend logs; later retries remain deduplicated |
| backend_response_invalid | The response was unreadable or was not a valid acknowledgement | Check backend routing; success was not recorded |
| accepted | Backend acknowledged the batch | First user/platform batch stays silent; later matching unseen projects can notify you |

If **visible project links > 0** but **matched cards = 0**, the visible link format is recognized but the card layout is not supported by the current selectors. This is an extraction issue, not a Telegram connection issue. No selectors were guessed from inaccessible live pages for this fix.

If both counts are zero, supported links may not be rendered, may be hidden, or may use an unsupported URL format. A zero count alone does not prove that the website has no projects.

“Connected to your Telegram account” describes the latest authenticated backend session check. It does not mean a scan was accepted. “Last accepted scan: Never” remains correct until ingestion is actually acknowledged. The recorded last scan may predate the current connection check; timestamps make that distinction explicit.

## Optional operator checks

In chrome://extensions, open the extension service worker's DevTools. A manual scan should send SCAN_PAGE to the active tab. Only a successful nonempty extraction should produce POST /v1/ingest in the worker's network panel. A session check is GET /v1/session and is separate from ingestion.

Do not share Authorization headers, session storage, pairing proofs, request bodies or full Network exports. The popup's status, stage and numeric link/card counts are enough to start debugging. Backend validation failures log ingestion.rejected with invalid_scan, without project contents.

This change was verified with fixture-based extraction, simulated Chrome messaging, popup state tests and local backend tests. The developer cannot infer the exact DOM or runtime state of your open Chrome tab from the original generic error. Live PeoplePerHour extraction still needs confirmation using the diagnostic steps above.
