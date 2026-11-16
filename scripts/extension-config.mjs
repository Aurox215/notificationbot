import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
export function validChatId(value) { return typeof value === 'string' && /^[1-9]\d{0,15}$/.test(value) && Number.isSafeInteger(Number(value)); }
export async function readPrivateConfig() {
  let config = {};
  try {
    const text = await readFile(process.env.AUROX_EXTENSION_CONFIG || resolve('extension/config.private.json'), 'utf8');
    try { config = JSON.parse(text); } catch { throw new Error('Invalid private configuration.'); }
  } catch (error) { if (error?.code !== 'ENOENT') throw new Error('Could not read valid private extension configuration.'); }
  if (!config || typeof config !== 'object' || Array.isArray(config) || (config.botUsername && config.botUsername !== 'Aurox_notification_bot') ||
    (config.botToken !== undefined && (typeof config.botToken !== 'string' || (config.botToken && !/^\d+:[A-Za-z0-9_-]{20,}$/.test(config.botToken)))) ||
    (config.chatId !== undefined && config.chatId !== '' && !validChatId(config.chatId))) throw new Error('Invalid shared bot or per-user chat configuration.');
  return config;
}