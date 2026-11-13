import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
const backend = new URL(process.env.AUROX_BACKEND_URL || 'http://127.0.0.1:4318');
if ((backend.protocol !== 'https:' && !(backend.protocol === 'http:' && backend.hostname === '127.0.0.1')) ||
  backend.username || backend.password || backend.pathname !== '/' || backend.search || backend.hash) throw new Error('AUROX_BACKEND_URL must be an HTTPS origin (HTTP loopback is development only).');
const manifest = {
  manifest_version: 3, name: 'Aurox Job Monitor', version: '0.2.1', minimum_chrome_version: '120',
  description: 'Projects from your own visible Chrome pages, delivered only to your linked Telegram account.',
  permissions: ['storage', 'activeTab'],
  host_permissions: [backend.origin + '/*', 'https://www.peopleperhour.com/*', 'https://www.guru.com/*'],
  background: { service_worker: 'dist/background.js' }, action: { default_popup: 'popup.html' },
  content_scripts: [{ matches: ['https://www.peopleperhour.com/*', 'https://www.guru.com/*'], js: ['dist/content.js'], run_at: 'document_idle', all_frames: false }],
  content_security_policy: { extension_pages: `script-src 'self'; object-src 'none'; connect-src ${backend.origin}` },
};
await writeFile('extension/manifest.json', JSON.stringify(manifest, null, 2) + '\n');
await build({ entryPoints: ['extension/src/content.ts', 'extension/src/background.ts', 'extension/src/popup.ts'],
  outdir: 'extension/dist', bundle: true, format: 'iife', platform: 'browser', target: 'chrome120',
  define: { __AUROX_BACKEND_URL__: JSON.stringify(backend.origin) } });
