export interface TelegramConfig {
  token: string;
  chatId: string;
  timeoutMs: number;
}

export function readTelegramConfig(env: NodeJS.ProcessEnv = process.env): TelegramConfig {
  const token = env.TELEGRAM_BOT_TOKEN?.trim() ?? '';
  const chatId = env.TELEGRAM_CHAT_ID?.trim() ?? '';
  const timeoutMs = Number(env.TELEGRAM_TIMEOUT_MS ?? '15000');
  if (!/^\d+:[A-Za-z0-9_-]+$/.test(token)) {
    throw new Error('Set TELEGRAM_BOT_TOKEN in .env to the token provided by BotFather.');
  }
  if (!/^-?\d+$/.test(chatId)) {
    throw new Error('Set TELEGRAM_CHAT_ID in .env to your numeric Telegram chat ID.');
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000) {
    throw new Error('TELEGRAM_TIMEOUT_MS must be an integer between 1000 and 120000.');
  }
  return { token, chatId, timeoutMs };
}
