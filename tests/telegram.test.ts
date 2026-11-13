import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readTelegramConfig } from '../src/config/index.js';
import { formatAlert } from '../src/domain/project.js';
import { TelegramClient } from '../src/telegram/client.js';

const config = { token: '123:test_secret', chatId: '456', timeoutMs: 1000 };

test('configuration rejects missing credentials and invalid timeout without revealing values', () => {
  assert.throws(() => readTelegramConfig({}), /TELEGRAM_BOT_TOKEN/);
  assert.throws(() => readTelegramConfig({ TELEGRAM_BOT_TOKEN: config.token, TELEGRAM_CHAT_ID: '456', TELEGRAM_TIMEOUT_MS: 'NaN' }), /TIMEOUT/);
});

test('formatter omits unavailable fields and preserves timestamp within Telegram limit', () => {
  const text = formatAlert({ platform: 'Guru', title: 'Python API', description: 'a'.repeat(6000), detectedAt: new Date('2026-01-01Z') });
  assert.ok(text.length <= 4096);
  assert.ok(text.includes('2026-01-01T00:00:00.000Z'));
  assert.ok(!text.includes('Budget:'));
  assert.ok(!text.includes('undefined'));
});

test('client posts plain text to Telegram', async () => {
  const request: typeof fetch = async (_url, options) => {
    assert.equal(options?.method, 'POST');
    assert.deepEqual(JSON.parse(String(options?.body)), { chat_id: '456', text: 'sample', link_preview_options: { is_disabled: true } });
    return Response.json({ ok: true, result: { message_id: 1 } });
  };
  await new TelegramClient(config, request).send('sample');
});

test('formatter includes source-supplied project and client metadata for each platform', () => {
  for (const platform of ['PeoplePerHour', 'Guru'] as const) {
    const text = formatAlert({
      platform, title: 'Example project', category: 'Web development', budget: '$500',
      skills: ['Python'], url: 'https://example.com/project', detectedAt: new Date('2026-01-01Z'),
      client: { ratingScore: '4.9 / 5', ratingCount: 12, reviewCount: 0, joinedAt: 'January 2024' },
    });
    for (const value of [platform, 'Category: Web development', 'Budget: $500', 'Skills: Python',
      'Client rating: 4.9 / 5', 'Client ratings: 12', 'Client reviews: 0',
      'Client joined: January 2024', 'https://example.com/project']) assert.ok(text.includes(value));
  }
});

test('formatter does not invent unavailable client information', () => {
  const text = formatAlert({ platform: 'Guru', title: 'Example', detectedAt: new Date('2026-01-01Z') });
  assert.ok(!text.includes('Client'));
  assert.ok(!text.includes('Category:'));
});

test('transport failures redact secrets and do not retry uncertain sends', async () => {
  let calls = 0;
  const request: typeof fetch = async () => { calls++; throw new Error(config.token); };
  await assert.rejects(new TelegramClient(config, request).send('sample'), (error: Error) => !error.message.includes(config.token));
  assert.equal(calls, 1);
});

test('client reports API rejection and malformed responses', async () => {
  await assert.rejects(new TelegramClient(config, async () => Response.json({ ok: false }, { status: 403 })).send('sample'), /rejected/);
  await assert.rejects(new TelegramClient(config, async () => new Response('bad')).send('sample'), /invalid response/);
});
