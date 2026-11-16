import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/persistence/store.js';
import { reportHeartbeat, startHeartbeat } from '../src/monitoring/heartbeat.js';

test('heartbeat distinguishes a healthy idle backend from a stalled asynchronous cycle without exposing account data', t => {
  const store = new Store(':memory:', []);
  const info = t.mock.method(console, 'log', () => {});
  const errors = t.mock.method(console, 'error', () => {});
  try {
    store.setState('source_mode', 'extension');
    store.ensureUser('private-account', 'private-chat'); store.preferences('private-account', { subscribed: true });
    store.recordAccess('private-account', 'Guru', 'login_required');
    store.setState('monitoring_cycle', JSON.stringify({ startedAt: 99000, completedAt: 99001, ok: true, running: false }));
    reportHeartbeat(store, 60000, 100000);
    const healthy = JSON.parse(info.mock.calls[0]!.arguments[0] as string);
    assert.equal(healthy.event, 'backend.heartbeat'); assert.equal(healthy.healthy, true);
    assert.equal(healthy.activeSubscribers, 1); assert.equal(healthy.lastBrowserContactAt, null);
    assert.deepEqual(healthy.platformAccess, [{ platform: 'Guru', status: 'login_required', count: 1 }]);
    assert.ok(!JSON.stringify(healthy).includes('private-account')); assert.ok(!JSON.stringify(healthy).includes('private-chat'));
    store.setState('monitoring_cycle', JSON.stringify({ startedAt: 100000, completedAt: 99001, ok: true, running: true }));
    reportHeartbeat(store, 60000, 200000);
    const stalled = JSON.parse(errors.mock.calls[0]!.arguments[0] as string);
    assert.equal(stalled.healthy, false); assert.equal(stalled.schedulerStale, true); assert.equal(stalled.schedulerRunning, true);
  } finally { store.close(); }
});
test('heartbeat repeats every 30 seconds and its timer stops before the store closes', t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const store = new Store(':memory:', []);
  const info = t.mock.method(console, 'log', () => {});
  try {
    store.setState('source_mode', 'extension');
    store.setState('monitoring_cycle', JSON.stringify({ startedAt: Date.now(), completedAt: Date.now(), ok: true }));
    const stop = startHeartbeat(store, 60000);
    t.mock.timers.tick(30000); assert.equal(info.mock.callCount(), 1);
    t.mock.timers.tick(30000); assert.equal(info.mock.callCount(), 2);
    stop(); t.mock.timers.tick(30000); assert.equal(info.mock.callCount(), 2);
  } finally { store.close(); }
});
