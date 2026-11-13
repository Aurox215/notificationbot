import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { SourceRunner, type StateStorage } from '../src/monitoring/source-runner.js';
import { monitoringHealth } from '../src/monitoring/health.js';
import { SourceError } from '../src/sources/errors.js';
import { createSources } from '../src/sources/registry.js';
import { validateProjects } from '../src/sources/validation.js';
import type { ProjectSource, SourceProject } from '../src/sources/types.js';
import { Store } from '../src/persistence/store.js';
import { Monitor } from '../src/monitoring/monitor.js';
import { readRuntimeConfig } from '../src/config/runtime.js';
import type { LogFields } from '../src/logging/logger.js';

function memory(): StateStorage {
  const values = new Map<string, string>();
  return { getState: key => values.get(key), setState: (key, value) => { values.set(key, value); } };
}
const signal = () => new AbortController().signal;
const quiet = () => {};

test('source registry preserves mocks and fails closed for every unverified live mode', async () => {
  const sources = createSources();
  assert.deepEqual(sources.map(s => s.platform), ['PeoplePerHour', 'Guru']);
  for (const source of sources) assert.match((await source.fetchProjects(signal()))[0]!.title, /MOCK/);
  for (const mode of ['live', 'rss', 'https://example.com']) assert.throws(() => createSources(mode), /unverified/);
  assert.throws(() => readRuntimeConfig({ SOURCE_MODE: 'live' }), /authorization/);
});

test('source retry policy validates configuration', () => {
  const env = { TELEGRAM_BOT_TOKEN: '123:fake' };
  const settings = readRuntimeConfig(env);
  assert.equal(settings.sourceOptions.timeoutMs, 15000);
  assert.equal(settings.sourceMode, 'mock');
  assert.throws(() => readRuntimeConfig({ ...env, SOURCE_TIMEOUT_MS: 'NaN' }), /TIMEOUT/);
  assert.throws(() => readRuntimeConfig({ ...env, SOURCE_RETRY_BASE_MS: '5000', SOURCE_RETRY_MAX_MS: '1000' }), /at least/);
  assert.throws(() => new SourceRunner(memory(), { intervalMs: 0 }), /Invalid/);
});

test('source backoff persists between runners, grows to cap, honors interval, then recovers', async () => {
  const storage = memory();
  let now = 1000;
  let calls = 0;
  let fail = true;
  const events: LogFields[] = [];
  const source: ProjectSource = { platform: 'Guru', fetchProjects: async () => {
    calls++;
    if (fail) throw new SourceError('network');
    return [];
  } };
  const options = { intervalMs: 100, retryBaseMs: 200, retryMaxMs: 500 };
  const runner = () => new SourceRunner(storage, options, () => now, (_level, _message, fields) => { events.push(fields); });
  let fetcher = runner();
  await fetcher.fetch(source, signal());
  assert.equal(fetcher.health('Guru').nextAttemptAt, 1200);
  fetcher = runner(); // reload persisted cooldown
  await fetcher.fetch(source, signal());
  assert.equal(calls, 1);
  now = 1200; await fetcher.fetch(source, signal());
  assert.equal(fetcher.health('Guru').nextAttemptAt, 1600);
  now = 1600; await fetcher.fetch(source, signal());
  assert.equal(fetcher.health('Guru').nextAttemptAt, 2100);
  fail = false; now = 2100;
  assert.deepEqual(await fetcher.fetch(source, signal()), []);
  assert.equal(fetcher.health('Guru').status, 'healthy');
  assert.equal(fetcher.health('Guru').consecutiveFailures, 0);
  assert.equal(fetcher.health('Guru').errorCode, null);
  assert.equal(events.at(-1)!.event, 'source.recovered');
  assert.equal(fetcher.health('Guru').nextAttemptAt, 2200);
});

test('typed source rate limits can exceed the exponential backoff cap', async () => {
  const fetcher = new SourceRunner(memory(), { intervalMs: 100, retryBaseMs: 100, retryMaxMs: 200 }, () => 1000, quiet);
  await fetcher.fetch({ platform: 'Guru', fetchProjects: async () => { throw new SourceError('rate_limit', 5000); } }, signal());
  assert.equal(fetcher.health('Guru').nextAttemptAt, 6000);
});

test('authentication, permission and configuration failures block retries across restarts', async () => {
  for (const code of ['authentication', 'permission', 'configuration'] as const) {
    const storage = memory(); let calls = 0;
    const source: ProjectSource = { platform: 'Guru', fetchProjects: async () => { calls++; throw new SourceError(code); } };
    await new SourceRunner(storage, {}, () => 1000, quiet).fetch(source, signal());
    const restarted = new SourceRunner(storage, {}, () => 9999999, quiet);
    await restarted.fetch(source, signal());
    assert.equal(calls, 1);
    assert.equal(restarted.health('Guru').status, 'blocked');
    assert.equal(restarted.health('Guru').nextAttemptAt, null);
  }
});

test('source deadlines discard late data and avoid overlapping a non-cooperative adapter', async () => {
  let now = 1000; let calls = 0;
  let release!: (projects: SourceProject[]) => void;
  const source: ProjectSource = { platform: 'Guru', fetchProjects: () => {
    calls++;
    return calls === 1 ? new Promise(resolve => { release = resolve; }) : Promise.resolve([]);
  } };
  const fetcher = new SourceRunner(memory(), { intervalMs: 1, timeoutMs: 10, retryBaseMs: 1 }, () => now, quiet);
  assert.equal(await fetcher.fetch(source, signal()), undefined);
  assert.equal(fetcher.health('Guru').errorCode, 'timeout');
  now = 99999;
  assert.equal(await fetcher.fetch(source, signal()), undefined);
  assert.equal(calls, 1);
  release([{ platform: 'Guru', sourceId: 'late', title: 'late data', detectedAt: new Date() }]);
  await Promise.resolve();
  assert.equal(fetcher.health('Guru').lastSuccessAt, null);
  assert.deepEqual(await fetcher.fetch(source, signal()), []);
  assert.equal(calls, 2);
});

test('shutdown cancellation does not count as a source failure or wait for deadline', async () => {
  const controller = new AbortController();
  const fetcher = new SourceRunner(memory(), {}, Date.now, quiet);
  const source: ProjectSource = { platform: 'Guru', fetchProjects: async () => { controller.abort(); return []; } };
  assert.equal(await fetcher.fetch(source, controller.signal), undefined);
  assert.equal(fetcher.health('Guru').consecutiveFailures, 0);
});

test('invalid batches are rejected before persistence and errors never leak upstream secrets', async () => {
  const records: unknown[] = [];
  const storage = memory();
  let now = 1000;
  const fetcher = new SourceRunner(storage, { intervalMs: 1, retryBaseMs: 1 }, () => now,
    (level, message, fields) => { records.push({ level, message, ...fields }); });
  let calls = 0;
  const source: ProjectSource = { platform: 'Guru', fetchProjects: () => { calls++; throw new Error('https://secret:token@example.com?oauth=private'); } };
  await fetcher.fetch(source, signal());
  now += 10;
  await fetcher.fetch(source, signal()); // synchronous throws must clear in-flight guard
  assert.equal(calls, 2);
  assert.equal(fetcher.health('Guru').errorCode, 'unexpected');
  assert.ok(!JSON.stringify(records).includes('secret'));
  assert.ok(!JSON.stringify(records).includes('oauth'));
  assert.equal((records[0] as LogFields).event, 'source.failed');

  const store = new Store(':memory:', []);
  try {
    const invalid: ProjectSource = { platform: 'Guru', fetchProjects: async () => [
      { platform: 'Guru', sourceId: 'valid', title: 'valid', detectedAt: new Date() },
      { platform: 'Guru', sourceId: '', title: 'invalid', detectedAt: new Date() },
    ] };
    await new Monitor(store, [invalid], { send: async () => {} }, 0).tick(signal());
    assert.equal(store.projects().length, 0);
  } finally { store.close(); }
});

test('source schema validation preserves missing fields and rejects bad optional fields', () => {
  const valid: SourceProject = { platform: 'Guru', sourceId: 'x', title: 'Python', detectedAt: new Date() };
  validateProjects([valid], 'Guru');
  for (const change of [{ platform: 'PeoplePerHour' }, { detectedAt: new Date('bad') }, { skills: [123] },
    { client: { reviewCount: -1 } }, { url: 'javascript:alert(1)' }, { url: 'https://user:password@example.com/' }]) {
    assert.throws(() => validateProjects([{ ...valid, ...change }], 'Guru'), /invalid_data/);
  }
});

test('shared monitor fetches each platform once independent of subscriber count', async () => {
  const store = new Store(':memory:', []);
  try {
    for (const id of ['1', '2', '3', '4']) { store.ensureUser(id, id); store.preferences(id, { subscribed: true }); }
    const counts = { Guru: 0, PeoplePerHour: 0 };
    const sources: ProjectSource[] = createSources().map(source => ({ platform: source.platform, fetchProjects: async s => {
      counts[source.platform]++;
      return source.fetchProjects(s);
    } }));
    let sent = 0;
    const messenger = { send: async () => { sent++; } };
    const monitor = new Monitor(store, sources, messenger, 0);
    await monitor.tick(signal());
    assert.deepEqual(counts, { Guru: 1, PeoplePerHour: 1 });
    assert.equal(sent, 8);
    assert.throws(() => new Monitor(store, [sources[0]!, sources[0]!], messenger), /one source/);
    assert.equal(monitoringHealth(store, 60000).healthy, true);
  } finally { store.close(); }
});

test('health detects startup, stale cycles/sources, degraded status and blocked status', async () => {
  const storage = memory(); let now = 1000;
  assert.equal(monitoringHealth(storage, 100, now).healthy, false);
  const fetcher = new SourceRunner(storage, { intervalMs: 1 }, () => now, quiet);
  for (const source of createSources()) await fetcher.fetch(source, signal());
  storage.setState('monitoring_cycle', JSON.stringify({ startedAt: now, completedAt: now, ok: true }));
  assert.equal(monitoringHealth(storage, 100, now).healthy, true);
  assert.equal(monitoringHealth(storage, 100, now).liveEnabled, false);
  assert.equal(monitoringHealth(storage, 100, now + 101).healthy, false);
  now++;
  await fetcher.fetch({ platform: 'Guru', fetchProjects: async () => { throw new SourceError('permission'); } }, signal());
  assert.equal(monitoringHealth(storage, 100, now).healthy, false);
  assert.equal(monitoringHealth(storage, 100, now).sources.find(s => s.platform === 'Guru')!.status, 'blocked');
});

test('health CLI reads existing SQLite without changing in-flight notification recovery state', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'bidbot-health-'));
  const path = join(directory, 'test.sqlite');
  const store = new Store(path, []);
  try {
    await new Monitor(store, createSources(), { send: async () => {} }, 0).tick(signal());
    store.ensureUser('1', '1');
    const projectId = store.projects()[0]!.id;
    store.enqueue('1', projectId); store.claim('1', projectId);
    const result = spawnSync(process.execPath, [resolve(__dirname, '../src/cli/health.js')], {
      env: { ...process.env, DATABASE_PATH: path, HEALTH_STALE_MS: '60000', MONITOR_INTERVAL_MS: '5000' }, encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal((JSON.parse(result.stdout) as { healthy: boolean }).healthy, true);
    assert.equal(store.history('1')[0]!.state, 'sending');
    store.setState('monitoring_cycle', JSON.stringify({ startedAt: 1, completedAt: 1, ok: true }));
    const stale = spawnSync(process.execPath, [resolve(__dirname, '../src/cli/health.js')], {
      env: { ...process.env, DATABASE_PATH: path, HEALTH_STALE_MS: '60000' }, encoding: 'utf8',
    });
    assert.equal(stale.status, 1);
    assert.equal((JSON.parse(stale.stdout) as { healthy: boolean }).healthy, false);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('a failed platform does not block the other and its cooldown survives a SQLite restart', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'bidbot-source-restart-'));
  const path = join(directory, 'test.sqlite');
  let store = new Store(path, []);
  try {
    let failedCalls = 0; let successfulCalls = 0; let deliveries = 0;
    const broken: ProjectSource = { platform: 'PeoplePerHour', fetchProjects: async () => {
      failedCalls++; throw new SourceError('network');
    } };
    const guru = createSources().find(s => s.platform === 'Guru')!;
    const working: ProjectSource = { platform: 'Guru', fetchProjects: async s => { successfulCalls++; return guru.fetchProjects(s); } };
    const messenger = { send: async () => { deliveries++; } };
    store.ensureUser('1', '1'); store.preferences('1', { subscribed: true });
    await new Monitor(store, [broken, working], messenger, 0).tick(signal());
    assert.equal(deliveries, 1);
    assert.equal(monitoringHealth(store, 60000).healthy, false);
    store.close(); store = new Store(path, []);
    await new Monitor(store, [broken, working], messenger, 0).tick(signal());
    assert.equal(failedCalls, 1);
    assert.equal(successfulCalls, 1);
    assert.equal(deliveries, 1);
    assert.equal(monitoringHealth(store, 60000).sources.find(s => s.platform === 'PeoplePerHour')!.errorCode, 'network');
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});
