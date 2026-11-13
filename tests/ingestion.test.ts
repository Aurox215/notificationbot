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
import { Monitor } from '../src/monitoring/monitor.js';
import { createSources } from '../src/sources/registry.js';

const token = 'x'.repeat(64);
const extensionId = 'a'.repeat(32);
const batch = (ids: number[] = [101]): ScanPayload => ({ platform: 'PeoplePerHour', pageUrl: 'https://www.peopleperhour.com/freelance-jobs',
  projects: ids.map(id => ({ sourceId: String(id), url: `https://www.peopleperhour.com/freelance-jobs/python-api-${id}`, title: 'Python API', skills: ['Python'] })) });

test('ingestion configuration requires token and local port without any extension ID registration', () => {
  assert.equal(readIngestionConfig({}), undefined);
  assert.throws(() => readIngestionConfig({ INGESTION_ENABLED: 'true' }), /TOKEN/);
  assert.deepEqual(readIngestionConfig({ INGESTION_ENABLED: 'true', INGESTION_TOKEN: token }), { token, port: 4318 });
  assert.equal(readIngestionConfig({ INGESTION_ENABLED: 'true', INGESTION_TOKEN: token, INGESTION_EXTENSION_ID: 'obsolete-value' })!.port, 4318);
  assert.deepEqual(createSources('extension'), []);
});

test('additive migration preserves existing project identities and notification eligibility', () => {
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
    assert.equal(store.projects(true)[0]!.project.title, project.title);
    assert.equal(store.saveProject(project), 7);
    assert.equal(store.projects(true, 'extension').length, 0);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});
test('untrusted scan validation rejects bad origins/IDs, missing platform, oversized or invalid optional data', () => {
  for (const value of [null, {}, { ...batch(), platform: undefined }, { ...batch(), pageUrl: 'https://evil.example/' },
    { ...batch(), projects: [] }, { ...batch(), projects: [{ ...batch().projects[0], sourceId: 'other' }] },
    { ...batch(), projects: [{ ...batch().projects[0], url: 'http://127.0.0.1/secret' }] },
    { ...batch(), projects: [{ ...batch().projects[0], skills: [123] }] },
    { ...batch(), projects: [{ ...batch().projects[0], description: 'x'.repeat(5001) }] }]) assert.throws(() => validateScan(value));
  const scan = validateScan({ ...batch(), projects: [{ ...batch().projects[0], detectedAt: 'bad', notify: true, chatId: 'victim', client: { ratingScore: 'invented' } }] });
  assert.ok(scan.projects[0]!.detectedAt instanceof Date);
  assert.equal(scan.projects[0]!.client, undefined);
});
test('first batch is permanently silent across restarts/new subscribers; later projects use existing filters and deduplication', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'bidbot-ingestion-'));
  const path = join(directory, 'test.sqlite');
  let store = new Store(path, []);
  try {
    store.setState('source_mode', 'extension');
    store.ensureUser('1', '1'); store.preferences('1', { subscribed: true, keywords: ['Python'] });
    const baseline = validateScan(batch());
    assert.equal(store.ingest(baseline.platform, baseline.projects).baseline, true);
    let sent = 0;
    const messenger = { send: async () => { sent++; } };
    await new Monitor(store, [], messenger, 0).tick(new AbortController().signal);
    assert.equal(sent, 0);
    store.close(); store = new Store(path, []);
    store.ensureUser('2', '2'); store.preferences('2', { subscribed: true, keywords: ['React'] });
    const later = validateScan(batch([101, 102]));
    const result = store.ingest(later.platform, later.projects);
    assert.deepEqual(result, { baseline: false, received: 2, inserted: 1 });
    const monitor = new Monitor(store, [], messenger, 0);
    await monitor.tick(new AbortController().signal);
    assert.equal(sent, 1);
    store.ingest(later.platform, later.projects);
    await monitor.tick(new AbortController().signal);
    assert.equal(sent, 1);
    store.ensureUser('3', '3'); store.preferences('3', { subscribed: true });
    await monitor.tick(new AbortController().signal);
    assert.equal(sent, 2); // new subscriber may receive 102, never baseline 101
    assert.equal(store.projects().length, 2);
    assert.equal(store.projects(true).length, 1);
    const guru = validateScan({ platform: 'Guru', pageUrl: 'https://www.guru.com/work/', projects: [{ sourceId: '201', title: 'Python', url: 'https://www.guru.com/jobs/python/201' }] });
    assert.equal(store.ingest('Guru', guru.projects).baseline, true);
    await monitor.tick(new AbortController().signal);
    assert.equal(sent, 2);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('local endpoint enforces origin, token, Host and schema before creating any baseline', async () => {
  const store = new Store(':memory:', []);
  const server = createIngestionServer(store, { port: 0, token });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = (server.address() as { port: number }).port;
  const url = `http://127.0.0.1:${port}`;
  const headers = { Origin: `chrome-extension://${extensionId}`, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  try {
    assert.equal((await fetch(url + '/health', { headers })).status, 200);
    // Unregistered installations work with the same pairing credential; IDs never authorize alone.
    const secondOrigin = `chrome-extension://${'b'.repeat(32)}`;
    const second = await fetch(url + '/health', { headers: { ...headers, Origin: secondOrigin } });
    assert.equal(second.status, 200);
    assert.equal(second.headers.get('access-control-allow-origin'), secondOrigin);
    assert.equal((await fetch(url + '/health', { headers: { Origin: secondOrigin } })).status, 401);
    const preflight = await fetch(url + '/v1/ingest', { method: 'OPTIONS', headers: { Origin: secondOrigin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), secondOrigin);
    for (const origin of ['null', 'chrome-extension://invalid', `chrome-extension://${'a'.repeat(32)}.evil.example`, `https://${'a'.repeat(32)}`]) {
      assert.equal((await fetch(url + '/health', { headers: { ...headers, Origin: origin } })).status, 403);
    }
    assert.equal((await fetch(url + '/health', { headers: { ...headers, Origin: 'https://www.guru.com' } })).status, 403);
    assert.equal((await fetch(url + '/health', { headers: { ...headers, Authorization: 'Bearer wrong' } })).status, 401);
    const invalidHost = await new Promise<number>(resolve => {
      const req = request(url + '/health', { headers: { ...headers, Host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode!); });
      req.end();
    });
    assert.equal(invalidHost, 403);
    assert.equal((await fetch(url + '/health')).status, 401);
    assert.equal((await fetch(url + '/health', { headers: { Authorization: `Bearer ${token}` } })).status, 200);
    const send = (data: unknown, custom = headers) => fetch(url + '/v1/ingest', { method: 'POST', headers: custom, body: JSON.stringify(data) });
    assert.equal((await send(batch(), { ...headers, Authorization: '' })).status, 401);
    assert.equal((await send({ ...batch(), projects: [batch().projects[0], { title: 'bad' }] })).status, 400);
    assert.equal(store.projects().length, 0);
    const first = await send(batch());
    assert.equal(first.status, 200);
    assert.equal((await first.json() as { baseline: boolean }).baseline, true);
    const otherInstallation = await send(batch(), { ...headers, Origin: secondOrigin });
    assert.equal(otherInstallation.status, 200);
    assert.equal((await otherInstallation.json() as { inserted: number }).inserted, 0);
    assert.equal((await send(batch(), { ...headers, Origin: secondOrigin, Authorization: '' })).status, 401);
    assert.equal((await (await send(batch())).json() as { inserted: number }).inserted, 0);
    assert.equal((await send(batch(), { ...headers, 'Content-Type': 'text/plain' })).status, 415);
    const tooLarge = await fetch(url + '/v1/ingest', { method: 'POST', headers, body: 'x'.repeat(270000) });
    assert.equal(tooLarge.status, 413);
    assert.equal(store.projects().length, 1);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); store.close(); }
});
