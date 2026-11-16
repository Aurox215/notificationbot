import { checkGuruSession } from './guru-session.js';
import { extractProjectDetails } from './detail-extractor.js';
import { canonicalProject } from '../shared/identity.js';
import { fetchProjectDetails } from './detail-fetch.js';
import { extractProjects } from './extractor.js';
import type { Extraction } from './extractor.js';
import { structureReport } from './structure-report.js';
import { pollListing } from './polling.js';
import { checkSession, savedSearchConfiguration } from './session-check.js';
let lastSessionCheck = 0;
let sessionObservation: Awaited<ReturnType<typeof checkGuruSession>> = { state: 'unknown', reason: 'unverified' };
let sessionPending: Promise<typeof sessionObservation> | undefined;
async function verifySession(force = false) {
  if (sessionPending) return sessionPending;
  if (!force && Date.now() - lastSessionCheck < 30000) return sessionObservation;
  sessionPending = (async () => {
    let configuration: string | undefined;
    if (location.origin === 'https://www.peopleperhour.com') {
      // Preserve only this site's public application configuration across tab navigation.
      // Never copy cookies, bearer tokens, account data, or API responses into storage.
      try {
        configuration = savedSearchConfiguration(location.origin, performance.getEntriesByType('resource').map(e => e.name));
        if (configuration) sessionStorage.setItem('aurox-session-probe', configuration);
        else configuration = savedSearchConfiguration(location.origin, [sessionStorage.getItem('aurox-session-probe') ?? '']);
      } catch { /* Discovery may be unavailable; leave state unknown. */ }
    }
    sessionObservation = location.origin === 'https://www.guru.com' ? await checkGuruSession(document.cookie, () => document.cookie) : await checkSession(location.origin, '', configuration);
    lastSessionCheck = Date.now();
    return sessionObservation;
  })();
  try { return await sessionPending; } finally { sessionPending = undefined; }
}
declare const __AUROX_DEV_DIAGNOSTICS__: boolean;
let stableSnapshot = '';
let stableSince = 0;
let settleTimer: ReturnType<typeof setTimeout> | undefined;
function extractSafely(): Extraction {
  try {
    const result = extractProjects(document, location.href);
    if (result.payload?.listing) {
      const fingerprint = JSON.stringify([result.payload.pageUrl, result.payload.projects]);
      if (fingerprint !== stableSnapshot) { stableSnapshot = fingerprint; stableSince = Date.now(); }
      result.payload.listing.settled = Date.now() - stableSince >= 1500;
      if (!result.payload.listing.settled && document.readyState === 'complete') {
        if (settleTimer) clearTimeout(settleTimer);
        settleTimer = setTimeout(() => { lastSubmitted = ''; void scanVisible(); }, 1600);
      }
    }
    return result;
  }
  catch { return { status: 'extraction_failed', detail: 'Content script received the scan, but reading the page failed. No project data was submitted. Reload the listing page and try again.' }; }
}
let lastSubmitted = '';
let timer: ReturnType<typeof setTimeout> | undefined;
let lastAttempt = 0;
let running = false;
let enabled = true;
async function scanVisible() {
  if (running || !enabled) return;
  running = true;
  try {
    const state = await chrome.runtime.sendMessage({ type: 'GET_SCAN_STATE' });
    enabled = Boolean(state?.enabled);
    if (!enabled) return;
    const extraction = extractSafely();
    const fingerprint = JSON.stringify(extraction);
    if (fingerprint === lastSubmitted) return;
    lastAttempt = Date.now();
    const result = await chrome.runtime.sendMessage({ type: 'AUTO_SCAN', extraction });
    if (result?.accepted) lastSubmitted = fingerprint;
  } catch { /* No background retries. A later DOM change or Scan Now can try again. */ }
  finally { running = false; }
}
function schedule() {
  if (!enabled) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { void scanVisible(); }, Math.max(1000, 5000 - (Date.now() - lastAttempt)));
}
new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'style', 'class', 'aria-hidden'] });
document.addEventListener('visibilitychange', schedule);
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id) return;
  if (message?.type === 'CHECK_AUTH') {
    void verifySession(message.force === true).then(authentication => reply({ authentication })).catch(() => reply({ authentication: { state: 'unknown', reason: 'unverified' } }));
    return true;
  }
  if (message?.type === 'PROJECT_DETAIL') {
    const platform = location.origin === 'https://www.peopleperhour.com' ? 'PeoplePerHour' : 'Guru';
    if (canonicalProject(location.href, platform)?.sourceId === String(message.sourceId ?? '') && canonicalProject(String(message.url ?? ''), platform)?.sourceId === String(message.sourceId ?? '')) {
      const details = extractProjectDetails(document, location.href, platform, String(message.sourceId)); reply({ ok: Boolean(details), details }); return;
    }
    void fetchProjectDetails(String(message.url ?? ''), location.origin, platform, String(message.sourceId ?? '')).then(details => reply({ ok: true, details }), () => reply({ ok: false }));
    return true;
  }
  if (message?.type === 'SCAN_PAGE') reply(extractSafely());
  if (message?.type === 'POLL_PAGE') {
    void chrome.runtime.sendMessage({ type: 'GET_SCAN_STATE' }).then(async state => {
      if (!state?.enabled) { reply({ status: 'unsupported', detail: 'Scanning is stopped.' }); return; }
      reply(await pollListing(location.href));
    }).catch(() => reply({ status: 'poll_failed', detail: 'Background polling is unavailable.' }));
    return true;
  }
  if (message?.type === 'STRUCTURE_PAGE') {
    if (!__AUROX_DEV_DIAGNOSTICS__) { reply({ status: 'developer_diagnostics_disabled' }); return; }
    try { reply(structureReport(document, location.href)); } catch { reply({ status: 'structure_unavailable', samples: [] }); }
  }
  if (message?.type === 'RESCAN') { enabled = true; lastSubmitted = ''; schedule(); }
  if (message?.type === 'SCAN_STATE_CHANGED') {
    enabled = Boolean(message.enabled);
    if (timer) clearTimeout(timer);
    if (!enabled && settleTimer) clearTimeout(settleTimer);
    if (enabled) { lastSubmitted = ''; schedule(); }
  }
});
schedule();
