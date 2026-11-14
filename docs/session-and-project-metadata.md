# Login checks and notification fields

See [account authentication checks](authentication-state.md) for the investigated
mechanisms, three-state behavior, sources, and current verification limits.

The extension requests the listing page in the background using the browser's
existing same-origin session. This does not refresh the open tab. A login response
pauses that platform and queues the user's Telegram login reminder.

Public listings can remain accessible after logout. A successful listing request
therefore proves listing access, not account login.

Direct token-expiry detection is not enabled. Neither platform's authentication
cookie/token identity, expiry semantics, or authorized session-check endpoint has
been verified. Do not guess cookie names or treat unrelated expired cookies as
logout. Session cookies may have no expiration date; token rotation and server-side
session invalidation also require platform-specific handling. Never send platform
cookies or tokens to the backend, Telegram, logs, or support messages.

To implement a reliable session check later, establish the authentication mechanism
and permitted status-check method using platform documentation or local inspection.
Only share non-secret field names and behavior, never token/cookie values.

Notifications support title, budget, skills, category, client rating score and client
review count and join date when available. Client metadata now survives extension ingestion and
validation. Extraction reads explicitly client-labelled fields within each card
(`.client-rating-score`, `.client-review-count`, `.client-join-date`,
`.client-joined-at`, or equivalent `data-field` names).
These selectors are covered by synthetic tests, not verified current live layouts.
Actual platform markup may require an update using a sanitized card sample.
Missing fields remain absent; no profile requests or invented values are used.
