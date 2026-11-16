import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Platform, SourceProject } from '../sources/types.js';
import { matchesKeywords } from '../filtering/keywords.js';
import { publishedAfter } from '../domain/publication.js';

export interface User {
  id: string; chatId: string; subscribed: boolean; paused: boolean; keywords: string[]; platforms: Platform[];
}
interface UserRow { id: string; chat_id: string; subscribed: number; paused: number; keywords: string; platforms: string }
export class Store {
  private readonly db: DatabaseSync;
  constructor(path: string, private readonly defaults: string[]) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, subscribed INTEGER NOT NULL DEFAULT 0,
        paused INTEGER NOT NULL DEFAULT 0, keywords TEXT NOT NULL, platforms TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY, platform TEXT NOT NULL, source_id TEXT NOT NULL, payload TEXT NOT NULL,
        UNIQUE(platform, source_id));
      CREATE TABLE IF NOT EXISTS notifications (
        user_id TEXT NOT NULL REFERENCES users(id), project_id INTEGER NOT NULL REFERENCES projects(id),
        state TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
        retry_at INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(user_id, project_id));
      CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ingestion_baselines (platform TEXT PRIMARY KEY, initialized_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS browser_projects (
        id INTEGER PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), platform TEXT NOT NULL,
        source_id TEXT NOT NULL, payload TEXT NOT NULL, notify INTEGER NOT NULL,
        UNIQUE(user_id,platform,source_id), UNIQUE(user_id,id));
      CREATE TABLE IF NOT EXISTS browser_baselines (
        user_id TEXT NOT NULL REFERENCES users(id), platform TEXT NOT NULL, PRIMARY KEY(user_id,platform));
      CREATE TABLE IF NOT EXISTS browser_notifications (
        user_id TEXT NOT NULL, project_id INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0, retry_at INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(user_id,project_id),
        FOREIGN KEY(user_id,project_id) REFERENCES browser_projects(user_id,id));
      CREATE TABLE IF NOT EXISTS pairing_requests (
        id TEXT PRIMARY KEY, link_hash TEXT NOT NULL UNIQUE, poll_hash TEXT NOT NULL,
        confirmation_code TEXT NOT NULL UNIQUE, expires_at INTEGER NOT NULL,
        user_id TEXT REFERENCES users(id), approved INTEGER NOT NULL DEFAULT 0, claimed INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS extension_sessions (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), token_hash TEXT NOT NULL UNIQUE,
        expires_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS platform_access (
        user_id TEXT NOT NULL REFERENCES users(id), platform TEXT NOT NULL, status TEXT NOT NULL,
        notice_state TEXT NOT NULL DEFAULT 'none', last_notice_at INTEGER NOT NULL DEFAULT 0,
        retry_at INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(user_id,platform));
      UPDATE platform_access SET notice_state='unknown',last_notice_at=CAST(strftime('%s','now') AS INTEGER)*1000 WHERE notice_state='sending';
      UPDATE browser_notifications SET state='unknown' WHERE state='sending';
      UPDATE notifications SET state='unknown' WHERE state='sending';`);
    const columns = this.db.prepare('PRAGMA table_info(projects)').all().map(row => row.name);
    if (!columns.includes('notify')) this.db.exec('ALTER TABLE projects ADD COLUMN notify INTEGER NOT NULL DEFAULT 1');
    if (!columns.includes('origin')) this.db.exec("ALTER TABLE projects ADD COLUMN origin TEXT NOT NULL DEFAULT 'monitor'");
    // Upgrade existing accounts once; restarts preserve their original cutoff.
    for (const row of this.db.prepare('SELECT id FROM users').all()) {
      const id = String(row.id);
      if (this.getState('alerts_since:' + id) === undefined) this.startAlerts(id);
    }
  }
  close(): void { this.db.close(); }
  runtimeSummary() {
    const activeSubscribers = Number(this.db.prepare('SELECT COUNT(*) AS count FROM users WHERE subscribed=1 AND paused=0').get()!.count);
    const pendingProjects = Number(this.db.prepare("SELECT (SELECT COUNT(*) FROM notifications WHERE state='pending') + (SELECT COUNT(*) FROM browser_notifications WHERE state='pending') AS count").get()!.count);
    const platformAccess = this.db.prepare('SELECT platform,status,COUNT(*) AS count FROM platform_access GROUP BY platform,status').all()
      .map(row => ({ platform: String(row.platform), status: String(row.status), count: Number(row.count) }));
    const contact = Number(this.getState('last_browser_contact') ?? 0);
    return { activeSubscribers, pendingProjects, platformAccess, lastBrowserContactAt: contact || null };
  }
  startAlerts(userId: string, now = Date.now()): void {
    this.setState('alerts_since:' + userId, String(now));
    this.db.prepare('UPDATE browser_projects SET notify=0 WHERE user_id=?').run(userId);
    this.db.prepare('DELETE FROM browser_baselines WHERE user_id=?').run(userId);
  }
  eligible(userId: string, project: SourceProject, owned: boolean): boolean {
    const cutoff = this.getState('alerts_since:' + userId);
    if (cutoff === undefined) return true;
    return owned || project.publishedAt !== undefined
      ? publishedAfter(project.publishedAt, project.detectedAt, Number(cutoff))
      : project.detectedAt.getTime() > Number(cutoff);
  }
  recordAccess(userId: string, platform: Platform, status: 'ok' | 'authenticated' | 'login_required' | 'verification_required', now = Date.now()): void {
    this.db.prepare(`INSERT INTO platform_access(user_id,platform,status,notice_state) VALUES(?,?,?,?)
      ON CONFLICT(user_id,platform) DO UPDATE SET status=excluded.status,
      notice_state=CASE WHEN excluded.status='authenticated' AND platform_access.status='login_required' THEN 'pending'
        WHEN excluded.status='authenticated' AND platform_access.status='authenticated' THEN platform_access.notice_state
        WHEN excluded.status!='login_required' THEN 'none'
        WHEN platform_access.status!='login_required' THEN 'pending' ELSE platform_access.notice_state END,
      retry_at=CASE WHEN excluded.status='authenticated' AND platform_access.status='login_required' THEN ?
        WHEN excluded.status='login_required' AND platform_access.status='authenticated' THEN ?
        WHEN excluded.status='login_required' AND platform_access.status!='login_required'
        THEN MAX(?,CASE WHEN platform_access.last_notice_at>0 THEN platform_access.last_notice_at+1800000 ELSE 0 END) ELSE platform_access.retry_at END`)
      .run(userId, platform, status, status === 'login_required' ? 'pending' : 'none', now, now, now);
  }
  accessStatus(userId: string, platform: Platform): string | undefined {
    return this.db.prepare('SELECT status FROM platform_access WHERE user_id=? AND platform=?').get(userId, platform)?.status as string | undefined;
  }
  loginNotices(userId: string): Platform[] {
    return this.db.prepare("SELECT platform FROM platform_access WHERE user_id=? AND status IN ('login_required','authenticated') AND notice_state='pending' AND retry_at<=?")
      .all(userId, Date.now()).map(row => row.platform as Platform);
  }
  claimLoginNotice(userId: string, platform: Platform): boolean {
    return this.db.prepare("UPDATE platform_access SET notice_state='sending' WHERE user_id=? AND platform=? AND status IN ('login_required','authenticated') AND notice_state='pending' AND retry_at<=?")
      .run(userId, platform, Date.now()).changes === 1;
  }
  finishLoginNotice(userId: string, platform: Platform, state: 'sent' | 'unknown' | 'failed' | 'pending', retryAt = 0, expectedStatus?: string): void {
    this.db.prepare("UPDATE platform_access SET notice_state=?,retry_at=?,last_notice_at=CASE WHEN ?='pending' THEN last_notice_at ELSE ? END WHERE user_id=? AND platform=? AND (? IS NULL OR status=?)")
      .run(state, retryAt, state, Date.now(), userId, platform, expectedStatus ?? null, expectedStatus ?? null);
  }
  ensureUser(id: string, chatId: string): User {
    this.db.prepare(`INSERT INTO users(id,chat_id,keywords,platforms) VALUES(?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET chat_id=excluded.chat_id`).run(id, chatId, JSON.stringify(this.defaults), JSON.stringify(['PeoplePerHour', 'Guru']));
    return this.user(id)!;
  }
  user(id: string): User | undefined {
    const row = this.db.prepare('SELECT * FROM users WHERE id=?').get(id) as unknown as UserRow | undefined;
    return row ? { id: row.id, chatId: row.chat_id, subscribed: Boolean(row.subscribed), paused: Boolean(row.paused),
      keywords: JSON.parse(row.keywords) as string[], platforms: JSON.parse(row.platforms) as Platform[] } : undefined;
  }
  users(): User[] {
    return (this.db.prepare('SELECT id FROM users WHERE subscribed=1 AND paused=0').all() as { id: string }[]).map(row => this.user(row.id)!);
  }
  preferences(id: string, change: Partial<Pick<User, 'subscribed' | 'paused' | 'keywords' | 'platforms'>>): void {
    const user = { ...this.user(id)!, ...change };
    this.db.prepare('UPDATE users SET subscribed=?,paused=?,keywords=?,platforms=? WHERE id=?')
      .run(Number(user.subscribed), Number(user.paused), JSON.stringify(user.keywords), JSON.stringify(user.platforms), id);
  }
  saveProject(project: SourceProject, options: { notify?: boolean; origin?: 'monitor' | 'extension' } = {}): number {
    this.db.prepare('INSERT OR IGNORE INTO projects(platform,source_id,payload,notify,origin) VALUES(?,?,?,?,?)')
      .run(project.platform, project.sourceId, JSON.stringify(project), Number(options.notify ?? true), options.origin ?? 'monitor');
    return Number(this.db.prepare('SELECT id FROM projects WHERE platform=? AND source_id=?').get(project.platform, project.sourceId)!.id);
  }
  projects(notifiableOnly = false, origin?: 'extension' | 'monitor'): { id: number; project: SourceProject }[] {
    return (this.db.prepare('SELECT id,payload FROM projects WHERE (?=0 OR notify=1) AND (? IS NULL OR origin=?)').all(Number(notifiableOnly), origin ?? null, origin ?? null) as { id: number; payload: string }[]).map(row => {
      const data = JSON.parse(row.payload) as SourceProject;
      return { id: row.id, project: { ...data, detectedAt: new Date(data.detectedAt) } };
    });
  }
  ingestOwned(userId: string, platform: Platform, projects: SourceProject[]) {
    if (!this.user(userId) || !projects.length || projects.some(p => p.platform !== platform)) throw new Error('Invalid owned batch.');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const baseline = !this.db.prepare('SELECT 1 FROM browser_baselines WHERE user_id=? AND platform=?').get(userId, platform);
      let inserted = 0;
      for (const project of projects) {
        const existing = this.db.prepare('SELECT payload FROM browser_projects WHERE user_id=? AND platform=? AND source_id=?')
          .get(userId, platform, project.sourceId) as { payload: string } | undefined;
        if (existing) {
          // A later DOM scan may expose metadata absent from an earlier HTML scan.
          // Keep original discovery time and baseline eligibility; never notify a baseline retroactively.
          const previous = JSON.parse(existing.payload) as SourceProject;
          const merged = { ...previous, ...project, detectedAt: previous.detectedAt,
            ...(previous.client || project.client ? { client: { ...previous.client, ...project.client } } : {}) };
          this.db.prepare('UPDATE browser_projects SET payload=? WHERE user_id=? AND platform=? AND source_id=?')
            .run(JSON.stringify(merged), userId, platform, project.sourceId);
          continue;
        }
        inserted += Number(this.db.prepare(`INSERT OR IGNORE INTO browser_projects(user_id,platform,source_id,payload,notify) VALUES(?,?,?,?,?)`)
          .run(userId, platform, project.sourceId, JSON.stringify(project), Number(this.getState('alerts_since:' + userId) === undefined ? !baseline : this.eligible(userId, project, true))).changes);
      }
      this.db.prepare('INSERT OR IGNORE INTO browser_baselines(user_id,platform) VALUES(?,?)').run(userId, platform);
      this.db.exec('COMMIT');
      return { baseline, received: projects.length, inserted };
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  browserProjects(userId: string, includeBaseline = false): { id: number; project: SourceProject }[] {
    return (this.db.prepare('SELECT id,payload FROM browser_projects WHERE user_id=? AND (?=1 OR notify=1)')
      .all(userId, Number(includeBaseline)) as { id: number; payload: string }[]).map(row => {
        const project = JSON.parse(row.payload) as SourceProject;
        return { id: row.id, project: { ...project, detectedAt: new Date(project.detectedAt) } };
      }).filter(row => includeBaseline || this.eligible(userId, row.project, true));
  }
  browserSummary(userId: string) {
    const user = this.user(userId);
    if (!user) throw new Error('Unknown user.');
    const all = this.browserProjects(userId, true);
    const candidates = this.browserProjects(userId);
    const platforms = candidates.filter(p => user.platforms.includes(p.project.platform));
    const matching = platforms.filter(p => matchesKeywords(p.project, user.keywords));
    const deliveries = this.db.prepare('SELECT state,COUNT(*) AS count FROM browser_notifications WHERE user_id=? GROUP BY state').all(userId);
    return { stored: all.length, baseline: all.length - candidates.length, afterBaseline: candidates.length,
      platformExcluded: candidates.length - platforms.length, keywordExcluded: platforms.length - matching.length,
      matching: matching.length, alertsEnabled: user.subscribed && !user.paused,
      missingSearchMetadata: candidates.filter(p => !p.project.description && !p.project.skills?.length).length,
      deliveries: deliveries.map(row => ({ state: String(row.state), count: Number(row.count) })) };
  }
  enqueueOwned(userId: string, projectId: number): void {
    this.db.prepare('INSERT OR IGNORE INTO browser_notifications(user_id,project_id) VALUES(?,?)').run(userId, projectId);
  }
  claimOwned(userId: string, projectId: number): boolean {
    return this.db.prepare(`UPDATE browser_notifications SET state='sending',attempts=attempts+1,updated_at=CURRENT_TIMESTAMP
      WHERE user_id=? AND project_id=? AND state='pending' AND retry_at<=? AND attempts<5`).run(userId, projectId, Date.now()).changes === 1;
  }
  finishOwned(userId: string, projectId: number, state: 'sent' | 'unknown' | 'failed' | 'pending', retryAt = 0): void {
    this.db.prepare(`UPDATE browser_notifications SET state=CASE WHEN ?='pending' AND attempts>=5 THEN 'failed' ELSE ? END,
      retry_at=?,updated_at=CURRENT_TIMESTAMP WHERE user_id=? AND project_id=?`).run(state, state, retryAt, userId, projectId);
  }
  createPairing(id: string, linkHash: string, pollHash: string, code: string, expiresAt: number, now: number): void {
    this.db.prepare('DELETE FROM pairing_requests WHERE expires_at<=?').run(now);
    this.db.prepare('INSERT INTO pairing_requests(id,link_hash,poll_hash,confirmation_code,expires_at) VALUES(?,?,?,?,?)').run(id, linkHash, pollHash, code, expiresAt);
  }
  proposePairing(linkHash: string, userId: string, now: number): string | undefined {
    this.db.prepare(`UPDATE pairing_requests SET user_id=? WHERE link_hash=? AND expires_at>? AND approved=0 AND claimed=0
      AND (user_id IS NULL OR user_id=?)`).run(userId, linkHash, now, userId);
    return this.db.prepare('SELECT confirmation_code FROM pairing_requests WHERE link_hash=? AND user_id=? AND expires_at>? AND approved=0 AND claimed=0')
      .get(linkHash, userId, now)?.confirmation_code as string | undefined;
  }
  approvePairing(userId: string, code: string, now: number): boolean {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const approved = this.db.prepare('UPDATE pairing_requests SET approved=1 WHERE user_id=? AND confirmation_code=? AND expires_at>? AND approved=0 AND claimed=0')
        .run(userId, code, now).changes === 1;
      if (approved) this.startAlerts(userId, now);
      this.db.exec('COMMIT');
      return approved;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  claimPairing(id: string, pollHash: string, sessionId: string, tokenHash: string, sessionExpiresAt: number, now: number): 'pending' | 'invalid' | 'connected' {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.db.prepare('SELECT user_id,approved FROM pairing_requests WHERE id=? AND poll_hash=? AND expires_at>? AND claimed=0')
        .get(id, pollHash, now) as { user_id: string | null; approved: number } | undefined;
      let result: 'pending' | 'invalid' | 'connected' = 'invalid';
      if (row && !row.approved) result = 'pending';
      else if (row?.user_id) {
        this.db.prepare('UPDATE pairing_requests SET claimed=1 WHERE id=?').run(id);
        this.db.prepare('INSERT INTO extension_sessions(id,user_id,token_hash,expires_at) VALUES(?,?,?,?)').run(sessionId, row.user_id, tokenHash, sessionExpiresAt);
        result = 'connected';
      }
      this.db.exec('COMMIT'); return result;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  sessionUser(tokenHash: string, now: number): string | undefined {
    return this.db.prepare('SELECT user_id FROM extension_sessions WHERE token_hash=? AND expires_at>? AND revoked=0').get(tokenHash, now)?.user_id as string | undefined;
  }
  revokeSession(tokenHash: string): void { this.db.prepare('UPDATE extension_sessions SET revoked=1 WHERE token_hash=?').run(tokenHash); }
  disconnectUser(userId: string): void {
    this.db.prepare('UPDATE extension_sessions SET revoked=1 WHERE user_id=?').run(userId);
    this.db.prepare('DELETE FROM pairing_requests WHERE user_id=?').run(userId);
  }
  // Legacy unowned input is retained for old database compatibility only. HTTP never
  // calls this method, and Monitor excludes these extension rows from all dispatch.
  ingest(platform: Platform, projects: SourceProject[]): { baseline: boolean; received: number; inserted: number } {
    if (!projects.length || projects.some(p => p.platform !== platform)) throw new Error('Invalid ingestion batch.');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const baseline = !this.db.prepare('SELECT 1 FROM ingestion_baselines WHERE platform=?').get(platform);
      let inserted = 0;
      for (const project of projects) {
        const exists = this.db.prepare('SELECT 1 FROM projects WHERE platform=? AND source_id=?').get(platform, project.sourceId);
        this.saveProject(project, { notify: !baseline, origin: 'extension' });
        if (!exists) inserted++;
      }
      this.db.prepare('INSERT OR IGNORE INTO ingestion_baselines(platform) VALUES(?)').run(platform);
      this.db.exec('COMMIT');
      return { baseline, received: projects.length, inserted };
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  enqueue(userId: string, projectId: number): void {
    this.db.prepare('INSERT OR IGNORE INTO notifications(user_id,project_id) VALUES(?,?)').run(userId, projectId);
  }
  claim(userId: string, projectId: number): boolean {
    return this.db.prepare(`UPDATE notifications SET state='sending',attempts=attempts+1,updated_at=CURRENT_TIMESTAMP
      WHERE user_id=? AND project_id=? AND state='pending' AND retry_at<=? AND attempts<5`)
      .run(userId, projectId, Date.now()).changes === 1;
  }
  finish(userId: string, projectId: number, state: 'sent' | 'unknown' | 'failed' | 'pending', retryAt = 0): void {
    this.db.prepare(`UPDATE notifications SET state=CASE WHEN ?='pending' AND attempts>=5 THEN 'failed' ELSE ? END,
      retry_at=?,updated_at=CURRENT_TIMESTAMP WHERE user_id=? AND project_id=?`)
      .run(state, state, retryAt, userId, projectId);
  }
  history(userId: string): { state: string; count: number }[] {
    const rows = this.db.prepare(`SELECT state,SUM(count) AS count FROM (
      SELECT state,COUNT(*) AS count FROM notifications WHERE user_id=? GROUP BY state UNION ALL
      SELECT state,COUNT(*) AS count FROM browser_notifications WHERE user_id=? GROUP BY state) GROUP BY state`).all(userId, userId) as { state: string; count: number }[];
    return rows.map(row => ({ state: row.state, count: row.count }));
  }
  getState(key: string): string | undefined { return this.db.prepare('SELECT value FROM state WHERE key=?').get(key)?.value as string | undefined; }
  setState(key: string, value: string): void {
    this.db.prepare('INSERT INTO state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value);
  }
}
