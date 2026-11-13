import { setTimeout as delay } from 'node:timers/promises';
import type { Store } from '../persistence/store.js';
import { TelegramClient, TelegramError } from '../telegram/client.js';
import type { CommandHandler } from './commands.js';
import { log } from '../logging/logger.js';

export async function runPolling(client: TelegramClient, handler: CommandHandler, store: Store, signal: AbortSignal): Promise<void> {
  let failures = 0;
  while (!signal.aborted) {
    try {
      const updates = await client.getUpdates(Number(store.getState('telegram_offset') ?? '0'), signal);
      failures = 0;
      for (const update of updates) {
        if (signal.aborted) break;
        if (!Number.isSafeInteger(update.update_id)) continue;
        try { await handler.handle(update); } catch { log('error', 'Command reply failed; preferences already stored.'); }
        store.setState('telegram_offset', String(update.update_id + 1));
      }
    } catch (error) {
      if (signal.aborted) break;
      if (error instanceof TelegramError && [401, 409].includes(error.code)) throw error;
      failures++;
      log('error', 'Telegram polling failed; retrying with backoff.');
      const retryMs = error instanceof TelegramError && error.code === 429 ? error.retryAfter * 1000 : Math.min(30000, 1000 * 2 ** Math.min(failures, 5));
      try { await delay(retryMs, undefined, { signal }); } catch { break; }
    }
  }
}
