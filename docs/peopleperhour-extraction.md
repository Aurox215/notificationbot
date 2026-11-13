# PeoplePerHour extraction fix: v0.2.2

## Cause

The old extractor recognized the direct project URLs, then required a matching ancestor from a short hardcoded list such as .project-card, .job-card or article. Your result of **20 visible project links / 0 matched cards** shows that this card boundary rule rejected the page's visible layout. It is not an authentication or ingestion failure.

The public page still returned robot verification during this investigation. No verification was bypassed, and no current authenticated DOM was captured. The new fixtures are explicitly synthetic structural regressions, not claimed to be the exact live page HTML.

## What changed

- Added PeoplePerHour card compatibility selectors such as .job-list-item and role=listitem.
- Recognizes h2–h6 title links, including links wrapping a heading.
- Added a structural fallback for repeated project entries without known classes: require recognized direct project URLs, title headings, and evidence of a multi-project collection or semantic list item.
- A card cannot contain multiple distinct project identities. Page containers are never used as one project's metadata.
- Navigation, site headers, sidebars, footers, hidden content and unrelated/external URLs are excluded.
- Metadata is copied only from recognized visible fields within that card. Missing budgets, descriptions and publication times stay absent. IDs continue coming only from canonical project URLs.

Telegram pairing, backend ownership, SQLite duplicate history and silent per-user/platform baselines are unchanged. Your .env is not needed for this fix and was not modified.

## Verify in Chrome

1. The normal v0.2.2 build has already been generated. If building again, use npm.cmd run build with the same backend origin as before. Hosted builds must retain their existing AUROX_BACKEND_URL; the default build is local development.
2. At chrome://extensions, click **Reload** on the existing Aurox extension. Confirm its version is **0.2.2**. Do not uninstall it or clear storage; your existing pairing should remain.
3. Manually refresh https://www.peopleperhour.com/freelance-jobs after the extension reload.
4. Wait until actual listings are visible. If the site shows login or verification, complete normal access yourself.
5. Open the popup, click **Check connection**, then **Scan Now**.
6. Confirm **matched cards > 0** and **extracted projects > 0**. If ingestion succeeds, status becomes accepted and Last accepted scan gains a timestamp. The initial batch for your user/platform intentionally sends no Telegram alerts.

Automatic DOM observation may accept the initial scan before you click Scan Now. In that case an accepted timestamp may already be present; rescanning is safe and does not reset the baseline.

## Developer-only layout report, if extraction still finds zero cards

Enable the diagnostic for one local development build without editing .env:

```powershell
$env:AUROX_DEV_DIAGNOSTICS = 'true'
npm.cmd run build
Remove-Item Env:AUROX_DEV_DIAGNOSTICS
```

Keep your existing AUROX_BACKEND_URL set when using a hosted backend. Reload the extension and manually refresh the listing tab again. Open **Developer layout diagnostic** in the popup and click **Inspect card structure**.

The report stays in the popup. It includes at most three samples and seven ancestor levels: known tag names, strictly allowlisted layout class names, fixed structural roles, and heading/link counts. Unknown classes/custom tag names are omitted or redacted. It contains no project titles, descriptions, IDs, URLs, arbitrary attributes, HTML, cookies, credentials, browser storage or account names. It is not logged, persisted or submitted to the backend. Login/verification pages return no samples.

You can inspect or manually share this sanitized report to refine selectors. Do not share raw page HTML, browser storage, cookies, screenshots of account details, or network headers. Rebuild normally with the diagnostic flag unset to hide and disable the developer tool again.

## Verification performed

Build, backend/extension typechecks and the full test suite cover structural extraction, navigation exclusion, missing fields, metadata boundaries, diagnostic redaction, pairing, user isolation and duplicate prevention. Successful extraction on your actual Chrome page still requires the steps above; it cannot be claimed from synthetic fixtures alone.
