import { readFile, mkdir, copyFile, writeFile } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { build } from 'esbuild';
import { readPrivateConfig, validChatId } from './extension-config.mjs';
const manifest = JSON.parse(await readFile('extension/manifest.json', 'utf8'));
if (manifest.background?.service_worker !== 'dist/standalone-background.js') throw new Error('Build the extension before packaging.');
const config = await readPrivateConfig();
const index = process.argv.indexOf('--chat-id');
const chatId = index >= 0 ? process.argv[index + 1] : config.chatId || '';
if ((index >= 0 || chatId) && !validChatId(chatId)) throw new Error('Provide a valid numeric private chat ID after --chat-id.');
const update = process.argv.indexOf('--update-existing');
if (update >= 0 && (!process.argv[update + 1] || process.argv[update + 1].startsWith('--'))) throw new Error('Provide the existing installed release folder after --update-existing.');
const output = update >= 0 ? resolve(process.argv[update + 1]) : resolve('release', 'aurox-job-monitor-' + Date.now() + '-' + randomUUID().slice(0, 8));
if (update >= 0) {
  if (!output.startsWith(resolve('release') + sep)) throw new Error('Update target must be an existing folder inside this project release directory.');
  const oldManifest = JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8'));
  if (oldManifest.name !== 'Aurox Job Monitor' || oldManifest.background?.service_worker !== manifest.background.service_worker) throw new Error('The update target is not a standalone Aurox package.');
  const worker = await readFile(join(output, 'dist/standalone-background.js'), 'utf8');
  const embeddedToken = worker.match(/\d{6,}:[A-Za-z0-9_-]{20,}/g) || [];
  const recipient = /\bconfiguredTelegramChatId\s*=\s*(["'])(.*?)\1/.exec(worker);
  if (embeddedToken.length !== (config.botToken ? 1 : 0) || (config.botToken && embeddedToken[0] !== config.botToken) || !recipient || recipient[2] !== chatId) throw new Error('Existing bot or recipient configuration differs. Use the same private build configuration; existing credentials were not overwritten.');
}
// Compile and validate before replacing any files in an installed package.
const compiled = await build({ entryPoints: ['extension/src/standalone-background.ts'], outfile: 'standalone-background.js', write: false, bundle: true, format: 'iife', platform: 'browser', target: 'chrome120',
  define: { __AUROX_SHARED_BOT_TOKEN__: JSON.stringify(config.botToken || ''), __AUROX_PROVISIONED_CHAT_ID__: JSON.stringify(chatId) } });
const files = ['manifest.json', 'standalone.html', 'popup.css', 'README.md', 'dist/content.js', 'dist/standalone-popup.js'];
for (const file of files) { await mkdir(resolve(output, file, '..'), { recursive: true }); await copyFile(join('extension', file), join(output, file)); }
await mkdir(join(output, 'dist'), { recursive: true });
await writeFile(join(output, 'dist/standalone-background.js'), compiled.outputFiles[0].contents);
console.log((update >= 0 ? 'Updated existing extension folder: ' : 'Private extension folder: ') + output);
console.log('Version: ' + manifest.version + '. Reload this existing Chrome extension entry and refresh the platform tabs.');
console.log(chatId ? 'Per-user Start setup configured. Distribute this copy only to its intended user.' : 'Manual chat setup. Use --chat-id to prepare a personal copy.');
console.log('The shared bot token is recoverable by recipients.');
