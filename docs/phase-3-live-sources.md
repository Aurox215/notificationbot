# Phase 3: live project source readiness

Phase 4 update: a separate [manual Chrome extension prototype](../extension/README.md) is now available. It reads user-opened pages on demand and does not enable automated platform requests. The mock-only registry descriptions below record the Phase 3 state; the current registry also accepts manual extension mode, with no fetching adapters. The authorization findings for direct automated polling remain unchanged.

Reviewed 2026-11-13 (Asia/Tokyo). **Neither platform's live project-listing integration can be activated.** Mock adapters remain operational. This phase prepares reliability and health infrastructure, not an unverified live connector.

## Integration decision

| Platform | Verified project API/RSS endpoint | API authentication | Permitted request rate | Activation |
| --- | --- | --- | --- | --- |
| PeoplePerHour | None verified in this review | Not established; do not assume OAuth, API keys or session-cookie reuse | Not established; five-second polling is not approved | Mock only; needs official documentation or written permission |
| Guru.com freelance marketplace | None verified in this review | Not established | Not established; five-second polling is not approved | Mock only; needs official documentation or written permission |

These are findings from the publicly available evidence reviewed, not proof that private partner integrations do not exist. No API paths, authentication schemes, rate limits or field guarantees are invented. Public browser access, a robots.txt allowance, a third-party scraper, or a working JSON response would not by itself establish permission for this application.

## Verified official capabilities and evidence

### PeoplePerHour

The official [Saved Searches support article](https://support.peopleperhour.com/hc/en-us/articles/205217987-Saved-Searches) documents keyword/filter searches, email updates with instant or daily options, and a maximum of ten saved searches. Account setup and saved-search notification preferences are required for that email feature. The article describes an end-user feature, not an HTTP project API or RSS endpoint, and does not publish automated request limits or a delivery SLA.

The official [Freelancer Guide](https://support.peopleperhour.com/hc/en-us/articles/205217167-Freelancer-Guide) also describes customized searches and email notifications. These sources support investigating owner-authorized email ingestion later. They do not establish permission to redistribute one account's alerts to all Telegram subscribers, authorize profile enrichment, or guarantee client ratings/reviews/join dates in emails.

Direct research access to the official [terms page](https://www.peopleperhour.com/static/terms) and [website-use terms URL](https://www.peopleperhour.com/static/terms-of-website-use) returned a JavaScript/browser-verification page. The latter URL was not verified as a current terms document. No bypass was attempted and no current automated-access permission is inferred from those responses. Current restrictions still require review with the platform. No public official project API documentation or official project RSS specification was found in the support/site searches reviewed. Blog RSS is not project data.

Request current integration documentation/permission through the official [support request form](https://support.peopleperhour.com/hc/en-us/requests/new). No support message has been sent by this implementation.

### Guru.com

The official [Leads / Job Matches help article](https://www.guru.com/help/freelancer/getting-hired/leads) was available in the search index: it describes skills-based Job Matches, their visibility period, and account Email Settings for Job Match emails. Direct retrieval returned HTTP 403 during this review, so this is indexed official documentation rather than a verified current account setting. It does not document an external jobs API, RSS consumption contract, authentication scheme, request quota or guaranteed delivery cadence.

A legacy candidate URL, [https://www.guru.com/rss/jobs/](https://www.guru.com/rss/jobs/), surfaced during RSS research. Direct inspection via the research tool was inaccessible and no current official support documentation confirming its operation, authorization, authentication or permitted frequency was located. It is **unverified, not a configured endpoint**. No scheduled requests or attempts to evade access controls were made.

Direct access to Guru's official [Terms of Service](https://www.guru.com/terms-of-service/) returned HTTP 403. This limits verification; it is not evidence either of API authorization or of a particular prohibition. Search results mentioning API development services/jobs are marketplace listings, not Guru API documentation. APIs.guru and getguru.com are different services and are not used as evidence for Guru.com's freelance marketplace.

Ask Guru through its official [contact page](https://www.guru.com/contact.aspx) for current project-feed/API support and permitted use. No message has been sent. The reviewed official material does not establish multi-user redistribution rights or availability of every requested client field.

## Endpoint and access inventory

The official links above are documentation/support pages, not application data endpoints. No PeoplePerHour or Guru API credentials, scopes, token URLs, pagination contracts, feed URLs or polling limits are verified for runtime use. The Guru legacy RSS candidate is recorded solely to avoid treating old examples as approval. There are no application-configured live endpoints and no URL override that can silently turn mock mode into website requests.

Official alert emails are a documented candidate route for later ingestion from an owner's mailbox; mailbox access would require that owner's authorization and separately verified mail-provider API scopes/quotas. This phase does not implement Gmail OAuth or assume that receiving an email permits redistribution. Platform-specific email templates and sanitized samples are still needed; absent fields must remain absent rather than be scraped from linked profiles.

## Adapter review and activation requirements

The preserved ProjectSource contract exposes platform and fetchProjects(signal), yielding SourceProject arrays with stable sourceId plus the existing project/notification fields. PeoplePerHourSource and GuruSource narrow the platform independently; both mock classes continue implementing them. Each source should implement its complete paginated retrieval inside that call, honoring cancellation. SourceRunner validates the entire batch before any project is saved (maximum 1000 projects per batch); larger feeds need an explicitly designed paging/checkpoint contract before activation.

The registry at src/sources/registry.ts constructs only mocks. SOURCE_MODE=live or any unsupported mode fails before Telegram startup. There is deliberately no speculative LivePeoplePerHourSource or LiveGuruSource making requests against guessed paths. Configurable source timeout/retry controls are operational mock settings, not platform-approved quotas.

Before adding a live adapter, record evidence here for:

1. Official provider documentation or written permission naming the endpoint, method, supported application purpose and authorized accounts.
2. Authentication, scopes, issuance/refresh/revocation and secret environment-variable names.
3. Minimum request interval, burst/daily quotas, per-account/application sharing rules and Retry-After semantics, including pagination calls.
4. Pagination/cursors, ordering, stable IDs, required/optional field schema and sanitized fixtures.
5. Permission for caching, retention, client-profile fields and redistribution to multiple Telegram users; any personal-data restrictions.
6. Integration tests using injected responses, plus an approved manual smoke-test plan and a centrally enforced per-platform interval floor.

Only then implement the verified transport/parser and add its explicit registry/configuration branch. The current global interval must never be used to bypass a provider's minimum. An API returning 200, knowledge of a private browser endpoint, or an environment flag alone is not an activation criterion.

## Reliability implemented now

- One adapter per platform is enforced at Monitor construction. Fetching is outside the subscriber loop. Each platform gets at most one source call per eligible shared cycle, regardless of user count; retries occur on later cycles, not per user.
- Source failures are isolated. Successful platforms and previously stored matching projects continue through filtering/delivery.
- Configurable deadline, persisted next-attempt time, exponential backoff with a maximum, and a minimum interval floor. A typed rate-limit delay can extend the backoff maximum and is never shortened by it. Retry state survives restarts. No immediate retry burst is performed.
- Authentication, permission and configuration failures block automatic retries. They need operator remediation; blocked state persists. In the current mock-only build, inspect and fix the underlying fault before an operator removes that platform's source_health state record from SQLite while the bot is stopped. Never clear notification history to reset source health.
- A timed-out adapter cannot submit late data. If it ignores cancellation and keeps running, that platform remains excluded from new calls in this process until the old request settles; other platforms continue. Future adapters must honor cancellation to stop actual network activity.
- Source output validation covers identities, required fields, timestamps and optional field shapes. Invalid batches produce invalid_data failures before persistence. The first observed valid project snapshot remains unchanged, preserving existing duplicate-detection behavior.
- Structured source.failed/source.recovered, notification.failed and monitor.cycle_failed events contain platform, safe error code, timing and retry metadata. Raw exceptions, URLs, tokens and upstream response bodies are excluded.

## Health checks and operations

Source health is persisted in existing SQLite state records: status, last attempt/success, consecutive failures, next retry, safe error code, latency and project count. Cycle state records the last completed cycle and whether it succeeded. /status includes a summary; it never reports mock success as a live connection.

After building, run npm.cmd run health from a second terminal while the bot runs. It opens SQLite read-only (without locks, notification crash recovery, network requests or credentials), prints JSON, and exits 0 only when the scheduler and both mock sources have recent successful checks. It exits 1 for missing/unreadable state, startup, stale data, degraded/blocked sources or failed cycles. Missing health state on a Phase 2 database is normal until the first Phase 3 cycle. No schema migration or destructive reset is needed.

Health checks measure the local mock monitor, not Telegram delivery or real platform availability. A healthy mock report always includes mode=mock and liveEnabled=false. Stopping the bot marks its final cancelled cycle unsuccessful; a hard crash becomes stale after HEALTH_STALE_MS. Long delivery queues may need a larger staleness threshold. Prior completed-cycle health stays visible during a new in-progress cycle rather than flapping to unhealthy on every poll.

| Setting | Default | Meaning |
| --- | --- | --- |
| SOURCE_MODE | mock | Only permitted mode until a source is verified |
| MONITOR_INTERVAL_MS | 5000 | Shared scheduler cadence/minimum source-attempt interval |
| SOURCE_TIMEOUT_MS | 15000 | Source deadline (10–120000 ms) |
| SOURCE_RETRY_BASE_MS | max(interval,5000) | Initial source retry backoff |
| SOURCE_RETRY_MAX_MS | max(interval,300000) | Exponential backoff cap; cannot be below base |
| HEALTH_STALE_MS | max(60000,3*interval) | Maximum source-success/completed-cycle age |

The example environment file specifies the shown defaults for a five-second mock interval. Existing .env files are preserved. Telegram delivery retries/deduplication and Phase 1 commands retain their prior behavior.
