import { listingPlatform, canonicalProject } from './identity.js';
import type { Platform, SourceProject } from '../sources/types.js';

export interface ExtractedProject {
  sourceId: string; url: string; title: string; budget?: string; description?: string;
  publishedAt?: string; category?: string; skills?: string[];
  client?: { ratingScore?: string; reviewCount?: number; joinedAt?: string };
}
export interface ScanPayload { platform: Platform; pageUrl: string; projects: ExtractedProject[] }

export function validateScan(value: unknown): { platform: Platform; projects: SourceProject[] } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_scan');
  const input = value as ScanPayload;
  if (!['PeoplePerHour', 'Guru'].includes(input.platform) || typeof input.pageUrl !== 'string' || input.pageUrl.length > 2000 || listingPlatform(input.pageUrl) !== input.platform ||
    !Array.isArray(input.projects) || input.projects.length < 1 || input.projects.length > 100) throw new Error('invalid_scan');
  const projects: SourceProject[] = [];
  const ids = new Set<string>();
  for (const raw of input.projects) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || typeof raw.url !== 'string' || raw.url.length > 1000) throw new Error('invalid_project');
    const identity = canonicalProject(raw.url, input.platform);
    if (!identity || identity.sourceId !== raw.sourceId || typeof raw.title !== 'string' || !raw.title.trim() || raw.title.length > 500) throw new Error('invalid_project');
    const project: SourceProject = { ...identity, platform: input.platform, title: raw.title.trim(), detectedAt: new Date() };
    for (const [field, maximum] of [['budget', 200], ['description', 5000], ['publishedAt', 150], ['category', 200]] as const) {
      const text = raw[field];
      if (text !== undefined) {
        if (typeof text !== 'string' || !text.trim() || text.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) throw new Error('invalid_project');
        project[field] = text.trim();
      }
    }
    if (raw.skills !== undefined) {
      if (!Array.isArray(raw.skills) || raw.skills.length > 30 || raw.skills.some(x => typeof x !== 'string' || !x.trim() || x.length > 60)) throw new Error('invalid_project');
      project.skills = [...new Set(raw.skills.map(x => x.trim()))];
    }
    if (raw.client !== undefined) {
      if (!raw.client || typeof raw.client !== 'object' || Array.isArray(raw.client)) throw new Error('invalid_project');
      const { ratingScore, reviewCount, joinedAt } = raw.client;
      if (ratingScore !== undefined && (typeof ratingScore !== 'string' || !ratingScore.trim() || ratingScore.length > 60 || /[\u0000-\u001f]/.test(ratingScore))) throw new Error('invalid_project');
      if (reviewCount !== undefined && (!Number.isSafeInteger(reviewCount) || reviewCount < 0)) throw new Error('invalid_project');
      if (joinedAt !== undefined && (typeof joinedAt !== 'string' || !joinedAt.trim() || joinedAt.length > 150 || /[\u0000-\u001f]/.test(joinedAt))) throw new Error('invalid_project');
      project.client = { ...(ratingScore !== undefined ? { ratingScore: ratingScore.trim() } : {}),
        ...(reviewCount !== undefined ? { reviewCount } : {}), ...(joinedAt !== undefined ? { joinedAt: joinedAt.trim() } : {}) };
    }
    // Ignore unknown properties: never accept recipient IDs, notification flags, or client detection timestamps.
    if (!ids.has(project.sourceId)) { ids.add(project.sourceId); projects.push(project); }
  }
  return { platform: input.platform, projects };
}
