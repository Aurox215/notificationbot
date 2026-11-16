import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { acquireDatabaseLock } from '../src/persistence/database-lock.js';

test('database lock records ownership, refuses a second instance and releases cleanly', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'database-lock-')); const path = join(directory, 'test.sqlite');
  try {
    const release = await acquireDatabaseLock(path);
    try {
      assert.equal(JSON.parse(readFileSync(path + '.lock', 'utf8')).pid, process.pid);
      await assert.rejects(acquireDatabaseLock(path), /Another bot instance/);
    } finally { await release(); }
    assert.equal(existsSync(path + '.lock'), false);
    const next = await acquireDatabaseLock(path); await next(); await next();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test('legacy empty locks and live process ownership are preserved rather than guessed stale', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'database-lock-')); const path = join(directory, 'test.sqlite');
  try {
    writeFileSync(path + '.lock', '');
    await assert.rejects(acquireDatabaseLock(path), /Legacy or damaged/);
    assert.equal(readFileSync(path + '.lock', 'utf8'), '');
    writeFileSync(path + '.lock', JSON.stringify({ pid: process.pid, token: 'live' }));
    await assert.rejects(acquireDatabaseLock(path), /running process/);
    assert.equal(JSON.parse(readFileSync(path + '.lock', 'utf8')).token, 'live');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test('a crashed process releases its OS lock and its stale PID file is recovered', { skip: !['win32', 'linux'].includes(process.platform) }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'database-lock-')); const path = join(directory, 'test.sqlite');
  const modulePath = resolve('dist/src/persistence/database-lock.js');
  const child = spawn(process.execPath, ['-e', 'process.on("message",()=>{});require(process.argv[1]).acquireDatabaseLock(process.argv[2]).then(()=>process.send("ready")).catch(()=>process.exit(1));', modulePath, path], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  try {
    await Promise.race([once(child, 'message'), once(child, 'exit').then(() => { throw new Error('Lock child exited before acquiring ownership'); })]);
    const exited = once(child, 'exit'); child.kill(); await exited;
    assert.equal(existsSync(path + '.lock'), true);
    const release = await acquireDatabaseLock(path);
    assert.equal(JSON.parse(readFileSync(path + '.lock', 'utf8')).pid, process.pid);
    await release();
  } finally { if (child.exitCode === null && child.signalCode === null) child.kill(); rmSync(directory, { recursive: true, force: true }); }
});
