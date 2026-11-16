import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DirectTelegram } from '../extension/src/direct-telegram.js';

test('standalone manifest and worker exclude backend dependencies and update polling', () => {
  const manifest = JSON.parse(readFileSync('extension/manifest.json', 'utf8'));
  assert.equal(manifest.background.service_worker, 'dist/standalone-background.js');
  assert.equal(manifest.action.default_popup, 'standalone.html');
  assert.deepEqual(manifest.host_permissions, ['https://api.telegram.org/*', 'https://www.peopleperhour.com/*', 'https://www.guru.com/*']);
  const worker = readFileSync('extension/dist/standalone-background.js', 'utf8');
  assert.ok(!/getUpdates|deleteWebhook|setWebhook|127\.0\.0\.1|localhost|\/v1\//.test(worker));
  assert.ok(!/require\(["'](?:node:|fs|http|sqlite)/.test(worker));
  const example = JSON.parse(readFileSync('extension/config.example.json', 'utf8')); assert.equal(example.botToken, '');
  assert.ok(readFileSync('.gitignore', 'utf8').includes('extension/config.private.json'));
  assert.ok(readFileSync('.gitignore', 'utf8').includes('release/'));
});
test('the shared bot identity and a private matching chat are required', async () => {
  const wrong = new DirectTelegram(async () => Response.json({ ok: true, result: { is_bot: true, username: 'OtherBot' } }));
  await assert.rejects(wrong.validate('synthetic', '7'), /Aurox_notification_bot/);
  const group = new DirectTelegram(async target => Response.json({ ok: true, result: String(target).endsWith('getMe') ? { is_bot: true, username: 'Aurox_notification_bot' } : { id: 7, type: 'group' } }));
  await assert.rejects(group.validate('synthetic', '7'), /private chat/);
});
test('read-only Telegram checks retry transient transport failures; sends are never blindly retried', async () => {
  let checks = 0;
  const checksApi = new DirectTelegram(async () => { checks++; if (checks < 3) throw new TypeError('synthetic transport failure'); return Response.json({ ok: true, result: { is_bot: true, username: 'Aurox_notification_bot' } }); });
  await checksApi.identify('synthetic'); assert.equal(checks, 3);
  let sends = 0;
  const sendsApi = new DirectTelegram(async () => { sends++; throw new TypeError('synthetic transport failure'); });
  await assert.rejects(sendsApi.send('synthetic', '7', 'Connection message'), /uncertain/); assert.equal(sends, 1);
  await assert.rejects(sendsApi.identify('synthetic'), /No message was sent/); assert.equal(sends, 4);
});
