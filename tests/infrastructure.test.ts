import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../src/persistence/store.js';
import { CommandHandler, type Messenger } from '../src/bot/commands.js';
import { Monitor, runScheduler } from '../src/monitoring/monitor.js';
import { MockPeoplePerHourSource } from '../src/sources/peopleperhour.js';
import { MockGuruSource } from '../src/sources/guru.js';
import type { ProjectSource, SourceProject } from '../src/sources/types.js';
import { matchesKeywords } from '../src/filtering/keywords.js';
import { readRuntimeConfig } from '../src/config/runtime.js';
import { TelegramClient, TelegramError, type TelegramUpdate } from '../src/telegram/client.js';
import { runPolling } from '../src/bot/polling.js';

const signal = () => new AbortController().signal;
const sources = () => [new MockPeoplePerHourSource(), new MockGuruSource()];
const update = (id: number, text: string, chatType = 'private'): TelegramUpdate => ({
  update_id: id, message: { text, from: { id }, chat: { id, type: chatType } },
});
function recorder() {
  const sent: { text: string; chatId: string }[] = [];
  const messenger: Messenger = { send: async (text, chatId) => { sent.push({ text, chatId }); } };
  return { sent, messenger };
}

test('runtime validates shared interval and source mode without requiring a fixed chat ID', () => {
  const env = { TELEGRAM_BOT_TOKEN: '123:fake' };
  assert.equal(readRuntimeConfig(env).intervalMs, 5000);
  assert.throws(() => readRuntimeConfig({ ...env, MONITOR_INTERVAL_MS: '0' }), /INTERVAL/);
  assert.throws(() => readRuntimeConfig({ ...env, SOURCE_MODE: 'live' }), /mock/);
});

test('keyword matching handles boundaries, punctuation, literal syntax and missing fields', () => {
  const project = { platform: 'Guru' as const, title: 'Next.js API integration with C++', detectedAt: new Date() };
  assert.equal(matchesKeywords(project, ['next.js']), true);
  assert.equal(matchesKeywords(project, ['API']), true);
  assert.equal(matchesKeywords(project, ['C++']), true);
  assert.equal(matchesKeywords(project, ['.*']), false);
  assert.equal(matchesKeywords({ ...project, title: 'paid painter' }, ['AI']), false);
  assert.equal(matchesKeywords(project, []), true);
  assert.equal(matchesKeywords({ ...project, title: 'Other', skills: ['Python'] }, ['python']), true);
});

test('commands register users, isolate preferences and require explicit subscription', async () => {
  const store = new Store(':memory:', ['Python']);
  try {
    const { messenger, sent } = recorder();
    const commands = new CommandHandler(store, messenger, 5000);
    await commands.handle(update(1, '/start'));
    await commands.handle(update(2, '/start'));
    assert.equal(store.user('1')!.subscribed, false);
    await commands.handle(update(1, '/resume'));
    assert.match(sent.at(-1)!.text, /subscribe first/);
    await commands.handle(update(1, '/keywords React, API'));
    await commands.handle(update(1, '/platforms Guru'));
    await commands.handle(update(1, '/subscribe'));
    assert.deepEqual(store.user('1')!.keywords, ['react', 'api']);
    assert.deepEqual(store.user('2')!.keywords, ['Python']);
    assert.deepEqual(store.user('1')!.platforms, ['Guru']);
    await commands.handle(update(1, '/pause'));
    assert.equal(store.users().length, 0);
    await commands.handle(update(1, '/resume'));
    assert.equal(store.users().length, 1);
    await commands.handle(update(1, '/status'));
    assert.match(sent.at(-1)!.text, /MOCK/);
    await commands.handle(update(1, '/help'));
    assert.match(sent.at(-1)!.text, /\/keywords/);
    await commands.handle(update(1, '/platforms Unknown'));
    assert.deepEqual(store.user('1')!.platforms, ['Guru']);
    await commands.handle(update(1, '/keywords all'));
    assert.deepEqual(store.user('1')!.keywords, []);
    await commands.handle(update(1, '/platforms all'));
    assert.deepEqual(store.user('1')!.platforms, ['PeoplePerHour', 'Guru']);
    await commands.handle(update(3, '/subscribe', 'group'));
    assert.equal(store.user('3'), undefined);
    await commands.handle({ update_id: 4, message: { text: '/subscribe', from: { id: 4 }, chat: { id: 5, type: 'private' } } });
    assert.equal(store.user('4'), undefined);
  } finally { store.close(); }
});

test('shared monitoring routes projects per user and deduplicates subsequent cycles', async () => {
  const store = new Store(':memory:', []);
  try {
    const { sent, messenger } = recorder();
    store.ensureUser('1', '1'); store.preferences('1', { subscribed: true, keywords: ['Python'] });
    store.ensureUser('2', '2'); store.preferences('2', { subscribed: true, platforms: ['Guru'] });
    store.ensureUser('3', '3'); store.preferences('3', { subscribed: true, paused: true });
    const monitor = new Monitor(store, sources(), messenger, 0);
    await monitor.tick(signal()); await monitor.tick(signal());
    assert.equal(sent.length, 2);
    assert.match(sent.find(x => x.chatId === '1')!.text, /PeoplePerHour/);
    assert.match(sent.find(x => x.chatId === '2')!.text, /Guru/);
    assert.equal(store.projects().length, 2);
    store.preferences('3', { paused: false });
    await monitor.tick(signal());
    assert.equal(sent.filter(x => x.chatId === '3').length, 2);
    store.preferences('1', { keywords: [] });
    await monitor.tick(signal());
    assert.equal(sent.filter(x => x.chatId === '1').length, 2);
  } finally { store.close(); }
});

test('SQLite preserves preferences, offsets and delivery history across restarts', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'bidbot-test-'));
  const path = join(directory, 'state.sqlite');
  let store = new Store(path, ['Python']);
  try {
    const { messenger, sent } = recorder();
    store.ensureUser('1', '1'); store.preferences('1', { subscribed: true });
    store.setState('telegram_offset', '123');
    await new Monitor(store, sources(), messenger, 0).tick(signal());
    assert.equal(sent.length, 1);
    store.close(); store = new Store(path, []);
    assert.equal(store.getState('telegram_offset'), '123');
    assert.deepEqual(store.user('1')!.keywords, ['Python']);
    await new Monitor(store, sources(), messenger, 0).tick(signal());
    assert.equal(sent.length, 1);
    assert.deepEqual(store.history('1'), [{ state: 'sent', count: 1 }]);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('uncertain sends are not retried; one user failure does not prevent another delivery', async () => {
  const store = new Store(':memory:', []);
  try {
    for (const id of ['1', '2']) { store.ensureUser(id, id); store.preferences(id, { subscribed: true }); }
    let attempts = 0;
    const messenger: Messenger = { send: async (_text, id) => { attempts++; if (id === '1') throw new Error('network timeout'); } };
    const monitor = new Monitor(store, [new MockGuruSource()], messenger, 0);
    await monitor.tick(signal()); await monitor.tick(signal());
    assert.equal(attempts, 2);
    assert.equal(store.history('1')[0]!.state, 'unknown');
    assert.equal(store.history('2')[0]!.state, 'sent');
  } finally { store.close(); }
});

test('explicit rate limits defer retries and blocked users are paused', async () => {
  const store = new Store(':memory:', []);
  try {
    store.ensureUser('1', '1'); store.preferences('1', { subscribed: true });
    let attempts = 0;
    const messenger: Messenger = { send: async () => { attempts++; throw new TelegramError('rate limit', 429, 30); } };
    await new Monitor(store, [new MockGuruSource()], messenger, 0).tick(signal());
    await new Monitor(store, [new MockGuruSource()], messenger, 0).tick(signal());
    assert.equal(attempts, 1);
    assert.equal(store.history('1')[0]!.state, 'pending');
    store.ensureUser('2', '2'); store.preferences('2', { subscribed: true });
    await new Monitor(store, [new MockGuruSource()], { send: async () => { throw new TelegramError('blocked', 403); } }, 0).tick(signal());
    assert.equal(store.user('2')!.paused, true);
  } finally { store.close(); }
});

test('source failures are isolated and overlapping cycles are skipped', async () => {
  const store = new Store(':memory:', []);
  try {
    const { sent, messenger } = recorder();
    store.ensureUser('1', '1'); store.preferences('1', { subscribed: true });
    let release!: (projects: SourceProject[]) => void;
    let calls = 0;
    const slow: ProjectSource = { platform: 'PeoplePerHour', fetchProjects: async () => { calls++; return new Promise(resolve => { release = resolve; }); } };
    const monitor = new Monitor(store, [slow, new MockGuruSource()], messenger, 0);
    const first = monitor.tick(signal());
    await monitor.tick(signal());
    release([]); await first;
    assert.equal(calls, 1);
    assert.equal(sent.length, 1);
    const broken: ProjectSource = { platform: 'PeoplePerHour', fetchProjects: async () => { throw new Error('source offline'); } };
    await new Monitor(store, [broken, new MockGuruSource()], messenger, 0).tick(signal());
    assert.equal(sent.length, 1);
  } finally { store.close(); }
});

test('scheduler stops promptly on cancellation', async () => {
  const store = new Store(':memory:', []);
  try {
    const controller = new AbortController();
    const source: ProjectSource = { platform: 'Guru', fetchProjects: async () => { controller.abort(); return []; } };
    await runScheduler(new Monitor(store, [source], recorder().messenger, 0), 5000, controller.signal);
    assert.equal(controller.signal.aborted, true);
  } finally { store.close(); }
});

test('polling persists the next update offset after handling commands', async () => {
  const store = new Store(':memory:', []);
  const controller = new AbortController();
  try {
    let calls = 0;
    const request: typeof fetch = async (_url, options) => {
      calls++;
      const body = JSON.parse(String(options?.body)) as { offset: number };
      if (calls === 1) {
        assert.equal(body.offset, 0);
        return Response.json({ ok: true, result: [update(7, '/start')] });
      }
      assert.equal(body.offset, 8);
      controller.abort();
      return Response.json({ ok: true, result: [] });
    };
    const client = new TelegramClient({ token: '123:fake', chatId: '0', timeoutMs: 1000 }, request);
    await runPolling(client, new CommandHandler(store, recorder().messenger, 5000), store, controller.signal);
    assert.equal(store.getState('telegram_offset'), '8');
    assert.ok(store.user('7'));
  } finally { store.close(); }
});

test('SQLite atomic claim prevents duplicate sends and crash recovery marks uncertain sends', () => {
  const directory = mkdtempSync(join(tmpdir(), 'bidbot-claim-'));
  const path = join(directory, 'state.sqlite');
  let store = new Store(path, []);
  try {
    store.ensureUser('1', '1');
    const project: SourceProject = { platform: 'Guru', sourceId: 'one', title: 'Example', detectedAt: new Date() };
    const id = store.saveProject(project);
    assert.equal(store.saveProject(project), id);
    store.enqueue('1', id); store.enqueue('1', id);
    assert.equal(store.claim('1', id), true);
    assert.equal(store.claim('1', id), false);
    store.close(); store = new Store(path, []);
    assert.equal(store.history('1')[0]!.state, 'unknown');
    assert.equal(store.claim('1', id), false);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});
