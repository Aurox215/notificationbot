const get = (id: string) => document.getElementById(id)!;
interface PopupState {
  monitoringDetail?: string;
  platformAuthentication?: Record<string, { state: string }>;
  developerDiagnostics?: boolean;
  scanningEnabled?: boolean;
  connected: boolean; supported: boolean; website: string; count: number; lastSuccess: string | null;
  lastAttempt: string | null; connection: string; connectionCheckedAt: string; confirmationCode?: string | null;
  detail: string; status: string; stage: string; contentScriptReached?: boolean; ingestionAttempted?: boolean;
  diagnostics?: { linksChecked: number; visibleProjectLinks: number; matchedCards: number; extractedProjects: number };
}
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
let busy = false;
let state: PopupState | undefined;
function buttons() {
  (get('toggle') as HTMLButtonElement).disabled = busy || !state?.connected;
  get('toggle').textContent = state?.scanningEnabled ? 'Stop scan' : 'Continue scan';
  (get('connect') as HTMLButtonElement).disabled = busy || Boolean(state?.connected);
  (get('disconnect') as HTMLButtonElement).disabled = busy;
  (get('check') as HTMLButtonElement).disabled = busy;
}
function render(value: PopupState) {
  state = value;
  get('website').textContent = value.website;
  get('count').textContent = String(value.count);
  get('lastSuccess').textContent = value.lastSuccess ? new Date(value.lastSuccess).toLocaleString() : 'Never';
  get('connection').textContent = value.connection;
  get('platformAuthentication').textContent = ['PeoplePerHour', 'Guru'].map(platform =>
    `${platform} account: ${value.platformAuthentication?.[platform]?.state ?? 'unknown'}`).join(' | ') + '. Listing access does not prove login.';
  get('connectionChecked').textContent = 'Connection checked: ' + new Date(value.connectionCheckedAt).toLocaleTimeString();
  get('status').textContent = value.detail + (value.monitoringDetail ? '\n\nCurrent notification status: ' + value.monitoringDetail : '');
  get('attempt').textContent = value.lastAttempt ? 'Last scan attempt: ' + new Date(value.lastAttempt).toLocaleString() : 'No scan attempted in this tab.';
  const counts = value.diagnostics;
  get('diagnostics').textContent = `Stage: ${value.stage}; status: ${value.status}. Content script: ${value.contentScriptReached ? 'responded' : 'not confirmed'}. Ingestion: ${value.ingestionAttempted ? 'attempted' : 'not attempted'}.` +
    (counts ? ` Visible project links: ${counts.visibleProjectLinks}; matched cards: ${counts.matchedCards}; extracted: ${counts.extractedProjects}.` : '');
  get('confirmation').textContent = value.confirmationCode ? `Compare code: ${value.confirmationCode}. Open the Telegram tab and tap Connect this browser if it matches. No typing is needed.` : '';
  get('developer').hidden = !value.developerDiagnostics;
  buttons();
}
async function refresh() {
  if (refreshTimer) clearTimeout(refreshTimer);
  try {
    const result = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
    if (!result?.ok) throw new Error(result?.error ?? 'Extension service worker did not respond.');
    render(result as PopupState);
    if (result.confirmationCode && !result.connected) refreshTimer = setTimeout(() => { void refresh(); }, 2000);
  } catch {
    // Never keep an earlier Connected label when a current check failed.
    get('connection').textContent = 'Current connection check unavailable.';
    get('status').textContent = 'The extension service worker did not return status. Reload the extension and refresh the website tab.';
    state = undefined; buttons();
  }
}
get('check').addEventListener('click', () => { void refresh(); });
get('structure').addEventListener('click', () => {
  get('structureReport').textContent = 'Reading layout only...';
  void chrome.runtime.sendMessage({ type: 'DEV_STRUCTURE' }).then(result => {
    get('structureReport').textContent = result?.ok ? JSON.stringify(result.structure, null, 2) : 'Structure report unavailable. Refresh the listing page with the developer build loaded.';
  }).catch(() => { get('structureReport').textContent = 'Structure report unavailable.'; });
});
for (const [id, type] of [['connect', 'CONNECT'], ['disconnect', 'DISCONNECT'], ['toggle', 'TOGGLE_SCAN']] as const) {
  get(id).addEventListener('click', () => {
    if (refreshTimer) clearTimeout(refreshTimer);
    busy = true; buttons();
    get('status').textContent = 'Working...';
    void chrome.runtime.sendMessage({ type }).then(async result => {
      await refresh(); // Refresh live authentication separately from the persisted scan result.
      if (!result?.ok) get('status').textContent = `${result?.errorCode ?? 'extension_error'}: ${result?.error ?? 'Extension action failed.'}`;
    }).catch(async () => {
      await refresh();
      get('status').textContent = 'Extension action did not respond. Reload the extension and manually refresh the listing tab.';
    }).finally(() => { busy = false; buttons(); });
  });
}
void refresh();
