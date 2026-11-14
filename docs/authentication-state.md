# Account authentication checks

Checked on 14 November 2026. Telegram connection and platform login are separate.

## What is verified

| Platform | Official evidence | What remains unknown |
| --- | --- | --- |
| Guru | Its privacy policy describes session-ID cookies that confirm login, plus a persistent cookie that remembers the login ID. | Current cookie names, server expiry/renewal rules, and an authorized session-status endpoint. A remembered login ID does not prove authentication. |
| PeoplePerHour | Its own PHP client documents maintaining login sessions with cookies and requires an application ID and secret. This is historical API documentation. | Whether today's browser uses the same mechanism, any browser token expiry timestamp, and a current authorized session-status endpoint. |

Sources:

- [Guru privacy policy](https://www.guru.com/privacy-policy/)
- [PeoplePerHour's PHP client](https://github.com/PeoplePerHour/pph-php-client/blob/master/README.md)
- [Chrome cookies API](https://developer.chrome.com/docs/extensions/reference/api/cookies)

The Guru policy was available through the search index; direct retrieval returned
403. PeoplePerHour's current policy/terms pages returned verification challenges.
No logged-in browser session was inspected. No challenge was bypassed.
The published policies do not establish the exact server-side session implementation.

Neither source provides a verified browser token-expiry rule. Chrome documents
that session cookies may lack an expiration date. A cookie's expiry describes
browser storage, not proof that a server accepts the session. No cookie permission,
token decoding, credential reading, private endpoint, or automatic login was added.

## State behavior

The popup shows independent PeoplePerHour and Guru account states:

- **authenticated**: reserved for a verified positive authentication check. No such
  mechanism is currently verified, so this release does not emit this state.
- **expired/logged_out**: HTTP 401 from the listing request, a supported login page
  or visible password form, or an explicit logout-success heading. Expiration and
  manual logout cannot always be distinguished, so they share one state.
- **unknown**: public listings, ordinary HTTP 200, redirects with unverified targets,
  network failures, CAPTCHA, rate limiting, and ambiguous pages.

No expiry timer is guessed. Tests cover expiration through simulated server rejection,
not a verified real-platform expiry timer. Logout-success text tests are synthetic;
other languages/layouts remain unknown until verified. Merely clicking a logout
link does not confirm that logout succeeded.

Confirmed logout pauses that platform and uses the existing owner-only, deduplicated
Telegram reminder. A successful extraction cannot silently clear that pause. Unknown
observations do not erase a previously confirmed logout. No credentials are included
in stored account observations or messages. Pairing tokens remain backend-session
credentials, separate from freelance-site credentials.

## Public listings after logout

Public HTML may still be technically accessible. That does not prove login or grant
permission for automated monitoring. Public access does not justify attempting
protected endpoints, following verification redirects, or bypassing restrictions.
Current platform permission for public automated polling was not independently
established from accessible official documentation:

- [PeoplePerHour terms](https://www.peopleperhour.com/static/terms)
- [Guru terms](https://www.guru.com/terms-of-service/)

This change adds no public-only fallback or new requests. Confirmed logout remains
paused. After normal sign-in, Stop scan then Continue scan explicitly retries listing
access; this resets observations to unknown, not authenticated. Public listing
monitoring can run in that unknown state under the existing configured workflow.
Reliable automatic confirmation of restored account login still needs platform
documentation or verified positive page/session evidence.

## Verify in Chrome

1. Reload the unpacked extension at `chrome://extensions` and refresh each platform
   tab once. Open the popup: account states are independent of Telegram connection.
2. A public listing must not show authenticated merely because projects were found.
3. Sign out normally. A login page/form or explicit logout confirmation should show
   expired/logged_out and queue the platform-specific reminder for your Telegram user.
   If the website leaves only public listings with no logout evidence, expect unknown.
4. An old listing tab must not clear a confirmed logout pause. The other platform's
   state must be unaffected.
5. Sign in normally, then Stop scan / Continue scan to explicitly retry. Listing
   access may resume; account authentication remains unknown until positively verified.

Automated checks: `npm run typecheck` and `npm test` (includes build).
