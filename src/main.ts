import { config } from 'dotenv';
import { openSync, closeSync, unlinkSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { readRuntimeConfig } from './config/runtime.js';
import { Store } from './persistence/store.js';
import { TelegramClient } from './telegram/client.js';
import { CommandHandler } from './bot/commands.js';
import { runPolling } from './bot/polling.js';
import { Monitor, runScheduler } from './monitoring/monitor.js';
import { MockPeoplePerHourSource } from './sources/peopleperhour.js';
import { MockGuruSource } from './sources/guru.js';
import { log } from './logging/logger.js';

async function main(): Promise<void> {
  config({ quiet: true });
  const settings = readRuntimeConfig();
  mkdirSync(dirname(settings.databasePath), { recursive: true });
  const lockPath = `${settings.databasePath}.lock`;
  let lock: number;
  try { lock = openSync(lockPath, 'wx'); } catch { throw new Error('Database lock exists. Stop other bot instances; after a crash, remove the stale .lock file only after confirming no instance is running.'); }
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  let store: Store | undefined;
  try {
    store = new Store(settings.databasePath, settings.keywords);
    const client = new TelegramClient(settings.telegram);
    const monitor = new Monitor(store, [new MockPeoplePerHourSource(), new MockGuruSource()], client);
    const commands = new CommandHandler(store, client, settings.intervalMs);
    log('info', `Bot started in MOCK mode; shared interval ${settings.intervalMs} ms. No live platform requests.`);
    const tasks = [runPolling(client, commands, store, controller.signal), runScheduler(monitor, settings.intervalMs, controller.signal)];
    try { await Promise.all(tasks); } finally { controller.abort(); await Promise.allSettled(tasks); }
  } finally {
    store?.close();
    closeSync(lock);
    unlinkSync(lockPath);
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
}
main().catch((error: unknown) => { log('error', error instanceof Error ? error.message : 'Bot stopped with an error.'); process.exitCode = 1; });
