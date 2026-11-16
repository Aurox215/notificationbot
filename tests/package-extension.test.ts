import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
const token = '123456:' + 'synthetic_shared_package_'.repeat(2);
function fixture() {
  mkdirSync('release', { recursive: true });
  const dir = mkdtempSync(resolve('release', 'update-test-'));
  const target = join(dir, 'installed'); mkdirSync(join(target, 'dist'), { recursive: true });
  writeFileSync(join(target, 'manifest.json'), JSON.stringify({ name: 'Aurox Job Monitor', version: '0.8.0', background: { service_worker: 'dist/standalone-background.js' } }));
  writeFileSync(join(target, 'dist/standalone-background.js'), `var configuredTelegramToken, configuredTelegramChatId; configuredTelegramToken = "${token}"; configuredTelegramChatId = "";`);
  writeFileSync(join(target, 'preserved-user-file.json'), '{"keep":true}');
  const config = join(dir, 'private.json'); writeFileSync(config, JSON.stringify({ botToken: token, chatId: '' }));
  return { dir, target, config, cleanup() { if (!resolve(dir).startsWith(resolve('release') + sep)) throw new Error('Invalid test cleanup scope'); rmSync(dir, { recursive: true, force: true }); } };
}
test('updating an existing release keeps its path and private configuration while replacing stale runtime assets', () => {
  const f = fixture();
  try {
    const result = spawnSync(process.execPath, ['scripts/package-extension.mjs', '--update-existing', f.target], { encoding: 'utf8', env: { ...process.env, AUROX_EXTENSION_CONFIG: f.config } });
    assert.equal(result.status, 0, result.stderr); assert.ok(!result.stdout.includes(token)); assert.ok(result.stdout.includes(f.target));
    const expected = JSON.parse(readFileSync('extension/manifest.json', 'utf8'));
    assert.equal(JSON.parse(readFileSync(join(f.target, 'manifest.json'), 'utf8')).version, expected.version);
    assert.equal(readFileSync(join(f.target, 'preserved-user-file.json'), 'utf8'), '{"keep":true}');
    assert.ok(readFileSync(join(f.target, 'dist/standalone-background.js'), 'utf8').includes(token));
    assert.equal(readFileSync(join(f.target, 'dist/content.js'), 'utf8'), readFileSync('extension/dist/content.js', 'utf8'));
  } finally { f.cleanup(); }
});
test('an in-place update refuses a changed bot configuration before modifying installed files', () => {
  const f = fixture();
  try {
    writeFileSync(f.config, JSON.stringify({ botToken: '654321:' + 'different_synthetic_'.repeat(2), chatId: '' }));
    const before = readFileSync(join(f.target, 'manifest.json'), 'utf8');
    const result = spawnSync(process.execPath, ['scripts/package-extension.mjs', '--update-existing', f.target], { encoding: 'utf8', env: { ...process.env, AUROX_EXTENSION_CONFIG: f.config } });
    assert.notEqual(result.status, 0); assert.equal(readFileSync(join(f.target, 'manifest.json'), 'utf8'), before);
    assert.equal(readFileSync(join(f.target, 'preserved-user-file.json'), 'utf8'), '{"keep":true}'); assert.ok(!result.stderr.includes(token));
  } finally { f.cleanup(); }
});
