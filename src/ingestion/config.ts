export interface IngestionConfig { port: number; publicUrl: string; botUsername: string }
export function readIngestionConfig(env: NodeJS.ProcessEnv = process.env): IngestionConfig | undefined {
  if (!env.INGESTION_ENABLED || env.INGESTION_ENABLED === 'false') return undefined;
  if (env.INGESTION_ENABLED !== 'true') throw new Error('INGESTION_ENABLED must be true or false.');
  const port = Number(env.INGESTION_PORT ?? '4318');
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('INGESTION_PORT must be between 1024 and 65535.');
  const botUsername = env.TELEGRAM_BOT_USERNAME?.trim() ?? '';
  if (!/^[A-Za-z0-9_]{5,32}$/.test(botUsername)) throw new Error('Set TELEGRAM_BOT_USERNAME without @.');
  let url: URL;
  try { url = new URL(env.PUBLIC_BASE_URL ?? `http://127.0.0.1:${port}`); } catch { throw new Error('Invalid PUBLIC_BASE_URL.'); }
  const local = url.protocol === 'http:' && url.hostname === '127.0.0.1';
  if ((!local && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('PUBLIC_BASE_URL must be an HTTPS origin (or HTTP 127.0.0.1 for operator development).');
  return { port, publicUrl: url.origin, botUsername };
}
