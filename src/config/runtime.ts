import { readTelegramConfig } from './index.js';
import { readIngestionConfig } from '../ingestion/config.js';

export const defaultKeywords = ['AI', 'automation', 'Python', 'PHP', 'Laravel', 'React', 'Next.js', 'Node.js', 'TypeScript', 'WordPress', 'WooCommerce', 'Shopify', 'API', 'full-stack'];

export function readRuntimeConfig(env: NodeJS.ProcessEnv = process.env) {
  const intervalMs = Number(env.MONITOR_INTERVAL_MS ?? '5000');
  if (!Number.isInteger(intervalMs) || intervalMs < 1000 || intervalMs > 3600000) {
    throw new Error('MONITOR_INTERVAL_MS must be an integer between 1000 and 3600000.');
  }
  if (env.SOURCE_MODE && !['mock', 'extension'].includes(env.SOURCE_MODE)) throw new Error('Only SOURCE_MODE=mock or extension is supported; live authorization and permitted frequency are not verified.');
  const sourceMode = env.SOURCE_MODE === 'extension' ? 'extension' as const : 'mock' as const;
  const ingestion = readIngestionConfig(env);
  if (sourceMode === 'extension' && !ingestion) throw new Error('Extension mode requires INGESTION_ENABLED=true and pairing configuration.');
  const bounded = (name: string, fallback: number, min: number, max: number) => {
    const value = Number(env[name] ?? fallback);
    if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer between ${min} and ${max}.`);
    return value;
  };
  const sourceOptions = { intervalMs,
    timeoutMs: bounded('SOURCE_TIMEOUT_MS', 15000, 10, 120000),
    retryBaseMs: bounded('SOURCE_RETRY_BASE_MS', Math.max(intervalMs, 5000), 1000, 3600000),
    retryMaxMs: bounded('SOURCE_RETRY_MAX_MS', Math.max(intervalMs, 300000), 1000, 86400000),
  };
  if (sourceOptions.retryMaxMs < sourceOptions.retryBaseMs) throw new Error('SOURCE_RETRY_MAX_MS must be at least SOURCE_RETRY_BASE_MS.');
  const healthStaleMs = bounded('HEALTH_STALE_MS', Math.max(60000, intervalMs * 3), 1000, 86400000);
  // The multi-user runtime does not use a fixed recipient. Keep Phase 1 validation intact.
  const telegram = readTelegramConfig({ ...env, TELEGRAM_CHAT_ID: '0' });
  return { telegram, intervalMs, sourceMode, ingestion, sourceOptions, healthStaleMs, databasePath: env.DATABASE_PATH?.trim() || 'data/bidbot.sqlite',
    keywords: env.DEFAULT_KEYWORDS ? env.DEFAULT_KEYWORDS.split(',').map(x => x.trim()).filter(Boolean) : defaultKeywords };
}
