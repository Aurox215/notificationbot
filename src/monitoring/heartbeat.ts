import { log } from '../logging/logger.js';
import { monitoringHealth } from './health.js';
import type { Store } from '../persistence/store.js';
type HeartbeatStore = Pick<Store, 'getState' | 'runtimeSummary'>;
export function reportHeartbeat(store: HeartbeatStore, staleMs: number, now = Date.now()): void {
  try {
    const health = monitoringHealth(store, staleMs, now);
    log(health.healthy ? 'info' : 'error', health.healthy
      ? 'Backend heartbeat: scheduler healthy.'
      : 'Backend heartbeat: monitoring is not ready, stale, or degraded.', {
      event: 'backend.heartbeat', healthy: health.healthy, mode: health.mode,
      schedulerRunning: health.scheduler.running ?? false, schedulerStale: health.scheduler.stale,
      lastCycleCompletedAt: health.scheduler.completedAt ?? null, ...store.runtimeSummary(),
    });
  } catch {
    log('error', 'Backend heartbeat could not read monitoring status.', { event: 'backend.heartbeat_failed', errorCode: 'heartbeat_failed' });
  }
}
export function startHeartbeat(store: HeartbeatStore, staleMs: number): () => void {
  // Independent of the scheduler: a pending asynchronous cycle cannot hide staleness.
  const timer = setInterval(() => reportHeartbeat(store, staleMs), 30000);
  timer.unref();
  return () => clearInterval(timer);
}
