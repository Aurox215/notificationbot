import type { ProjectAlert } from '../domain/project.js';

export function matchesKeywords(project: ProjectAlert, keywords: string[]): boolean {
  if (!keywords.length) return true;
  const text = [project.title, project.description, project.category, ...(project.skills ?? [])].join(' ').toLowerCase();
  return keywords.some(keyword => {
    const escaped = keyword.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'u').test(text);
  });
}
