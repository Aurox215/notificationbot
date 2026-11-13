import { listingPlatform, canonicalProject } from '../../src/ingestion/identity.js';
import type { ScanPayload, ExtractedProject } from '../../src/ingestion/schema.js';

export interface Extraction {
  status: 'ok' | 'login_required' | 'verification_required' | 'no_projects' | 'unsupported' | 'extraction_failed';
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
  const pageText = text(document.body, 20000) ?? '';
  const heading = document.title + ' ' + Array.from(document.querySelectorAll('h1,h2,[role="alert"]')).map(e => text(e, 300) ?? '').join(' ');
  const challenge = /verify (?:that )?you(?:'re| are) (?:not a robot|human)|verify you are human|checking your browser|security verification|just a moment|access denied|javascript is disabled/i.test(heading + ' ' + pageText.slice(0,3000));
  const captcha = Array.from(document.querySelectorAll('iframe[src*="recaptcha"],iframe[src*="hcaptcha"],iframe[src*="turnstile"],.g-recaptcha,.h-captcha')).some(visible);
  if (challenge || captcha) return { status: 'verification_required', detail: 'Verification/CAPTCHA detected. Complete normal website access yourself; the extension will not interact with it.' };
  if (/\/login(?:\.aspx)?\/?$/i.test(url.pathname) || /\/(?:site\/login|signin)/i.test(url.pathname) || Array.from(document.querySelectorAll('input[type="password"]')).some(visible)) {
    return { status: 'login_required', detail: 'Login page detected. Sign in yourself, then open the listing page and scan again.' };
  }
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
    const card = anchor.closest('[data-project-id],[data-job-id],.project-card,.job-card,.job-listing,.job-listing-item,.list-group-item,article');
    if (!card || !visible(card)) continue;
    diagnostics.matchedCards++;
    const titleAnchor = Array.from(card.querySelectorAll('h2 a,h3 a,.project-title a,.job-title a,a[data-project-title]')).find(a => {
      try { return canonicalProject(new URL(a.getAttribute('href')!, pageUrl).href, platform)?.sourceId === identity!.sourceId && visible(a); } catch { return false; }
    });
    const title = text(titleAnchor ?? anchor, 500);
    if (!title || /^(?:view|read more|details|apply|send a quote)$/i.test(title)) continue;
    const project: ExtractedProject = { ...identity, title };
    const budget = field(card, '.budget,.job-budget,.project-budget,[data-field="budget"]', 200);
    const description = field(card, '.description,.job-description,.project-description,[data-field="description"]', 5000);
    const category = field(card, '.category,.job-category,[data-field="category"]', 200);
    const publishedAt = field(card, 'time,.posted,.posted-date,.publication-time,.job-age', 150);
    const skills = Array.from(card.querySelectorAll('.skill,.skills li,[data-field="skill"]')).map(e => text(e, 60)).filter((s): s is string => Boolean(s)).slice(0,30);
    if (budget) project.budget = budget;
    if (description) project.description = description;
    if (category) project.category = category;
    if (publishedAt) project.publishedAt = publishedAt;
    if (skills.length) project.skills = [...new Set(skills)];
    projects.set(project.sourceId, project);
    if (projects.size >= 100) break;
  }
  diagnostics.extractedProjects = projects.size;
  if (!projects.size) return { status: 'no_projects', diagnostics, detail: diagnostics.visibleProjectLinks > 0 ?
    'Zero projects extracted: visible project links were found, but the card/title layout was not recognized. A selector update may be needed. Nothing was submitted.' :
    'Zero supported visible project links found. Wait for normal page loading and scan again. Nothing was submitted and no baseline was created.' };
  return { status: 'ok', diagnostics, detail: 'Visible project cards extracted.', payload: { platform, pageUrl: `${url.origin}${url.pathname}`, projects: [...projects.values()] } };
}
