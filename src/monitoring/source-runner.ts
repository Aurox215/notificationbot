import { log, type LogFields } from '../logging/logger.js';
import type { Platform, ProjectSource, SourceProject } from '../sources/types.js';
import { SourceError, type SourceErrorCode } from '../sources/errors.js';
import { validateProjects } from '../sources/validation.js';

export interface StateStorage {
  getState(key: string): string | undefined;
  setState(key: string, value: string): void;
}
export interface SourceHealth {
  platform: Platform;
  status: 'starting' | 'healthy' | 'degraded' | 'blocked';
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  consecutiveFailures: number;
  nextAttemptAt: number | null;
  errorCode: SourceErrorCode | null;
  durationMs: number;
  projectCount: number;
}
export interface SourceRunnerOptions {
  intervalMs: number;
  timeoutMs: number;
  retryBaseMs: number;
  retryMaxMs: number;
}
export const defaultSourceOptions: SourceRunnerOptions = { intervalMs: 5000, timeoutMs: 15000, retryBaseMs: 5000, retryMaxMs: 300000 };
export function initialHealth(platform: Platform): SourceHealth {
  return { platform, status: 'starting', lastAttemptAt: null, lastSuccessAt: null, consecutiveFailures: 0,
    nextAttemptAt: 0, errorCode: null, durationMs: 0, projectCount: 0 };
}
export function sourceHealthKey(platform: Platform): string { return `source_health:${platform}`; }

export class SourceRunner {
  readonly options: SourceRunnerOptions;
  private readonly inFlight = new Set<Platform>();
  constructor(private readonly storage: StateStorage, options: Partial<SourceRunnerOptions> = {},
    private readonly now: () => number = Date.now,
    private readonly logger: (level: 'info' | 'error', message: string, fields: LogFields) => void = log) {
    this.options = { ...defaultSourceOptions, ...options };
    const o = this.options;
    if (Object.values(o).some(x => !Number.isSafeInteger(x) || x < 1) || o.retryMaxMs < o.retryBaseMs) throw new Error('Invalid source monitoring options.');
  }
  health(platform: Platform): SourceHealth {
    const raw = this.storage.getState(sourceHealthKey(platform));
    return raw ? JSON.parse(raw) as SourceHealth : initialHealth(platform);
  }
  private save(health: SourceHealth): void { this.storage.setState(sourceHealthKey(health.platform), JSON.stringify(health)); }

  async fetch(source: ProjectSource, signal: AbortSignal): Promise<SourceProject[] | undefined> {
    const health = this.health(source.platform);
    if (signal.aborted || this.inFlight.has(source.platform) || health.status === 'blocked' || (health.nextAttemptAt ?? 0) > this.now()) return undefined;
    const started = this.now();
    health.lastAttemptAt = started;
    // Persist the earliest permitted next attempt before fetching, including across restarts.
    health.nextAttemptAt = started + this.options.intervalMs;
    this.save(health);
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), this.options.timeoutMs);
    const combined = AbortSignal.any([signal, timeout.signal]);
    try {
      // Race the source even if an adapter accidentally fails to honor its signal.
      // Late results are discarded and can never persist or trigger notifications.
      let onAbort!: () => void;
      const aborted = new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(new SourceError('timeout'));
        combined.addEventListener('abort', onAbort, { once: true });
        if (combined.aborted) onAbort();
      });
      let projects: SourceProject[];
      try {
        this.inFlight.add(source.platform);
        let request: Promise<SourceProject[]>;
        try { request = source.fetchProjects(combined); }
        catch (error) { this.inFlight.delete(source.platform); throw error; }
        void request.then(() => this.inFlight.delete(source.platform), () => this.inFlight.delete(source.platform));
        projects = await Promise.race([request, aborted]);
      }
      finally { combined.removeEventListener('abort', onAbort); }
      if (signal.aborted) return undefined;
      validateProjects(projects, source.platform);
      const recovered = health.consecutiveFailures > 0;
      Object.assign(health, { status: 'healthy', lastSuccessAt: this.now(), consecutiveFailures: 0, errorCode: null,
        durationMs: this.now() - started, projectCount: projects.length });
      this.save(health);
      if (recovered) this.logger('info', 'Project source recovered.', { event: 'source.recovered', platform: source.platform,
        durationMs: health.durationMs, projectCount: health.projectCount });
      return projects;
    } catch (error) {
      if (signal.aborted) return undefined;
      const failure = timeout.signal.aborted ? new SourceError('timeout') : error instanceof SourceError ? error : new SourceError('unexpected');
      health.consecutiveFailures++;
      health.errorCode = failure.code;
      health.status = failure.retryable ? 'degraded' : 'blocked';
      health.durationMs = this.now() - started;
      const backoff = Math.min(this.options.retryMaxMs, this.options.retryBaseMs * 2 ** Math.min(health.consecutiveFailures - 1, 20));
      const retryAfter = Number.isFinite(failure.retryAfterMs) ? Math.max(0, failure.retryAfterMs) : 0;
      health.nextAttemptAt = failure.retryable ? this.now() + Math.max(this.options.intervalMs, backoff, retryAfter) : null;
      this.save(health);
      this.logger('error', 'Project source fetch failed.', { event: 'source.failed', platform: source.platform,
        errorCode: failure.code, consecutiveFailures: health.consecutiveFailures, retryAt: health.nextAttemptAt, durationMs: health.durationMs });
      return undefined;
    } finally { clearTimeout(timer); }
  }
}
