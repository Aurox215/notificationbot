import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publishedAfter } from '../extension/shared/publication.js';
const cutoff = Date.parse('2026-11-15T12:00:00Z');
const detectedAt = new Date(cutoff + 600000);

test('publication cutoff rejects old, unknown, ambiguous and future dates', () => {
  for (const value of [undefined, '', 'today', 'just now', '2026-11-15', '2026-11-15T12:01:00',
    '2026-11-15T12:00:00Z', '2026-11-15T11:59:59Z', '2026-11-15T13:00:00Z', 'Posted 10 minutes ago', 'Posted 9 minutes ago']) {
    assert.equal(publishedAfter(value, detectedAt, cutoff), false, String(value));
  }
  for (const value of ['2026-11-15T12:01:00Z', '2026-11-15T13:01:00+01:00', 'Posted 5 minutes ago']) {
    assert.equal(publishedAfter(value, detectedAt, cutoff), true, value);
  }
});
test('abbreviated posting ages and Guru quote suffixes preserve the conservative cutoff', () => {
  for (const value of ['7 mins ago', 'Posted 7 mins ago \u00b7 2 Quotes Received', '7 minutes ago | 1 proposal', '7 mins ago 1 proposal']) assert.equal(publishedAfter(value, detectedAt, cutoff), true, value);
  for (const value of ['Posted 9 mins ago \u00b7 2 Quotes Received', 'just now', 'description says 7 mins ago']) assert.equal(publishedAfter(value, detectedAt, cutoff), false, value);
});
