import type { Extraction } from './extractor.js';
import { listingPlatform } from '../../src/ingestion/identity.js';
import { DiagnosticError, diagnostic, httpFailure } from './diagnostics.js';
declare const __AUROX_BACKEND_URL__: string;
const backend = __AUROX_BACKEND_URL__;
interface Session { token: string; expiresAt: number; localId: string }
interface Pending { pairingId: string; pollSecret: string; confirmationCode: string; expiresAt: number }
interface ScanState {
  count: number; lastSuccess: string | null; lastAttempt: string; status: string; detail: string; stage: string;
  contentScriptReached: boolean; ingestionAttempted: boolean; diagnostics?: Extraction['diagnostics']; httpStatus?: number;
}
const scanKey = (current: Session | undefined, tabId: number) => `scan:${current?.localId ?? 'unconnected'}:${tabId}`;
function failedState(state: ScanState, error: unknown): ScanState {
  const failure = diagnostic(error);
  return { ...state, status: failure.code, stage: failure.stage, detail: failure.message,
    ...(failure.httpStatus === undefined ? {} : { httpStatus: failure.httpStatus }) };
}
const ready = chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).then(() => chrome.storage.local.remove('pairing'));
const busy = new Set<number>();
const supportedHost = (value: string) => {
  try { const url = new URL(value); return url.protocol === 'https:' && ['www.peopleperhour.com', 'www.guru.com'].includes(url.hostname); } catch { return false; }
};
async function api(path: string, method = 'GET', body?: unknown, token?: string): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(backend + path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(10000) });
  } catch { throw new DiagnosticError('backend_unavailable', 'network', 'Backend unavailable or request timed out. Check the running service and connection; do not reconnect Telegram just for this error.'); }
  if (!response.ok) {
    if (response.status === 401) { await chrome.storage.local.remove('accountSession'); await chrome.storage.local.set({ authenticationIssue: 'authentication_expired' }); }
    if (response.status === 410) await chrome.storage.local.remove('pendingLink');
    throw httpFailure(response.status, path === '/v1/ingest');
  }
  try { return await response.json() as Record<string, unknown>; }
  catch { throw new DiagnosticError('backend_response_invalid', 'ingestion', 'Backend returned an unreadable response. Ingestion was not confirmed; retrying the scan is safe.'); }
}
async function clearScans() {
  const data = await chrome.storage.local.get(null);
  await chrome.storage.local.remove(Object.keys(data).filter(k => k.startsWith('scan:')));
}
async function session(): Promise<Session | undefined> {
  const data = await chrome.storage.local.get(['accountSession', 'pendingLink']);
  const current = data.accountSession as Session | undefined;
  if (current && current.expiresAt > Date.now()) return current;
  if (current) { await chrome.storage.local.remove('accountSession'); await chrome.storage.local.set({ authenticationIssue: 'authentication_expired' }); }
  const pending = data.pendingLink as Pending | undefined;
  if (!pending) return undefined;
  if (pending.expiresAt <= Date.now()) { await chrome.storage.local.remove('pendingLink'); return undefined; }
  const result = await api('/v1/pairings/claim', 'POST', { pairingId: pending.pairingId, pollSecret: pending.pollSecret });
  if (result.status !== 'connected') return undefined;
  const connected = { token: String(result.sessionToken), expiresAt: Number(result.expiresAt), localId: crypto.randomUUID() };
  await clearScans();
  await chrome.storage.local.set({ accountSession: connected });
  await chrome.storage.local.remove(['pendingLink', 'authenticationIssue']);
  for (const tab of await chrome.tabs.query({ url: ['https://www.peopleperhour.com/*', 'https://www.guru.com/*'] })) {
    if (tab.id !== undefined) void chrome.tabs.sendMessage(tab.id, { type: 'RESCAN' }).catch(() => {});
  }
  return connected;
}
async function submit(extraction: Extraction, tabId: number) {
  if (busy.has(tabId)) return { accepted: false, detail: 'Scan already in progress.' };
  busy.add(tabId);
  try {
    const current = await session();
    const key = scanKey(current, tabId);
    const previous = (await chrome.storage.local.get(key))[key] as { lastSuccess?: string } | undefined;
    let state: ScanState = { count: extraction.payload?.projects.length ?? 0, lastSuccess: previous?.lastSuccess ?? null,
      lastAttempt: new Date().toISOString(), status: extraction.status, detail: extraction.detail, stage: 'extraction',
      contentScriptReached: true, ingestionAttempted: false, ...(extraction.diagnostics ? { diagnostics: extraction.diagnostics } : {}) };
    if (!current) { state = failedState(state, new DiagnosticError('authentication_required', 'authentication', 'Connect Telegram to enable alerts from this browser.')); await chrome.storage.local.set({ [key]: state }); return { accepted: false, ...state }; }
    if (extraction.status !== 'ok' || !extraction.payload) { await chrome.storage.local.set({ [key]: state }); return { accepted: false, ...state }; }
    try {
      state.stage = 'ingestion'; state.ingestionAttempted = true;
      const result = await api('/v1/ingest', 'POST', extraction.payload, current.token);
      if (!result || typeof result.acceptedAt !== 'string' || !Number.isFinite(Date.parse(result.acceptedAt)) || typeof result.baseline !== 'boolean' || typeof result.inserted !== 'number') {
        throw new DiagnosticError('backend_response_invalid', 'ingestion', 'Backend did not return a valid ingestion acknowledgement. No successful scan was recorded.');
      }
      state.lastSuccess = String(result.acceptedAt);
      state.detail = result.baseline ? 'Your initial baseline was saved silently.' : `Accepted ${result.inserted} new project(s) for your Telegram account.`;
      state.status = 'accepted';
      await chrome.storage.local.set({ [key]: state });
      return { accepted: true, ...state };
    } catch (error) {
      state = failedState(state, error);
      await chrome.storage.local.set({ [key]: state }); return { accepted: false, ...state };
    }
  } finally { busy.delete(tabId); }
}
async function handle(message: { type?: string; extraction?: Extraction }, sender: chrome.runtime.MessageSender) {
  await ready;
  if (message.type === 'AUTO_SCAN') {
    if (sender.frameId !== 0 || sender.tab?.id === undefined || !sender.url || !supportedHost(sender.url) ||
      message.extraction?.payload && listingPlatform(message.extraction.payload.pageUrl) !== listingPlatform(sender.url)) throw new Error('Invalid page sender.');
    if (!message.extraction) throw new Error('Missing extraction.');
    return submit(message.extraction, sender.tab.id);
  }
  if (message.type === 'CONNECT') {
    if ((await chrome.storage.local.get('accountSession')).accountSession) throw new Error('Disconnect the current account before connecting another.');
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const pollSecret = Array.from(bytes, x => x.toString(16).padStart(2, '0')).join('');
    const result = await api('/v1/pairings', 'POST', { pollSecret });
    const telegramUrl = new URL(String(result.telegramUrl));
    if (telegramUrl.origin !== 'https://t.me') throw new Error('Invalid Telegram link.');
    await chrome.storage.local.set({ pendingLink: { pairingId: result.pairingId, confirmationCode: result.confirmationCode, expiresAt: result.expiresAt, pollSecret } });
    await chrome.tabs.create({ url: telegramUrl.href, active: false });
    return { confirmationCode: result.confirmationCode };
  }
  if (message.type === 'DISCONNECT') {
    const current = (await chrome.storage.local.get('accountSession')).accountSession as Session | undefined;
    try { if (current) await api('/v1/session', 'DELETE', undefined, current.token); }
    finally { await chrome.storage.local.remove(['accountSession', 'pendingLink', 'authenticationIssue']); await clearScans(); }
    return { disconnected: true };
  }
  if (message.type === 'SCAN') {
    const tab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    if (tab?.id === undefined || !tab.url || !supportedHost(tab.url)) throw new DiagnosticError('unsupported_page', 'content_script', 'Open a supported website in the active tab.');
    const current = await session();
    const key = scanKey(current, tab.id);
    const previous = (await chrome.storage.local.get(key))[key] as ScanState | undefined;
    const attempt: ScanState = { count: 0, lastSuccess: previous?.lastSuccess ?? null, lastAttempt: new Date().toISOString(),
      status: 'scanning', stage: 'content_script', detail: 'Sending SCAN_PAGE to the active tab.', contentScriptReached: false, ingestionAttempted: false };
    await chrome.storage.local.set({ [key]: attempt });
    let extraction: Extraction;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      extraction = await Promise.race([
        chrome.tabs.sendMessage(tab.id, { type: 'SCAN_PAGE' }) as Promise<Extraction>,
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error()), 15000); }),
      ]);
      if (!extraction || typeof extraction.status !== 'string' || typeof extraction.detail !== 'string') throw new Error();
    } catch {
      const failure = new DiagnosticError('content_script_unavailable', 'content_script', 'No response from the page content script. After reloading the extension, manually refresh this listing tab once, wait for it to load, and click Scan Now again. If it persists, check that extension site access is allowed for this website.');
      await chrome.storage.local.set({ [key]: failedState(attempt, failure) });
      throw failure;
    } finally { if (timer) clearTimeout(timer); }
    return submit(extraction, tab.id);
  }
  if (message.type === 'GET_STATUS') {
    let current: Session | undefined;
    let connectionFailure: DiagnosticError | undefined;
    try { current = await session(); } catch (error) { connectionFailure = diagnostic(error); }
    const scope = current;
    let connection = 'Not connected';
    if (current) {
      try {
        const result = await api('/v1/session', 'GET', undefined, current.token);
        if (!result || result.connected !== true) throw new DiagnosticError('backend_response_invalid', 'authentication', 'Backend did not confirm the session. Check the server address and routing.');
        connection = 'Connected to your Telegram account';
      }
      catch (error) { connectionFailure = diagnostic(error); if (connectionFailure.code === 'authentication_expired') current = undefined; }
    }
    if (!current && !connectionFailure && (await chrome.storage.local.get('authenticationIssue')).authenticationIssue) connectionFailure = httpFailure(401, false);
    if (connectionFailure) connection = connectionFailure.message;
    const tab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    const key = scanKey(scope, tab?.id ?? -1);
    const data = await chrome.storage.local.get([key, 'pendingLink']);
    const pending = data.pendingLink as Pending | undefined;
    let website = 'Unsupported page';
    try { website = new URL(tab?.url ?? '').hostname; } catch {}
    return { website, supported: Boolean(tab?.url && supportedHost(tab.url)),
      confirmationCode: pending && pending.expiresAt > Date.now() ? pending.confirmationCode : null,
      count: 0, lastSuccess: null, lastAttempt: null, status: 'not_scanned', stage: 'idle', detail: 'Scan Now or watch for visible card changes.',
      ...data[key] as object,
      ...(connectionFailure?.code === 'authentication_expired' ? { status: connectionFailure.code, stage: connectionFailure.stage, detail: connectionFailure.message } : {}),
      connected: Boolean(current), connection, connectionStatus: connectionFailure?.code ?? (current ? 'connected' : 'not_connected'),
      connectionCheckedAt: new Date().toISOString() };
  }
  throw new Error('Unknown action.');
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id) return;
  const popup = sender.url === chrome.runtime.getURL('popup.html');
  if (!popup && message?.type !== 'AUTO_SCAN') return;
  if (popup && message?.type === 'AUTO_SCAN') return;
  void handle(message, sender).then(value => reply({ ok: true, ...value }), error => {
    const failure = diagnostic(error);
    reply({ ok: false, error: failure.message, errorCode: failure.code, stage: failure.stage });
  });
  return true;
});
