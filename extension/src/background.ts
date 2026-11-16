import type { Extraction } from './extractor.js';
import { listingPlatform } from '../../src/ingestion/identity.js';
import { DiagnosticError, diagnostic, httpFailure } from './diagnostics.js';
import { authenticationFromResult } from './authentication.js';
import type { AuthenticationObservation } from './authentication.js';
declare const __AUROX_BACKEND_URL__: string;
declare const __AUROX_DEV_DIAGNOSTICS__: boolean;
const backend = __AUROX_BACKEND_URL__;
function monitoringDetail(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const summary = value as Record<string, unknown>;
  if (!['afterBaseline', 'matching', 'keywordExcluded', 'platformExcluded', 'missingSearchMetadata'].every(key =>
    typeof summary[key] === 'number' && Number.isSafeInteger(summary[key]) && Number(summary[key]) >= 0) || typeof summary.alertsEnabled !== 'boolean') return '';
  const deliveries = Array.isArray(summary.deliveries) ? summary.deliveries.filter(row => row && ['sent', 'pending', 'sending', 'failed', 'unknown'].includes(row.state) && Number.isSafeInteger(row.count) && row.count >= 0)
    .map(row => `${row.state}=${row.count}`).join(', ') : '';
  return `Stored after baseline: ${summary.afterBaseline}. Matching current filters: ${summary.matching}; keyword excluded: ${summary.keywordExcluded}; platform excluded: ${summary.platformExcluded}. ` +
    `Telegram alerts: ${summary.alertsEnabled ? 'enabled' : 'paused or not subscribed'}. Deliveries: ${deliveries || 'none'}. ` +
    (summary.afterBaseline && !summary.matching ? 'No later projects match. Check /keywords in Telegram; /keywords all enables all projects on selected platforms. ' : '') +
    (summary.missingSearchMetadata ? `${summary.missingSearchMetadata} later project(s) lack descriptions and skills; keyword matching has limited source data.` : '');
}
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
const checkingAuth = new Set<string>();
const pendingAuth = new Map<string, Pick<chrome.tabs.Tab, 'id' | 'url'>>();
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
  await chrome.storage.local.remove(Object.keys(data).filter(k => k.startsWith('scan:') || k.startsWith('refresh:') || k.startsWith('blocked:') || k.startsWith('poll:') || k.startsWith('platform-auth:')));
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
  await chrome.storage.local.set({ accountSession: connected, scanEnabled: true });
  await chrome.storage.local.remove(['pendingLink', 'authenticationIssue']);
  for (const tab of await chrome.tabs.query({ url: ['https://www.peopleperhour.com/*', 'https://www.guru.com/*'] })) {
    if (tab.id !== undefined) void chrome.tabs.sendMessage(tab.id, { type: 'RESCAN' }).catch(() => {});
  }
  await syncAlarm();
  return connected;
}
async function verifyTabSession(tab: Pick<chrome.tabs.Tab, 'id' | 'url'>, force = false) {
  await ready;
  if (tab.id === undefined || !tab.url || !supportedHost(tab.url)) return;
  const current = await session(); if (!current) return;
  const platform = platformHost(tab.url);
  const authKey = 'platform-auth:' + current.localId + ':' + platform;
  if (checkingAuth.has(authKey)) { if (force) pendingAuth.set(authKey, tab); return; }
  checkingAuth.add(authKey);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      chrome.tabs.sendMessage(tab.id, { type: 'CHECK_AUTH', force }),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error()), 12000); })
    ]);
    const observation = result?.authentication;
    const authenticated = observation?.state === 'authenticated' && observation?.reason === 'api_authenticated';
    const rejected = observation?.state === 'expired/logged_out' && observation?.reason === 'api_rejected';
    if (!authenticated && !rejected) return;
    const latest = await session(); if (latest?.localId !== current.localId) return;
    const previous = (await chrome.storage.local.get(authKey))[authKey] as { state?: string; checkedAt?: string } | undefined;
    if (previous?.state === observation.state && Date.now() - Date.parse(previous?.checkedAt ?? '') < 30000) return;
    const status = authenticated ? 'authenticated' : 'login_required';
    // Await backend acknowledgement; a failed report is retried on the next check.
    await api('/v1/platform-access', 'POST', { platform, status }, current.token);
    await chrome.storage.local.set({ [authKey]: { state: observation.state, reason: observation.reason, checkedAt: new Date().toISOString() } });
    const blockedKey = 'blocked:' + current.localId + ':' + platform;
    if (authenticated) await chrome.storage.local.remove(blockedKey);
    else await chrome.storage.local.set({ [blockedKey]: 'login_required' });
  } catch { /* Network failures do not assert login/logout and never include credentials. */ }
  finally {
    if (timer) clearTimeout(timer); checkingAuth.delete(authKey);
    const pending = pendingAuth.get(authKey); pendingAuth.delete(authKey);
    if (pending) void verifyTabSession(pending, true);
  }
}
const platformHost = (value: string) => new URL(value).hostname === 'www.guru.com' ? 'Guru' as const : 'PeoplePerHour' as const;
async function submit(extraction: Extraction, tabId: number, platform?: 'PeoplePerHour' | 'Guru') {
  if (busy.has(tabId)) return { accepted: false, detail: 'Scan already in progress.' };
  busy.add(tabId);
  try {
    const current = await session();
    if ((await chrome.storage.local.get('scanEnabled')).scanEnabled === false) return { accepted: false, status: 'scanning_paused', detail: 'Scanning is stopped.' };
    const key = scanKey(current, tabId);
    const previous = (await chrome.storage.local.get(key))[key] as { lastSuccess?: string } | undefined;
    let state: ScanState = { count: extraction.payload?.projects.length ?? 0, lastSuccess: previous?.lastSuccess ?? null,
      lastAttempt: new Date().toISOString(), status: extraction.status, detail: extraction.detail, stage: 'extraction',
      contentScriptReached: true, ingestionAttempted: false, ...(extraction.diagnostics ? { diagnostics: extraction.diagnostics } : {}) };
    if (!current) { state = failedState(state, new DiagnosticError('authentication_required', 'authentication', 'Connect Telegram to enable alerts from this browser.')); await chrome.storage.local.set({ [key]: state }); return { accepted: false, ...state }; }
    if (platform) {
      const authKey = `platform-auth:${current.localId}:${platform}`;
      const prior = (await chrome.storage.local.get(authKey))[authKey] as AuthenticationObservation | undefined;
      // Project extraction and page navigation never override an API session verdict.
      const observation = { state: 'unknown', reason: 'unverified' } as const;
      if (!prior || prior.state === 'unknown') {
        await chrome.storage.local.set({ [authKey]: { ...observation,
          checkedAt: new Date().toISOString() } });
      }
      const blockedKey = `blocked:${current.localId}:${platform}`;
      if (extraction.status === 'ok' && (await chrome.storage.local.get(blockedKey))[blockedKey] === 'login_required') {
        state.status = 'login_required';
        state.detail = 'Account monitoring is paused after confirmed logout. Public or stale cards do not prove sign-in. Sign in normally. A successful API session check will automatically restore platform monitoring.';
        await chrome.storage.local.set({ [key]: state });
        return { accepted: false, ...state };
      }
    }
    if (platform && extraction.status === 'verification_required') {
      const blockedKey = `blocked:${current.localId}:${platform}`;
      const priorBlock = (await chrome.storage.local.get(blockedKey))[blockedKey];
      const accessStatus = priorBlock === 'login_required' ? 'login_required' : extraction.status;
      await chrome.storage.local.set({ [blockedKey]: accessStatus });
      try {
        await api('/v1/platform-access', 'POST', { platform, status: accessStatus }, current.token);
      } catch { state.detail += ' Status reporting failed; it will retry on the next cycle.'; }
    }
    if (extraction.status !== 'ok' || !extraction.payload) { await chrome.storage.local.set({ [key]: state }); return { accepted: false, ...state }; }
    try {
      if ((await chrome.storage.local.get('scanEnabled')).scanEnabled === false) return { accepted: false, status: 'scanning_paused', detail: 'Scanning is stopped.' };
      state.stage = 'ingestion'; state.ingestionAttempted = true;
      const result = await api('/v1/ingest', 'POST', extraction.payload, current.token);
      if (!result || typeof result.acceptedAt !== 'string' || !Number.isFinite(Date.parse(result.acceptedAt)) || typeof result.baseline !== 'boolean' || typeof result.inserted !== 'number') {
        throw new DiagnosticError('backend_response_invalid', 'ingestion', 'Backend did not return a valid ingestion acknowledgement. No successful scan was recorded.');
      }
      state.lastSuccess = String(result.acceptedAt);
      state.detail = result.baseline ? 'Initial scan saved. Only projects verified as published after connecting can send alerts.' :
        result.inserted === 0 ? 'No unseen project IDs in this scan. Existing projects were checked for updated metadata.' :
          `Saved ${result.inserted} unseen project(s). Telegram delivery depends on your subscription and filters.`;
      state.detail += ' ' + monitoringDetail(result.monitoring);
      state.status = 'accepted';
      if (platform) await chrome.storage.local.remove(`blocked:${current.localId}:${platform}`);
      await chrome.storage.local.set({ [key]: state });
      return { accepted: true, ...state };
    } catch (error) {
      state = failedState(state, error);
      await chrome.storage.local.set({ [key]: state }); return { accepted: false, ...state };
    }
  } finally { busy.delete(tabId); }
}
async function scanTab(tab: Pick<chrome.tabs.Tab, 'id' | 'url'>, poll = false) {
    if (tab?.id === undefined || !tab.url || !supportedHost(tab.url)) throw new DiagnosticError('unsupported_page', 'content_script', 'Open a supported website in the active tab.');
    await verifyTabSession(tab);
    const current = await session();
    const key = scanKey(current, tab.id);
    const previous = (await chrome.storage.local.get(key))[key] as ScanState | undefined;
    const attempt: ScanState = { count: 0, lastSuccess: previous?.lastSuccess ?? null, lastAttempt: new Date().toISOString(),
      status: 'scanning', stage: 'content_script', detail: poll ? 'Requesting background listing HTML.' : 'Reading loaded listing DOM.', contentScriptReached: false, ingestionAttempted: false };
    await chrome.storage.local.set({ [key]: attempt });
    let extraction: Extraction;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      extraction = await Promise.race([
        chrome.tabs.sendMessage(tab.id, { type: poll ? 'POLL_PAGE' : 'SCAN_PAGE' }) as Promise<Extraction>,
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error()), 15000); }),
      ]);
      if (!extraction || typeof extraction.status !== 'string' || typeof extraction.detail !== 'string') throw new Error();
    } catch {
      const failure = new DiagnosticError('content_script_unavailable', 'content_script', 'No response from the page content script. After reloading the extension, manually refresh this listing tab once, wait for it to load, and click Scan Now again. If it persists, check that extension site access is allowed for this website.');
      await chrome.storage.local.set({ [key]: failedState(attempt, failure) });
      throw failure;
    } finally { if (timer) clearTimeout(timer); }
    return submit(extraction, tab.id, platformHost(tab.url));
}

const scanAlarm = 'aurox-loaded-listings';
let sweeping = false;
async function syncAlarm() {
  if (!chrome.alarms) return;
  await ready;
  const data = await chrome.storage.local.get(['scanEnabled', 'accountSession', 'pendingLink']);
  if (data.pendingLink || data.accountSession) {
    if (!await chrome.alarms.get(scanAlarm)) {
      await chrome.alarms.create(scanAlarm, { periodInMinutes: 0.5 });
    }
  } else await chrome.alarms.clear(scanAlarm);
}
async function scanLoadedTabs(pollDue = false) {
  if (sweeping) return;
  sweeping = true;
  try {
    await ready;
    const current = await session(); // Completes approved pairing even when the popup is closed.
    if (!current) { await syncAlarm(); return; }
    for (const tab of await chrome.tabs.query({ url: ['https://www.peopleperhour.com/*', 'https://www.guru.com/*'] })) {

      if (tab.discarded || tab.status === 'loading' || !tab.url || !supportedHost(tab.url)) continue;
      try {
        await verifyTabSession(tab);
        if ((await chrome.storage.local.get('scanEnabled')).scanEnabled === false) continue;
        const platform = platformHost(tab.url);
        const blockedKey = `blocked:${current.localId}:${platform}`;
        const blocked = (await chrome.storage.local.get(blockedKey))[blockedKey];
        if (pollDue && blocked) { await api('/v1/platform-access', 'POST', { platform, status: blocked }, current.token); continue; }
        const poll = pollDue && Boolean(listingPlatform(tab.url));
        const key = `poll:${current.localId}:${platform}`;
        const last = Number((await chrome.storage.local.get(key))[key] ?? 0);
        if (poll && Date.now() - last < 30000) continue;
        if (poll) await chrome.storage.local.set({ [key]: Date.now() });
        await scanTab(tab, poll);
      } catch { /* A closed/restricted tab must not stop other tabs. */ }
    }
  } catch { /* Existing diagnostic paths report authentication/network errors without secrets. */ }
  finally { sweeping = false; }
}
// Navigation and completed login/logout calls invalidate the 30-second probe
// cache. They trigger verification; neither URL nor HTTP 200 determines state.
chrome.tabs.onUpdated?.addListener((_id, change, tab) => {
  if (change.status === 'complete' && tab.url && supportedHost(tab.url)) void verifyTabSession(tab, true);
});
chrome.webRequest?.onCompleted.addListener(details => {
  if (details.tabId < 0) return;
  let url: URL; try { url = new URL(details.url); } catch { return; }
  if (!supportedHost(url.href) || !/\/(?:login|logout|signin|signout)(?:\.aspx)?\/?$/i.test(url.pathname)) return;
  void chrome.tabs.get(details.tabId).then(tab => verifyTabSession(tab, true)).catch(() => {});
}, { urls: ['https://www.peopleperhour.com/*', 'https://www.guru.com/*'], types: ['xmlhttprequest'] });
chrome.alarms?.onAlarm.addListener(alarm => { if (alarm.name === scanAlarm) void scanLoadedTabs(true); });
void syncAlarm().catch(() => {});

async function handle(message: { type?: string; extraction?: Extraction }, sender: chrome.runtime.MessageSender) {
  await ready;
  if (message.type === 'GET_SCAN_STATE') {
    const data = await chrome.storage.local.get(['scanEnabled', 'accountSession']);
    const current = data.accountSession as Session | undefined;
    return { enabled: Boolean(current && current.expiresAt > Date.now() && data.scanEnabled !== false) };
  }
  if (message.type === 'TOGGLE_SCAN') {
    const data = await chrome.storage.local.get(['scanEnabled', 'accountSession']);
    if (!data.accountSession) throw new DiagnosticError('authentication_required', 'authentication', 'Connect Telegram before starting scans.');
    const enabled = data.scanEnabled === false;
    await chrome.storage.local.set({ scanEnabled: enabled });
    if (enabled) {
      const stored = await chrome.storage.local.get(null);
      await chrome.storage.local.remove(Object.keys(stored).filter(key => key.startsWith('poll:')));
      // Continue scan never clears a confirmed logout; only a server check can.
    }
    for (const tab of await chrome.tabs.query({ url: ['https://www.peopleperhour.com/*', 'https://www.guru.com/*'] })) {
      if (tab.id !== undefined) void chrome.tabs.sendMessage(tab.id, { type: 'SCAN_STATE_CHANGED', enabled }).catch(() => {});
    }
    await syncAlarm();
    if (enabled) void scanLoadedTabs();
    return { scanningEnabled: enabled };
  }
  if (message.type === 'DEV_STRUCTURE') {
    if (!__AUROX_DEV_DIAGNOSTICS__) throw new DiagnosticError('developer_diagnostics_disabled', 'extension', 'Developer structure diagnostics are disabled in this build.');
    const tab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    if (tab?.id === undefined || !tab.url || listingPlatform(tab.url) !== 'PeoplePerHour') throw new DiagnosticError('unsupported_page', 'content_script', 'Open the PeoplePerHour listing page.');
    try { return { structure: await chrome.tabs.sendMessage(tab.id, { type: 'STRUCTURE_PAGE' }) }; }
    catch { throw new DiagnosticError('content_script_unavailable', 'content_script', 'Refresh the listing tab after loading the developer build.'); }
  }
  if (message.type === 'AUTO_SCAN') {
    if (sender.frameId !== 0 || sender.tab?.id === undefined || !sender.url || !supportedHost(sender.url) ||
      message.extraction?.payload && listingPlatform(message.extraction.payload.pageUrl) !== listingPlatform(sender.url)) throw new Error('Invalid page sender.');
    if (!message.extraction) throw new Error('Missing extraction.');
    await verifyTabSession(sender.tab);
    return submit(message.extraction, sender.tab.id, platformHost(sender.url));
  }
  if (message.type === 'CONNECT') {
    if ((await chrome.storage.local.get('accountSession')).accountSession) throw new Error('Disconnect the current account before connecting another.');
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const pollSecret = Array.from(bytes, x => x.toString(16).padStart(2, '0')).join('');
    const result = await api('/v1/pairings', 'POST', { pollSecret });
    const telegramUrl = new URL(String(result.telegramUrl));
    if (telegramUrl.origin !== 'https://t.me') throw new Error('Invalid Telegram link.');
    await chrome.storage.local.set({ pendingLink: { pairingId: result.pairingId, confirmationCode: result.confirmationCode, expiresAt: result.expiresAt, pollSecret } });
    await syncAlarm();
    await chrome.tabs.create({ url: telegramUrl.href, active: false });
    return { confirmationCode: result.confirmationCode };
  }
  if (message.type === 'DISCONNECT') {
    const current = (await chrome.storage.local.get('accountSession')).accountSession as Session | undefined;
    try { if (current) await api('/v1/session', 'DELETE', undefined, current.token); }
    finally { await chrome.storage.local.remove(['accountSession', 'pendingLink', 'authenticationIssue']); await clearScans(); await syncAlarm(); }
    return { disconnected: true };
  }
  if (message.type === 'SCAN') {
    if ((await chrome.storage.local.get('scanEnabled')).scanEnabled === false) throw new DiagnosticError('scanning_paused', 'extension', 'Scanning is stopped. Click Continue scan to resume.');
    const tab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    if (!tab) throw new DiagnosticError('unsupported_page', 'content_script', 'Open a supported listing tab.');
    return scanTab(tab);
  }
  if (message.type === 'GET_STATUS') {
    let current: Session | undefined;
    let connectionFailure: DiagnosticError | undefined;
    try { current = await session(); } catch (error) { connectionFailure = diagnostic(error); }
    const scope = current;
    let connection = 'Not connected';
    let currentMonitoring = '';
    if (current) {
      try {
        const result = await api('/v1/session', 'GET', undefined, current.token);
        if (!result || result.connected !== true) throw new DiagnosticError('backend_response_invalid', 'authentication', 'Backend did not confirm the session. Check the server address and routing.');
        connection = 'Connected to your Telegram account';
        currentMonitoring = monitoringDetail(result.monitoring);
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
    const platformAuthentication: Record<string, unknown> = {};
    for (const platform of ['PeoplePerHour', 'Guru']) {
      const authKey = `platform-auth:${scope?.localId ?? 'unconnected'}:${platform}`;
      platformAuthentication[platform] = (await chrome.storage.local.get(authKey))[authKey] ?? authenticationFromResult('unknown');
    }
    return { website, supported: Boolean(tab?.url && supportedHost(tab.url)),
      monitoringDetail: currentMonitoring,
      platformAuthentication,
      confirmationCode: pending && pending.expiresAt > Date.now() ? pending.confirmationCode : null,
      count: 0, lastSuccess: null, lastAttempt: null, status: 'not_scanned', stage: 'idle', detail: 'Scan Now or watch for visible card changes.',
      ...data[key] as object,
      ...(connectionFailure?.code === 'authentication_expired' ? { status: connectionFailure.code, stage: connectionFailure.stage, detail: connectionFailure.message } : {}),
      connected: Boolean(current), scanningEnabled: Boolean(current && (await chrome.storage.local.get('scanEnabled')).scanEnabled !== false), refreshEnabled: false, pollingIntervalSeconds: 30, developerDiagnostics: __AUROX_DEV_DIAGNOSTICS__, connection, connectionStatus: connectionFailure?.code ?? (current ? 'connected' : 'not_connected'),
      connectionCheckedAt: new Date().toISOString() };
  }
  throw new Error('Unknown action.');
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id) return;
  const popup = sender.url === chrome.runtime.getURL('popup.html');
  if (!popup && !['AUTO_SCAN', 'GET_SCAN_STATE'].includes(message?.type)) return;
  if (!popup && (sender.frameId !== 0 || !sender.url || !supportedHost(sender.url))) return;
  if (popup && message?.type === 'AUTO_SCAN') return;
  void handle(message, sender).then(value => reply({ ok: true, ...value }), error => {
    const failure = diagnostic(error);
    reply({ ok: false, error: failure.message, errorCode: failure.code, stage: failure.stage });
  });
  return true;
});
