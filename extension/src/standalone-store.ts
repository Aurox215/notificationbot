import type { ProjectDetails } from './detail-extractor.js';
import { listingPlatform } from '../shared/identity.js';
import { listingScope, listingUrlPage } from './listing-evidence.js';
import { validateScan } from '../shared/schema.js';
import { publishedAfter } from '../shared/publication.js';
import { formatAlert } from '../shared/project.js';
import { matchesKeywords } from '../shared/keywords.js';
import { platforms, type Platform, type SourceProject } from '../shared/types.js';
import { DiagnosticError } from './diagnostics.js';
import { DirectTelegram, DirectTelegramError, SHARED_BOT_USERNAME } from './direct-telegram.js';
export interface Delivery { state: 'pending' | 'sending' | 'sent' | 'unknown' | 'failed' | 'suppressed'; attempts: number; retryAt: number }
interface ProjectRecord { project: Omit<SourceProject, 'detectedAt'> & { detectedAt: string }; baseline: boolean; confirmed?: boolean; publicationObservedAt?: number; detailsCheckedAt?: number; enrichedDetails?: ProjectDetails; epoch: string; deliveries: Record<string, Delivery> }
interface Access { status: 'authenticated' | 'login_required' | 'verification_required'; generation: number }
interface Notice { kind?: 'account' | 'listing'; text: string; chatId: string; epoch: string; platform: Platform; generation: number; delivery: Delivery }
export interface StandaloneData {
  version: 3; token?: string;
  connection?: { chatId: string; cutoff: number; epoch: string };
  pending?: { chatId: string; code: string; expiresAt: number; failures: number; delivery: Delivery; auto?: boolean; nextAttemptAt?: number; confirmedAt?: number };
  keywords: string[]; selectedPlatforms: Platform[]; paused: boolean; scanEnabled: boolean;
  projects: Record<string, ProjectRecord>; seen: Record<string, true>; baselines: Platform[]; baselineAt: Partial<Record<Platform, number>>;
  guruSessionProbeVersion?: number;
  authenticationIssues?: Partial<Record<Platform, string>>;
  nextDetailAt?: Partial<Record<Platform, number>>; detailIssues?: Partial<Record<Platform, string>>;
  monitoringIssues?: Partial<Record<Platform, string>>;
  listingLocations?: Partial<Record<Platform, { available: boolean; generation: number; accessGeneration: number; epoch: string }>>;
  access: Partial<Record<Platform, Access>>; notices: Notice[]; nextSendAt: number; lastError: string;
}
export interface LocalPersistence { read(): Promise<unknown>; write(data: StandaloneData): Promise<void>; exclusive?<T>(operation: () => Promise<T>): Promise<T> }
const delivery = (): Delivery => ({ state: 'pending', attempts: 0, retryAt: 0 });
const initial = (): StandaloneData => ({ version: 3, keywords: [], selectedPlatforms: [...platforms], paused: false, scanEnabled: true,
  projects: {}, seen: {}, baselines: [], baselineAt: {}, access: {}, notices: [], nextSendAt: 0, lastError: '' });
const restore = (record: ProjectRecord): SourceProject => ({ ...record.project, detectedAt: new Date(record.project.detectedAt) });
export class StandaloneStore {
  private queue: Promise<unknown> = Promise.resolve();
  private recovered = false;
  constructor(private readonly persistence: LocalPersistence, private readonly telegram = new DirectTelegram(), private readonly configuredToken = '',
    private readonly now: () => number = Date.now, private readonly nonce: () => string = () => crypto.randomUUID().replaceAll('-', ''),
    private readonly wait: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms)), private readonly provisionedChatId = '', private readonly enrich?: (project: SourceProject) => Promise<ProjectDetails>) {}
  private migrate(raw: unknown): StandaloneData {
    if (raw === undefined || raw === null) return initial();
    const old = raw as Record<string, any>;
    if (old.version === 3) return old as StandaloneData;
    if (old.version === 2) {
      const upgraded = { ...old, version: 3, baselineAt: Object.fromEntries((old.baselines ?? []).map((p: Platform) => [p, this.now()])) } as StandaloneData;
      for (const record of Object.values(upgraded.projects)) record.confirmed = true;
      return upgraded;
    }
    if (old.version !== 1) throw new DiagnosticError('storage_version_invalid', 'storage', 'Unsupported local data version. Existing history was preserved.');
    const next = initial();
    next.keywords = Array.isArray(old.keywords) ? [...old.keywords] : [];
    next.selectedPlatforms = Array.isArray(old.selectedPlatforms) && old.selectedPlatforms.length ? old.selectedPlatforms.filter((p: Platform) => platforms.includes(p)) : [...platforms];
    next.paused = Boolean(old.paused) || old.subscribed === false; next.scanEnabled = old.scanEnabled !== false;
    next.baselines = Array.isArray(old.baselines) ? old.baselines.filter((p: Platform) => platforms.includes(p)) : [];
    for (const [key, value] of Object.entries(old.projects ?? {})) {
      const record = value as { project: ProjectRecord['project']; notify: boolean; delivery?: Delivery };
      if (!record?.project || !platforms.includes(record.project.platform)) continue;
      next.seen[key] = true;
      next.projects[key] = { project: record.project, baseline: !record.notify, epoch: 'legacy', deliveries: {} };
      if (record.delivery && old.session?.chatId) next.projects[key]!.deliveries[String(old.session.chatId)] = { ...record.delivery };
    }
    next.baselineAt = Object.fromEntries(next.baselines.map(p => [p, this.now()]));
    // Retire the old per-bot polling connection, keeping local preferences/history.
    return next;
  }
  private run<T>(task: (data: StandaloneData) => Promise<T>): Promise<T> {
    const operation = async () => {
      const data = this.migrate(await this.persistence.read());
      if (!this.recovered) {
        for (const record of Object.values(data.projects)) for (const item of Object.values(record.deliveries)) if (item.state === 'sending') item.state = 'unknown';
        for (const notice of data.notices) if (notice.delivery.state === 'sending') notice.delivery.state = 'unknown';
        if (data.pending?.delivery.state === 'sending') data.pending.delivery.state = 'unknown';
        await this.persistence.write(data); this.recovered = true;
      }
      if (data.pending && data.pending.expiresAt <= this.now()) { delete data.pending; await this.persistence.write(data); }
      return task(data);
    };
    const result = this.queue.catch(() => {}).then(() => this.persistence.exclusive ? this.persistence.exclusive(operation) : operation());
    this.queue = result; return result;
  }
  private token(data: StandaloneData): string {
    const value = data.token || this.configuredToken;
    if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(value)) throw new DiagnosticError('telegram_token_missing', 'telegram', 'Ask the administrator for the shared bot configuration or token.');
    return value;
  }
  private eligible(data: StandaloneData, record: ProjectRecord): boolean {
    return Boolean(data.connection && record.confirmed === true && !record.baseline && record.epoch === data.connection.epoch &&
      publishedAfter(record.project.publishedAt, new Date(record.publicationObservedAt ?? new Date(record.project.detectedAt).getTime()), Math.max(data.connection.cutoff, data.baselineAt[record.project.platform] ?? Infinity)));
  }
  private publicStatus(data: StandaloneData) {
    return { standalone: true, botUsername: SHARED_BOT_USERNAME, tokenConfigured: Boolean(data.token || this.configuredToken),
      provisionedChatId: this.provisionedChatId, automaticSetup: Boolean(data.pending?.auto),
      connected: Boolean(data.connection), chatId: data.connection?.chatId ?? '', verificationPending: Boolean(data.pending),
      pendingChatId: data.pending?.chatId ?? '', verificationDelivery: data.pending?.delivery.state ?? '',
      baselineReady: Object.fromEntries(platforms.map(platform => [platform, data.baselines.includes(platform)])),
      scanningEnabled: data.scanEnabled, preferences: { keywords: data.keywords, platforms: data.selectedPlatforms, paused: data.paused },
      platformAccess: data.access, lastError: data.lastError,
      monitoringIssue: data.scanEnabled && !data.paused ? data.selectedPlatforms.flatMap(platform => [data.authenticationIssues?.[platform], data.monitoringIssues?.[platform], data.detailIssues?.[platform]]).filter(Boolean).join(' ') : '',
    };
  }
  status() { return this.run(async data => this.publicStatus(data)); }
  async beginConnection(chatId: string, suppliedToken?: string) {
    chatId = chatId || this.provisionedChatId;
    return this.run(async data => {
      if (data.connection) throw new DiagnosticError('already_connected', 'telegram', 'Disconnect before connecting another chat. History and settings will be retained.');
      if (!/^[1-9]\d{0,15}$/.test(chatId) || !Number.isSafeInteger(Number(chatId))) throw new DiagnosticError('telegram_chat_invalid', 'telegram', 'Enter your numeric private Telegram chat ID.');
      if (suppliedToken?.trim()) data.token = suppliedToken.trim();
      if (this.provisionedChatId === chatId) await this.telegram.identify(this.token(data)); else await this.telegram.validate(this.token(data), chatId);
      if (!data.pending || data.pending.chatId !== chatId || ['unknown', 'failed'].includes(data.pending.delivery.state)) data.pending = { chatId, code: this.nonce().slice(0, 8).toUpperCase(), expiresAt: this.now() + 86400000, failures: 0, delivery: delivery(), auto: true };
      await this.persistence.write(data);
      await this.drain(data);
      return this.publicStatus(data);
    });
  }
  confirmConnection(code: string) {
    return this.run(async data => {
      if (!data.pending) throw new DiagnosticError('verification_expired', 'telegram', 'Start Connect Telegram again; the verification expired.');
      if (data.pending.auto) throw new DiagnosticError('telegram_waiting_start', 'telegram', 'Press Start in Telegram (or send /start). This preconfigured connection activates automatically.');
      if (data.pending.code !== code.trim().toUpperCase()) {
        data.pending.failures++; if (data.pending.failures >= 5) delete data.pending;
        await this.persistence.write(data);
        throw new DiagnosticError('verification_invalid', 'telegram', 'The code does not match. Read the connection message in your Telegram chat.');
      }
      for (const record of Object.values(data.projects)) for (const item of Object.values(record.deliveries)) if (item.state === 'pending') item.state = 'suppressed';
      for (const notice of data.notices) if (notice.delivery.state === 'pending') notice.delivery.state = 'suppressed';
      data.connection = { chatId: data.pending.chatId, cutoff: this.now(), epoch: this.nonce() };
      delete data.pending; data.lastError = '';
      await this.persistence.write(data); return this.publicStatus(data);
    });
  }
  disconnect() {
    return this.run(async data => {
      delete data.connection; delete data.pending; delete data.token;
      for (const record of Object.values(data.projects)) for (const item of Object.values(record.deliveries)) if (item.state === 'pending') item.state = 'suppressed';
      for (const notice of data.notices) if (notice.delivery.state === 'pending') notice.delivery.state = 'suppressed';
      data.lastError = ''; await this.persistence.write(data); return this.publicStatus(data);
    });
  }
  checkConnection() {
    return this.run(async data => {
      if (data.pending?.auto) await this.drain(data);
      if (data.connection) {
        try { await this.telegram.validate(this.token(data), data.connection.chatId); data.lastError = ''; }
        catch (error) { await this.recordError(data, error); }
      }
      await this.persistence.write(data); return this.publicStatus(data);
    });
  }
  setScanning(enabled: boolean) { return this.run(async data => { data.scanEnabled = enabled; await this.persistence.write(data); return this.publicStatus(data); }); }
  ingest(input: unknown) {
    return this.run(async data => {
      if (!data.connection || !data.scanEnabled) return { accepted: false, detail: 'Connect Telegram and enable scanning first.' };
      const raw = input as { platform?: Platform; pageUrl?: string; projects?: unknown[]; listing?: import('../shared/schema.js').ListingEvidence };
      const evidence = raw?.listing;
      const validScope = typeof raw?.pageUrl === 'string' && listingPlatform(raw.pageUrl) === raw.platform;
      const confirmed = validScope && evidence?.version === 1 && (evidence.source === 'dom' || (evidence.source === 'html' && data.baselines.includes(raw.platform!))) && evidence.settled === true && evidence.page === 'first' && listingUrlPage(raw.pageUrl!) === 'first' && evidence.scope === listingScope(raw.pageUrl!);
      const complete = confirmed && ((evidence.completeness === 'complete' && Array.isArray(raw.projects) && raw.projects.length > 0) || (evidence.completeness === 'empty' && Array.isArray(raw.projects) && raw.projects.length === 0));
      const empty = complete && evidence!.completeness === 'empty';
      const scan = empty ? { platform: raw.platform!, projects: [] as SourceProject[] } : validateScan(input);
      const baseline = !data.baselines.includes(scan.platform);
      const establishes = baseline && complete;
      let inserted = 0;
      for (const project of scan.projects) {
        const key = project.platform + ':' + project.sourceId;
        const previous = data.projects[key];
        if (previous) {
          const publicationChanged = Boolean(project.publishedAt && project.publishedAt !== previous.project.publishedAt);
          previous.project = { ...previous.project, ...project, ...previous.enrichedDetails, detectedAt: previous.project.detectedAt,
            ...(previous.project.client || project.client ? { client: { ...previous.project.client, ...project.client, ...previous.enrichedDetails?.client } } : {}) };
          if (publicationChanged) previous.publicationObservedAt = this.now();
          if (complete && !previous.baseline) previous.confirmed = true;
        } else {
          data.projects[key] = { project: { ...project, detectedAt: new Date(this.now()).toISOString() }, baseline: baseline || evidence?.page !== 'first' || Boolean(data.seen[key]), confirmed: complete, publicationObservedAt: this.now(), epoch: data.connection.epoch, deliveries: {} };
          data.seen[key] = true; inserted++;
        }
      }
      if (establishes) { data.baselines.push(scan.platform); data.baselineAt[scan.platform] = this.now(); }
      await this.persistence.write(data); await this.drain(data);
      return { accepted: true, baseline: establishes, baselineReady: data.baselines.includes(scan.platform), conservative: !complete, inserted, count: scan.projects.length, lastSuccess: new Date(this.now()).toISOString(),
        detail: !complete ? 'Incomplete, HTML-only or paginated scan saved silently. Waiting for a settled first-page listing scan.' : establishes ? 'Confirmed initial baseline saved silently. None of these projects will notify.' : `Saved ${inserted} new project(s); delivery follows your filters and connection cutoff.` };
    });
  }
  recordAccess(platform: Platform, status: Access['status']) {
    return this.run(async data => {
      if (!platforms.includes(platform) || !['authenticated', 'login_required', 'verification_required'].includes(status)) return;
      const firstGuruProof = platform === 'Guru' && status === 'authenticated' && data.guruSessionProbeVersion !== 1;
      if (firstGuruProof) {
        data.guruSessionProbeVersion = 1;
        if (data.listingLocations) delete data.listingLocations.Guru;
        for (const notice of data.notices) if (notice.platform === 'Guru' && notice.kind === 'listing' && notice.delivery.state === 'pending') notice.delivery.state = 'suppressed';
      }
      const previous = data.access[platform];
      if (status === 'verification_required' && previous?.status === 'login_required') return;
      const changed = previous?.status !== status;
      const generation = (previous?.generation ?? 0) + (changed ? 1 : 0);
      data.access[platform] = { status, generation };
      if ((changed || firstGuruProof) && data.connection && (status === 'login_required' || (status === 'authenticated' && (previous?.status === 'login_required' || firstGuruProof)))) {
        data.notices.push({ text: status === 'login_required' ? `${platform}: login required. Sign in normally in your browser.` : previous?.status === 'login_required' ? `${platform}: signed in again. Monitoring can resume; your preferences still apply.` : `${platform}: signed in. Keep the jobs page open to monitor new projects.`,
          chatId: data.connection.chatId, epoch: data.connection.epoch, platform, generation, delivery: delivery() });
      }
      await this.persistence.write(data); await this.drain(data);
    });
  }
  recordAuthenticationIssue(platform: Platform, detail: string) {
    return this.run(async data => {
      if (!platforms.includes(platform)) return;
      const issues = data.authenticationIssues ??= {};
      if (detail) issues[platform] = detail; else delete issues[platform];
      await this.persistence.write(data);
    });
  }
  recordMonitoringIssue(platform: Platform, detail: string) {
    return this.run(async data => {
      if (!platforms.includes(platform)) return;
      const issues = data.monitoringIssues ??= {};
      if (detail) issues[platform] = detail; else delete issues[platform];
      await this.persistence.write(data);
    });
  }
  recordListingPresence(platform: Platform, available: boolean) {
    return this.run(async data => {
      if (!platforms.includes(platform) || !data.connection || !data.scanEnabled || data.paused || !data.selectedPlatforms.includes(platform)) return;
      const access = data.access[platform];
      if (access?.status !== 'authenticated') return;
      const locations = data.listingLocations ??= {};
      const previous = locations[platform];
      const changed = !previous || previous.available !== available || previous.accessGeneration !== access.generation || previous.epoch !== data.connection.epoch;
      if (changed) {
        const generation = (previous?.generation ?? 0) + 1;
        locations[platform] = { available, generation, accessGeneration: access.generation, epoch: data.connection.epoch };
        if (!available) {
          const url = platform === 'PeoplePerHour' ? 'https://www.peopleperhour.com/freelance-jobs' : 'https://www.guru.com/work/';
          data.notices.push({ kind: 'listing', text: platform + ': you are signed in, but the jobs page is not open. Open ' + url + ' and keep that tab open to receive new-project alerts.',
            chatId: data.connection.chatId, epoch: data.connection.epoch, platform, generation, delivery: delivery() });
        }
      }
      await this.persistence.write(data); await this.drain(data);
    });
  }
  private async recordError(data: StandaloneData, error: unknown) {
    data.lastError = error instanceof DiagnosticError ? error.message : 'Telegram delivery failed. No credentials were logged.';
    if (error instanceof DirectTelegramError && [401, 403].includes(error.telegramCode)) { delete data.connection; delete data.pending; }
    await this.persistence.write(data);
  }
  private async send(data: StandaloneData, item: Delivery, chatId: string, text: string, setup = false) {
    const delay = data.nextSendAt - this.now(); if (delay > 1500) return;
    if (delay > 0) await this.wait(delay);
    item.state = 'sending'; item.attempts++; data.nextSendAt = this.now() + 1100;
    await this.persistence.write(data);
    try { await this.telegram.send(this.token(data), chatId, text); item.state = 'sent'; data.lastError = ''; if (setup && data.pending) data.pending.confirmedAt = this.now(); }
    catch (error) {
      if (setup && error instanceof DirectTelegramError && [400, 403].includes(error.telegramCode)) {
        item.state = 'pending'; item.attempts--; item.retryAt = this.now() + 5000; data.nextSendAt = item.retryAt;
        data.lastError = 'Waiting for Telegram Start. Open @Aurox_notification_bot and press Start (or send /start); setup will finish automatically.';
        await this.persistence.write(data); return;
      }
      if (error instanceof DirectTelegramError && error.telegramCode === 429 && item.attempts < 5) { item.state = 'pending'; item.retryAt = this.now() + error.retryAfter * 1000; data.nextSendAt = item.retryAt; }
      else item.state = error instanceof DirectTelegramError && error.telegramCode < 500 ? 'failed' : 'unknown';
      await this.recordError(data, error);
    }
    await this.persistence.write(data);
  }
  private async advanceAutomaticConnection(data: StandaloneData) {
    const pending = data.pending;
    if (!pending?.auto || ['unknown', 'failed'].includes(pending.delivery.state)) return;
    if (pending.delivery.state !== 'sent') {
      if ((pending.nextAttemptAt ?? 0) > this.now() || pending.delivery.retryAt > this.now()) return;
      try { await this.telegram.validate(this.token(data), pending.chatId); }
      catch (error) {
        pending.nextAttemptAt = this.now() + (error instanceof DirectTelegramError && error.telegramCode === 429 ? error.retryAfter * 1000 : 5000);
        if (error instanceof DirectTelegramError && [400, 403].includes(error.telegramCode)) {
          data.lastError = 'Waiting for Telegram Start. Open @Aurox_notification_bot and press Start (or send /start); setup will finish automatically.';
          await this.persistence.write(data);
        } else await this.recordError(data, error);
        return;
      }
      await this.send(data, pending.delivery, pending.chatId, 'Aurox is connected to this browser. New matching job alerts and account notices will arrive here. Existing jobs are skipped.', true);
    }
    if (data.pending?.delivery.state === 'sent') {
      for (const record of Object.values(data.projects)) for (const item of Object.values(record.deliveries)) if (item.state === 'pending') item.state = 'suppressed';
      for (const notice of data.notices) if (notice.delivery.state === 'pending') notice.delivery.state = 'suppressed';
      data.connection = { chatId: pending.chatId, cutoff: pending.confirmedAt ?? this.now(), epoch: this.nonce() };
      delete data.pending; data.lastError = ''; await this.persistence.write(data);
    }
  }
  private async drain(data: StandaloneData) {
    const due = (item: Delivery) => item.state === 'pending' && item.attempts < 5 && item.retryAt <= this.now();
    if (this.now() < data.nextSendAt - 1500) return;
    if (data.pending?.auto) await this.advanceAutomaticConnection(data);
    if (data.pending && !data.pending.auto && due(data.pending.delivery)) await this.send(data, data.pending.delivery, data.pending.chatId, `Aurox connection code: ${data.pending.code}\nEnter this code in the extension to confirm this chat. If you did not start this setup, ignore the message.`);
    if (!data.connection || data.paused) return;
    let attempts = 0;
    for (const notice of data.notices) {
      if (attempts >= 3) break;
      const location = data.listingLocations?.[notice.platform];
      const currentNotice = notice.kind === 'listing'
        ? location?.available === false && notice.generation === location.generation && location.accessGeneration === data.access[notice.platform]?.generation && data.access[notice.platform]?.status === 'authenticated' && data.scanEnabled
        : notice.generation === data.access[notice.platform]?.generation;
      if (notice.epoch !== data.connection.epoch || !currentNotice) { if (due(notice.delivery)) notice.delivery.state = 'suppressed'; continue; }
      if (data.selectedPlatforms.includes(notice.platform) && due(notice.delivery)) { await this.send(data, notice.delivery, notice.chatId, notice.text); attempts++; }
      if (!data.connection) return;
    }
    if (data.scanEnabled) for (const record of Object.values(data.projects)) {
      if (!data.connection || attempts >= 3) break;
      let project = restore(record);
      if (!this.eligible(data, record) || !data.selectedPlatforms.includes(project.platform) || data.access[project.platform]?.status === 'login_required') continue;
      const item = record.deliveries[data.connection.chatId] ??= delivery();
      if (due(item)) {
        if (this.enrich && record.detailsCheckedAt === undefined) {
          const detailDelay = Math.min(1100, Math.max(0, (data.nextDetailAt?.[project.platform] ?? 0) - this.now()));
          if (detailDelay) await this.wait(detailDelay);
          record.detailsCheckedAt = this.now(); (data.nextDetailAt ??= {})[project.platform] = this.now() + 1100;
          await this.persistence.write(data);
          try {
            const details = await this.enrich(project); record.enrichedDetails = details;
            record.project = { ...record.project, ...details, ...(details.client || record.project.client ? { client: { ...record.project.client, ...details.client } } : {}) };
            if (data.detailIssues) delete data.detailIssues[project.platform];
          } catch { (data.detailIssues ??= {})[project.platform] = project.platform + ': some project details could not be read. Alerts use available listing information.'; }
          await this.persistence.write(data); project = restore(record);
        }
        if (!matchesKeywords(project, data.keywords)) continue;
        await this.send(data, item, data.connection.chatId, formatAlert(project)); attempts++;
      }
    }
    await this.persistence.write(data);
  }
  pulse() { return this.run(async data => { await this.drain(data); return this.publicStatus(data); }); }
}