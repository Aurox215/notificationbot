import type { Store } from '../persistence/store.js';
import type { TelegramUpdate, InlineKeyboard } from '../telegram/client.js';
import { platforms, type Platform } from '../sources/types.js';
import { monitoringHealth } from '../monitoring/health.js';
import type { AccountLinks } from '../ingestion/accounts.js';

export const help = `Mock freelance alerts — no live platform monitoring.
/start — register your private chat
/subscribe — enable alerts
/pause — pause alerts
/resume — resume an existing subscription
/keywords — show keywords
/keywords Python, React, API — replace keywords
/keywords all — match every project
/platforms — show platforms
/platforms PeoplePerHour,Guru — select platforms (or all)
/status — preferences and delivery counts
/help — show commands
/confirm CODE — approve a browser connection after checking its code
/disconnect — revoke your browser connections
Matching uses any keyword in title, description, category or skills.
Only projects published after connecting or subscribing are eligible for alerts.`;

export interface Messenger { send(text: string, chatId: string, keyboard?: InlineKeyboard): Promise<void>; answerCallback?(id: string, text: string): Promise<void> }
export class CommandHandler {
  constructor(private readonly store: Store, private readonly messenger: Messenger, private readonly intervalMs: number,
    private readonly healthStaleMs = Math.max(60000, intervalMs * 3), private readonly accounts?: AccountLinks) {}
  async handle(update: TelegramUpdate): Promise<void> {
    const callback = update.callback_query;
    if (callback) {
      if (!callback.message || callback.from.is_bot || callback.message.chat.type !== 'private' || callback.message.chat.id !== callback.from.id || !/^connect:[A-F0-9]{8}$/.test(callback.data ?? '')) return;
      const id = String(callback.from.id);
      const approved = this.accounts?.approve(id, callback.data!.slice(8)) ?? false;
      if (approved) this.store.preferences(id, { subscribed: true, paused: false });
      await this.messenger.answerCallback?.(callback.id, approved ? 'Browser connected.' : 'Connection expired or already approved.');
      await this.messenger.send(approved ? 'Your browser is approved. Scanning starts automatically; no command or Scan Now click is needed. Use Stop scan in the extension to pause collection.' : 'This connection is expired, already approved, or belongs to another account. Start Connect Telegram again if needed.', id);
      return;
    }
    const message = update.message;
    if (!message?.text || message.chat.type !== 'private' || !message.from || message.from.is_bot) return;
    // Private chat identity is verified by Telegram; never accept an ID from command arguments.
    if (message.chat.id !== message.from.id) return;
    const match = /^\/(\w+)(?:@[\w]+)?(?:\s+([\s\S]*))?$/.exec(message.text.trim());
    if (!match) return;
    const id = String(message.from.id);
    this.store.ensureUser(id, String(message.chat.id));
    const command = match[1]!.toLowerCase();
    const argument = match[2]?.trim() ?? '';
    const extensionMode = this.store.getState('source_mode') === 'extension';
    const activeHelp = extensionMode ? help.replace('Mock freelance alerts — no live platform monitoring.', 'Browser monitoring — control collection with Stop scan / Continue scan in your extension.').replaceAll('mock fixtures', 'scanned projects') : help;
    let reply: string;
    let keyboard: InlineKeyboard | undefined;
    switch (command) {
      case 'confirm':
        if (this.accounts?.approve(id, argument.toUpperCase())) {
          this.store.preferences(id, { subscribed: true, paused: false });
          reply = 'Browser connection approved. Alerts from your own browser are enabled. Return to the extension to finish connecting. Use /pause or /disconnect at any time.';
        } else reply = 'Connection code is invalid, expired, or already used. Start Connect Telegram again in your extension.';
        break;
      case 'disconnect': this.accounts?.disconnect(id); reply = 'Your browser sessions have been revoked. Reconnect through the extension to authorize a browser again.'; break;
      case 'start': reply = `Welcome! Your private chat is registered. Use /subscribe to enable ${extensionMode ? 'scanned' : 'mock'} project alerts.\n\n${activeHelp}`; break;
      case 'help': reply = activeHelp; break;
      case 'subscribe': if (!this.store.user(id)!.subscribed) this.store.startAlerts(id); this.store.preferences(id, { subscribed: true, paused: false }); reply = 'Subscribed to mock project alerts. Use /keywords and /platforms to customize them.'; break;
      case 'pause': this.store.preferences(id, { paused: true }); reply = 'Alerts paused. Use /resume to continue.'; break;
      case 'resume':
        if (!this.store.user(id)!.subscribed) reply = 'Use /subscribe first to enable alerts.';
        else { this.store.preferences(id, { paused: false }); reply = 'Mock alerts resumed.'; }
        break;
      case 'keywords': {
        if (argument) {
          const keywords = argument.toLowerCase() === 'all' ? [] : [...new Set(argument.split(',').map(x => x.trim().toLowerCase()).filter(Boolean))];
          if ((argument.toLowerCase() !== 'all' && !keywords.length) || keywords.length > 30 || keywords.some(x => x.length > 60)) {
            reply = 'Provide up to 30 comma-separated keywords, at most 60 characters each, or /keywords all.'; break;
          }
          this.store.preferences(id, { keywords });
        }
        reply = `Keywords: ${this.store.user(id)!.keywords.join(', ') || 'all projects'}`; break;
      }
      case 'platforms': {
        if (argument) {
          const values = argument.toLowerCase() === 'all' ? platforms : argument.split(',').map(x => platforms.find(p => p.toLowerCase() === x.trim().toLowerCase()));
          if (!values.length || values.some(x => !x)) { reply = 'Use /platforms PeoplePerHour,Guru or /platforms all.'; break; }
          this.store.preferences(id, { platforms: [...new Set(values)] as Platform[] });
        }
        reply = `Platforms: ${this.store.user(id)!.platforms.join(', ')}`; break;
      }
      case 'status': {
        const user = this.store.user(id)!;
        reply = `Mode: MOCK (not live)\nSubscription: ${user.subscribed ? (user.paused ? 'paused' : 'active') : 'not subscribed'}\nPlatforms: ${user.platforms.join(', ')}\nKeywords: ${user.keywords.join(', ') || 'all projects'}\nShared interval: ${this.intervalMs} ms\nDeliveries: ${this.store.history(id).map(x => `${x.state}=${x.count}`).join(', ') || 'none'}`;
        const health = monitoringHealth(this.store, this.healthStaleMs);
        if (extensionMode) {
          const summary = this.store.browserSummary(id);
          reply += `\nBrowser projects: ${summary.stored}; silent baseline: ${summary.baseline}; later projects: ${summary.afterBaseline}` +
            `\nMatching current filters: ${summary.matching}; keyword excluded: ${summary.keywordExcluded}; platform excluded: ${summary.platformExcluded}` +
            `\nLater projects missing description and skills: ${summary.missingSearchMetadata}`;
          if (summary.afterBaseline > 0 && summary.matching === 0) reply += '\nNo later projects match your filters. Use /keywords to check them, or /keywords all to receive all projects on your selected platforms.';
        }
        reply += extensionMode ? `\nBackend dispatch: ${health.healthy ? 'healthy' : 'not ready or degraded'}\nBrowser scans come only from your connected extension.` :
          `\nMonitoring: ${health.healthy ? 'healthy (mock)' : 'not ready or degraded (mock)'}\n` + health.sources.map(s =>
            `${s.platform}: ${s.status}${s.stale ? ', stale' : ''}${s.errorCode ? ` (${s.errorCode})` : ''}`).join('\n');
        break;
      }
      default: reply = 'Unknown command. Use /help.';
    }
    if (command === 'start' && argument.startsWith('aurox_')) {
      const code = this.accounts?.propose(argument, id);
      reply = code ? `Connect your Aurox Job Monitor browser?\nCompare this code with your extension: ${code}\nIf you initiated this connection and the codes match, tap Connect this browser below. Nothing needs to be typed. Ignore unsolicited connection links.` : 'This browser connection is invalid, expired, or already used. Click Connect Telegram again in the extension.';
      if (code) keyboard = { inline_keyboard: [[{ text: 'Connect this browser', callback_data: `connect:${code}` }]] };
    }
    if (extensionMode) reply = reply.replaceAll('mock project alerts', 'manually scanned project alerts').replace('Mock alerts resumed.', 'Manual scan alerts resumed.').replace('Mode: MOCK (not live)', 'Mode: EXTENSION (your browser)').replaceAll('(mock)', '(your browser)');
    await this.messenger.send(reply, String(message.chat.id), keyboard);
  }
}
