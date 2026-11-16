// Relative ages are rounded: use the oldest possible publication time.
export function publishedAfter(value: string | undefined, detectedAt: Date, cutoff: number): boolean {
  if (!value || !Number.isFinite(detectedAt.getTime())) return false;
  const text = value.trim().replace(/^posted\s*(?::\s*)?/i, '').replace(/(\bago)\s*(?:[|\u00b7\u2022]|[-\u2013\u2014]\s|\d+\s+(?:quotes?|proposals?)).*$/i, '$1');
  let earliest: number;
  const relative = /^(\d+)\s*(second|sec|minute|min|hour|hr|day|week)s?\s+ago$/i.exec(text);
  if (relative) {
    const units: Record<string, number> = { second: 1000, sec: 1000, minute: 60000, min: 60000, hour: 3600000, hr: 3600000, day: 86400000, week: 604800000 };
    earliest = detectedAt.getTime() - (Number(relative[1]) + 1) * units[relative[2]!.toLowerCase()]!;
  } else {
    // Require a full timestamp with a timezone; unknown dates stay silent.
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(text)) return false;
    earliest = Date.parse(text);
  }
  return Number.isFinite(earliest) && earliest > cutoff && earliest <= detectedAt.getTime();
}
