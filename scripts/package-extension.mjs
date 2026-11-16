import { readFile, mkdir, copyFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { build } from 'esbuild';
import { readPrivateConfig, validChatId } from './extension-config.mjs';
const manifest = JSON.parse(await readFile('extension/manifest.json', 'utf8'));
if (manifest.background?.service_worker !== 'dist/standalone-background.js') throw new Error('Build standalone mode before packaging.');
const config = await readPrivateConfig();
const index = process.argv.indexOf('--chat-id');
const chatId = index >= 0 ? process.argv[index + 1] : config.chatId || '';
if ((index >= 0 || chatId) && !validChatId(chatId)) throw new Error('Provide a valid numeric private chat ID after --chat-id.');
const files = ['manifest.json', 'standalone.html', 'popup.css', 'README.md', 'dist/content.js', 'dist/standalone-background.js', 'dist/standalone-popup.js'];
const output = resolve('release', 'aurox-job-monitor-' + Date.now() + '-' + randomUUID().slice(0, 8));
for (const file of files) { await mkdir(resolve(output, file, '..'), { recursive: true }); await copyFile(join('extension', file), join(output, file)); }
await build({ entryPoints: ['extension/src/standalone-background.ts'], outfile: join(output, 'dist/standalone-background.js'), bundle: true, format: 'iife', platform: 'browser', target: 'chrome120',
  define: { __AUROX_SHARED_BOT_TOKEN__: JSON.stringify(config.botToken || ''), __AUROX_PROVISIONED_CHAT_ID__: JSON.stringify(chatId) } });
console.log('Private extension folder: ' + output);
console.log(chatId ? 'Per-user Start setup configured. Distribute this copy only to its intended user.' : 'Manual chat setup fallback. Use --chat-id to prepare a Start-ready copy for each user.');
console.log('The configured shared bot token is recoverable by recipients, as expected for this private distribution.');