import type { Platform, SourceProject } from './types.js';
import { SourceError } from './errors.js';

export function validateProjects(value: unknown, platform: Platform): asserts value is SourceProject[] {
  if (!Array.isArray(value) || value.length > 1000) throw new SourceError('invalid_data');
  for (const item of value) {
    if (!item || typeof item !== 'object') throw new SourceError('invalid_data');
    const p = item as SourceProject;
    if (p.platform !== platform || typeof p.sourceId !== 'string' || !p.sourceId.trim() || p.sourceId.length > 300 ||
      typeof p.title !== 'string' || !p.title.trim() || !(p.detectedAt instanceof Date) || !Number.isFinite(p.detectedAt.getTime())) throw new SourceError('invalid_data');
    for (const field of ['category', 'budget', 'description', 'publishedAt', 'url'] as const) {
      if (p[field] !== undefined && typeof p[field] !== 'string') throw new SourceError('invalid_data');
    }
    if (p.url !== undefined) {
      try {
        const url = new URL(p.url);
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error();
      } catch { throw new SourceError('invalid_data'); }
    }
    if (p.skills !== undefined && (!Array.isArray(p.skills) || p.skills.some(skill => typeof skill !== 'string'))) throw new SourceError('invalid_data');
    if (p.client !== undefined) {
      if (!p.client || typeof p.client !== 'object') throw new SourceError('invalid_data');
      for (const field of ['ratingScore', 'joinedAt'] as const) {
        if (p.client[field] !== undefined && typeof p.client[field] !== 'string') throw new SourceError('invalid_data');
      }
      for (const field of ['ratingCount', 'reviewCount'] as const) {
        const count = p.client[field];
        if (count !== undefined && (!Number.isSafeInteger(count) || count < 0)) throw new SourceError('invalid_data');
      }
    }
  }
}
