import { extractProjects, type Extraction } from './extractor.js';
import { listingPlatform } from '../shared/identity.js';

export function inertDocument(html: string): Document {
  // Template contents are inert. Strip executable/resource elements before creating
  // the detached document; parsing must not run scripts or load tracking resources.
  const template = document.createElement('template');
  template.innerHTML = html;
  template.content.querySelectorAll('script,style,link,iframe,object,embed,img,video,audio,source,track,base').forEach(el => el.remove());
  template.content.querySelectorAll('[src],[srcset],[srcdoc]').forEach(el => {
    el.removeAttribute('src'); el.removeAttribute('srcset'); el.removeAttribute('srcdoc');
  });
  return new DOMParser().parseFromString(template.innerHTML, 'text/html');
}

export async function pollListing(pageUrl: string, request: typeof fetch = fetch,
  parse: (html: string) => Document = inertDocument): Promise<Extraction> {
  if (!listingPlatform(pageUrl)) return { status: 'unsupported', detail: 'Background polling is restricted to the two supported listing URLs.' };
  let response: Response;
  try {
    response = await request(pageUrl, { method: 'GET', credentials: 'same-origin', redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(10000) });
  } catch { return { status: 'poll_failed', detail: 'The website background request failed or timed out. Your Telegram connection was not changed.' }; }
  if (response.status === 401) {
    return { status: 'login_required', authentication: { state: 'expired/logged_out', reason: 'authentication_rejected' }, detail: 'The platform rejected authentication (HTTP 401). Open the platform tab and sign in normally.' };
  }
  if (response.type === 'opaqueredirect' || [301, 302, 303, 307, 308].includes(response.status)) {
    // Fetch manual redirects are normally opaque in Chrome. Do not guess that
    // canonicalization, consent or verification redirects mean an expired login.
    return { status: 'poll_unsupported', detail: 'The listing request redirected. Authentication is unknown; no redirect was followed. Open the platform tab to check normal access.' };
  }
  if ([202, 403, 429].includes(response.status) || response.headers.get('x-amzn-waf-action') === 'challenge') {
    return { status: 'verification_required', detail: 'Website access is restricted or rate-limited. Background requests are paused; open the page and complete normal access yourself.' };
  }
  if (!response.ok) return { status: 'poll_failed', detail: `Website returned HTTP ${response.status}. No project ingestion was attempted.` };
  if (!(response.headers.get('content-type') ?? '').includes('text/html')) return { status: 'poll_unsupported', detail: 'The listing request did not return HTML. No private endpoints or alternate APIs were tried.' };
  try {
    const maximum = 2 * 1024 * 1024;
    const reader = response.body?.getReader();
    if (!reader) return { status: 'poll_failed', detail: 'Website response was empty.' };
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength;
      if (size > maximum) { await reader.cancel(); return { status: 'poll_unsupported', detail: 'Website HTML exceeds the safe response-size limit.' }; }
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const result = extractProjects(parse(new TextDecoder().decode(bytes)), pageUrl, 'html');
    if (result.status === 'no_projects' && result.payload?.listing?.completeness !== 'empty') return { ...result, status: 'poll_unsupported', detail: 'Background HTML contains no extractable project cards. It may require JavaScript rendering or updated selectors. Live DOM observation remains active; no page reload or private API fallback was attempted.' };
    return result;
  } catch { return { status: 'poll_failed', detail: 'The background HTML response could not be parsed. No project data was accepted.' }; }
}
