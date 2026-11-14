# Background polling: v0.4.0

The popup now has **Stop scan / Continue scan** only. Scan Now was removed. The old tab-reload loop was removed too.

## What happens every 30 seconds

While scanning is enabled, a Chrome alarm asks the content script in a loaded listing tab to make a normal GET request for that exact listing URL. It uses the browser's same-origin session, does not add an Authorization header, does not follow redirects, and never calls guessed private API endpoints. There is at most one scheduled listing GET per platform in each 30-second window, even with multiple tabs.

The HTML is parsed locally without executing its scripts or loading embedded resources. Only extracted project metadata is sent to the backend through the existing authenticated per-user session. Raw HTML, cookies and platform credentials never go to the backend. Your private snapshots, silent baseline and duplicate history remain unchanged.

DOM observation still handles changes already appearing on the loaded page. Polling does not navigate, reload, activate or switch your tabs. Stop scan prevents subsequent polling/submissions; Continue scan resumes and clears a paused access state so you can retry after signing in.

## Important response differences

A page refresh and a background GET are not always equivalent. A refresh can run website JavaScript that fetches and renders more data. This implementation deliberately does not execute returned JavaScript or imitate undocumented private requests.

| Result | Behavior |
| --- | --- |
| HTML includes supported project cards | Extract and ingest normally |
| Login page, HTTP 401 or a redirect | Report login_required; pause website requests for that platform |
| Challenge, HTTP 202/403/429 or WAF challenge header | Report verification_required; pause requests without bypassing access controls |
| JavaScript shell or unsupported layout | Report poll_unsupported; no false claim that there are no new jobs |
| Timeout, network or server error | Report poll_failed; no successful ingestion recorded |

A redirect is a conservative sign-in/access warning, not proof that credentials were revoked. Complete normal access in the platform tab yourself. A newly observed valid DOM scan can restore monitoring, or use Stop/Continue after signing in. Platform refresh/poll permission has not been independently verified; this change follows the user's explicit background-polling request.

## Telegram login notice

When your authenticated extension reports that a platform requires sign-in, the backend queues a notice such as:

> Guru: login required. Please open Guru in your own Chrome browser and sign in normally to resume project monitoring.

Only that user's subscribed, unpaused Telegram account receives it, and only for an enabled platform. Repeated reports of the same logout do not send repeated notices. The state survives restarts. A successful scan clears the logout state; a later logout can notify again, with a 30-minute cooldown to avoid rapid login/logout spam. Verification alone does not send a misleading logout notice.

Like project notifications, a delivery with an uncertain outcome is not automatically retried, avoiding possible duplicate notices. An explicit Telegram rate limit is deferred safely. Notices already sent or queued may finish after Stop scan; Telegram /pause controls notification delivery.

## Update and check

1. Restart the backend with the updated build. This adds an owner-scoped platform-access state table; no database reset is needed.
2. Reload the existing extension at chrome://extensions and confirm **0.4.0**. Keep your pairing and storage.
3. Manually refresh the already-open platform tabs once to attach the updated content script. This one-time update step is not the polling mechanism.
4. Leave scanning enabled. No Scan Now button should appear. After an alarm cycle, read the popup status and accepted timestamp.
5. Switch to another tab and confirm the platform tab is not reloaded. In its DevTools Network panel, the scheduled request should be a fetch GET for the listing URL.
6. If the website shows login_required, verify that your own Telegram receives one platform-specific sign-in notice. Sign in normally and resume using Stop/Continue if needed.

Do not share Network exports, cookies or Authorization headers. The popup status and numeric diagnostics are sufficient for reporting failures.

## What has been verified

Automated tests cover the polling GET options, extraction from response fixtures, redirects/login, challenges, shells, invalid responses, no tab reloads, Stop/Continue, user isolation, login-notice routing and restart deduplication. The popup tests ensure Scan Now is absent.

Live logged-in PeoplePerHour/Guru background responses have **not** been verified in this development environment. If they return a shell/challenge, the extension reports that limitation; a private API or security-bypass fallback is not implemented. Chrome must be running and tabs must remain loaded; frozen/discarded tabs and device sleep can delay or stop work. Thirty seconds is an approximate browser alarm interval.
