import { enrichProject } from './enrich-project.js';
import { DiagnosticError } from './diagnostics.js';
import { StandaloneStore } from './standalone-store.js';
import { configuredTelegramToken, configuredTelegramChatId } from './telegram-config.js';
let instance: StandaloneStore | undefined;
export function localStore(): StandaloneStore {
  instance ??= new StandaloneStore({
    read: async () => {
      const values = await chrome.storage.local.get(['standaloneData', 'scanEnabled']);
      const raw = values.standaloneData as Record<string, unknown> | undefined;
      return raw?.version === 1 && typeof values.scanEnabled === 'boolean' ? { ...raw, scanEnabled: values.scanEnabled } : raw;
    },
    write: async data => { await chrome.storage.local.set({ standaloneData: data }); },
    exclusive: async operation => {
      if (typeof navigator === 'undefined' || !navigator.locks) throw new DiagnosticError('storage_lock_unavailable', 'storage', 'This browser cannot safely serialize extension storage. Use an up-to-date Chrome browser.');
      return navigator.locks.request('aurox-local-monitor', operation);
    },
  }, undefined, configuredTelegramToken, undefined, undefined, undefined, configuredTelegramChatId, enrichProject);
  return instance;
}