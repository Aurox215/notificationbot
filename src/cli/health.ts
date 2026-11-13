import { config } from 'dotenv';
import { DatabaseSync } from 'node:sqlite';
import { monitoringHealth } from '../monitoring/health.js';

function main(): void {
  config({ quiet: true });
  const intervalMs = Number(process.env.MONITOR_INTERVAL_MS ?? '5000');
  const staleMs = Number(process.env.HEALTH_STALE_MS ?? Math.max(60000, intervalMs * 3));
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1000 || !Number.isSafeInteger(staleMs) || staleMs < 1000) throw new Error();
  // Never open Store here: its startup recovery modifies notification states.
  const db = new DatabaseSync(process.env.DATABASE_PATH?.trim() || 'data/bidbot.sqlite', { readOnly: true });
  try {
    const report = monitoringHealth({ getState: key => db.prepare('SELECT value FROM state WHERE key=?').get(key)?.value as string | undefined }, staleMs);
    console.log(JSON.stringify(report));
    process.exitCode = report.healthy ? 0 : 1;
  } finally { db.close(); }
}
try { main(); } catch {
  console.log(JSON.stringify({ healthy: false, mode: 'mock', liveEnabled: false, errorCode: 'health_unavailable' }));
  process.exitCode = 1;
}
