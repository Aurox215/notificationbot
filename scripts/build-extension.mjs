import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import { readPrivateConfig } from './extension-config.mjs';
const mode = process.env.AUROX_EXTENSION_MODE || 'standalone';
if (!['standalone', 'backend'].includes(mode)) throw new Error('AUROX_EXTENSION_MODE must be standalone or backend.');
const standalone = mode === 'standalone';
const config = await readPrivateConfig();
const backend = new URL(standalone ? 'http://127.0.0.1:4318' : process.env.AUROX_BACKEND_URL || 'http://127.0.0.1:4318');
if ((backend.protocol !== 'https:' && !(backend.protocol === 'http:' && backend.hostname === '127.0.0.1')) || backend.username || backend.password || backend.pathname !== '/' || backend.search || backend.hash) throw new Error('Invalid backend build origin.');
const target = standalone ? 'https://api.telegram.org' : backend.origin;
const manifest = { manifest_version: 3, name: 'Aurox Job Monitor', version: '0.7.6', minimum_chrome_version: '120',
  description: standalone ? 'Private standalone PeoplePerHour and Guru alerts through Aurox_notification_bot. No backend required.' : 'Aurox Job Monitor legacy backend mode.',
  permissions: ['storage', 'activeTab', 'alarms', 'webRequest', ...(standalone ? ['unlimitedStorage'] : [])],
  host_permissions: [target + '/*', 'https://www.peopleperhour.com/*', 'https://www.guru.com/*'],
  background: { service_worker: standalone ? 'dist/standalone-background.js' : 'dist/background.js' },
  action: { default_popup: standalone ? 'standalone.html' : 'popup.html' },
  content_scripts: [{ matches: ['https://www.peopleperhour.com/*', 'https://www.guru.com/*'], js: ['dist/content.js'], run_at: 'document_idle', all_frames: false }],
  content_security_policy: { extension_pages: `script-src 'self'; object-src 'none'; connect-src 'self' ${target}` } };
await writeFile('extension/manifest.json', JSON.stringify(manifest, null, 2) + '\n');
const options = { outdir: 'extension/dist', bundle: true, format: 'iife', platform: 'browser', target: 'chrome120',
  define: { __AUROX_BACKEND_URL__: JSON.stringify(backend.origin), __AUROX_DEV_DIAGNOSTICS__: String(process.env.AUROX_DEV_DIAGNOSTICS === 'true'),
    __AUROX_SHARED_BOT_TOKEN__: JSON.stringify(config.botToken || ''), __AUROX_PROVISIONED_CHAT_ID__: JSON.stringify(config.chatId || '') } };
// Retained for optional backend builds and existing regression tests; not packaged.
await build({ ...options, entryPoints: ['extension/src/background.ts', 'extension/src/popup.ts'], define: options.define });
await build({ ...options, entryPoints: { content: 'extension/src/content.ts', 'standalone-background': 'extension/src/standalone-background.ts', 'standalone-popup': 'extension/src/standalone-popup.ts' } });