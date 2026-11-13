import { config } from 'dotenv';
import { openSync, closeSync, unlinkSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { readRuntimeConfig } from './config/runtime.js';
import { Store } from './persistence/store.js';
import { TelegramClient } from './telegram/client.js';
import { CommandHandler } from './bot/commands.js';
import { runPolling } from './bot/polling.js';
import { Monitor, runScheduler } from './monitoring/monitor.js';
import { createSources } from './sources/registry.js';
import { log } from './logging/logger.js';
import { startIngestionServer } from './ingestion/server.js';
import type { Server } from 'node:http';
import { AccountLinks } from './ingestion/accounts.js';

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
  let ingestionServer: Server | undefined;
  try {
    store = new Store(settings.databasePath, settings.keywords);
    store.setState('source_mode', settings.sourceMode);
    const accounts = settings.ingestion ? new AccountLinks(store, settings.ingestion.botUsername) : undefined;
    if (settings.ingestion) ingestionServer = await startIngestionServer(store, settings.ingestion, accounts);
    const client = new TelegramClient(settings.telegram);
    const monitor = new Monitor(store, createSources(settings.sourceMode), client, 1100, settings.sourceOptions);
    const commands = new CommandHandler(store, client, settings.intervalMs, settings.healthStaleMs, accounts);
    log('info', `Bot started in ${settings.sourceMode.toUpperCase()} mode; shared dispatch interval ${settings.intervalMs} ms. No live platform requests.`);
    const tasks = [runPolling(client, commands, store, controller.signal), runScheduler(monitor, settings.intervalMs, controller.signal)];
    try { await Promise.all(tasks); } finally { controller.abort(); await Promise.allSettled(tasks); }
  } finally {
    if (ingestionServer) await new Promise<void>(resolve => ingestionServer!.close(() => resolve()));
    store?.close();
    closeSync(lock);
    unlinkSync(lockPath);
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
}
main().catch((error: unknown) => { log('error', error instanceof Error ? error.message : 'Bot stopped with an error.'); process.exitCode = 1; });
