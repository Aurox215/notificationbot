import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

interface Reply { ok: boolean; status?: string; errorCode?: string; error?: string; stage?: string; count?: number; contentScriptReached?: boolean; ingestionAttempted?: boolean; connectionStatus?: string; connection?: string; lastSuccess?: string }
const extraction = { status: 'ok', detail: 'Extracted.', diagnostics: { linksChecked: 2, visibleProjectLinks: 1, matchedCards: 1, extractedProjects: 1 },
  payload: { platform: 'PeoplePerHour', pageUrl: 'https://www.peopleperhour.com/freelance-jobs', projects: [{ sourceId: '1', title: 'Python API', url: 'https://www.peopleperhour.com/freelance-jobs/python-1' }] } };

function worker(options: { missing?: boolean; extraction?: unknown; ingestStatus?: number; networkDown?: boolean; authStatus?: number; backendInvalid?: boolean } = {}) {
  const storage: Record<string, unknown> = { accountSession: { token: 'synthetic-test-secret', localId: 'scope1', expiresAt: Date.now() + 1000000 } };
  let listener!: (message: unknown, sender: unknown, reply: (value: Reply) => void) => boolean;
  const pageMessages: unknown[] = [];
  const requests: { path: string; method: string }[] = [];
  const fakeChrome = {
    storage: { local: {
      setAccessLevel: async () => {},
      get: async (keys: string | string[] | null) => Object.fromEntries((keys === null ? Object.keys(storage) : typeof keys === 'string' ? [keys] : keys).filter(k => k in storage).map(k => [k, storage[k]])),
      set: async (data: Record<string, unknown>) => { Object.assign(storage, data); },
      remove: async (keys: string | string[]) => { for (const key of typeof keys === 'string' ? [keys] : keys) delete storage[key]; },
    } },
    tabs: { query: async () => [{ id: 7, url: 'https://www.peopleperhour.com/freelance-jobs' }],
      sendMessage: async (_id: number, message: unknown) => {
        pageMessages.push(message);
        if (options.missing) throw new Error('Receiving end does not exist. Do not leak synthetic-test-secret');
        return options.extraction ?? extraction;
      } },
    runtime: { id: 'self', getURL: (path: string) => 'chrome-extension://self/' + path,
      onMessage: { addListener: (fn: typeof listener) => { listener = fn; } } },
  };
  runInNewContext(readFileSync('extension/dist/background.js', 'utf8'), {
    chrome: fakeChrome, URL, AbortSignal, setTimeout, clearTimeout,
    fetch: async (url: string, init: { method: string }) => {
      const path = new URL(url).pathname; requests.push({ path, method: init.method });
      if (options.networkDown) throw new Error('Do not expose synthetic-test-secret or upstream URL');
      if (path === '/v1/session') return Response.json({ connected: true }, { status: options.authStatus ?? 200 });
      const status = options.ingestStatus ?? 200;
      if (options.backendInvalid) return new Response('not JSON', { status: 200 });
      return Response.json(status === 200 ? { baseline: true, inserted: 1, acceptedAt: '2026-11-14T00:00:00.000Z' } : { error: 'synthetic-test-secret' }, { status });
    },
  });
  const send = (type: string) => new Promise<Reply>((resolve, reject) => {
    const accepted = listener({ type }, { id: 'self', url: 'chrome-extension://self/popup.html' }, resolve);
    if (!accepted) reject(new Error('Listener refused popup request'));
  });
  return { send, storage, pageMessages, requests };
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
