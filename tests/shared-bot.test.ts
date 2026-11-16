import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
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
test('backend settings export is read-only, owner-scoped and excludes credentials', () => {
  const directory = mkdtempSync(join(tmpdir(), 'aurox-settings-')); const path = join(directory, 'original.sqlite'); const output = join(directory, 'settings.json');
  try {
    const db = new DatabaseSync(path);
    db.exec("CREATE TABLE users(id TEXT,keywords TEXT,platforms TEXT,paused INTEGER,chat_id TEXT); CREATE TABLE browser_projects(user_id TEXT,platform TEXT,source_id TEXT); CREATE TABLE notifications(state TEXT); INSERT INTO notifications VALUES('sending');");
    db.prepare('INSERT INTO users VALUES(?,?,?,?,?)').run('7', '["react"]', '["PeoplePerHour"]', 1, 'private-chat');
    db.prepare('INSERT INTO browser_projects VALUES(?,?,?)').run('7', 'PeoplePerHour', '123');
    db.prepare('INSERT INTO browser_projects VALUES(?,?,?)').run('8', 'Guru', '999'); db.close();
    const before = readFileSync(path);
    const result = spawnSync(process.execPath, [resolve('scripts/export-extension-settings.mjs'), '--database', path, '--user', '7', '--output', output], { encoding: 'utf8' });
    assert.equal(result.status, 0); assert.deepEqual(readFileSync(path), before);
    const exported = JSON.parse(readFileSync(output, 'utf8'));
    assert.deepEqual(exported.preferences, { keywords: ['react'], platforms: ['PeoplePerHour'], paused: true });
    assert.deepEqual(exported.seenProjects, [{ platform: 'PeoplePerHour', sourceId: '123' }]);
    assert.ok(!JSON.stringify(exported).includes('private-chat'));
    const second = spawnSync(process.execPath, [resolve('scripts/export-extension-settings.mjs'), '--database', path, '--user', '7', '--output', output], { encoding: 'utf8' });
    assert.notEqual(second.status, 0); assert.deepEqual(readFileSync(path), before);
  } finally { rmSync(directory, { recursive: true, force: true }); }
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
