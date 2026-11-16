import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publishedAfter } from '../src/domain/publication.js';
import { Store } from '../src/persistence/store.js';
import { Monitor } from '../src/monitoring/monitor.js';
import type { SourceProject } from '../src/sources/types.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cutoff = Date.parse('2026-11-15T12:00:00Z');
const detectedAt = new Date(cutoff + 600000);
const project = (id: string, publishedAt?: string): SourceProject => ({
  sourceId: id, platform: 'Guru', title: id, detectedAt,
  ...(publishedAt === undefined ? {} : { publishedAt })
});
test('publication cutoff rejects old, unknown, ambiguous and future dates', () => {
  for (const value of [undefined, '', 'today', 'just now', '2026-11-15', '2026-11-15T12:01:00',
    '2026-11-15T12:00:00Z', '2026-11-15T11:59:59Z', '2026-11-15T13:00:00Z', 'Posted 10 minutes ago', 'Posted 9 minutes ago']) {
    assert.equal(publishedAfter(value, detectedAt, cutoff), false, String(value));
  }
  for (const value of ['2026-11-15T12:01:00Z', '2026-11-15T13:01:00+01:00', 'Posted 5 minutes ago']) {
    assert.equal(publishedAfter(value, detectedAt, cutoff), true, value);
  }
});
test('connection cutoff filters first scan and later old pages, persists and resets on valid approval only', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'publication-'));
  const path = join(directory, 'test.sqlite');
  let store = new Store(path, []);
  const sent: string[] = [];
  try {
    store.ensureUser('1', '1'); store.preferences('1', { subscribed: true });
    store.startAlerts('1', cutoff);
    store.ingestOwned('1', 'Guru', [project('old', '2026-11-15T11:00:00Z'), project('fresh', '2026-11-15T12:01:00Z')]);
    store.ingestOwned('1', 'Guru', [project('old-later', '2026-11-15T11:30:00Z'), project('unknown')]);
    store.close(); store = new Store(path, []);
    const monitor = new Monitor(store, [], { send: async text => { sent.push(text); } }, 0);
    await monitor.tick(new AbortController().signal);
    assert.equal(sent.length, 1); assert.match(sent[0]!, /fresh/);
    const queued = store.ingestOwned('1', 'Guru', [project('queued', '2026-11-15T12:02:00Z')]);
    assert.equal(queued.inserted, 1);
    store.createPairing('pair', 'link', 'poll', 'ABCDEF12', cutoff + 1000000, cutoff);
    store.proposePairing('link', '1', cutoff);
    assert.equal(store.approvePairing('1', 'WRONG', cutoff + 300000), false);
    assert.equal(store.getState('alerts_since:1'), String(cutoff));
    assert.equal(store.approvePairing('1', 'ABCDEF12', cutoff + 300000), true);
    assert.equal(store.approvePairing('1', 'ABCDEF12', cutoff + 400000), false);
    store.ingestOwned('1', 'Guru', [project('new-connection', '2026-11-15T12:06:00Z')]);
    await monitor.tick(new AbortController().signal);
    assert.equal(sent.length, 2); assert.match(sent[1]!, /new-connection/);
    assert.equal(store.browserProjects('1').length, 1);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});
