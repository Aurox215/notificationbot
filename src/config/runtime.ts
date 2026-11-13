import { readTelegramConfig } from './index.js';

export const defaultKeywords = ['AI', 'automation', 'Python', 'PHP', 'Laravel', 'React', 'Next.js', 'Node.js', 'TypeScript', 'WordPress', 'WooCommerce', 'Shopify', 'API', 'full-stack'];

export function readRuntimeConfig(env: NodeJS.ProcessEnv = process.env) {
  const intervalMs = Number(env.MONITOR_INTERVAL_MS ?? '5000');
  if (!Number.isInteger(intervalMs) || intervalMs < 1000 || intervalMs > 3600000) {
    throw new Error('MONITOR_INTERVAL_MS must be an integer between 1000 and 3600000.');
  }
  if (env.SOURCE_MODE && env.SOURCE_MODE !== 'mock') throw new Error('Only SOURCE_MODE=mock is supported.');
  // The multi-user runtime does not use a fixed recipient. Keep Phase 1 validation intact.
  const telegram = readTelegramConfig({ ...env, TELEGRAM_CHAT_ID: '0' });
  return { telegram, intervalMs, databasePath: env.DATABASE_PATH?.trim() || 'data/bidbot.sqlite',
    keywords: env.DEFAULT_KEYWORDS ? env.DEFAULT_KEYWORDS.split(',').map(x => x.trim()).filter(Boolean) : defaultKeywords };
}
