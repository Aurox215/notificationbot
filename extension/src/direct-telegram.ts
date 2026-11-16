import { DiagnosticError } from './diagnostics.js';
export const SHARED_BOT_USERNAME = 'Aurox_notification_bot';
export class DirectTelegramError extends DiagnosticError {
  constructor(readonly telegramCode: number, readonly retryAfter = 0) {
    super(telegramCode === 401 ? 'telegram_token_invalid' : telegramCode === 403 ? 'telegram_chat_forbidden' : telegramCode === 429 ? 'telegram_rate_limited' : 'telegram_rejected', 'telegram',
      telegramCode === 401 ? 'The shared bot token is invalid or revoked. Ask the administrator to update the private configuration.' :
      telegramCode === 403 ? 'Telegram denied access to this chat. Open @Aurox_notification_bot, unblock it and press Start (or send /start).' :
      telegramCode === 429 ? 'Telegram rate limit reached. The extension will wait before retrying.' : 'Telegram rejected the request. Check the chat ID and bot access.');
  }
}
export class DirectTelegram {
  constructor(private readonly request: typeof fetch = fetch) {}
  async call<T>(token: string, method: 'getMe' | 'getChat' | 'sendMessage', body: Record<string, unknown> = {}): Promise<T> {
    const sending = method === 'sendMessage';
    const attempts = sending ? 1 : 3;
    let response!: Response;
    let data!: { ok?: boolean; result?: T; error_code?: number; parameters?: { retry_after?: number } };
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        response = await this.request.call(globalThis, `https://api.telegram.org/bot${token}/${method}`, { method: 'POST',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(10000) });
      } catch {
        if (attempt + 1 < attempts) { await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1))); continue; }
        throw new DiagnosticError('telegram_network_error', 'telegram', sending
          ? 'Chrome lost contact with Telegram while sending. Delivery is uncertain, so this message will not be resent automatically.'
          : 'Chrome could not reach Telegram to check the connection. No message was sent. Check Chrome proxy/VPN, firewall and the extension site access for api.telegram.org, then try Connect again.');
      }
      try { data = await response.json(); }
      catch {
        if (attempt + 1 < attempts) { await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1))); continue; }
        throw new DiagnosticError('telegram_invalid_response', 'telegram', sending
          ? 'Telegram returned an unreadable delivery response. Delivery is uncertain; this message will not be resent automatically.'
          : 'Telegram returned an unreadable connection response. No message was sent. Check Chrome network access and try Connect again.');
      }
      break;
    }
    if (!response.ok || data?.ok !== true) throw new DirectTelegramError(data?.error_code ?? response.status,
      Math.max(1, Math.min(86400, Number(data?.parameters?.retry_after) || 30)));
    return data.result as T;
  }
  async identify(token: string): Promise<void> {
    const bot = await this.call<{ is_bot?: boolean; username?: string }>(token, 'getMe');
    if (!bot?.is_bot || bot.username?.toLowerCase() !== SHARED_BOT_USERNAME.toLowerCase()) throw new DiagnosticError('telegram_wrong_bot', 'telegram', 'Use the token for @Aurox_notification_bot.');
  }
  async validate(token: string, chatId: string): Promise<void> {
    await this.identify(token);
    const chat = await this.call<{ id?: number; type?: string }>(token, 'getChat', { chat_id: chatId }).catch(error => {
      if (error instanceof DirectTelegramError && error.telegramCode === 400) throw new DiagnosticError('telegram_chat_unavailable', 'telegram', 'Telegram could not find or access this chat. Check your ID, open @Aurox_notification_bot and press Start (or send /start), then try again.');
      throw error;
    });
    if (chat?.type !== 'private' || String(chat.id) !== chatId) throw new DiagnosticError('telegram_chat_invalid', 'telegram', 'Enter your own numeric private chat ID and press Start (or send /start) in @Aurox_notification_bot first.');
  }
  async send(token: string, chatId: string, text: string): Promise<void> {
    if (!text.trim() || text.length > 4096) throw new DiagnosticError('telegram_message_invalid', 'telegram', 'Telegram messages must contain 1–4096 characters.');
    await this.call(token, 'sendMessage', { chat_id: chatId, text, link_preview_options: { is_disabled: true } });
  }
}