import type { SourceProject } from '../extension/shared/types.js';
import type { ProjectDetails } from '../extension/src/detail-extractor.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StandaloneStore, type StandaloneData } from '../extension/src/standalone-store.js';
import { DirectTelegram } from '../extension/src/direct-telegram.js';
const token = '123456:' + 'synthetic_shared_bot_'.repeat(2);
function harness(chatId = '7', provisioned = '', enrich?: (project: SourceProject) => Promise<ProjectDetails>) {
  let data: unknown;
  let lock: Promise<unknown> = Promise.resolve(); let failSentCommit = false;
  let clock = Date.parse('2026-11-16T12:00:00Z'); let serial = 0;
  let failure: 'none' | 'network' | 'rate' | 'forbidden' | 'server' | 'notStarted' = 'none';
  const calls: { method: string; body: Record<string, any> }[] = [];
  const sent: { chat_id: string; text: string }[] = [];
  const persistence = { exclusive: <T>(operation: () => Promise<T>): Promise<T> => { const result = lock.catch(() => {}).then(operation); lock = result; return result; }, read: async () => structuredClone(data), write: async (value: StandaloneData) => { if (failSentCommit && Object.values(value.projects).some(p => Object.values(p.deliveries).some(d => d.state === 'sent'))) { failSentCommit = false; throw new Error('synthetic commit failure'); } data = structuredClone(value); } };
  const telegram = new DirectTelegram(async (target, init) => {
    const url = new URL(String(target)); assert.equal(url.origin, 'https://api.telegram.org');
    const method = url.pathname.split('/').at(-1)!; const body = JSON.parse(String(init!.body)); calls.push({ method, body });
    assert.ok(['getMe', 'getChat', 'sendMessage'].includes(method));
    if (method === 'getMe') return Response.json({ ok: true, result: { is_bot: true, username: 'Aurox_notification_bot' } });
    if (method === 'getChat' && failure === 'notStarted') return Response.json({ ok: false, error_code: 400 }, { status: 400 });
    if (method === 'getChat') return Response.json({ ok: true, result: { id: Number(body.chat_id), type: 'private' } });
    if (failure === 'network') throw new Error('secret URL ' + token);
    if (failure === 'rate') { failure = 'none'; return Response.json({ ok: false, error_code: 429, parameters: { retry_after: 10 } }, { status: 429 }); }
    if (failure === 'forbidden') return Response.json({ ok: false, error_code: 403 }, { status: 403 });
    if (failure === 'server') return Response.json({ ok: false, error_code: 500 }, { status: 500 });
    sent.push(body); return Response.json({ ok: true, result: { message_id: sent.length } });
  });
  const create = () => new StandaloneStore(persistence, telegram, token, () => clock, () => String(++serial).padStart(32, '1'), async ms => { clock += ms; }, provisioned, enrich);
  let store = create();
  return { get store() { return store; }, get data() { return structuredClone(data) as StandaloneData; }, get now() { return clock; }, calls, sent, peer: create, failCommit: () => { failSentCommit = true; },
    advance: (ms = 3000) => { clock += ms; }, fail: (value: typeof failure) => { failure = value; }, restart: () => { store = create(); },
    seed: async (value: unknown) => { data = structuredClone(value); store = create(); },
    async connect(id = chatId) { await store.beginConnection(id); if (!(data as StandaloneData).connection) throw new Error('Expected direct connection'); clock += 6000; },
  };
}
const batch = (id: number, time: number, title = 'Python API') => ({ platform: 'PeoplePerHour', pageUrl: 'https://www.peopleperhour.com/freelance-jobs',
  listing: { version: 1, source: 'dom', completeness: 'complete', page: 'first', settled: true, scope: 'https://www.peopleperhour.com/freelance-jobs' },
  projects: [{ sourceId: String(id), url: `https://www.peopleperhour.com/freelance-jobs/python-api-${id}`, title, publishedAt: new Date(time).toISOString() }] });

test('first successful platform scan is unconditionally silent, new project sends once, and repeats stay silent', async () => {
  const h = harness(); await h.connect(); const cutoff = h.data.connection!.cutoff;
  await h.store.ingest(batch(1, cutoff + 1000)); h.advance(); assert.equal(h.sent.length, 1); assert.equal(h.data.projects['PeoplePerHour:1']!.baseline, true);
  await h.store.ingest(batch(2, h.now - 1000)); assert.equal(h.sent.length, 2); assert.match(h.sent[1]!.text, /Python API/);
  h.advance(); await h.store.ingest(batch(2, h.now - 1000)); assert.equal(h.sent.length, 2);
  assert.equal(h.calls.some(call => /Updates|Webhook/.test(call.method)), false);
});
test('disconnect and reconnect preserve settings, history, baselines and suppress old pending projects', async () => {
  const h = harness(); await h.connect(); const cutoff = h.data.connection!.cutoff;
  await h.store.ingest(batch(1, cutoff + 1000)); h.advance();
  await h.seed({ ...h.data, keywords: ['react'], selectedPlatforms: ['PeoplePerHour'], paused: false });
  await h.store.ingest(batch(2, h.now - 1000));
  await h.store.disconnect(); assert.equal(Object.keys(h.data.projects).length, 2); assert.deepEqual(h.data.keywords, ['react']);
  await h.connect(); const before = h.sent.length;
  await h.seed({ ...h.data, keywords: [] });
  await h.store.ingest(batch(2, h.now - 1000)); await h.store.pulse(); assert.equal(h.sent.length, before);
  h.advance(); await h.store.ingest(batch(3, h.data.connection!.cutoff + 1000)); assert.equal(h.sent.length, before + 1);
});
test('restart preserves history and recovers an interrupted sending claim as unknown', async () => {
  const h = harness(); await h.connect(); const cutoff = h.data.connection!.cutoff;
  await h.store.ingest(batch(1, cutoff + 1000)); h.advance(); await h.store.ingest(batch(2, h.now - 1000));
  const snapshot = h.data; snapshot.projects['PeoplePerHour:2']!.deliveries['7']!.state = 'sending';
  await h.seed(snapshot); h.advance(); await h.store.pulse(); await h.store.ingest(batch(2, h.now - 1000));
  assert.equal(h.sent.length, 2); assert.equal(h.data.projects['PeoplePerHour:2']!.deliveries['7']!.state, 'unknown');
});
test('two independent profiles share the bot token but route only to their own chats without polling', async () => {
  const a = harness('7'); const b = harness('8'); await a.connect(); await b.connect();
  for (const h of [a, b]) { const cutoff = h.data.connection!.cutoff; await h.store.ingest(batch(1, cutoff + 1000)); h.advance(); await h.store.ingest(batch(2, h.now - 1000)); }
  assert.ok(a.sent.every(message => message.chat_id === '7')); assert.ok(b.sent.every(message => message.chat_id === '8'));
  assert.equal(a.data.connection!.chatId, '7'); assert.equal(b.data.connection!.chatId, '8');
  assert.ok([...a.calls, ...b.calls].every(call => call.method !== 'getUpdates'));
});
test('rate limits retry durably; network and server failures do not automatically duplicate delivery', async () => {
  for (const failure of ['network', 'server', 'rate'] as const) {
    const h = harness(); await h.connect(); const cutoff = h.data.connection!.cutoff; await h.store.ingest(batch(1, cutoff + 1000)); h.advance();
    h.fail(failure); await h.store.ingest(batch(2, h.now - 1000));
    const item = h.data.projects['PeoplePerHour:2']!.deliveries['7']!;
    assert.equal(item.state, failure === 'rate' ? 'pending' : 'unknown'); assert.ok(!h.data.lastError.includes(token));
    h.fail('none'); h.restart(); h.advance(11000); await h.store.pulse();
    assert.equal(h.sent.length, failure === 'rate' ? 2 : 1);
  }
});
test('legacy connection proof never appears in status, invalid codes are rejected, forbidden chat errors disconnect safely', async () => {
  const h = harness(); await h.store.beginConnection('7'); const code = 'LEGACY01';
  const legacy = h.data; delete legacy.connection; legacy.pending = { chatId: '7', code, expiresAt: h.now + 300000, failures: 0, delivery: { state: 'sent', attempts: 1, retryAt: 0 } }; await h.seed(legacy);
  assert.ok(!JSON.stringify(await h.store.status()).includes(code)); assert.ok(!JSON.stringify(await h.store.status()).includes(token));
  await assert.rejects(h.store.confirmConnection('WRONG'), /does not match/); await h.store.confirmConnection(code); h.advance();
  await h.store.ingest(batch(1, h.data.connection!.cutoff + 1000)); h.advance();
  h.fail('forbidden'); await h.store.ingest(batch(2, h.now - 1000));
  assert.equal((await h.store.status()).connected, false); assert.equal(Object.keys(h.data.projects).length, 2);
});
test('v1 migration preserves local preferences and project history while retiring the polling connection', async () => {
  const h = harness(); const project = { ...batch(1, h.now).projects[0]!, platform: 'PeoplePerHour', detectedAt: new Date(h.now).toISOString() };
  await h.seed({ version: 1, token, session: { chatId: '7' }, keywords: ['react'], selectedPlatforms: ['Guru'], paused: true, scanEnabled: false,
    baselines: ['PeoplePerHour'], projects: { 'PeoplePerHour:1': { project, notify: false, delivery: { state: 'sent', attempts: 1, retryAt: 0 } } } });
  const status = await h.store.status(); assert.equal(status.connected, false); assert.deepEqual(status.preferences.keywords, ['react']); assert.equal(status.scanningEnabled, false);
  assert.equal(h.data.version, 3); assert.equal(h.data.seen['PeoplePerHour:1'], true); assert.equal(h.data.projects['PeoplePerHour:1']!.deliveries['7']!.state, 'sent');
  assert.equal(h.data.token, undefined);
});
test('baseline is permanent despite metadata changes and previously known IDs never notify', async () => {
  const h = harness(); await h.connect(); const cutoff = h.data.connection!.cutoff;
  await h.seed({ ...h.data, seen: { 'PeoplePerHour:2': true } });
  await h.store.ingest(batch(1, cutoff + 1000)); h.advance(); await h.store.ingest(batch(2, h.now - 1000)); await h.store.ingest(batch(1, cutoff + 1000, 'Enriched Python project'));
  assert.equal(h.sent.length, 1);
});
test('API logout and recovery notices are independent of the project baseline', async () => {
  const h = harness(); await h.connect();
  await h.store.recordAccess('PeoplePerHour', 'login_required'); h.advance(); await h.store.recordAccess('PeoplePerHour', 'login_required');
  assert.equal(h.sent.length, 2); assert.match(h.sent[1]!.text, /login required/);
  await h.store.recordAccess('PeoplePerHour', 'authenticated'); assert.equal(h.sent.length, 3); assert.match(h.sent[2]!.text, /signed in again/);
});
test('token-bearing network exceptions are redacted', async () => {
  const api = new DirectTelegram(async () => { throw new Error(token); });
  await assert.rejects(api.call(token, 'getMe'), error => error instanceof Error && !error.message.includes(token));
});
test('preconfigured Start setup waits safely, survives restart and activates without a code or updates polling', async () => {
  const h = harness('7', '7'); h.fail('notStarted');
  const waiting = await h.store.beginConnection(''); assert.equal(waiting.connected, false); assert.equal(waiting.automaticSetup, true); assert.equal(h.sent.length, 0);
  h.restart(); h.advance(31000); await h.store.pulse(); assert.equal(h.sent.length, 0);
  h.fail('none'); h.advance(31000); const active = await h.store.pulse(); assert.equal(active.connected, true); assert.equal(active.chatId, '7'); assert.equal(h.sent.length, 1);
  h.restart(); await h.store.pulse(); assert.equal(h.sent.length, 1); assert.ok(h.calls.every(c => c.method !== 'getUpdates'));
});

test('automatic setup honors rate limits and does not resend an uncertain setup delivery', async () => {
  for (const mode of ['rate', 'network'] as const) {
    const h = harness('7', '7'); h.fail(mode); await h.store.beginConnection('');
    assert.equal(h.data.pending!.delivery.state, mode === 'rate' ? 'pending' : 'unknown');
    h.restart(); h.advance(31000); h.fail('none'); await h.store.pulse();
    assert.equal((await h.store.status()).connected, mode === 'rate'); assert.equal(h.sent.length, mode === 'rate' ? 1 : 0);
  }
});

test('partial, failed, HTML-only and later-page initial scans cannot establish a baseline', async () => {
  const h = harness(); await h.connect();
  for (const modify of [
    (p: ReturnType<typeof batch>) => { p.listing.completeness = 'partial'; },
    (p: ReturnType<typeof batch>) => { p.listing.source = 'html'; },
    (p: ReturnType<typeof batch>) => { p.pageUrl += '?page=2'; p.listing.scope = p.pageUrl; p.listing.page = 'later'; },
    (p: ReturnType<typeof batch>) => { p.listing.settled = false; },
  ]) { const p = batch(1, h.now); modify(p); await h.store.ingest(p); assert.deepEqual(h.data.baselines, []); }
  await assert.rejects(h.store.ingest({ platform: 'PeoplePerHour', pageUrl: batch(1, h.now).pageUrl, projects: [] }));
  await h.store.ingest(batch(2, h.now)); assert.deepEqual(h.data.baselines, ['PeoplePerHour']); assert.equal(h.sent.length, 1);
  h.advance(); await h.store.ingest(batch(1, h.now - 1000)); assert.equal(h.sent.length, 1);
  await h.store.ingest(batch(3, h.data.baselineAt.PeoplePerHour! - 1000)); assert.equal(h.sent.length, 1);
});

test('only explicit settled empty results establish an empty baseline; a later new project notifies', async () => {
  const h = harness(); await h.connect(); const p = { ...batch(1, h.now), projects: [] as ReturnType<typeof batch>['projects'] }; p.listing.completeness = 'empty';
  await h.store.ingest(p); assert.deepEqual(h.data.baselines, ['PeoplePerHour']); assert.equal(h.sent.length, 1);
  h.advance(); await h.store.ingest(batch(2, h.now - 1000)); assert.equal(h.sent.length, 2);
});

test('a staged partial new project waits for a complete scan and repeated concurrent events notify once', async () => {
  const h = harness(); await h.connect(); await h.store.ingest(batch(1, h.now)); h.advance();
  const p = batch(2, h.now - 1000); p.listing.completeness = 'partial'; await h.store.ingest(p); assert.equal(h.sent.length, 1);
  p.listing.completeness = 'complete'; p.listing.source = 'html';
  await Promise.all(Array.from({ length: 20 }, () => h.store.ingest(p))); assert.equal(h.sent.length, 2);
  h.restart(); await Promise.all([h.store.pulse(), h.store.ingest(p)]); assert.equal(h.sent.length, 2);
});

test('contradictory pagination metadata cannot declare a first-page baseline', async () => {
  const h = harness(); await h.connect(); const p = batch(1, h.now); p.pageUrl += '?page=2'; p.listing.scope = p.pageUrl;
  await h.store.ingest(p); assert.deepEqual(h.data.baselines, []); assert.equal(h.sent.length, 1);
});

test('independent store instances sharing an exclusive storage lock claim one delivery', async () => {
  const h = harness(); await h.connect(); await h.store.ingest(batch(1, h.now)); h.advance();
  const peer = h.peer(); const p = batch(2, h.now - 1000);
  await Promise.all([h.store.ingest(p), peer.ingest(p), h.store.pulse(), peer.pulse()]); assert.equal(h.sent.length, 2);
});

test('successful network send with failed storage commit is never automatically sent again after restart', async () => {
  const h = harness(); await h.connect(); await h.store.ingest(batch(1, h.now)); h.advance(); h.failCommit();
  await assert.rejects(h.store.ingest(batch(2, h.now - 1000)), /commit failure/);
  assert.equal(h.sent.length, 2); assert.equal(h.data.projects['PeoplePerHour:2']!.deliveries['7']!.state, 'sending');
  h.restart(); await h.store.pulse(); assert.equal(h.sent.length, 2); assert.equal(h.data.projects['PeoplePerHour:2']!.deliveries['7']!.state, 'unknown');
});

test('signed-in users get one jobs-page reminder per missing-page episode, including across worker restarts', async () => {
  const h = harness(); await h.connect();
  await h.store.recordListingPresence('PeoplePerHour', false); assert.equal(h.sent.length, 1);
  await h.store.recordAccess('PeoplePerHour', 'authenticated'); h.advance();
  await Promise.all(Array.from({ length: 12 }, () => h.store.recordListingPresence('PeoplePerHour', false)));
  assert.equal(h.sent.length, 2); assert.match(h.sent[1]!.text, /https:\/\/www.peopleperhour.com\/freelance-jobs/);
  h.restart(); await h.store.recordListingPresence('PeoplePerHour', false); await h.store.pulse(); assert.equal(h.sent.length, 2);
  await h.store.recordListingPresence('PeoplePerHour', true); h.advance(); await h.store.recordListingPresence('PeoplePerHour', false); assert.equal(h.sent.length, 3);
  assert.deepEqual(h.data.baselines, []); assert.deepEqual(h.data.projects, {});
});

test('jobs-page reminders respect platform state, scanning, filters and private recipients', async () => {
  const a = harness('7'); const b = harness('8'); await a.connect(); await b.connect();
  for (const h of [a, b]) { await h.store.recordAccess('Guru', 'authenticated'); h.advance(); }
  await a.store.recordListingPresence('Guru', false); await b.store.recordListingPresence('Guru', true);
  assert.equal(a.sent.length, 3); assert.equal(b.sent.length, 2); assert.equal(a.sent[2]!.chat_id, '7'); assert.match(a.sent[2]!.text, /https:\/\/www.guru.com\/work\//);
  await a.store.recordListingPresence('Guru', true); await a.store.recordAccess('Guru', 'login_required'); const before = a.sent.length;
  await a.store.recordListingPresence('Guru', false); assert.equal(a.sent.length, before);
  await b.store.setScanning(false); await b.store.recordListingPresence('Guru', false); assert.equal(b.sent.length, 2);
  await b.store.setScanning(true); await b.seed({ ...b.data, selectedPlatforms: ['PeoplePerHour'] }); await b.store.recordListingPresence('Guru', false); assert.equal(b.sent.length, 2);
});

test('queued jobs-page reminder is suppressed when a listing opens before its rate-limit retry', async () => {
  const h = harness(); await h.connect(); await h.store.recordAccess('Guru', 'authenticated'); h.advance(); h.fail('rate');
  await h.store.recordListingPresence('Guru', false); assert.equal(h.data.notices.at(-1)!.delivery.state, 'pending');
  await h.store.recordListingPresence('Guru', true); h.advance(12000); await h.store.pulse(); assert.equal(h.sent.length, 2); assert.equal(h.data.notices.at(-1)!.delivery.state, 'suppressed');
});

test('later publication metadata can recover a missed new project on either platform without resetting first detection or baseline', async () => {
  for (const platform of ['PeoplePerHour', 'Guru'] as const) {
    const h = harness(); await h.connect();
    const make = (id: number, age: string) => {
      const p = batch(id, h.now); p.platform = platform;
      if (platform === 'Guru') { p.pageUrl = 'https://www.guru.com/work/'; p.listing.scope = p.pageUrl; p.projects[0]!.url = `https://www.guru.com/jobs/python/${id}`; }
      p.projects[0]!.publishedAt = age; return p;
    };
    await h.store.ingest(make(1, '4 hours ago')); const watermark = h.data.baselineAt[platform]; h.advance(15 * 60000);
    await h.store.ingest(make(2, 'just now')); assert.equal(h.sent.length, 1);
    const firstSeen = h.data.projects[platform + ':2']!.project.detectedAt;
    h.advance(7 * 60000); await h.store.ingest(make(2, platform === 'Guru' ? 'Posted 7 mins ago \u00b7 2 Quotes Received' : '7 minutes ago'));
    assert.equal(h.sent.length, 2, platform); assert.equal(h.data.projects[platform + ':2']!.project.detectedAt, firstSeen); assert.equal(h.data.baselineAt[platform], watermark);
    h.restart(); await h.store.ingest(make(2, '7 minutes ago')); assert.equal(h.sent.length, 2);
    await h.store.ingest(make(1, 'just now')); assert.equal(h.sent.length, 2); // Baseline membership is permanent.
  }
});

test('missing initial publication age can be filled later while a relative old project never becomes new by aging', async () => {
  const h = harness(); await h.connect(); await h.store.ingest(batch(1, h.now)); h.advance(15 * 60000);
  const missing = batch(2, h.now); delete (missing.projects[0] as { publishedAt?: string }).publishedAt; await h.store.ingest(missing);
  const old = batch(3, h.now); old.projects[0]!.publishedAt = '30 minutes ago'; await h.store.ingest(old); assert.equal(h.sent.length, 1);
  h.advance(7 * 60000); missing.projects[0]!.publishedAt = '7 minutes ago'; old.projects[0]!.publishedAt = '37 minutes ago';
  await h.store.ingest(missing); await h.store.ingest(old); assert.equal(h.sent.length, 2);
});

test('a static old relative-age label cannot drift forward across repeated scans', async () => {
  const h = harness(); await h.connect(); await h.store.ingest(batch(1, h.now)); h.advance(5 * 60000);
  const old = batch(2, h.now); old.projects[0]!.publishedAt = '7 minutes ago'; await h.store.ingest(old); assert.equal(h.sent.length, 1);
  h.advance(30 * 60000); await h.store.ingest(old); assert.equal(h.sent.length, 1);
});

test('detail enrichment skips baselines, persists complete metadata across rescans and rate-limit retries, and never duplicates lookup', async () => {
  let reads = 0;
  const h = harness('7', '', async () => { reads++; return { budget: '$250', category: 'Design', skills: ['Video Editing'], description: 'Complete project description from its detail page.', client: { ratingScore: '100%', reviewCount: 10, joinedAt: 'January 2024' } }; });
  await h.connect(); await h.store.ingest(batch(1, h.now)); assert.equal(reads, 0); h.advance(10 * 60000);
  h.fail('rate'); await h.store.ingest(batch(2, h.now - 60000)); assert.equal(reads, 1); assert.equal(h.sent.length, 1);
  const shorter = batch(2, h.now - 60000); await h.store.ingest(shorter);
  h.restart(); h.advance(31000); await h.store.pulse(); assert.equal(reads, 1); assert.equal(h.sent.length, 2);
  for (const value of ['Budget: $250', 'Category: Design', 'Skills: Video Editing', 'Client rating: 100%', 'Client reviews: 10', 'Client joined: January 2024']) assert.ok(h.sent[1]!.text.includes(value), value);
  await h.store.ingest(shorter); assert.equal(h.sent.length, 2);
});

test('detail failure does not suppress the new project alert and is not repeatedly fetched on restart', async () => {
  let reads = 0; const h = harness('7', '', async () => { reads++; throw new Error('synthetic blocked detail'); });
  await h.connect(); await h.store.ingest(batch(1, h.now)); h.advance(10 * 60000); await h.store.ingest(batch(2, h.now - 60000));
  assert.equal(h.sent.length, 2); assert.equal(reads, 1); assert.match(h.sent[1]!.text, /Client joined: Not provided/);
  assert.match((await h.store.status()).monitoringIssue, /details could not be read/);
  h.restart(); h.advance(31000); await h.store.pulse(); assert.equal(reads, 1); assert.equal(h.sent.length, 2);
});

test('several projects found in one scan are delivered promptly rather than queued thirty seconds apart', async () => {
  let lookups = 0; const h = harness('7', '', async () => { lookups++; return { budget: '$250' }; });
  await h.connect(); await h.store.ingest(batch(1, h.now)); h.advance(10 * 60000); const started = h.now;
  const burst = batch(2, h.now - 60000); burst.projects.push(...batch(3, h.now - 60000).projects, ...batch(4, h.now - 60000).projects);
  await h.store.ingest(burst); assert.equal(h.sent.length, 4); assert.equal(lookups, 3); assert.ok(h.now - started < 5000);
  assert.ok(h.sent.slice(1).every(message => !message.text.includes('Description:')));
});

test('upgrading an already signed-in Guru session refreshes its status and missing-page reminder once without resetting history', async () => {
  const h = harness(); await h.connect(); await h.store.ingest(batch(1, h.now));
  const old = h.data; old.access.Guru = { status: 'authenticated', generation: 1 }; old.listingLocations = { Guru: { available: false, generation: 1, accessGeneration: 1, epoch: old.connection!.epoch } }; delete old.guruSessionProbeVersion;
  await h.seed(old); h.advance(); await h.store.recordAccess('Guru', 'authenticated'); await h.store.recordListingPresence('Guru', false);
  assert.equal(h.sent.length, 3); assert.match(h.sent[1]!.text, /Guru: signed in\./); assert.match(h.sent[2]!.text, /https:\/\/www.guru.com\/work\//);
  assert.equal(h.data.seen['PeoplePerHour:1'], true); assert.deepEqual(h.data.baselines, ['PeoplePerHour']);
  h.restart(); await h.store.recordAccess('Guru', 'authenticated'); await h.store.recordListingPresence('Guru', false); assert.equal(h.sent.length, 3);
});
