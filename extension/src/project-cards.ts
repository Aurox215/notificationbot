import { canonicalProject } from '../../src/ingestion/identity.js';
import type { Platform } from '../../src/sources/types.js';

export const titleSelector = 'h2 a,h3 a,h4 a,h5 a,h6 a,[role="heading"] a,.project-title a,.job-title a,.job-list-item__title a,a[data-project-title],a.job-list-item__title';
export function titleHeading(anchor: Element): Element | null {
  const selector = 'h2,h3,h4,h5,h6,[role="heading"],.job-list-item__title';
  return anchor.closest(selector) ?? anchor.querySelector(selector);
}
export const isTitleLink = (anchor: Element) => anchor.matches(titleSelector) || Boolean(titleHeading(anchor));
const excluded = 'nav,aside,footer,[role="navigation"],[role="complementary"],template';
export function projectIdentity(anchor: Element, platform: Platform, pageUrl: string) {
  try { return canonicalProject(new URL(anchor.getAttribute('href') ?? '', pageUrl).href, platform); } catch { return undefined; }
}
function identities(container: Element, platform: Platform, pageUrl: string, visible: (el: Element) => boolean, titlesOnly = false): Set<string> {
  const ids = new Set<string>();
  for (const link of Array.from(container.querySelectorAll('a[href]'))) {
    if (titlesOnly && !isTitleLink(link)) continue;
    if (link.closest(excluded) || !visible(link)) continue;
    const identity = projectIdentity(link, platform, pageUrl);
    if (identity) ids.add(identity.sourceId);
    if (ids.size > 1) break; // Only the one-card vs collection distinction matters.
  }
  return ids;
}
export function findProjectCard(anchor: Element, platform: Platform, pageUrl: string, visible: (el: Element) => boolean): Element | undefined {
  if (anchor.closest(excluded)) return undefined;
  // A site-wide header is not a listing; a header within a real article is fine.
  if (anchor.closest('header') && !anchor.closest('main,article,[role="main"]')) return undefined;
  const selector = '[data-project-id],[data-job-id],.project-card,.job-card,.job-listing,.job-listing-item,.list-group-item,article' +
    (platform === 'PeoplePerHour' ? ',.job-list-item,[role="listitem"]' : '');
  const explicit = anchor.closest(selector);
  if (explicit && visible(explicit) && identities(explicit, platform, pageUrl, visible).size === 1) return explicit;
  if (platform !== 'PeoplePerHour') return undefined;

  // No class-name guess is needed for repeated layout wrappers. Require a real
  // project title, a single project identity per card, and a multi-project parent.
  // Never use a page/container holding multiple projects as one project's metadata.
  const heading = titleHeading(anchor);
  if (!heading || !visible(heading) || !projectIdentity(anchor, platform, pageUrl)) return undefined;
  let candidate: Element | undefined;
  for (let node = heading.parentElement, depth = 0; node && depth < 7; node = node.parentElement, depth++) {
    if (node.matches('body,html') || node.closest(excluded)) break;
    const ids = identities(node, platform, pageUrl, visible);
    if (ids.size > 1) {
      // Two distinct project title links provide collection evidence; a random
      // body link to another project is not enough.
      return candidate && identities(node, platform, pageUrl, visible, true).size > 1 ? candidate : undefined;
    }
    if (node.matches('main,[role="main"]')) break;
    if (ids.size === 1 && visible(node) && node.matches('div,section,li,article')) {
      candidate = node;
      if (node.matches('li') && node.parentElement?.matches('ul,ol,[role="list"]')) return node;
    }
  }
  return undefined;
}
