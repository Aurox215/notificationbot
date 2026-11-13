import { extractProjects } from './extractor.js';
import type { Extraction } from './extractor.js';
import { structureReport } from './structure-report.js';
declare const __AUROX_DEV_DIAGNOSTICS__: boolean;
function extractSafely(): Extraction {
  try { return extractProjects(document, location.href); }
  catch { return { status: 'extraction_failed', detail: 'Content script received the scan, but reading the page failed. No project data was submitted. Reload the listing page and try again.' }; }
}
let lastSubmitted = '';
let timer: ReturnType<typeof setTimeout> | undefined;
let lastAttempt = 0;
let running = false;
async function scanVisible() {
  if (running || document.visibilityState !== 'visible') return;
  running = true;
  try {
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
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { void scanVisible(); }, Math.max(1000, 5000 - (Date.now() - lastAttempt)));
}
new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'style', 'class', 'aria-hidden'] });
document.addEventListener('visibilitychange', schedule);
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id) return;
  if (message?.type === 'SCAN_PAGE') reply(extractSafely());
  if (message?.type === 'STRUCTURE_PAGE') {
    if (!__AUROX_DEV_DIAGNOSTICS__) { reply({ status: 'developer_diagnostics_disabled' }); return; }
    try { reply(structureReport(document, location.href)); } catch { reply({ status: 'structure_unavailable', samples: [] }); }
  }
  if (message?.type === 'RESCAN') { lastSubmitted = ''; schedule(); }
});
schedule();
