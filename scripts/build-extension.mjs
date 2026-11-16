import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import { readPrivateConfig } from './extension-config.mjs';
const config = await readPrivateConfig();
const manifest = { manifest_version: 3, name: 'Aurox Job Monitor', version: '0.8.2', minimum_chrome_version: '120',
  description: 'Standalone PeoplePerHour and Guru alerts through Aurox_notification_bot.',
  permissions: ['storage', 'activeTab', 'alarms', 'webRequest', 'unlimitedStorage'],
  host_permissions: ['https://api.telegram.org/*', 'https://www.peopleperhour.com/*', 'https://www.guru.com/*'],
  background: { service_worker: 'dist/standalone-background.js' }, action: { default_popup: 'standalone.html' },
  content_scripts: [{ matches: ['https://www.peopleperhour.com/*', 'https://www.guru.com/*'], js: ['dist/content.js'], run_at: 'document_idle', all_frames: false }],
  content_security_policy: { extension_pages: "script-src 'self'; object-src 'none'; connect-src 'self' https://api.telegram.org" } };
await writeFile('extension/manifest.json', JSON.stringify(manifest, null, 2) + '\n');
await build({ outdir: 'extension/dist', bundle: true, format: 'iife', platform: 'browser', target: 'chrome120',
  define: { __AUROX_DEV_DIAGNOSTICS__: String(process.env.AUROX_DEV_DIAGNOSTICS === 'true'), __AUROX_SHARED_BOT_TOKEN__: JSON.stringify(config.botToken || ''), __AUROX_PROVISIONED_CHAT_ID__: JSON.stringify(config.chatId || '') },
  entryPoints: { content: 'extension/src/content.ts', 'standalone-background': 'extension/src/standalone-background.ts', 'standalone-popup': 'extension/src/standalone-popup.ts' } });
