import { config } from 'dotenv';
import { readTelegramConfig } from '../config/index.js';
import { formatAlert } from '../domain/project.js';
import { TelegramClient } from '../telegram/client.js';
import { log } from '../logging/logger.js';

async function main(): Promise<void> {
  config({ quiet: true });
  const text = formatAlert({
    platform: 'PeoplePerHour',
    title: '[TEST — synthetic sample] Build an AI automation integration',
    category: 'Sample only: Technology & Programming',
    budget: 'Sample only: £500',
    skills: ['TypeScript', 'Node.js', 'API integrations'],
    description: 'Synthetic test notification. This is not a real freelance project.',
    client: {
      ratingScore: 'Sample only: 4.9 / 5',
      ratingCount: 12,
      reviewCount: 10,
      joinedAt: 'Sample only: January 2024',
    },
    url: 'https://example.com/synthetic-project',
    detectedAt: new Date(),
  });
  if (process.argv.includes('--dry-run')) { console.log(text); return; }
  await new TelegramClient(readTelegramConfig()).send(text);
  log('info', 'Sample Telegram notification sent successfully.');
}

main().catch((error: unknown) => {
  log('error', error instanceof Error ? error.message : 'Notification failed.');
  process.exitCode = 1;
});
