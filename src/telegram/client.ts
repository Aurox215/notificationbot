import type { TelegramConfig } from '../config/index.js';

export class TelegramError extends Error {
  constructor(message: string, readonly code: number, readonly retryAfter = 0) { super(message); }
}
export interface TelegramUpdate {
  update_id: number;
  message?: { text?: string; from?: { id: number; is_bot?: boolean }; chat: { id: number; type: string } };
}

export class TelegramClient {
  constructor(private readonly config: TelegramConfig, private readonly request: typeof fetch = fetch) {}

  async send(text: string, chatId = this.config.chatId): Promise<void> {
    if (!text.trim() || text.length > 4096) throw new Error('Telegram text must contain 1–4096 characters.');
    let response: Response;
    try {
      response = await this.request(`https://api.telegram.org/bot${this.config.token}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, link_preview_options: { is_disabled: true } }),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch {
      // Fetch errors can contain the token-bearing URL. Never propagate them.
      throw new Error('Telegram request failed or timed out. Delivery is unknown; check the chat before retrying.');
    }
    let result: unknown;
    try { result = await response.json(); } catch {
      throw new Error(`Telegram returned an invalid response (HTTP ${response.status}). Delivery is unknown.`);
    }
    if (!response.ok || typeof result !== 'object' || result === null || !('ok' in result) || result.ok !== true) {
      const data = result as { error_code?: number; parameters?: { retry_after?: number } } | null;
      const code = data?.error_code ?? response.status;
      const retry = data?.parameters?.retry_after;
      throw new TelegramError(`Telegram rejected the request (HTTP ${response.status}). Check bot access or rate limits.`, code,
        typeof retry === 'number' && Number.isFinite(retry) ? Math.max(1, retry) : 30);
    }
  }

  async getUpdates(offset: number, signal: AbortSignal): Promise<TelegramUpdate[]> {
    let response: Response;
    try {
      response = await this.request(`https://api.telegram.org/bot${this.config.token}/getUpdates`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ offset, timeout: 25, allowed_updates: ['message'] }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(35000)]),
      });
    } catch { throw new Error('Telegram update request failed or timed out.'); }
    let body: unknown;
    try { body = await response.json(); } catch { throw new Error('Telegram returned invalid updates.'); }
    const data = body as { ok?: boolean; result?: TelegramUpdate[]; error_code?: number; parameters?: { retry_after?: number } } | null;
    if (!response.ok || !data?.ok || !Array.isArray(data.result)) {
      throw new TelegramError('Telegram polling rejected. Check token, webhook configuration, or another polling instance.',
        data?.error_code ?? response.status, data?.parameters?.retry_after ?? 5);
    }
    return data.result;
  }
}
