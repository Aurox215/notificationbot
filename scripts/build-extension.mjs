import { build } from 'esbuild';
await build({ entryPoints: ['extension/src/content.ts', 'extension/src/background.ts', 'extension/src/popup.ts'],
  outdir: 'extension/dist', bundle: true, format: 'iife', platform: 'browser', target: 'chrome120' });
