import { Store } from '../persistence/store.js';
import { CommandHandler } from '../bot/commands.js';
import { Monitor } from '../monitoring/monitor.js';
import { MockPeoplePerHourSource } from '../sources/peopleperhour.js';
import { MockGuruSource } from '../sources/guru.js';

async function main(): Promise<void> {
  const store = new Store(':memory:', []);
  let alerts = 0;
  const messenger = { send: async (text: string, chatId: string) => {
    if (text.includes('[MOCK]')) alerts++;
    console.log(`\n[OFFLINE DEMO — recipient ${chatId}]\n${text}`);
  } };
  try {
    const commands = new CommandHandler(store, messenger, 5000);
    for (const [id, texts] of [[1, ['/start', '/keywords Python', '/subscribe']], [2, ['/start', '/platforms Guru', '/subscribe']]] as const) {
      for (const text of texts) await commands.handle({ update_id: id, message: { text, from: { id }, chat: { id, type: 'private' } } });
    }
    const monitor = new Monitor(store, [new MockPeoplePerHourSource(), new MockGuruSource()], messenger, 0);
    await monitor.tick(new AbortController().signal);
    const firstCount = alerts;
    await monitor.tick(new AbortController().signal);
    if (firstCount !== 2 || alerts !== 2) throw new Error('Offline demo routing or deduplication failed.');
    console.log('\nPASS: two users received one matching mock alert each; the second cycle sent no duplicates.');
  } finally { store.close(); }
}
main().catch(() => { console.error('Offline demo failed.'); process.exitCode = 1; });
