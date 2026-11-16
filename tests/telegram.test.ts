import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatAlert } from '../extension/shared/project.js';


test('formatter includes unavailable-field labels and preserves timestamp within Telegram limit', () => {
  const text = formatAlert({ platform: 'Guru', title: 'Python API', description: 'a'.repeat(6000), detectedAt: new Date('2026-01-01Z') });
  assert.ok(text.length <= 4096);
  assert.ok(text.includes('2026-01-01T00:00:00.000Z'));
  assert.ok(text.includes('Budget: Not provided')); assert.ok(!text.includes('Description:')); assert.ok(!text.includes('a'.repeat(20)));
  assert.ok(!text.includes('undefined'));
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
  for (const label of ['Budget', 'Category', 'Skills', 'Client rating', 'Client reviews', 'Client joined']) assert.ok(text.includes(label + ': Not provided'), label);
});

test('maximum listing metadata never removes required fields or the full project link', () => {
  const url = 'https://www.peopleperhour.com/freelance-jobs/' + 'a'.repeat(900) + '-123';
  for (const platform of ['PeoplePerHour', 'Guru'] as const) {
    const message = formatAlert({ platform, title: 'T'.repeat(500), budget: 'B'.repeat(200), category: 'C'.repeat(200),
      skills: Array.from({ length: 30 }, () => 'S'.repeat(60)), publishedAt: '7 minutes ago', description: 'D'.repeat(5000),
      client: { ratingScore: '4.9', reviewCount: 0, joinedAt: 'January 2024' }, url, detectedAt: new Date('2026-01-01Z') });
    for (const label of ['Budget:', 'Category:', 'Skills:', 'Client rating:', 'Client reviews: 0', 'Client joined: January 2024']) assert.ok(message.includes(label), label);
    assert.ok(message.includes(url)); assert.ok(message.includes('Detected: 2026-01-01T00:00:00.000Z')); assert.ok(message.length <= 4096);
  }
});
