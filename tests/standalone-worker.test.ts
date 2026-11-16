import { extractProjects } from '../extension/src/extractor.js';
import { build } from 'esbuild';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { parseHTML } from 'linkedom';

function profile(chatId: number, workerSource?: string, permissionGranted = true, page: { url?: string; authenticated?: boolean; listingOpen?: boolean; scanResponse?: Record<string, unknown>; scanMessages?: string[]; details?: Record<string, unknown> | false } = {}) {
  const storage: Record<string, any> = {};
  const sent: { chat_id: string; text: string }[] = [];
  const methods: string[] = []; const detailRequests: string[] = [];
  let lock: Promise<unknown> = Promise.resolve();
  let time = Date.parse('2026-11-16T12:00:00Z');
  const botToken = '123456:' + 'synthetic_shared_'.repeat(2);
  class Clock extends Date { static override now() { return time; } }
  function boot() {
    let listener!: (message: unknown, sender: unknown, reply: (result: Record<string, any>) => void) => boolean | undefined;
    let startup: (() => void) | undefined; let alarm = false;
    const tab = { id: 7, url: page.url ?? 'https://www.peopleperhour.com/freelance-jobs', status: 'complete' };
    const chrome = {
      permissions: { contains: async (permission: { origins: string[] }) => { assert.equal(permission.origins.join(','), 'https://api.telegram.org/*'); return permissionGranted; } },
      storage: { local: { setAccessLevel: async () => {},
        get: async (keys: string | string[] | null) => Object.fromEntries((keys === null ? Object.keys(storage) : typeof keys === 'string' ? [keys] : keys).filter(key => key in storage).map(key => [key, structuredClone(storage[key])])),
        set: async (values: Record<string, unknown>) => { Object.assign(storage, structuredClone(values)); },
        remove: async (keys: string | string[]) => { for (const key of typeof keys === 'string' ? [keys] : keys) delete storage[key]; } } },
      alarms: { get: async () => alarm ? {} : undefined, create: async () => { alarm = true; }, clear: async () => { alarm = false; }, onAlarm: { addListener: () => {} } },
      tabs: { create: async (tab: { url: string }) => { assert.equal(tab.url, 'https://t.me/Aurox_notification_bot?start=extension'); }, query: async () => [tab, ...(page.listingOpen ? [{ id: 8, url: 'https://www.peopleperhour.com/freelance-jobs', status: 'complete' }] : [])], get: async () => tab, onUpdated: { addListener: () => {} }, sendMessage: async (_id: number, message: { type: string; url?: string }) => message.type === 'PROJECT_DETAIL' ? (() => { detailRequests.push(message.url ?? ''); return page.details === false ? { ok: false } : { ok: true, details: page.details ?? {} }; })() : message.type === 'CHECK_AUTH' ? { authentication: page.authenticated ? { state: 'authenticated', reason: 'api_authenticated' } : { state: 'unknown', reason: 'unverified' } } : (() => { if (['SCAN_PAGE', 'POLL_PAGE'].includes(message.type)) page.scanMessages?.push(message.type); return page.scanResponse ?? { status: 'no_projects', detail: 'No project cards.' }; })() },
      webRequest: { onCompleted: { addListener: () => {} } },
      runtime: { id: 'self', getURL: (path: string) => 'chrome-extension://self/' + path, onMessage: { addListener: (fn: typeof listener) => { listener = fn; } }, onStartup: { addListener: (fn: () => void) => { startup = fn; } }, onInstalled: { addListener: () => {} } },
    };
    runInNewContext(workerSource ?? readFileSync('extension/dist/standalone-background.js', 'utf8'), {
      navigator: { locks: { request: (_name: string, operation: () => Promise<unknown>) => { const next = lock.catch(() => {}).then(operation); lock = next; return next; } } },
      chrome, Date: Clock, crypto: globalThis.crypto, URL, AbortSignal, setTimeout, clearTimeout,
      fetch: async function (this: { chrome?: unknown }, input: string, init: { body: string }) {
        assert.ok(this?.chrome, 'Browser fetch must use the service worker global receiver, not the Telegram client instance.');
        const url = new URL(input); assert.equal(url.origin, 'https://api.telegram.org', 'No backend or website fetch is allowed from the standalone worker.');
        const method = url.pathname.split('/').at(-1)!; methods.push(method);
        const payload = JSON.parse(init.body);
        if (method === 'getMe') return Response.json({ ok: true, result: { is_bot: true, username: 'Aurox_notification_bot' } });
        if (method === 'getChat') return Response.json({ ok: true, result: { id: chatId, type: 'private' } });
        assert.equal(method, 'sendMessage'); assert.equal(payload.chat_id, String(chatId)); sent.push(payload);
        return Response.json({ ok: true, result: { message_id: sent.length } });
      },
    });
    assert.ok(startup);
    return {
      startup: async () => { startup!(); for (let turn = 0; turn < 30; turn++) await new Promise<void>(resolve => setImmediate(resolve)); },
      send: (type: string, values: Record<string, unknown> = {}) => new Promise<Record<string, any>>(resolve => {
        assert.equal(listener({ type, ...values }, { id: 'self', url: 'chrome-extension://self/standalone.html' }, resolve), true);
      }),
      content: (type: string, values: Record<string, unknown> = {}) => new Promise<Record<string, any>>(resolve => {
        assert.equal(listener({ type, ...values }, { id: 'self', frameId: 0, url: tab.url, tab }, resolve), true);
      }),
      rejected: () => assert.equal(listener({ type: 'CONNECT', chatId: '999' }, { id: 'self', frameId: 0, url: tab.url, tab }, () => {}), undefined),
    };
  }
  return { boot, storage, sent, methods, detailRequests, botToken, advance: (ms = 4000) => { time += ms; }, get now() { return time; } };
}
const scan = (id: number, publishedAt: number) => ({ status: 'ok', detail: 'Extracted.', payload: { platform: 'PeoplePerHour', pageUrl: 'https://www.peopleperhour.com/freelance-jobs',
  listing: { version: 1, source: 'dom', completeness: 'complete', page: 'first', settled: true, scope: 'https://www.peopleperhour.com/freelance-jobs' },
  projects: [{ sourceId: String(id), url: `https://www.peopleperhour.com/freelance-jobs/python-${id}`, title: 'Python API', publishedAt: new Date(publishedAt).toISOString() }] } });

test('compiled extension works with no backend: manual connection, silent baseline, one new alert, restart and retained disconnect', async () => {
  const p = profile(7); let worker = p.boot();
  const begin = await worker.send('CONNECT', { chatId: '7', botToken: p.botToken });
  assert.equal(begin.ok, true); assert.equal(begin.connected, true); assert.equal(begin.verificationPending, false);
  assert.ok(!JSON.stringify(begin).includes(p.botToken)); assert.ok(!p.sent[0]!.text.includes('connection code'));
  p.advance();
  const published = p.now + 1000; p.advance();
  await worker.content('AUTO_SCAN', { extraction: scan(1, published) }); assert.equal(p.sent.length, 1);
  p.advance(); await worker.content('AUTO_SCAN', { extraction: scan(2, p.now - 1000) }); assert.equal(p.sent.length, 2);
  p.advance(); await worker.content('AUTO_SCAN', { extraction: scan(2, published) }); assert.equal(p.sent.length, 2);
  const page = await worker.content('GET_SCAN_STATE'); assert.equal(page.enabled, true); assert.ok(!JSON.stringify(page).includes(p.botToken)); worker.rejected();
  worker = p.boot(); p.advance(); assert.equal((await worker.send('GET_STATUS')).connected, true);
  await worker.send('DISCONNECT'); assert.equal(p.storage.standaloneData.connection, undefined); assert.equal(p.storage.standaloneData.seen['PeoplePerHour:2'], true);
  assert.ok(p.methods.every(method => ['getMe', 'getChat', 'sendMessage'].includes(method)));
});
test('compiled shared-bot extension isolates two Chrome profiles and never polls Telegram updates', async () => {
  const first = profile(7); const second = profile(8);
  for (const p of [first, second]) {
    const worker = p.boot(); await worker.send('CONNECT', { chatId: String(p === first ? 7 : 8), botToken: p.botToken });
    assert.equal((await worker.send('GET_STATUS')).connected, true); p.advance();
    const publication = p.now + 1000; p.advance();
    await worker.content('AUTO_SCAN', { extraction: scan(1, publication) }); p.advance(); await worker.content('AUTO_SCAN', { extraction: scan(2, p.now - 1000) });
  }
  assert.ok(first.sent.every(message => message.chat_id === '7')); assert.ok(second.sent.every(message => message.chat_id === '8'));
  assert.ok([...first.methods, ...second.methods].every(method => method !== 'getUpdates'));
});
test('popup preserves Connect and Disconnect and submits chat ID and verification without exposing credentials', async () => {
  const { document, window } = parseHTML(readFileSync('extension/standalone.html', 'utf8'));
  const requests: Record<string, unknown>[] = [];
  runInNewContext(readFileSync('extension/dist/standalone-popup.js', 'utf8'), {
    document, setTimeout, clearTimeout, chrome: { runtime: { sendMessage: async (message: Record<string, unknown>) => {
      requests.push(message); return { ok: true, connected: false, verificationPending: message.type === 'CONNECT', tokenConfigured: false, pendingChatId: '7', verificationDelivery: 'sent', scanningEnabled: true,
        lastError: '' };
    } } },
  });
  await new Promise<void>(resolve => setImmediate(resolve));
  (document.getElementById('chatId') as unknown as { value: string }).value = '7';
  const input = document.getElementById('botToken') as unknown as { value: string }; input.value = 'synthetic-token';
  document.getElementById('connect')!.dispatchEvent(new window.Event('click')); await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(requests.find(request => request.type === 'CONNECT')!.chatId, '7'); assert.equal(input.value, '');
  assert.ok(!document.body.textContent.includes('synthetic-token')); assert.equal(document.getElementById('connect')!.textContent, 'Connect Telegram'); assert.ok(document.getElementById('disconnect'));
});
test('compiled personal worker activates from Connect without code entry and preserves recipient isolation', async () => {
  for (const id of [7, 8]) {
    const output = await build({ entryPoints: ['extension/src/standalone-background.ts'], write: false, bundle: true, format: 'iife', platform: 'browser', target: 'chrome120',
      define: { __AUROX_SHARED_BOT_TOKEN__: JSON.stringify('123456:' + 'synthetic_shared_'.repeat(2)), __AUROX_PROVISIONED_CHAT_ID__: JSON.stringify(String(id)) } });
    const p = profile(id, output.outputFiles[0]!.text); let worker = p.boot();
    const connected = await worker.send('CONNECT'); assert.equal(connected.ok, true); assert.equal(connected.connected, true); assert.equal(connected.chatId, String(id)); assert.equal(p.sent.length, 1);
    worker = p.boot(); await worker.send('CHECK_CONNECTION'); assert.equal(p.sent.length, 1); assert.equal(p.methods.includes('getUpdates'), false);
  }
});

test('chat ID feedback shows valid syntax in green without claiming an active Telegram connection', async () => {
  const { document, window } = parseHTML(readFileSync('extension/standalone.html', 'utf8'));
  let connected = false; let pending = false; let error = ''; let connectCalls = 0;
  const status = () => ({ ok: true, connected, chatId: connected ? '7' : '', verificationPending: pending, pendingChatId: pending ? '7' : '', tokenConfigured: true, verificationDelivery: 'sent', scanningEnabled: true, lastError: '' });
  runInNewContext(readFileSync('extension/dist/standalone-popup.js', 'utf8'), { document, setTimeout, clearTimeout, chrome: { runtime: { sendMessage: async (message: { type: string }) => {
    if (message.type === 'CONNECT') { connectCalls++; if (error) return { ok: false, errorCode: error, error: 'Check the ID and press Start.' }; pending = true; }
    if (message.type === 'CONFIRM_CONNECTION') { connected = true; pending = false; }
    if (message.type === 'DISCONNECT') connected = false;
    return status();
  } } } });
  const flush = () => new Promise<void>(resolve => setImmediate(resolve)); await flush();
  const field = document.getElementById('chatId') as unknown as HTMLInputElement;
  const edit = (value: string) => { field.value = value; field.dispatchEvent(new window.Event('input')); };
  const click = async (id: string) => { document.getElementById(id)!.dispatchEvent(new window.Event('click')); await flush(); };
  edit('abc'); await click('connect'); assert.equal(connectCalls, 0); assert.equal(field.getAttribute('aria-invalid'), 'true'); assert.ok(field.classList.contains('chat-invalid'));
  edit('7'); assert.equal(field.classList.contains('chat-invalid'), false); assert.equal(field.classList.contains('chat-valid'), true); assert.match(document.getElementById('chatFeedback')!.textContent!, /format looks correct/);
  error = 'telegram_chat_unavailable'; await click('connect'); assert.ok(field.classList.contains('chat-invalid'));
  edit('7'); error = 'telegram_network_error'; await click('connect'); assert.equal(field.classList.contains('chat-invalid'), false);
  error = ''; await click('connect'); assert.equal(field.classList.contains('chat-valid'), true);
  await click('confirm'); assert.ok(field.classList.contains('chat-valid')); assert.equal(document.getElementById('setup')!.hidden, false); assert.equal(field.readOnly, true);
  await click('disconnect'); assert.equal(field.classList.contains('chat-valid'), true); assert.match(document.getElementById('chatFeedback')!.textContent!, /format looks correct/); assert.equal(field.readOnly, false);
});

test('missing Chrome Telegram host access reports a permission error without attempting delivery', async () => {
  const p = profile(7, undefined, false); const worker = p.boot();
  const result = await worker.send('CONNECT', { chatId: '7', botToken: p.botToken });
  assert.equal(result.ok, false); assert.equal(result.errorCode, 'telegram_permission_missing'); assert.match(result.error, /api.telegram.org/);
  assert.equal(p.methods.length, 0); assert.equal(p.sent.length, 0);
});

test('compiled worker prompts after confirmed login on a dashboard, but accepts an existing listing in another tab', async () => {
  const page = { url: 'https://www.peopleperhour.com/dashboard', authenticated: true, listingOpen: false };
  const p = profile(7, undefined, true, page); let worker = p.boot(); await worker.send('CONNECT', { chatId: '7', botToken: p.botToken }); p.advance();
  const extraction = { status: 'unsupported', detail: 'Dashboard, not a listing.' };
  await worker.content('AUTO_SCAN', { extraction }); assert.equal(p.sent.length, 2); assert.match(p.sent[1]!.text, /jobs page is not open/);
  worker = p.boot(); await worker.content('AUTO_SCAN', { extraction }); assert.equal(p.sent.length, 2);
  page.listingOpen = true; await worker.content('AUTO_SCAN', { extraction }); p.advance();
  page.listingOpen = false; await worker.content('AUTO_SCAN', { extraction }); assert.equal(p.sent.length, 3);
  const other = profile(8, undefined, true, { ...page, listingOpen: true }); const otherWorker = other.boot(); await otherWorker.send('CONNECT', { chatId: '8', botToken: other.botToken }); other.advance();
  await otherWorker.content('AUTO_SCAN', { extraction }); assert.equal(other.sent.length, 1);
});

test('background worker retries a live incomplete baseline before switching to HTML polling and sends a later new project once', async () => {
  const page = { scanResponse: scan(1, Date.parse('2026-11-16T11:00:00Z')), scanMessages: [] as string[] };
  page.scanResponse.payload.listing.settled = false;
  const p = profile(7, undefined, true, page); let worker = p.boot(); await worker.send('CONNECT', { chatId: '7', botToken: p.botToken }); p.advance(31000);
  await worker.startup(); assert.equal(page.scanMessages.at(-1), 'SCAN_PAGE'); assert.equal(p.storage.standaloneData.baselines.length, 0);
  page.scanResponse.payload.listing.settled = true; worker = p.boot(); p.advance(31000); await worker.startup();
  assert.equal(page.scanMessages.at(-1), 'SCAN_PAGE'); assert.equal(p.storage.standaloneData.baselines[0], 'PeoplePerHour'); assert.equal(p.sent.length, 1);
  p.advance(10 * 60000); page.scanResponse = scan(2, p.now - 60000); page.scanResponse.payload.listing.source = 'html';
  await worker.startup(); assert.equal(page.scanMessages.at(-1), 'POLL_PAGE'); assert.equal(p.sent.length, 2);
  p.advance(31000); await worker.startup(); assert.equal(p.sent.length, 2);
});

test('a parsed real-style listing with a new sibling-footer project reaches Telegram through the background worker on both sites', async () => {
  for (const [site, url, prefix] of [['PeoplePerHour', 'https://www.peopleperhour.com/freelance-jobs', '/freelance-jobs/project-'], ['Guru', 'https://www.guru.com/work/', '/jobs/project/']] as const) {
    const card = (id: number, title: string, age: string) => `<div class="outer"><div data-project-id="${id}"><h2><a href="${prefix}${id}">${title}</a></h2></div><footer>${age}<span> 1 proposal</span></footer></div>`;
    const parsed = (html: string, source: 'dom' | 'html') => {
      const { document } = parseHTML(`<html><body><main><section>${html}</section></main></body></html>`); Object.defineProperty(document, 'readyState', { value: 'complete' });
      const result = extractProjects(document as unknown as Document, url, source); result.payload!.listing!.settled = true; return result;
    };
    const page = { url, scanResponse: parsed(card(1, 'Pinned baseline project', '4 hours ago'), 'dom') as unknown as Record<string, unknown>, scanMessages: [] as string[] };
    const p = profile(7, undefined, true, page); const worker = p.boot(); await worker.send('CONNECT', { chatId: '7', botToken: p.botToken });
    await worker.content('AUTO_SCAN', { extraction: page.scanResponse }); assert.equal(p.sent.length, 1);
    p.advance(15 * 60000); page.scanResponse = parsed(card(1, 'Pinned baseline project', '4 hours ago') + card(2, 'New seven-minute project', '7 minutes ago'), 'html') as unknown as Record<string, unknown>;
    await worker.startup(); assert.equal(page.scanMessages.at(-1), 'POLL_PAGE'); assert.equal(p.sent.length, 2, site); assert.match(p.sent[1]!.text, /New seven-minute project/);
    p.advance(31000); await worker.startup(); assert.equal(p.sent.length, 2);
    const broken = structuredClone(page.scanResponse) as { payload: { projects: { publishedAt?: string }[] } };
    for (const project of broken.payload.projects) delete project.publishedAt;
    await worker.content('AUTO_SCAN', { extraction: broken }); const status = await worker.send('GET_STATUS'); assert.match(status.monitoringIssue, /posting times could not be read/);
    await worker.content('AUTO_SCAN', { extraction: page.scanResponse }); assert.equal((await worker.send('GET_STATUS')).monitoringIssue, '');
  }
});

test('compiled worker includes detail values before notifying and paces lookups across restarts', async () => {
  const page = { details: { budget: 'Under $250', category: 'Design & Art', skills: ['Video Editing'], description: 'Create a three-minute highlight reel for scouts.', client: { ratingScore: '100%', reviewCount: 10, joinedAt: 'January 2024' } } };
  const p = profile(7, undefined, true, page); let worker = p.boot(); await worker.send('CONNECT', { chatId: '7', botToken: p.botToken });
  await worker.content('AUTO_SCAN', { extraction: scan(1, p.now - 60000) }); assert.equal(p.detailRequests.length, 0);
  p.advance(10 * 60000); await worker.content('AUTO_SCAN', { extraction: scan(2, p.now - 60000) });
  assert.equal(p.detailRequests.length, 1); assert.equal(p.sent.length, 2);
  for (const value of ['Budget: Under $250', 'Category: Design & Art', 'Skills: Video Editing', 'highlight reel for scouts', 'Client rating: 100%', 'Client reviews: 10', 'Client joined: January 2024']) assert.ok(p.sent[1]!.text.includes(value), value);
  p.advance(); await worker.content('AUTO_SCAN', { extraction: scan(3, p.now - 1000) }); assert.equal(p.detailRequests.length, 1); assert.equal(p.sent.length, 2);
  worker = p.boot(); p.advance(31000); await worker.startup(); assert.equal(p.detailRequests.length, 2); assert.equal(p.sent.length, 3);
});
