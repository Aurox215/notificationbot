import type { Extraction } from './extractor.js';

interface Pairing { token: string; port: number }
interface ScanState { count: number; lastSuccess: string | null; status: string; detail: string; connection: string }
const ready = chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
const isWebsite = (value: string) => {
  try { const url = new URL(value); return url.protocol === 'https:' && ['www.peopleperhour.com', 'www.guru.com'].includes(url.hostname); }
  catch { return false; }
};
async function pairing(): Promise<Pairing | undefined> {
  const value = (await chrome.storage.local.get('pairing')).pairing as Pairing | undefined;
  return value;
}
async function request(path: '/health' | '/v1/ingest', body?: unknown): Promise<Record<string, unknown>> {
  const settings = await pairing();
  if (!settings) throw new Error('Pair the extension with the local backend first.');
  let response: Response;
  try {
    response = await fetch(`http://127.0.0.1:${settings.port}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${settings.token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(8000),
    });
  } catch { throw new Error('Local backend unreachable. Check that it is running and the port is correct.'); }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new Error('Pairing rejected. Check the separate ingestion token on the backend.');
    throw new Error(`Backend rejected the scan (HTTP ${response.status}). No success recorded; scan again after correcting the issue.`);
  }
  return response.json() as Promise<Record<string, unknown>>;
}
async function context() {
  const tab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  const url = tab?.url ?? '';
  const website = isWebsite(url) ? new URL(url).hostname : 'Unsupported page';
  const state = (await chrome.storage.local.get(`scan:${website}`))[`scan:${website}`] as ScanState | undefined;
  return { tab, website, state, supported: isWebsite(url) };
}
async function handle(message: { type?: string; token?: string; port?: number }) {
  await ready;
  if (message.type === 'SAVE_PAIRING') {
    if (typeof message.token !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(message.token) ||
      !Number.isInteger(message.port) || message.port! < 1024 || message.port! > 65535) throw new Error('Enter a 32–128 character ingestion token and valid port.');
    await chrome.storage.local.set({ pairing: { token: message.token, port: message.port } });
    await request('/health');
    return { ok: true, connection: 'Connected' };
  }
  const current = await context();
  if (message.type === 'GET_STATUS') {
    let connection: string;
    try { await request('/health'); connection = 'Connected'; } catch (error) { connection = (error as Error).message; }
    return { ok: true, website: current.website, supported: current.supported,
      count: current.state?.count ?? 0, lastSuccess: current.state?.lastSuccess ?? null,
      status: current.state?.status ?? 'not_scanned', detail: current.state?.detail ?? 'Open a listing and click Scan Now.', connection };
  }
  if (message.type !== 'SCAN') throw new Error('Unsupported action.');
  if (!current.supported || current.tab?.id === undefined) throw new Error('Open a supported website in the active tab.');
  let extraction: Extraction;
  try { extraction = await chrome.tabs.sendMessage(current.tab.id, { type: 'SCAN_PAGE' }) as Extraction; }
  catch { throw new Error('Content script unavailable. Manually refresh the page after loading or reloading the extension.'); }
  if (!extraction || typeof extraction.status !== 'string') throw new Error('Invalid extraction result.');
  const state: ScanState = { count: extraction.payload?.projects.length ?? 0, lastSuccess: current.state?.lastSuccess ?? null,
    status: extraction.status, detail: extraction.detail, connection: 'Not contacted for this scan' };
  if (extraction.status === 'ok' && extraction.payload) {
    try {
      const result = await request('/v1/ingest', extraction.payload);
      state.lastSuccess = String(result.acceptedAt);
      state.connection = 'Connected';
      state.detail = result.baseline ? 'Initial baseline saved. No notifications for this batch.' : `Accepted ${result.inserted} new project(s); repeats are ignored.`;
    } catch (error) { state.status = 'connection_error'; state.connection = (error as Error).message; state.detail = 'Extraction completed but ingestion was not confirmed. You can safely scan again.'; }
  }
  await chrome.storage.local.set({ [`scan:${current.website}`]: state });
  return { ok: true, website: current.website, supported: true, ...state };
}
// Only the extension popup can trigger a scan or access pairing settings. No external/page messaging.
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('popup.html')) return;
  void handle(message).then(reply, () => reply({ ok: false, error: 'Action failed. Check pairing, backend availability, and manually refresh the listing page.' }));
  return true;
});
