import { setTimeout as delay } from 'node:timers/promises';
import type { Store } from '../persistence/store.js';
import type { ProjectSource } from '../sources/types.js';
import type { Messenger } from '../bot/commands.js';
import { formatAlert } from '../domain/project.js';
import { matchesKeywords } from '../filtering/keywords.js';
import { TelegramError } from '../telegram/client.js';
import { log } from '../logging/logger.js';

export class Monitor {
  private running = false;
  private nextSendAt = 0;
  constructor(private readonly store: Store, private readonly sources: ProjectSource[], private readonly messenger: Messenger,
    private readonly sendSpacingMs = 1100) {}

  async tick(signal: AbortSignal): Promise<void> {
    if (this.running || signal.aborted) return;
    this.running = true;
    try {
      for (const source of this.sources) {
        if (signal.aborted) return;
        try {
          const projects = await source.fetchProjects(AbortSignal.any([signal, AbortSignal.timeout(15000)]));
          for (const project of projects) {
            if (project.platform !== source.platform || !project.sourceId) throw new Error('Invalid source identity');
            this.store.saveProject(project);
          }
        } catch { if (!signal.aborted) log('error', `${source.platform} source failed; will retry next cycle.`); }
      }
      // Re-evaluate stored fixtures for new subscribers or changed preferences.
      for (const { id: projectId, project } of this.store.projects()) {
        for (const initialUser of this.store.users()) {
          if (signal.aborted) return;
          const waitMs = this.nextSendAt - Date.now();
          if (waitMs > 0) {
            try { await delay(waitMs, undefined, { signal }); } catch { return; }
          }
          // Commands may change preferences while a send is waiting.
          const user = this.store.user(initialUser.id)!;
          if (!user.subscribed || user.paused || !user.platforms.includes(project.platform) || !matchesKeywords(project, user.keywords)) continue;
          this.store.enqueue(user.id, projectId);
          if (!this.store.claim(user.id, projectId)) continue;
          this.nextSendAt = Date.now() + this.sendSpacingMs;
          try {
            await this.messenger.send(formatAlert(project), user.chatId);
            this.store.finish(user.id, projectId, 'sent');
          } catch (error) {
            if (error instanceof TelegramError && error.code === 429) {
              const retryAt = Date.now() + error.retryAfter * 1000;
              this.nextSendAt = retryAt;
              this.store.finish(user.id, projectId, 'pending', retryAt);
            } else if (error instanceof TelegramError && error.code >= 400 && error.code < 500) {
              this.store.finish(user.id, projectId, 'failed');
              if (error.code === 403) this.store.preferences(user.id, { paused: true });
            } else {
              // Unknown outcome: avoid automatically duplicating a possibly delivered alert.
              this.store.finish(user.id, projectId, 'unknown');
            }
            log('error', 'Project notification failed; delivery state recorded.');
          }
        }
      }
    } finally { this.running = false; }
  }
}

export async function runScheduler(monitor: Monitor, intervalMs: number, signal: AbortSignal): Promise<void> {
  while (!signal.aborted) {
    const started = Date.now();
    try { await monitor.tick(signal); } catch { log('error', 'Monitoring cycle failed; retrying next cycle.'); }
    try { await delay(Math.max(0, intervalMs - (Date.now() - started)), undefined, { signal }); } catch { break; }
  }
}
