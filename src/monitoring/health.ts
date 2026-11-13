import { platforms } from '../sources/types.js';
import { initialHealth, sourceHealthKey, type SourceHealth } from './source-runner.js';

export interface HealthReader { getState(key: string): string | undefined }
export interface CycleHealth { startedAt: number; completedAt: number | null; ok: boolean; running?: boolean }

export function monitoringHealth(reader: HealthReader, staleMs: number, now = Date.now()) {
  const cycleRaw = reader.getState('monitoring_cycle');
  const cycle = cycleRaw ? JSON.parse(cycleRaw) as CycleHealth : null;
  const mode = reader.getState('source_mode') === 'extension' ? 'extension' as const : 'mock' as const;
  // In extension mode no shared source freshness exists. Per-user browser data is
  // intentionally excluded from this operator scheduler-health report.
  const sources = (mode === 'extension' ? [] : platforms).map(platform => {
    const raw = reader.getState(sourceHealthKey(platform));
    const health = raw ? JSON.parse(raw) as SourceHealth : initialHealth(platform);
    const stale = health.lastSuccessAt === null || now - health.lastSuccessAt > staleMs || health.lastSuccessAt > now;
    return { ...health, stale };
  });
  const schedulerStale = !cycle?.completedAt || now - cycle.completedAt > staleMs || cycle.completedAt > now;
  return { healthy: !schedulerStale && Boolean(cycle?.ok) && sources.every(s => s.status === 'healthy' && !s.stale),
    mode, liveEnabled: false, checkedAt: now,
    scheduler: { ...cycle, stale: schedulerStale }, sources };
}
