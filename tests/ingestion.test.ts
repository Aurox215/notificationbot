import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { request } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../src/persistence/store.js';
import { validateScan, type ScanPayload } from '../src/ingestion/schema.js';
import { readIngestionConfig } from '../src/ingestion/config.js';
import { createIngestionServer } from '../src/ingestion/server.js';
import { AccountLinks } from '../src/ingestion/accounts.js';
import { CommandHandler } from '../src/bot/commands.js';
import { Monitor } from '../src/monitoring/monitor.js';
import { createSources } from '../src/sources/registry.js';

const extensionId = 'a'.repeat(32);
const batch = (ids: number[] = [101], title = 'Python API'): ScanPayload => ({ platform: 'PeoplePerHour', pageUrl: 'https://www.peopleperhour.com/freelance-jobs',
  projects: ids.map(id => ({ sourceId: String(id), url: `https://www.peopleperhour.com/freelance-jobs/python-api-${id}`, title, skills: ['Python'] })) });

test('filtered projects explain silence, metadata enrichment enables one owner-only notification without promoting baseline', async () => {
  const store = new Store(':memory:', ['python']);
  const sent: { text: string; chatId: string }[] = [];
  try {
    for (const id of ['1', '2']) { store.ensureUser(id, id); store.preferences(id, { subscribed: true }); }
    const plain = (ids: number[]) => validateScan({ ...batch(ids, 'Build a service'), projects: batch(ids, 'Build a service').projects.map(({ skills, ...project }) => project) }).projects;
    store.ingestOwned('1', 'PeoplePerHour', plain([101]));
    store.ingestOwned('1', 'PeoplePerHour', plain([101, 102]));
    const monitor = new Monitor(store, [], { send: async (text, chatId) => { sent.push({ text, chatId }); } }, 0);
    await monitor.tick(new AbortController().signal);
    assert.equal(sent.length, 0);
    assert.equal(store.browserSummary('1').keywordExcluded, 1);
    assert.equal(store.browserSummary('1').missingSearchMetadata, 1);
    assert.equal(store.browserSummary('2').stored, 0);
    const originalTime = store.browserProjects('1')[0]!.project.detectedAt.toISOString();
    const enriched = plain([101, 102]).map(project => ({ ...project, description: 'Implement a Python service', skills: ['Python'] }));
    assert.equal(store.ingestOwned('1', 'PeoplePerHour', enriched).inserted, 0);
    assert.equal(store.browserSummary('1').matching, 1);
    assert.equal(store.browserSummary('1').baseline, 1);
    assert.equal(store.browserProjects('1')[0]!.project.detectedAt.toISOString(), originalTime);
    // Sparse later HTTP responses must not erase metadata found in the loaded DOM.
    store.ingestOwned('1', 'PeoplePerHour', plain([101, 102]));
    await monitor.tick(new AbortController().signal);
    await monitor.tick(new AbortController().signal);
    assert.equal(sent.length, 1);
    assert.equal(sent[0]!.chatId, '1');
    assert.match(sent[0]!.text, /Python service/);
    assert.deepEqual(store.browserSummary('1').deliveries, [{ state: 'sent', count: 1 }]);
  } finally { store.close(); }
});

test('changing keywords delivers previously filtered later projects once and keeps the first batch silent', async () => {
  const store = new Store(':memory:', ['python']);
  const sent: string[] = [];
  try {
    store.ensureUser('1', '1'); store.preferences('1', { subscribed: true });
    const projects = validateScan({ ...batch([101, 102], 'Logo design'), projects: batch([101, 102], 'Logo design').projects.map(p => ({ ...p, skills: ['Design'] })) }).projects;
    store.ingestOwned('1', 'PeoplePerHour', projects.slice(0, 1));
    store.ingestOwned('1', 'PeoplePerHour', projects);
    const monitor = new Monitor(store, [], { send: async text => { sent.push(text); } }, 0);
    await monitor.tick(new AbortController().signal);
    assert.equal(sent.length, 0);
    store.preferences('1', { keywords: [] });
    await monitor.tick(new AbortController().signal);
    await monitor.tick(new AbortController().signal);
    assert.equal(sent.length, 1);
    assert.ok(sent[0]!.includes(projects[1]!.url!));
  } finally { store.close(); }
});
function authorize(accounts: AccountLinks, store: Store, id: string) {
  store.ensureUser(id, id);
  const proof = ('proof' + id).repeat(15);
  const link = accounts.start(proof);
  const payload = new URL(link.telegramUrl).searchParams.get('start')!;
  assert.equal(accounts.propose(payload, id), link.confirmationCode);
  assert.equal(accounts.approve(id, link.confirmationCode), true);
  const claimed = accounts.claim(link.pairingId, proof);
  assert.equal(claimed.status, 'connected');
  return (claimed as { sessionToken: string }).sessionToken;
}
test('operator configuration needs a bot username and secure public origin, never a shared ingestion token', () => {
  assert.equal(readIngestionConfig({}), undefined);
  assert.throws(() => readIngestionConfig({ INGESTION_ENABLED: 'true' }), /USERNAME/);
  const env = { INGESTION_ENABLED: 'true', TELEGRAM_BOT_USERNAME: 'AuroxTestBot' };
  assert.equal(readIngestionConfig(env)!.port, 4318);
  assert.equal(readIngestionConfig({ ...env, PUBLIC_BASE_URL: 'https://jobs.example.com' })!.publicUrl, 'https://jobs.example.com');
  for (const url of ['http://jobs.example.com', 'https://user:password@example.com', 'https://example.com/?token=secret']) assert.throws(() => readIngestionConfig({ ...env, PUBLIC_BASE_URL: url }));
  assert.deepEqual(createSources('extension'), []);
});
test('additive migration preserves mock projects but does not assign legacy browser data to any user', () => {
  const directory = mkdtempSync(join(tmpdir(), 'bidbot-migration-'));
  const path = join(directory, 'old.sqlite');
  const old = new DatabaseSync(path);
  old.exec('CREATE TABLE projects (id INTEGER PRIMARY KEY, platform TEXT NOT NULL, source_id TEXT NOT NULL, payload TEXT NOT NULL, UNIQUE(platform,source_id))');
  const project = validateScan(batch()).projects[0]!;
  old.prepare('INSERT INTO projects(id,platform,source_id,payload) VALUES(?,?,?,?)').run(7, project.platform, project.sourceId, JSON.stringify(project));
  old.close();
  const store = new Store(path, []);
  try {
    assert.equal(store.projects(true)[0]!.id, 7);
    assert.equal(store.saveProject(project), 7);
    assert.equal(store.browserProjects('new-user', true).length, 0);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});
test('scan validation rejects bad URLs, IDs and optional data and never accepts supplied owner identity', () => {
  for (const value of [null, {}, { ...batch(), platform: undefined }, { ...batch(), pageUrl: 'https://evil.example/' },
    { ...batch(), projects: [] }, { ...batch(), projects: [{ ...batch().projects[0], sourceId: 'other' }] },
    { ...batch(), projects: [{ ...batch().projects[0], url: 'http://127.0.0.1/secret' }] },
    { ...batch(), projects: [{ ...batch().projects[0], skills: [123] }] },
    { ...batch(), projects: [{ ...batch().projects[0], description: 'x'.repeat(5001) }] }]) assert.throws(() => validateScan(value));
  const scan = validateScan({ ...batch(), userId: 'victim', projects: [{ ...batch().projects[0], detectedAt: 'bad', notify: true, chatId: 'victim' }] });
  assert.ok(scan.projects[0]!.detectedAt instanceof Date);
  assert.equal('userId' in scan, false);
});

test('pairing requires Telegram approval, owner match, proof and single-use claim; sessions revoke and expire', () => {
  const store = new Store(':memory:', []);
  let now = 1000;
  const accounts = new AccountLinks(store, 'AuroxTestBot', () => now);
  try {
    store.ensureUser('1', '1'); store.ensureUser('2', '2');
    const proof = 'proof'.repeat(15);
    const link = accounts.start(proof);
    const payload = new URL(link.telegramUrl).searchParams.get('start')!;
    assert.ok(payload.length <= 64);
    assert.equal(accounts.claim(link.pairingId, 'wrong'.repeat(15)).status, 'invalid');
    assert.equal(accounts.claim(link.pairingId, proof).status, 'pending');
    assert.equal(accounts.propose(payload, '1'), link.confirmationCode);
    assert.equal(accounts.propose(payload, '2'), undefined);
    assert.equal(accounts.approve('2', link.confirmationCode), false);
    assert.equal(accounts.approve('1', 'BADCODE0'), false);
    assert.equal(accounts.approve('1', link.confirmationCode), true);
    const result = accounts.claim(link.pairingId, proof) as { status: string; sessionToken: string };
    assert.equal(result.status, 'connected');
    assert.equal(accounts.authenticate('Bearer ' + result.sessionToken), '1');
    assert.equal(accounts.claim(link.pairingId, proof).status, 'invalid');
    assert.equal(accounts.approve('1', link.confirmationCode), false);
    accounts.revoke('Bearer ' + result.sessionToken);
    assert.equal(accounts.authenticate('Bearer ' + result.sessionToken), undefined);
    const otherToken = authorize(accounts, store, '2');
    accounts.disconnect('1'); // cannot revoke another owner's session
    assert.equal(accounts.authenticate('Bearer ' + otherToken), '2');
    now += 31 * 24 * 60 * 60 * 1000;
    assert.equal(accounts.authenticate('Bearer ' + otherToken), undefined);
    const expiring = accounts.start(proof);
    now += 5 * 60 * 1000;
    assert.equal(accounts.propose(new URL(expiring.telegramUrl).searchParams.get('start')!, '1'), undefined);
    assert.equal(accounts.claim(expiring.pairingId, proof).status, 'invalid');
  } finally { store.close(); }
});

test('projects, snapshots, baselines and notifications are isolated per user and persist across restarts', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'bidbot-owned-'));
  const path = join(directory, 'test.sqlite');
  let store = new Store(path, []);
  try {
    store.setState('source_mode', 'extension');
    for (const id of ['1', '2', '3']) { store.ensureUser(id, id); store.preferences(id, { subscribed: true }); }
    const ingest = (id: string, ids: number[], title: string) => { const scan = validateScan(batch(ids, title)); return store.ingestOwned(id, scan.platform, scan.projects); };
    assert.equal(ingest('1', [101], 'Alice baseline').baseline, true);
    assert.equal(ingest('2', [102], 'Bob private baseline').baseline, true);
    assert.equal(ingest('1', [101, 102], 'Alice private title').inserted, 1);
    // The same site ID exists independently with another owner's data and silent status.
    assert.equal(store.browserProjects('1')[0]!.project.title, 'Alice private title');
    assert.equal(store.browserProjects('2').length, 0);
    store.close(); store = new Store(path, []);
    const sent: { text: string; chatId: string }[] = [];
    const monitor = new Monitor(store, [], { send: async (text, chatId) => { sent.push({ text, chatId }); } }, 0);
    await monitor.tick(new AbortController().signal);
    assert.equal(sent.length, 1);
    assert.equal(sent[0]!.chatId, '1');
    assert.match(sent[0]!.text, /Alice private title/);
    assert.equal(store.history('2').length, 0);
    assert.equal(store.history('3').length, 0);
    assert.throws(() => store.enqueueOwned('2', store.browserProjects('1')[0]!.id), /FOREIGN KEY/);
    ingest('1', [102], 'Duplicate changed text');
    await monitor.tick(new AbortController().signal);
    assert.equal(sent.length, 1);
    assert.equal(ingest('2', [101, 102], 'Bob private title').baseline, false);
    await monitor.tick(new AbortController().signal);
    assert.equal(sent.length, 2);
    assert.equal(sent[1]!.chatId, '2');
    assert.match(sent[1]!.text, /Bob private title/);
    const guru = validateScan({ platform: 'Guru', pageUrl: 'https://www.guru.com/work/', projects: [{ sourceId: '201', title: 'Python', url: 'https://www.guru.com/jobs/python/201' }] });
    assert.equal(store.ingestOwned('1', 'Guru', guru.projects).baseline, true);
    assert.equal(store.ingestOwned('2', 'Guru', guru.projects).baseline, true);
    await monitor.tick(new AbortController().signal);
    assert.equal(sent.length, 2);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('owned dispatch honors pause, platforms and keywords; legacy unowned extension rows never broadcast', async () => {
  const store = new Store(':memory:', []);
  try {
    for (const id of ['1', '2']) { store.ensureUser(id, id); store.preferences(id, { subscribed: true }); }
    const scan = validateScan(batch());
    store.ingestOwned('1', scan.platform, scan.projects);
    store.ingestOwned('1', scan.platform, validateScan(batch([102])).projects);
    // This old global path remains readable for migration, but must never route to users.
    store.ingest(scan.platform, scan.projects);
    store.ingest(scan.platform, validateScan(batch([103])).projects);
    let sent = 0;
    const monitor = new Monitor(store, [], { send: async () => { sent++; } }, 0);
    store.preferences('1', { paused: true });
    await monitor.tick(new AbortController().signal); assert.equal(sent, 0);
    store.preferences('1', { paused: false, keywords: ['React'] });
    await monitor.tick(new AbortController().signal); assert.equal(sent, 0);
    store.preferences('1', { keywords: ['Python'], platforms: ['Guru'] });
    await monitor.tick(new AbortController().signal); assert.equal(sent, 0);
    store.preferences('1', { platforms: ['PeoplePerHour'] });
    await monitor.tick(new AbortController().signal); assert.equal(sent, 1);
  } finally { store.close(); }
});

test('session hashes persist across restarts and disconnect revokes only the correct owner installations', () => {
  const directory = mkdtempSync(join(tmpdir(), 'bidbot-sessions-'));
  const path = join(directory, 'sessions.sqlite');
  let store = new Store(path, []);
  try {
    let accounts = new AccountLinks(store, 'AuroxTestBot');
    const first = authorize(accounts, store, '1');
    const second = authorize(accounts, store, '1');
    const other = authorize(accounts, store, '2');
    const inspect = new DatabaseSync(path, { readOnly: true });
    try {
      const hashes = inspect.prepare('SELECT token_hash FROM extension_sessions').all().map(row => String(row.token_hash));
      assert.equal(hashes.length, 3);
      assert.ok(hashes.every(value => /^[a-f0-9]{64}$/.test(value) && ![first, second, other].includes(value)));
      const pairings = JSON.stringify(inspect.prepare('SELECT * FROM pairing_requests').all());
      assert.ok(!pairings.includes(first));
      assert.ok(!pairings.includes(('proof1').repeat(15)));
    } finally { inspect.close(); }
    store.close(); store = new Store(path, []);
    accounts = new AccountLinks(store, 'AuroxTestBot');
    assert.equal(accounts.authenticate('Bearer ' + first), '1');
    assert.equal(accounts.authenticate('Bearer ' + second), '1');
    accounts.disconnect('1');
    assert.equal(accounts.authenticate('Bearer ' + first), undefined);
    assert.equal(accounts.authenticate('Bearer ' + second), undefined);
    assert.equal(accounts.authenticate('Bearer ' + other), '2');
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('Telegram confirmation cannot be approved in a group or using a different sender chat', async () => {
  const store = new Store(':memory:', []);
  const accounts = new AccountLinks(store, 'AuroxTestBot');
  const handler = new CommandHandler(store, { send: async () => {} }, 5000, 60000, accounts);
  const proof = 'private-proof'.repeat(6);
  const link = accounts.start(proof);
  const payload = new URL(link.telegramUrl).searchParams.get('start')!;
  try {
    await handler.handle({ update_id: 1, message: { text: '/start ' + payload, from: { id: 1 }, chat: { id: 1, type: 'private' } } });
    await handler.handle({ update_id: 2, message: { text: '/confirm ' + link.confirmationCode, from: { id: 1 }, chat: { id: 1, type: 'group' } } });
    await handler.handle({ update_id: 3, message: { text: '/confirm ' + link.confirmationCode, from: { id: 2 }, chat: { id: 1, type: 'private' } } });
    assert.equal(accounts.claim(link.pairingId, proof).status, 'pending');
  } finally { store.close(); }
});

test('Telegram inline button approves without typed confirmation and preserves owner/replay checks', async () => {
  const store = new Store(':memory:', []);
  const accounts = new AccountLinks(store, 'AuroxTestBot');
  const keyboards: unknown[] = [];
  const handler = new CommandHandler(store, { send: async (_text, _id, keyboard) => { if (keyboard) keyboards.push(keyboard); } }, 5000, 60000, accounts);
  const proof = 'proof'.repeat(15);
  const link = accounts.start(proof);
  try {
    await handler.handle({ update_id: 1, message: { text: '/start ' + new URL(link.telegramUrl).searchParams.get('start'), from: { id: 1 }, chat: { id: 1, type: 'private' } } });
    assert.equal(keyboards.length, 1);
    await handler.handle({ update_id: 2, callback_query: { id: 'wrong', data: 'connect:' + link.confirmationCode, from: { id: 2 }, message: { chat: { id: 2, type: 'private' } } } });
    assert.equal(accounts.claim(link.pairingId, proof).status, 'pending');
    await handler.handle({ update_id: 3, callback_query: { id: 'right', data: 'connect:' + link.confirmationCode, from: { id: 1 }, message: { chat: { id: 1, type: 'private' } } } });
    assert.equal(accounts.claim(link.pairingId, proof).status, 'connected');
    assert.equal(store.user('1')!.subscribed, true);
    await handler.handle({ update_id: 4, callback_query: { id: 'repeat', data: 'connect:' + link.confirmationCode, from: { id: 1 }, message: { chat: { id: 1, type: 'private' } } } });
    assert.equal(accounts.claim(link.pairingId, proof).status, 'invalid');
  } finally { store.close(); }
});

test('HTTP pairing, session authentication and malicious owner fields cannot redirect notifications', async () => {
  const store = new Store(':memory:', []);
  const accounts = new AccountLinks(store, 'AuroxTestBot');
  const server = createIngestionServer(store, { port: 0, publicUrl: 'http://127.0.0.1', botUsername: 'AuroxTestBot' }, accounts);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = (server.address() as { port: number }).port;
  const url = `http://127.0.0.1:${port}`;
  const baseHeaders = { Origin: `chrome-extension://${extensionId}`, 'Content-Type': 'application/json' };
  const post = (path: string, value: unknown, token?: string) => fetch(url + path, { method: 'POST', headers: { ...baseHeaders, ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(value) });
  try {
    const proof = 'proof'.repeat(15);
    const started = await post('/v1/pairings', { pollSecret: proof, userId: 'victim' });
    assert.equal(started.status, 201);
    const link = await started.json() as { pairingId: string; telegramUrl: string; confirmationCode: string };
    assert.equal((await post('/v1/ingest', batch(), 'old-shared-token')).status, 401);
    assert.equal((await post('/v1/pairings/claim', { pairingId: link.pairingId, pollSecret: proof })).status, 200);
    const replies: string[] = [];
    const commands = new CommandHandler(store, { send: async text => { replies.push(text); } }, 5000, 60000, accounts);
    const command = (id: number, text: string) => commands.handle({ update_id: id, message: { text, from: { id }, chat: { id, type: 'private' } } });
    await command(1, '/start ' + new URL(link.telegramUrl).searchParams.get('start'));
    assert.match(replies.at(-1)!, /Compare this code/);
    await command(1, '/confirm ' + link.confirmationCode);
    const claimed = await post('/v1/pairings/claim', { pairingId: link.pairingId, pollSecret: proof });
    const token = (await claimed.json() as { sessionToken: string }).sessionToken;
    const headers = { ...baseHeaders, Authorization: 'Bearer ' + token };
    assert.equal((await fetch(url + '/health', { headers })).status, 200);
    for (const origin of ['https://www.guru.com', 'null', 'chrome-extension://invalid']) assert.equal((await fetch(url + '/health', { headers: { ...headers, Origin: origin } })).status, 403);
    const invalidHost = await new Promise<number>(resolve => {
      const req = request(url + '/health', { headers: { ...headers, Host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode!); }); req.end();
    });
    assert.equal(invalidHost, 403);
    store.ensureUser('2', '2'); store.preferences('2', { subscribed: true });
    assert.equal((await post('/v1/ingest', { ...batch(), userId: '2', chatId: '2' }, token)).status, 200);
    assert.equal(store.browserProjects('1', true).length, 1);
    assert.equal(store.browserProjects('2', true).length, 0);
    assert.equal((await post('/v1/ingest', batch([101, 102]), token)).status, 200);
    const sent: string[] = [];
    await new Monitor(store, [], { send: async (_text, id) => { sent.push(id); } }, 0).tick(new AbortController().signal);
    assert.deepEqual(sent, ['1']);
    assert.equal((await post('/v1/platform-access', { platform: 'Guru', status: 'login_required', userId: '2' }, token)).status, 200);
    assert.deepEqual(store.loginNotices('1'), ['Guru']);
    assert.deepEqual(store.loginNotices('2'), []);
    const loginAlerts: { text: string; id: string }[] = [];
    const notify = new Monitor(store, [], { send: async (text, id) => { loginAlerts.push({ text, id }); } }, 0);
    await notify.tick(new AbortController().signal);
    await post('/v1/platform-access', { platform: 'Guru', status: 'login_required' }, token);
    await notify.tick(new AbortController().signal);
    assert.equal(loginAlerts.length, 1);
    assert.equal(loginAlerts[0]!.id, '1');
    assert.match(loginAlerts[0]!.text, /Guru: login required/);
    assert.equal((await post('/v1/platform-access', { platform: 'Other', status: 'login_required' }, token)).status, 400);
    assert.equal((await post('/v1/ingest', { ...batch(), projects: [batch().projects[0], { title: 'bad' }] }, token)).status, 400);
    const tooLarge = await fetch(url + '/v1/ingest', { method: 'POST', headers, body: 'x'.repeat(270000) });
    assert.equal(tooLarge.status, 413);
    const preflight = await fetch(url + '/v1/ingest', { method: 'OPTIONS', headers: { Origin: `chrome-extension://${'b'.repeat(32)}` } });
    assert.equal(preflight.status, 204);
    await command(1, '/disconnect');
    assert.equal((await fetch(url + '/health', { headers })).status, 401);
    assert.equal((await post('/v1/pairings/claim', { pairingId: link.pairingId, pollSecret: proof })).status, 410);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); store.close(); }
});

test('login-notice deduplication survives restarts and suppresses rapid logout/login flapping', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'bidbot-login-'));
  const path = join(directory, 'state.sqlite');
  let store = new Store(path, []);
  try {
    store.ensureUser('1', '1'); store.preferences('1', { subscribed: true });
    store.recordAccess('1', 'Guru', 'login_required');
    assert.equal(store.claimLoginNotice('1', 'Guru'), true);
    store.finishLoginNotice('1', 'Guru', 'sent');
    store.close(); store = new Store(path, []);
    store.recordAccess('1', 'Guru', 'login_required');
    assert.deepEqual(store.loginNotices('1'), []);
    store.recordAccess('1', 'Guru', 'ok');
    store.recordAccess('1', 'Guru', 'login_required');
    assert.deepEqual(store.loginNotices('1'), []);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('PeoplePerHour logout uses the same owner-only deduplicated notice workflow as Guru', async () => {
  const store = new Store(':memory:', []);
  try {
    for (const id of ['1', '2']) { store.ensureUser(id, id); store.preferences(id, { subscribed: true }); }
    const sent: { text: string; chatId: string }[] = [];
    const monitor = new Monitor(store, [], { send: async (text, chatId) => { sent.push({ text, chatId }); } }, 0);
    store.recordAccess('1', 'PeoplePerHour', 'login_required');
    await monitor.tick(new AbortController().signal);
    store.recordAccess('1', 'PeoplePerHour', 'login_required');
    await monitor.tick(new AbortController().signal);
    assert.equal(sent.length, 1);
    assert.equal(sent[0]!.chatId, '1');
    assert.match(sent[0]!.text, /^PeoplePerHour: login required/);
    assert.equal(store.history('2').length, 0);
    store.recordAccess('1', 'Guru', 'login_required');
    await monitor.tick(new AbortController().signal);
    assert.equal(sent.length, 2);
    assert.match(sent[1]!.text, /^Guru: login required/);
  } finally { store.close(); }
});
