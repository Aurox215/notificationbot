export interface IngestionConfig { port: number; token: string }
export function readIngestionConfig(env: NodeJS.ProcessEnv = process.env): IngestionConfig | undefined {
  if (!env.INGESTION_ENABLED || env.INGESTION_ENABLED === 'false') return undefined;
  if (env.INGESTION_ENABLED !== 'true') throw new Error('INGESTION_ENABLED must be true or false.');
  const token = env.INGESTION_TOKEN ?? '';
  const port = Number(env.INGESTION_PORT ?? '4318');
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) throw new Error('INGESTION_TOKEN must be a separate random token with 32–128 URL-safe characters.');
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('INGESTION_PORT must be between 1024 and 65535.');
  return { token, port };
}
