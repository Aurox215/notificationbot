import { listingPlatform, canonicalProject } from '../../src/ingestion/identity.js';
import type { ScanPayload, ExtractedProject } from '../../src/ingestion/schema.js';
import { findProjectCard, isTitleLink } from './project-cards.js';
import type { AuthenticationObservation } from './authentication.js';

export interface Extraction {
  authentication?: AuthenticationObservation;
  status: 'ok' | 'login_required' | 'verification_required' | 'no_projects' | 'unsupported' | 'extraction_failed' | 'poll_failed' | 'poll_unsupported';
  detail: string;
  payload?: ScanPayload;
  diagnostics?: { linksChecked: number; visibleProjectLinks: number; matchedCards: number; extractedProjects: number };
}
export function visible(element: Element): boolean {
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (node.hasAttribute('hidden') || node.getAttribute('aria-hidden') === 'true') return false;
    const inline = node.getAttribute('style') ?? '';
    if (/(?:display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse)|opacity\s*:\s*0(?:\s*[;!]|\s*$))/i.test(inline)) return false;
    const style = node.ownerDocument.defaultView?.getComputedStyle?.(node);
    if (style && (style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility) || style.opacity === '0')) return false;
  }
  if (element.ownerDocument.defaultView?.getComputedStyle && element.getClientRects().length === 0) return false;
  return true;
}
const text = (element: Element | undefined | null, maximum: number): string | undefined => {
  if (!element || /^(?:SCRIPT|STYLE|TEMPLATE|NOSCRIPT)$/i.test(element.tagName) || !visible(element)) return undefined;
  const value = Array.from(element.childNodes).map(node => node.nodeType === 3 ? node.textContent :
    node.nodeType === 1 && visible(node as Element) ? text(node as Element, maximum) ?? '' : '').join(' ').replace(/\s+/g, ' ').trim();
  return value ? value.slice(0, maximum) : undefined;
};
function field(card: Element, selectors: string, maximum: number): string | undefined {
  return Array.from(card.querySelectorAll(selectors)).map(el => text(el, maximum)).find(Boolean);
}

export function extractProjects(document: Document, pageUrl: string): Extraction {
  let url: URL;
  try { url = new URL(pageUrl); } catch { return { status: 'unsupported', detail: 'Unsupported URL.' }; }
  if (!['www.peopleperhour.com', 'www.guru.com'].includes(url.hostname) || url.protocol !== 'https:') return { status: 'unsupported', detail: 'Open a supported listing page.' };
  if (/\/login(?:\.aspx)?\/?$/i.test(url.pathname) || /\/(?:site\/login|signin)/i.test(url.pathname)) return { status: 'login_required', detail: 'Login page detected. Sign in normally on this platform to resume monitoring.' };
  const pageText = text(document.body, 20000) ?? '';
  const heading = document.title + ' ' + Array.from(document.querySelectorAll('h1,h2,[role="alert"]')).map(e => text(e, 300) ?? '').join(' ');
  const challenge = /verify (?:that )?you(?:'re| are) (?:not a robot|human)|verify you are human|checking your browser|security verification|just a moment|access denied|javascript is disabled/i.test(heading + ' ' + pageText.slice(0,3000));
  const captcha = Array.from(document.querySelectorAll('iframe[src*="recaptcha"],iframe[src*="hcaptcha"],iframe[src*="turnstile"],.g-recaptcha,.h-captcha')).some(visible);
  if (challenge) return { status: 'verification_required', detail: 'Verification detected. Complete normal website access yourself; the extension will not interact with it.' };
  if (/\b(?:you have been (?:logged|signed) out|(?:logged|signed) out successfully)\b/i.test(heading)) {
    return { status: 'login_required', authentication: { state: 'expired/logged_out', reason: 'explicit_logout' }, detail: 'The platform explicitly confirms logout. Sign in normally to restore account access.' };
  }
  if (/\/login(?:\.aspx)?\/?$/i.test(url.pathname) || /\/(?:site\/login|signin)/i.test(url.pathname) || Array.from(document.querySelectorAll('input[type="password"]')).some(visible)) {
    return { status: 'login_required', detail: 'Login page detected. Sign in yourself, then open the listing page and scan again.' };
  }
  if (captcha) return { status: 'verification_required', detail: 'CAPTCHA detected. Complete normal website access yourself; the extension will not interact with it.' };
  const platform = listingPlatform(pageUrl);
  if (!platform) return { status: 'unsupported', detail: 'Scan only /freelance-jobs or /work/ listing pages.' };
  const projects = new Map<string, ExtractedProject>();
  const diagnostics = { linksChecked: 0, visibleProjectLinks: 0, matchedCards: 0, extractedProjects: 0 };
  for (const anchor of Array.from(document.querySelectorAll('a[href]'))) {
    diagnostics.linksChecked++;
    if (!visible(anchor)) continue;
    let identity;
    try { identity = canonicalProject(new URL(anchor.getAttribute('href')!, pageUrl).href, platform); } catch { continue; }
    if (!identity) continue;
    diagnostics.visibleProjectLinks++;
    if (projects.has(identity.sourceId)) continue;
    const card = findProjectCard(anchor, platform, pageUrl, visible);
    if (!card || !visible(card)) continue;
    diagnostics.matchedCards++;
    const titleAnchor = Array.from(card.querySelectorAll('a[href]')).find(a => {
      try { return isTitleLink(a) && canonicalProject(new URL(a.getAttribute('href')!, pageUrl).href, platform)?.sourceId === identity!.sourceId && visible(a); } catch { return false; }
    });
    const title = text(titleAnchor ?? anchor, 500);
    if (!title || /^(?:view|read more|details|apply|send a quote)$/i.test(title)) continue;
    const project: ExtractedProject = { ...identity, title };
    const budget = field(card, '.budget,.job-budget,.project-budget,.job-list-item__budget,.job-list-item__price,[data-field="budget"]', 200);
    const description = field(card, '.description,.job-description,.project-description,.job-list-item__description,.job-list-item__excerpt,[itemprop="description"],[data-field="description"]', 5000);
    const category = field(card, '.category,.job-category,[data-field="category"]', 200);
    const publicationTime = Array.from(card.querySelectorAll('time[datetime]')).find(visible)?.getAttribute('datetime');
    const publishedAt = publicationTime || field(card, 'time,.posted,.posted-date,.publication-time,.job-age,.job-list-item__date,.job-list-item__posted', 150);
    const skills = Array.from(card.querySelectorAll('.skill,.skills li,.job-list-item__skills li,[data-field="skill"]')).map(e => text(e, 60)).filter((s): s is string => Boolean(s)).slice(0,30);
    if (budget) project.budget = budget;
    if (description) project.description = description;
    if (category) project.category = category;
    if (publishedAt) project.publishedAt = publishedAt;
    if (skills.length) project.skills = [...new Set(skills)];
    // Read only explicitly client-labelled fields inside this project card.
    // Never confuse project budgets, proposal counts or freelancer ratings with client metadata.
    const ratingScore = field(card, '.client-rating-score,[data-field="client-rating-score"]', 60);
    const reviews = field(card, '.client-review-count,[data-field="client-review-count"]', 60);
    const joinedAt = field(card, '.client-joined-at,.client-join-date,[data-field="client-joined-at"],[data-field="client-join-date"]', 150);
    const reviewCount = reviews && /^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(reviews) ? Number(reviews.replace(/,/g, '')) : undefined;
    if (ratingScore || joinedAt || (reviewCount !== undefined && Number.isSafeInteger(reviewCount))) {
      project.client = { ...(ratingScore ? { ratingScore } : {}),
        ...(reviewCount !== undefined && Number.isSafeInteger(reviewCount) ? { reviewCount } : {}), ...(joinedAt ? { joinedAt } : {}) };
    }
    projects.set(project.sourceId, project);
    if (projects.size >= 100) break;
  }
  diagnostics.extractedProjects = projects.size;
  if (!projects.size) return { status: 'no_projects', diagnostics, detail: diagnostics.visibleProjectLinks > 0 ?
    'Zero projects extracted: visible project links were found, but the card/title layout was not recognized. A selector update may be needed. Nothing was submitted.' :
    'Zero supported visible project links found. Wait for normal page loading and scan again. Nothing was submitted and no baseline was created.' };
  return { status: 'ok', diagnostics, detail: 'Visible project cards extracted.', payload: { platform, pageUrl: `${url.origin}${url.pathname}`, projects: [...projects.values()] } };
}
