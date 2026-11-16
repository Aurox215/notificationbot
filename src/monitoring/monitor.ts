import { setTimeout as delay } from 'node:timers/promises';
import type { Store } from '../persistence/store.js';
import type { ProjectSource } from '../sources/types.js';
import type { Messenger } from '../bot/commands.js';
import { formatAlert } from '../domain/project.js';
import { matchesKeywords } from '../filtering/keywords.js';
import { TelegramError } from '../telegram/client.js';
import { log } from '../logging/logger.js';
import { SourceRunner, type SourceRunnerOptions } from './source-runner.js';

export class Monitor {
  private running = false;
  private nextSendAt = 0;
  private readonly sourceRunner: SourceRunner;
  constructor(private readonly store: Store, private readonly sources: ProjectSource[], private readonly messenger: Messenger,
    private readonly sendSpacingMs = 1100, sourceOptions: Partial<SourceRunnerOptions> = {}) {
    if (new Set(sources.map(source => source.platform)).size !== sources.length) throw new Error('Configure exactly one source per platform.');
    this.sourceRunner = new SourceRunner(store, sourceOptions);
  }

  async tick(signal: AbortSignal): Promise<void> {
    if (this.running || signal.aborted) return;
    this.running = true;
    const startedAt = Date.now();
    let ok = false;
    try {
      const previousRaw = this.store.getState('monitoring_cycle');
      const previous = previousRaw ? JSON.parse(previousRaw) as { completedAt: number | null; ok: boolean } : undefined;
      this.store.setState('monitoring_cycle', JSON.stringify({ startedAt, completedAt: previous?.completedAt ?? null, ok: previous?.ok ?? false, running: true }));
      for (const source of this.sources) {
        if (signal.aborted) return;
        const projects = await this.sourceRunner.fetch(source, signal);
        if (projects) for (const project of projects) this.store.saveProject(project);
      }
      // Re-evaluate stored projects within each subscriber's publication window.
      // Browser projects are selected by owner. Legacy unowned browser rows never dispatch.
      const shared = this.store.getState('source_mode') === 'extension' ? [] : this.store.projects(true, 'monitor');
      for (const initialUser of this.store.users()) {
        for (const platform of this.store.loginNotices(initialUser.id)) {
          if (signal.aborted) return;
          const wait = this.nextSendAt - Date.now();
          if (wait > 0) { try { await delay(wait, undefined, { signal }); } catch { return; } }
          const user = this.store.user(initialUser.id)!;
          if (!user.subscribed || user.paused || !user.platforms.includes(platform) || !this.store.claimLoginNotice(user.id, platform)) continue;
          const noticeStatus = this.store.accessStatus(user.id, platform);
          this.nextSendAt = Date.now() + this.sendSpacingMs;
          try {
            const recovered = this.store.accessStatus(user.id, platform) === 'authenticated';
            await this.messenger.send(recovered ? `${platform}: signed in again. Platform monitoring can resume; your scan and alert preferences still apply.` : `${platform}: login required. Please open ${platform} in your own Chrome browser and sign in normally to resume project monitoring.`, user.chatId);
            this.store.finishLoginNotice(user.id, platform, 'sent', 0, noticeStatus);
            log('info', 'Platform account notice sent to Telegram.', { event: 'platform.notice_sent', platform, noticeType: recovered ? 'recovered' : 'login_required' });
          } catch (error) {
            log('error', 'Platform account notice failed; delivery state recorded.', { event: 'platform.notice_failed', platform, errorCode: error instanceof TelegramError ? `telegram_${error.code}` : 'delivery_unknown' });
            if (error instanceof TelegramError && error.code === 429) this.store.finishLoginNotice(user.id, platform, 'pending', Date.now() + error.retryAfter * 1000, noticeStatus);
            else this.store.finishLoginNotice(user.id, platform, error instanceof TelegramError && error.code >= 400 && error.code < 500 ? 'failed' : 'unknown', 0, noticeStatus);
          }
        }
        const candidates = [...shared.map(p => ({ ...p, owned: false })),
          ...this.store.browserProjects(initialUser.id).map(p => ({ ...p, owned: true }))];
        for (const { id: projectId, project, owned } of candidates) {
          if (signal.aborted) return;
          const waitMs = this.nextSendAt - Date.now();
          if (waitMs > 0) {
            try { await delay(waitMs, undefined, { signal }); } catch { return; }
          }
          // Commands may change preferences while a send is waiting.
          const user = this.store.user(initialUser.id)!;
          if ((owned && this.store.accessStatus(user.id, project.platform) === 'login_required') || !this.store.eligible(user.id, project, owned) || !user.subscribed || user.paused || !user.platforms.includes(project.platform) || !matchesKeywords(project, user.keywords)) continue;
          const enqueue = owned ? this.store.enqueueOwned.bind(this.store) : this.store.enqueue.bind(this.store);
          const claim = owned ? this.store.claimOwned.bind(this.store) : this.store.claim.bind(this.store);
          const finish = owned ? this.store.finishOwned.bind(this.store) : this.store.finish.bind(this.store);
          enqueue(user.id, projectId);
          if (!claim(user.id, projectId)) continue;
          this.nextSendAt = Date.now() + this.sendSpacingMs;
          try {
            await this.messenger.send(formatAlert(project), user.chatId);
            finish(user.id, projectId, 'sent');
            log('info', 'Project notification sent.', { event: 'notification.sent', platform: project.platform });
          } catch (error) {
            if (error instanceof TelegramError && error.code === 429) {
              const retryAt = Date.now() + error.retryAfter * 1000;
              this.nextSendAt = retryAt;
              finish(user.id, projectId, 'pending', retryAt);
            } else if (error instanceof TelegramError && error.code >= 400 && error.code < 500) {
              finish(user.id, projectId, 'failed');
              if (error.code === 403) this.store.preferences(user.id, { paused: true });
            } else {
              // Unknown outcome: avoid automatically duplicating a possibly delivered alert.
              finish(user.id, projectId, 'unknown');
            }
            log('error', 'Project notification failed; delivery state recorded.', {
              event: 'notification.failed', platform: project.platform,
              errorCode: error instanceof TelegramError ? `telegram_${error.code}` : 'delivery_unknown',
            });
          }
        }
      }
      ok = true;
    } finally {
      this.running = false;
      this.store.setState('monitoring_cycle', JSON.stringify({ startedAt, completedAt: Date.now(), ok: ok && !signal.aborted, running: false }));
    }
  }
}

export async function runScheduler(monitor: Monitor, intervalMs: number, signal: AbortSignal): Promise<void> {
  while (!signal.aborted) {
    const started = Date.now();
    try { await monitor.tick(signal); } catch { log('error', 'Monitoring cycle failed; retrying next cycle.', { event: 'monitor.cycle_failed', errorCode: 'cycle_failed' }); }
    try { await delay(Math.max(0, intervalMs - (Date.now() - started)), undefined, { signal }); } catch { break; }
  }
}
