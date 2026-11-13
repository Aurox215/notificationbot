import { extractProjects, visible } from './extractor.js';
import { projectIdentity } from './project-cards.js';
import { listingPlatform } from '../../src/ingestion/identity.js';

// Only layout vocabulary may leave the page. Arbitrary classes can contain account
// identifiers, so unknown tokens (including hashes and IDs) are never reported.
const vocabulary = new Set(('job jobs project projects list listing listings item items card cards title budget price description summary excerpt posted date time skill skills content body row col container wrapper grid result results search media heading text main section panel box clearfix header footer meta details info link links entry entries xs sm md lg xl').split(' '));
const tags = new Set('a div span section article main li ul ol header footer nav aside h1 h2 h3 h4 h5 h6 p time small strong em i b'.split(' '));
function layoutClasses(element: Element): string[] {
  return Array.from(element.classList).filter(value => value.length <= 70 && /^[a-z_-]+$/.test(value) &&
    value.split(/[-_]+/).filter(Boolean).every(part => vocabulary.has(part))).slice(0, 8);
}
export function structureReport(document: Document, pageUrl: string) {
  const platform = listingPlatform(pageUrl);
  if (platform !== 'PeoplePerHour') return { status: 'unsupported', samples: [] };
  const extraction = extractProjects(document, pageUrl);
  if (['login_required', 'verification_required'].includes(extraction.status)) return { status: extraction.status, samples: [] };
  const samples: object[] = [];
  const seen = new Set<string>();
  for (const link of Array.from(document.querySelectorAll('a[href]'))) {
    if (!visible(link) || link.closest('nav,aside,footer,[role="navigation"],[role="complementary"]')) continue;
    const identity = projectIdentity(link, platform, pageUrl);
    if (!identity || seen.has(identity.sourceId)) continue;
    seen.add(identity.sourceId);
    const ancestors: object[] = [];
    for (let node: Element | null = link, depth = 0; node && depth < 7; node = node.parentElement, depth++) {
      if (node.matches('body,html')) break;
      const role = node.getAttribute('role');
      const tag = node.tagName.toLowerCase();
      ancestors.push({ tag: tags.has(tag) ? tag : 'other', layoutClasses: layoutClasses(node),
        ...(role && ['list', 'listitem', 'heading', 'main'].includes(role) ? { role } : {}),
        headingCount: node.querySelectorAll('h2,h3,h4,h5,h6,[role="heading"]').length,
        linkCount: node.querySelectorAll('a[href]').length });
    }
    samples.push({ ancestors });
    if (samples.length >= 3) break;
  }
  // Never return text, HTML, IDs, URLs, arbitrary attribute values, or storage.
  return { status: extraction.status, counts: extraction.diagnostics, samples };
}
