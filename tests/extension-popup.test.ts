import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { parseHTML } from 'linkedom';
const base = { ok: true, connected: true, supported: true, scanningEnabled: true, website: 'www.peopleperhour.com', count: 0,
  lastSuccess: null, lastAttempt: null, connection: 'Connected to your Telegram account', connectionCheckedAt: '2026-11-14T00:00:00Z',
  status: 'not_scanned', stage: 'idle', detail: 'Ready.' };
const flush = () => new Promise<void>(done => setImmediate(done));
function popup(send: (type: string) => Promise<unknown>) {
  const { document, window } = parseHTML(readFileSync('extension/popup.html', 'utf8'));
  runInNewContext(readFileSync('extension/dist/popup.js', 'utf8'), {
    document, setTimeout, clearTimeout, chrome: { runtime: { sendMessage: ({ type }: { type: string }) => send(type) } },
  });
  return { document, click: (id: string) => document.getElementById(id)!.dispatchEvent(new window.Event('click')),
    text: (id: string) => document.getElementById(id)!.textContent,
    disabled: (id: string) => Boolean((document.getElementById(id) as unknown as { disabled: boolean }).disabled) };
}
test('popup has Stop/Continue, no Scan Now button, and shows background scan diagnostics separately', async () => {
  const ui = popup(async () => ({ ...base, lastAttempt: '2026-11-14T00:01:00Z', status: 'poll_unsupported', stage: 'extraction', detail: 'Background HTML has no rendered cards.' }));
  await flush();
  assert.equal(ui.document.getElementById('scan'), null);
  assert.ok(!ui.document.body.textContent.includes('Scan Now'));
  assert.match(ui.text('connection')!, /Connected to your Telegram/);
  assert.match(ui.text('diagnostics')!, /poll_unsupported/);
});
test('expired authentication disables Continue scan', async () => {
  const ui = popup(async () => ({ ...base, connected: false, connection: 'Authentication expired.' }));
  await flush(); assert.equal(ui.disabled('toggle'), true);
});
test('failed fresh status check removes stale Connected label', async () => {
  let fail = false;
  const ui = popup(async () => { if (fail) throw new Error('private error'); return base; });
  await flush(); fail = true; ui.click('check'); await flush();
  assert.equal(ui.text('connection'), 'Current connection check unavailable.');
  assert.equal(ui.disabled('toggle'), true);
});
test('Stop and Continue toggle the persistent collection state', async () => {
  let enabled = true;
  const ui = popup(async type => { if (type === 'TOGGLE_SCAN') { enabled = !enabled; return { ok: true }; } return { ...base, scanningEnabled: enabled }; });
  await flush(); assert.equal(ui.text('toggle'), 'Stop scan');
  ui.click('toggle'); await flush(); assert.equal(ui.text('toggle'), 'Continue scan');
  ui.click('toggle'); await flush(); assert.equal(ui.text('toggle'), 'Stop scan');
});
