import { DatabaseSync } from 'node:sqlite';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const values = new Map();
for (let i = 2; i < process.argv.length; i += 2) values.set(process.argv[i], process.argv[i + 1]);
const database = values.get('--database'); const userId = values.get('--user'); const output = values.get('--output');
if (!database || !userId || !output || !/^\d+$/.test(userId) || resolve(database) === resolve(output)) throw new Error('Usage: node scripts/export-extension-settings.mjs --database PATH --user NUMERIC_ID --output FILE.aurox-settings.json');
const db = new DatabaseSync(database, { readOnly: true });
let exported;
try {
  const row = db.prepare('SELECT keywords,platforms,paused FROM users WHERE id=?').get(userId);
  if (!row) throw new Error('No preferences exist for the selected user.');
  const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='browser_projects'").get();
  const seenProjects = exists ? db.prepare('SELECT platform,source_id AS sourceId FROM browser_projects WHERE user_id=?').all(userId) : [];
  exported = { format: 'aurox-settings-v1', preferences: { keywords: JSON.parse(row.keywords), platforms: JSON.parse(row.platforms), paused: Boolean(row.paused) }, seenProjects };
} finally { db.close(); }
await writeFile(output, JSON.stringify(exported, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log('Settings exported without changing the database. No Telegram credentials or chat IDs were exported.');