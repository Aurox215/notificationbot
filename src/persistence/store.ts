import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Platform, SourceProject } from '../sources/types.js';

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
      UPDATE notifications SET state='unknown' WHERE state='sending';`);
    const columns = this.db.prepare('PRAGMA table_info(projects)').all().map(row => row.name);
    if (!columns.includes('notify')) this.db.exec('ALTER TABLE projects ADD COLUMN notify INTEGER NOT NULL DEFAULT 1');
    if (!columns.includes('origin')) this.db.exec("ALTER TABLE projects ADD COLUMN origin TEXT NOT NULL DEFAULT 'monitor'");
  }
  close(): void { this.db.close(); }
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
  projects(notifiableOnly = false, origin?: 'extension'): { id: number; project: SourceProject }[] {
    return (this.db.prepare('SELECT id,payload FROM projects WHERE (?=0 OR notify=1) AND (? IS NULL OR origin=?)').all(Number(notifiableOnly), origin ?? null, origin ?? null) as { id: number; payload: string }[]).map(row => {
      const data = JSON.parse(row.payload) as SourceProject;
      return { id: row.id, project: { ...data, detectedAt: new Date(data.detectedAt) } };
    });
  }
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
    const rows = this.db.prepare('SELECT state,COUNT(*) AS count FROM notifications WHERE user_id=? GROUP BY state').all(userId) as { state: string; count: number }[];
    return rows.map(row => ({ state: row.state, count: row.count }));
  }
  getState(key: string): string | undefined { return this.db.prepare('SELECT value FROM state WHERE key=?').get(key)?.value as string | undefined; }
  setState(key: string, value: string): void {
    this.db.prepare('INSERT INTO state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value);
  }
}
