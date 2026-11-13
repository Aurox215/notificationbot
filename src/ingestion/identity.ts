import type { Platform } from '../sources/types.js';

export function listingPlatform(value: string): Platform | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return undefined;
    if (url.hostname === 'www.peopleperhour.com' && /^\/freelance-jobs\/?$/.test(url.pathname)) return 'PeoplePerHour';
    if (url.hostname === 'www.guru.com' && /^\/work\/?$/.test(url.pathname)) return 'Guru';
  } catch { /* Invalid URL */ }
  return undefined;
}

export function canonicalProject(value: string, platform: Platform): { url: string; sourceId: string } | undefined {
  try {
    const url = new URL(value);
    const host = platform === 'PeoplePerHour' ? 'www.peopleperhour.com' : 'www.guru.com';
    if (url.protocol !== 'https:' || url.hostname !== host || url.port || url.username || url.password) return undefined;
    const path = url.pathname.replace(/\/$/, '');
    const match = platform === 'PeoplePerHour' ? /^\/freelance-jobs\/(?:[^/]+\/)*[^/]*[-/](\d+)$/.exec(path) : /^\/jobs\/(?:[^/]+\/)+(\d+)$/.exec(path);
    if (!match) return undefined;
    return { url: `https://${host}${path}`, sourceId: match[1]! };
  } catch { return undefined; }
}
