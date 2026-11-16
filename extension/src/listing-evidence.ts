import type { ListingEvidence } from '../shared/schema.js';
export function listingScope(value: string): string {
  const url = new URL(value); url.hash = ''; url.searchParams.sort(); return url.href;
}
export function listingUrlPage(pageUrl: string): ListingEvidence['page'] {
  const url = new URL(pageUrl); let result: ListingEvidence['page'] = 'first';
  for (const [name, value] of url.searchParams) {
    if (/^(?:page|p|page\[number\]|pagenumber|page_number)$/i.test(name)) {
      if (!/^\d+$/.test(value)) result = 'unknown'; else if (Number(value) > 1) return 'later';
    }
    if (/^(?:offset|start|skip)$/i.test(name)) {
      if (!/^\d+$/.test(value)) result = 'unknown'; else if (Number(value) > 0) return 'later';
    }
  }
  return result;
}
export function listingPage(document: Document, pageUrl: string): ListingEvidence['page'] {
  const result = listingUrlPage(pageUrl); if (result !== 'first') return result;
  for (const element of Array.from(document.querySelectorAll('[aria-current="page"],.pagination .active,.pagination .current'))) {
    const value = element.textContent?.trim() ?? '';
    if (/^\d+$/.test(value) && Number(value) > 1) return 'later';
  }
  return result;
}
export function listingEvidence(document: Document, pageUrl: string, extracted: number, candidates: number,
  isVisible: (element: Element) => boolean, source: 'dom' | 'html' = 'dom', listingRoot?: Element): ListingEvidence {
  const loadingSelectors = source === 'html' ? '[aria-busy="true"],[data-loading="true"]' : '[aria-busy="true"],[role="progressbar"],.loading,.loader,.skeleton,[data-loading="true"]';
  const loading = Array.from((listingRoot ?? document).querySelectorAll(loadingSelectors)).some(isVisible) || Boolean(listingRoot && listingRoot.matches('[aria-busy="true"],[data-loading="true"]')); 
  const empty = Array.from(document.querySelectorAll('main .no-results,main .empty-state,.job-list-empty,.no-jobs,.no-projects,[data-testid="empty-state"]'))
    .some(element => isVisible(element) && /\b(?:no (?:matching )?(?:jobs|projects|results)(?: found)?|0 (?:jobs|projects|results))\b/i.test(element.textContent ?? ''));
  const page = listingPage(document, pageUrl);
  const loaded = source === 'html' || document.readyState === 'complete';
  const completeness: ListingEvidence['completeness'] = !loaded || loading ? 'partial' :
    extracted === 0 ? (empty && candidates === 0 ? 'empty' : 'unknown') : extracted < candidates || extracted >= 100 ? 'partial' : 'complete';
  return { version: 1, source, completeness, page, scope: listingScope(pageUrl), settled: source === 'html' };
}