import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { parseHTML } from 'linkedom';

const base = { ok: true, connected: true, supported: true, website: 'www.peopleperhour.com', count: 0,
  lastSuccess: null, lastAttempt: null, connection: 'Connected to your Telegram account', connectionCheckedAt: '2026-11-14T00:00:00Z',
  status: 'not_scanned', stage: 'idle', detail: 'Ready.' };
function popup(send: (type: string) => Promise<unknown>) {
  const { document, window } = parseHTML(readFileSync('extension/popup.html', 'utf8'));
  runInNewContext(readFileSync('extension/dist/popup.js', 'utf8'), {
    document, setTimeout, clearTimeout, chrome: { runtime: { sendMessage: ({ type }: { type: string }) => send(type) } },
  });
  const click = (id: string) => document.getElementById(id)!.dispatchEvent(new window.Event('click'));
  const text = (id: string) => document.getElementById(id)!.textContent;
  const disabled = (id: string) => Boolean((document.getElementById(id) as unknown as { disabled: boolean }).disabled);
  return { click, text, disabled };
}
const flush = () => new Promise<void>(done => setImmediate(done));

test('popup separates current healthy connection from a persisted content-script scan failure', async () => {
  let scan = false; let messages = 0;
  const ui = popup(async type => {
    if (type === 'SCAN') { scan = true; messages++; return { ok: false, errorCode: 'content_script_unavailable', error: 'Refresh the listing tab.' }; }
    return scan ? { ...base, lastAttempt: '2026-11-14T00:01:00Z', status: 'content_script_unavailable', stage: 'content_script', detail: 'Refresh the listing tab.' } : base;
  });
  await flush();
  ui.click('scan'); await flush();
  assert.equal(messages, 1);
  assert.match(ui.text('connection')!, /Connected to your Telegram/);
  assert.match(ui.text('status')!, /content_script_unavailable/);
  assert.match(ui.text('diagnostics')!, /Content script: not confirmed/);
  assert.match(ui.text('attempt')!, /Last scan attempt/);
});

test('popup does not re-enable Scan Now after current status reports expired authentication', async () => {
  let expired = false;
  const ui = popup(async type => {
    if (type === 'SCAN') { expired = true; return { ok: true, accepted: false }; }
    return expired ? { ...base, connected: false, connection: 'Authentication expired.', status: 'authentication_expired', stage: 'authentication', detail: 'Connect Telegram again.' } : base;
  });
  await flush();
  assert.equal(ui.disabled('scan'), false);
  ui.click('scan'); await flush();
  assert.equal(ui.disabled('scan'), true);
  assert.match(ui.text('connection')!, /Authentication expired/);
});

test('failed fresh status check removes the old Connected label instead of showing stale success', async () => {
  let fail = false;
  const ui = popup(async () => { if (fail) throw new Error('Do not expose raw error'); return base; });
  await flush();
  fail = true; ui.click('check'); await flush();
  assert.equal(ui.text('connection'), 'Current connection check unavailable.');
  assert.equal(ui.disabled('scan'), true);
  assert.ok(!ui.text('status')!.includes('Do not expose'));
});
