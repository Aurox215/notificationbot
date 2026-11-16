import type { ExtractedProject } from '../../src/ingestion/schema.js';
import type { Platform } from '../../src/sources/types.js';
import { canonicalProject } from '../../src/ingestion/identity.js';
import { visible } from './extractor.js';
export type ProjectDetails = Pick<ExtractedProject, 'budget' | 'category' | 'skills' | 'description' | 'client'>;
const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
function panel(el: Element, pattern: RegExp): boolean {
  for (let node: Element | null = el; node && !node.matches('body,html,main'); node = node.parentElement) {
    const heading: Element | null = node.querySelector('h1,h2,h3,h4,h5,h6');
    if (heading && pattern.test(text(heading)) && (heading.closest('section,article,.panel,.module_box,[role="region"]') === node || node.firstElementChild === heading)) return true;
  }
  return false;
}
export function extractProjectDetails(document: Document, url: string, platform: Platform, sourceId: string): ProjectDetails | undefined {
  if (canonicalProject(url, platform)?.sourceId !== sourceId) return;
  const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute('href');
  if (canonical && canonicalProject(new URL(canonical, url).href, platform)?.sourceId !== sourceId) return;
  const title = text(document.querySelector('h1,.project-title,.job-title,h2'));
  if (!title || /verify.*human|access denied|just a moment|checking your browser|log in|sign in/i.test(title + ' ' + document.title) || document.querySelector('input[type="password"]')) return;
  const shownId = /(?:Job\s*ID\s*:\s*|#)(\d{4,})/i.exec(text(document.body).slice(0, 1800));
  if (shownId && shownId[1] !== sourceId) return;
  const ignored = /^(?:similar jobs|more jobs from.*|related project searches|.*other projects|new proposal|clarification board|job q&a)$/i;
  const elements = Array.from(document.querySelectorAll('body *')).filter(el => visible(el) && !el.closest('script,style,template,noscript,nav,[role="navigation"]') && !panel(el, ignored));
  const first = (selector: string) => elements.find(el => el.matches(selector));
  const labelValue = (labels: string[]): string | undefined => {
    const pattern = new RegExp('^(?:' + labels.join('|') + ')\\s*:?\\s*', 'i');
    for (const el of [...elements].sort((a, b) => text(a).length - text(b).length)) {
      const value = text(el); if (!value || value.length > 300 || !pattern.test(value)) continue;
      let rest = value.replace(pattern, '').replace(/^[\s:|>\u203a]+/, '');
      if (!rest) rest = text(el.nextElementSibling) || text(el.parentElement).replace(pattern, '');
      if (rest && rest.length <= 200) return rest.trim();
    }
    return undefined;
  };
  const details: ProjectDetails = {};
  const budget = text(first('.jobHeading__budget')).replace(/^(?:fixed price|hourly(?: rate)?)\s*\|?\s*/i, '') || text(first('[itemprop="baseSalary"],.budget,.job-budget,.project-budget,[data-field="budget"]')) || labelValue(['Fixed price', 'Hourly rate', 'Hourly', 'Budget']);
  if (budget) details.budget = budget.slice(0, 200);
  const categoryRow = first('.jobDetails__category .rhythmMargin1');
  const primaryCategory = text(categoryRow?.querySelector('strong'));
  const category = categoryRow && primaryCategory ? [primaryCategory, text(categoryRow).slice(primaryCategory.length).trim()].filter(Boolean).join(' > ') : text(first('[itemprop="occupationalCategory"],.job-category,.category,[data-field="category"]'));
  if (category) details.category = category.slice(0, 200);
  else {
    const path = elements.map(text).find(value => value.length < 200 && /^Design & Art\s*[>\u203a]\s*.+/i.test(value));
    if (path) details.category = path;
  }
  const skills = elements.filter(el => el.matches('.skill,.skill-tag,.skillTag,.skillsList__skill,.skills li,.skills a,.skills span,.skillsList li,.skillsList a,.job-skills li,[data-field="skill"]')).map(text).filter(value => value && value.length <= 60);
  if (skills.length) details.skills = [...new Set(skills)].slice(0, 30);
  let description = text(first('.jobDetails__description,[itemprop="description"],#jobDescription,.job-description,.project-description,.description,[data-field="description"]'));
  if (!description) {
    const heading = elements.find(el => /^H[1-6]$/.test(el.tagName) && /^description$/i.test(text(el)));
    const parts: string[] = [];
    if (heading) for (let node = heading.nextElementSibling; node && !/^H[1-6]$/.test(node.tagName); node = node.nextElementSibling) {
      if (panel(node, ignored)) break;
      const value = text(node); if (value) parts.push(value);
    }
    if (!parts.length) parts.push(...elements.filter(el => el.tagName === 'P' && text(el).length >= 40 && !panel(el, /^posted by$/i) && !el.closest('aside,.client-info,.employer-info')).map(text));
    description = parts.join('\n\n');
  }
  if (description) details.description = description.replace(/\s*\.{3}\s*Show more\s*$/i, '').slice(0, 5000);
  const feedback = labelValue(['Feedback', 'Client rating']);
  const feedbackTuple = elements.filter(el => el.matches('a,span,small')).map(text).find(value => /^\d+(?:\.\d+)?%\s*\(\d+\)$/.test(value));
  const rawScore = (feedback || feedbackTuple)?.match(/\d+(?:\.\d+)?\s*(?:%|\/\s*5)/)?.[0];
  const score = rawScore && !(/No Feedback/i.test(feedback ?? '') && parseFloat(rawScore) === 0) ? rawScore : undefined;
  const reviews = labelValue(['Client reviews', 'Reviews', 'Review count']);
  const count = reviews?.match(/^\d[\d,]*/)?.[0].replace(/,/g, '') ?? feedbackTuple?.match(/\((\d+)\)/)?.[1];
  const joinedAt = labelValue(['Member since', 'Joined', 'Joining date', 'Registration date']);
  if (score || count !== undefined || joinedAt) details.client = { ...(score ? { ratingScore: score } : {}), ...(count !== undefined && Number.isSafeInteger(Number(count)) ? { reviewCount: Number(count) } : {}), ...(joinedAt ? { joinedAt: joinedAt.slice(0, 150) } : {}) };
  return Object.keys(details).length ? details : undefined;
}
