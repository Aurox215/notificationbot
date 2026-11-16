import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { checkSession } from '../extension/src/session-check.js';
import { Store } from '../src/persistence/store.js';
import { Monitor } from '../src/monitoring/monitor.js';

interface Reply { ok: boolean; status?: string; errorCode?: string; error?: string; stage?: string; count?: number; contentScriptReached?: boolean; ingestionAttempted?: boolean; connectionStatus?: string; connection?: string; lastSuccess?: string }
const extraction = { status: 'ok', detail: 'Extracted.', diagnostics: { linksChecked: 2, visibleProjectLinks: 1, matchedCards: 1, extractedProjects: 1 },
  payload: { platform: 'PeoplePerHour', pageUrl: 'https://www.peopleperhour.com/freelance-jobs', projects: [{ sourceId: '1', title: 'Python API', url: 'https://www.peopleperhour.com/freelance-jobs/python-1' }] } };

function worker(options: { missing?: boolean; extraction?: unknown; ingestStatus?: number; networkDown?: boolean; authStatus?: number; backendInvalid?: boolean; discarded?: boolean; pending?: boolean; monitoring?: unknown; platformAuth?: unknown; onAccess?: (status: 'authenticated' | 'login_required') => void } = {}) {
  const storage: Record<string, unknown> = { accountSession: { token: 'synthetic-test-secret', localId: 'scope1', expiresAt: Date.now() + 1000000 } };
  let listener!: (message: unknown, sender: unknown, reply: (value: Reply) => void) => boolean;
  const pageMessages: unknown[] = [];
  const requests: { path: string; method: string }[] = [];
  let alarmListener!: (alarm: { name: string }) => void;
  let alarmCreated = false;
  let tabUpdated: ((id: number, change: { status: string }, tab: unknown) => void) | undefined;
  let requestCompleted: ((details: { tabId: number; url: string }) => void) | undefined;
  const authRequests: { force?: boolean }[] = [];
  const reloaded: number[] = [];
  const tab = { id: 7, active: false, url: 'https://www.peopleperhour.com/freelance-jobs', discarded: options.discarded ?? false };
  if (options.pending) { delete storage.accountSession; storage.pendingLink = { pairingId: 'synthetic', pollSecret: 'synthetic', expiresAt: Date.now() + 100000 }; }
  const fakeChrome = {
    alarms: { get: async () => alarmCreated ? {} : undefined, create: async () => { alarmCreated = true; }, clear: async () => { alarmCreated = false; return true; }, onAlarm: { addListener: (fn: typeof alarmListener) => { alarmListener = fn; } } },
    storage: { local: {
      setAccessLevel: async () => {},
      get: async (keys: string | string[] | null) => Object.fromEntries((keys === null ? Object.keys(storage) : typeof keys === 'string' ? [keys] : keys).filter(k => k in storage).map(k => [k, storage[k]])),
      set: async (data: Record<string, unknown>) => { Object.assign(storage, data); },
      remove: async (keys: string | string[]) => { for (const key of typeof keys === 'string' ? [keys] : keys) delete storage[key]; },
    } },
    webRequest: { onCompleted: { addListener: (fn: typeof requestCompleted) => { requestCompleted = fn; } } },
    tabs: { onUpdated: { addListener: (fn: typeof tabUpdated) => { tabUpdated = fn; } }, query: async () => [tab], get: async () => tab, reload: async (id: number) => { reloaded.push(id); },
      sendMessage: async (_id: number, message: unknown) => {
        if ((message as { type: string }).type === 'CHECK_AUTH') {
          authRequests.push(message as { force?: boolean });
          return { authentication: typeof options.platformAuth === 'function' ? await options.platformAuth() : options.platformAuth ?? { state: 'unknown', reason: 'unverified' } };
        }
        pageMessages.push(message);
        if (options.missing) throw new Error('Receiving end does not exist. Do not leak synthetic-test-secret');
        return options.extraction ?? extraction;
      } },
    runtime: { id: 'self', getURL: (path: string) => 'chrome-extension://self/' + path,
      onMessage: { addListener: (fn: typeof listener) => { listener = fn; } } },
  };
  runInNewContext(readFileSync('extension/dist/background.js', 'utf8'), {
    chrome: fakeChrome, crypto: globalThis.crypto, URL, AbortSignal, setTimeout, clearTimeout,
    fetch: async (url: string, init: { method: string; body?: string }) => {
      const path = new URL(url).pathname; requests.push({ path, method: init.method });
      if (options.networkDown) throw new Error('Do not expose synthetic-test-secret or upstream URL');
      if (path === '/v1/platform-access' && init.body) options.onAccess?.(JSON.parse(init.body).status);
      if (path === '/v1/session') return Response.json({ connected: true, monitoring: options.monitoring }, { status: options.authStatus ?? 200 });
      if (path === '/v1/pairings/claim') return Response.json({ status: 'connected', sessionToken: 'synthetic-token', expiresAt: Date.now() + 100000 });
      const status = options.ingestStatus ?? 200;
      if (options.backendInvalid) return new Response('not JSON', { status: 200 });
      return Response.json(status === 200 ? { baseline: !options.monitoring, inserted: options.monitoring ? 0 : 1, monitoring: options.monitoring, acceptedAt: '2026-11-14T00:00:00.000Z' } : { error: 'synthetic-test-secret' }, { status });
    },
  });
  const send = (type: string) => new Promise<Reply>((resolve, reject) => {
    const accepted = listener({ type }, { id: 'self', url: 'chrome-extension://self/popup.html' }, resolve);
    if (!accepted) reject(new Error('Listener refused popup request'));
  });
  const tick = async () => { alarmListener({ name: 'aurox-loaded-listings' }); for (let i = 0; i < 4; i++) await new Promise<void>(resolve => setImmediate(resolve)); };
  const flush = async () => { for (let i = 0; i < 12; i++) await new Promise<void>(resolve => setImmediate(resolve)); };
  return { send, storage, pageMessages, requests, tick, reloaded, authRequests,
    navigation: async () => { tabUpdated?.(tab.id, { status: 'complete' }, tab); await flush(); },
    nativeRequest: async (url: string) => { requestCompleted?.({ tabId: tab.id, url }); await flush(); } };
}

test('paired backend can be healthy while Scan Now fails to reach a stale/missing content script', async () => {
  const w = worker({ missing: true });
  assert.equal((await w.send('GET_STATUS')).connectionStatus, 'connected');
  const scan = await w.send('SCAN');
  assert.equal(scan.ok, false);
  assert.equal(scan.errorCode, 'content_script_unavailable');
  assert.match(scan.error!, /manually refresh/);
  assert.ok(!scan.error!.includes('synthetic-test-secret'));
  assert.equal(w.pageMessages.length, 1);
  assert.equal((w.pageMessages[0] as { type: string }).type, 'SCAN_PAGE');
  assert.equal(w.requests.filter(r => r.path === '/v1/ingest').length, 0);
  const current = await w.send('GET_STATUS');
  assert.equal(current.connectionStatus, 'connected');
  assert.equal(current.status, 'content_script_unavailable');
  assert.equal(current.contentScriptReached, false);
});

test('zero-project extraction is not a connection failure and never calls ingestion', async () => {
  const w = worker({ extraction: { status: 'no_projects', detail: 'Zero supported visible project links found.' } });
  const result = await w.send('SCAN');
  assert.equal(result.status, 'no_projects');
  assert.equal(result.stage, 'extraction');
  assert.equal(result.contentScriptReached, true);
  assert.equal(result.ingestionAttempted, false);
  assert.equal(result.count, 0);
  assert.equal(w.requests.length, 0);
});

test('successful Scan Now reaches the content script and ingestion, then records acceptance', async () => {
  const w = worker();
  const result = await w.send('SCAN');
  assert.equal(result.status, 'accepted');
  assert.equal(result.contentScriptReached, true);
  assert.equal(result.ingestionAttempted, true);
  assert.equal(result.count, 1);
  assert.equal(result.lastSuccess, '2026-11-14T00:00:00.000Z');
  assert.deepEqual(w.requests, [{ path: '/v1/ingest', method: 'POST' }]);
});

test('accepted duplicate scans distinguish filter exclusion from delivery and fresh status reports it', async () => {
  const w = worker({ monitoring: { afterBaseline: 16, matching: 0, keywordExcluded: 16, platformExcluded: 0, missingSearchMetadata: 16, alertsEnabled: true, deliveries: [] } });
  const scan = await w.send('SCAN') as Reply & { detail: string };
  assert.equal(scan.status, 'accepted');
  assert.match(scan.detail, /No unseen project IDs/);
  assert.match(scan.detail, /keyword excluded: 16/);
  assert.match(scan.detail, /Deliveries: none/);
  assert.match(scan.detail, /\/keywords all/);
  const status = await w.send('GET_STATUS') as Reply & { monitoringDetail: string };
  assert.match(status.monitoringDetail, /Matching current filters: 0/);
});

test('network, rejected data, server failures and forbidden requests retain distinct scan diagnostics', async () => {
  for (const [options, code, stage] of [
    [{ networkDown: true }, 'backend_unavailable', 'network'],
    [{ ingestStatus: 400 }, 'scan_rejected', 'validation'],
    [{ ingestStatus: 413 }, 'scan_rejected', 'validation'],
    [{ ingestStatus: 500 }, 'ingestion_failed', 'ingestion'],
    [{ ingestStatus: 403 }, 'request_forbidden', 'authorization'],
    [{ backendInvalid: true }, 'backend_response_invalid', 'ingestion'],
  ] as const) {
    const w = worker(options);
    const result = await w.send('SCAN');
    assert.equal(result.status, code);
    assert.equal(result.stage, stage);
    assert.equal(result.count, 1); // Extraction succeeded; this must never be labeled zero projects.
    assert.equal(result.ingestionAttempted, true);
    assert.equal(result.lastSuccess, null);
    assert.ok(!JSON.stringify(result).includes('synthetic-test-secret'));
    const status = await w.send('GET_STATUS');
    assert.equal(status.connectionStatus, options.networkDown ? 'backend_unavailable' : 'connected');
    assert.equal(status.status, code);
  }
});

test('authentication expiration is distinguished from networking and removes the invalid session', async () => {
  const w = worker({ ingestStatus: 401 });
  const result = await w.send('SCAN');
  assert.equal(result.status, 'authentication_expired');
  assert.equal(w.storage.accountSession, undefined);
  assert.equal((await w.send('GET_STATUS')).connectionStatus, 'authentication_expired');
});

test('content-script extraction exceptions have their own status and no backend request', async () => {
  const w = worker({ extraction: { status: 'extraction_failed', detail: 'Content script received scan but failed to read the page.' } });
  const result = await w.send('SCAN');
  assert.equal(result.status, 'extraction_failed');
  assert.equal(result.contentScriptReached, true);
  assert.equal(w.requests.length, 0);
});

test('structure diagnostics are disabled in the normal release build and make no page or backend request', async () => {
  const w = worker();
  const result = await w.send('DEV_STRUCTURE');
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'developer_diagnostics_disabled');
  assert.equal(w.pageMessages.length, 0);
  assert.equal(w.requests.length, 0);
});

test('alarm polls inactive listing tabs at a 30-second floor without reloading', async () => {
  const w = worker();
  await w.tick();
  assert.equal(w.requests.filter(r => r.path === '/v1/ingest').length, 1);
  assert.equal(w.reloaded.length, 0);
  assert.equal((w.pageMessages[0] as { type: string }).type, 'POLL_PAGE');
  w.storage['poll:scope1:PeoplePerHour'] = Date.now() - 31000;
  await w.tick();
  assert.equal(w.reloaded.length, 0);
  const count = w.pageMessages.length;
  await w.tick();
  assert.equal(w.pageMessages.length, count);
});

test('Stop scan persists and prevents alarm scans, submissions, and refresh; Continue resumes', async () => {
  const w = worker();
  const stopped = await w.send('TOGGLE_SCAN') as Reply & { scanningEnabled: boolean };
  assert.equal(stopped.scanningEnabled, false);
  assert.equal(w.storage.scanEnabled, false);
  w.storage['refresh:scope1:7'] = Date.now() - 31000;
  await w.tick();
  assert.equal(w.requests.length, 0);
  assert.equal(w.reloaded.length, 0);
  assert.equal((await w.send('SCAN')).errorCode, 'scanning_paused');
  await w.send('TOGGLE_SCAN');
  for (let i = 0; i < 4; i++) await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(w.storage.scanEnabled, true);
  assert.ok(w.requests.some(r => r.path === '/v1/ingest'));
});

test('alarm does not reload challenges, login/unknown layouts, or discarded tabs', async () => {
  for (const status of ['verification_required', 'login_required', 'no_projects']) {
    const w = worker({ extraction: { status, detail: 'Restricted or not ready.' } });
    w.storage['refresh:scope1:7'] = Date.now() - 31000;
    await w.tick();
    assert.equal(w.requests.filter(r => r.path === '/v1/ingest').length, 0);
    assert.equal(w.reloaded.length, 0);
  }
  const discarded = worker({ discarded: true });
  await discarded.tick();
  assert.equal(discarded.pageMessages.length, 0);
});

test('approved pairing completes and starts scanning via alarm without reopening the popup', async () => {
  const w = worker({ pending: true });
  await w.tick();
  assert.ok(w.storage.accountSession);
  assert.equal(w.storage.scanEnabled, true);
  assert.ok(w.requests.some(r => r.path === '/v1/pairings/claim'));
  assert.ok(w.requests.some(r => r.path === '/v1/ingest'));
});

test('confirmed logout pauses its platform and stale public DOM cannot clear it or ingest', async () => {
  const w = worker();
  w.storage['blocked:scope1:PeoplePerHour'] = 'login_required';
  w.storage['platform-auth:scope1:PeoplePerHour'] = { state: 'expired/logged_out', reason: 'authentication_rejected' };
  assert.equal((await w.send('SCAN')).status, 'login_required');
  assert.equal(w.requests.filter(r => r.path === '/v1/ingest').length, 0);
  assert.equal(w.storage['blocked:scope1:PeoplePerHour'], 'login_required');
  assert.equal((w.storage['platform-auth:scope1:PeoplePerHour'] as { state: string }).state, 'expired/logged_out');
  assert.equal(w.storage['platform-auth:scope1:Guru'], undefined);
});

test('public listing and network failure cannot assert an authenticated platform session', async () => {
  for (const status of ['ok', 'poll_failed', 'poll_unsupported', 'verification_required']) {
    const w = worker({ extraction: { ...extraction, status } });
    await w.send('SCAN');
    assert.equal((w.storage['platform-auth:scope1:PeoplePerHour'] as { state: string }).state, 'unknown');
  }
});

test('confirmed API rejection records no credentials and queues only the affected platform status', async () => {
  const w = worker({ platformAuth: { state: 'expired/logged_out', reason: 'api_rejected' }, extraction: { status: 'login_required', detail: 'HTTP 401' } });
  await w.send('SCAN');
  assert.equal(w.storage['blocked:scope1:PeoplePerHour'], 'login_required');
  assert.deepEqual(JSON.parse(JSON.stringify(w.storage['platform-auth:scope1:PeoplePerHour'])).state, 'expired/logged_out');
  assert.equal(w.requests.filter(r => r.path === '/v1/platform-access').length, 1);
  assert.equal(w.requests.filter(r => r.path === '/v1/ingest').length, 0);
  assert.ok(!JSON.stringify(w.storage['platform-auth:scope1:PeoplePerHour']).includes('synthetic-test-secret'));
});

test('a verified API recovery clears the logout block and collection resumes', async () => {
  const w = worker({ platformAuth: { state: 'authenticated', reason: 'api_authenticated' } });
  w.storage['blocked:scope1:PeoplePerHour'] = 'login_required';
  const result = await w.send('SCAN');
  assert.equal(result.status, 'accepted');
  assert.equal(w.storage['blocked:scope1:PeoplePerHour'], undefined);
  assert.equal((w.storage['platform-auth:scope1:PeoplePerHour'] as { state: string }).state, 'authenticated');
  assert.equal(w.requests.filter(r => r.path === '/v1/platform-access').length, 1);
});
test('opening a login page without API confirmation does not assert logout', async () => {
  const w = worker({ extraction: { status: 'login_required', detail: 'Login form' } });
  await w.send('SCAN');
  assert.equal(w.storage['blocked:scope1:PeoplePerHour'], undefined);
  assert.equal(w.requests.filter(r => r.path === '/v1/platform-access').length, 0);
});
test('authentication recovery checks continue while project scanning is stopped', async () => {
  const w = worker({ platformAuth: { state: 'authenticated', reason: 'api_authenticated' } });
  w.storage.scanEnabled = false;
  w.storage['blocked:scope1:PeoplePerHour'] = 'login_required';
  await w.tick();
  assert.equal(w.storage['blocked:scope1:PeoplePerHour'], undefined);
  assert.equal(w.requests.filter(r => r.path === '/v1/ingest').length, 0);
  assert.equal(w.storage.scanEnabled, false);
});

test('PeoplePerHour real member/guest response shapes traverse the worker and dispatch one Telegram notice per transition', async () => {
  const store = new Store(':memory:', []); const notices: string[] = [];
  let signedIn = false;
  try {
    store.ensureUser('1', '1'); store.preferences('1', { subscribed: true });
    const monitor = new Monitor(store, [], { send: async text => { notices.push(text); } }, 0);
    const w = worker({ platformAuth: () => checkSession('https://www.peopleperhour.com', '', undefined,
      async () => new Response(JSON.stringify(signedIn ? { member: { id: '123' }, shared: {} } : { shared: { handie: { 'guest.neverLoggedIn': true } } }),
        { headers: { 'content-type': 'application/vnd.api+json' } })),
      onAccess: status => store.recordAccess('1', 'PeoplePerHour', status) });
    await w.send('SCAN'); await monitor.tick(new AbortController().signal);
    assert.equal(notices.length, 1); assert.match(notices[0]!, /login required/);
    signedIn = true;
    await w.navigation(); await monitor.tick(new AbortController().signal);
    assert.equal(store.accessStatus('1', 'PeoplePerHour'), 'authenticated');
    assert.equal(notices.length, 2); assert.match(notices[1]!, /signed in again/);
    signedIn = false;
    await w.nativeRequest('https://www.peopleperhour.com/v1/user/logout');
    await monitor.tick(new AbortController().signal);
    assert.equal(notices.length, 3); assert.match(notices[2]!, /login required/);
    assert.equal(w.authRequests.at(-1)!.force, true);
    await w.send('SCAN'); await monitor.tick(new AbortController().signal);
    assert.equal(notices.length, 3);
    assert.equal(w.storage['blocked:scope1:PeoplePerHour'], 'login_required');
  } finally { store.close(); }
});
