# Extension-only architecture

The MV3 worker serializes storage and delivery through Web Locks. chrome.storage.local retains profile-local history, baselines, connection epochs, account state, detail claims and delivery claims. No Node backend, SQL adapter, HTTP listener or localhost API remains.

Content scripts read existing platform pages. Listing HTML requests stay within their observed same-origin routes. New eligible projects may receive one canonical project-detail GET through an existing platform tab. Detail claims persist before retrieval and are paced about 1.1 seconds apart. Login, redirects and challenges are not bypassed; client profiles are not crawled.

Telegram is called only by the worker, with getMe, getChat and sendMessage. API errors are sanitized; read-only checks retry boundedly, while uncertain sends become unknown. Required metadata labels remain present and descriptions are excluded from the message formatter. Cached description text can still support existing keyword filters.

Guru session checks verify the account API with an anonymous negative control. A stale refresh cookie receives a two-second grace and a second read-only rejection check if tokens did not change. When navigation or a guest-looking page calls for it, the browser's cookie-authenticated /pro/ route is checked as well; a server redirect to Guru's own login.aspx confirms logout despite a surviving API token. Other redirects are inconclusive for logout.

Completed navigation, URL-only navigation, native login/logout requests and periodic checks trigger account verification. A listing in another tab counts. Missing-listing reminders are persisted by account generation and missing-page episode.

Shared browser-safe types, identity/scan validation, publication cutoffs, keyword matching and formatting live in extension/shared. Source tests cover both platforms, authentication, scan recovery, delivery persistence, profile isolation, detail mapping and message contents. Old backend tests were deleted together with the implementation they exercised.

Local .env, private build configuration and old data files are intentionally preserved and ignored by Git. No runtime code loads the old credentials/data. Release packages contain only manifest, HTML/CSS, README and the three compiled extension bundles.

Guru 0.8.1: the protected Dashboard check runs independently before the account-only API fallback. A private Dashboard marker plus anonymous rejection proves login; a server redirect to the actual login form proves logout. Unknown results produce a visible account-check issue. First proof after migration refreshes Guru's reminder episode once without resetting project history or the Telegram connection.
