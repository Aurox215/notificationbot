import type { AuthenticationObservation } from './authentication.js';
import { checkSession } from './session-check.js';
const origin = 'https://www.guru.com';
async function html(response: Response): Promise<string | undefined> {
  if (!(response.headers.get('content-type') ?? '').includes('text/html')) { await response.body?.cancel(); return; }
  const reader = response.body?.getReader(); if (!reader) return;
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 1048576) { await reader.cancel(); return; } chunks.push(part.value); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(bytes);
}
function blocked(value: string): boolean {
  return /<title[^>]*>[^<]*(?:just a moment|access denied|verification|security check)/i.test(value) || /verify (?:you are|that you are) human|checking your browser/i.test(value);
}
function login(response: Response, body: string): boolean {
  let url: URL; try { url = new URL(response.url); } catch { return false; }
  return response.ok && response.redirected && url.origin === origin && /^\/login\.aspx\/?$/i.test(url.pathname) && !blocked(body) && (
    /<input\b[^>]*\btype\s*=\s*["']?password\b/i.test(body) ||
    (/<title[^>]*>\s*Guru Login\s*-\s*Log In to Your Guru\.com Account\s*<\/title>/i.test(body) &&
      /\bid\s*=\s*["']vue-login-app["']/i.test(body))
  );
}
function privateDashboard(response: Response, body: string): boolean {
  let url: URL; try { url = new URL(response.url); } catch { return false; }
  if (!response.ok || url.origin !== origin || !/^\/pro\/?$/i.test(url.pathname) || blocked(body)) return false;
  // The Dashboard can be rendered by JavaScript. Its private status is proved
  // by the anonymous control below, rather than account details in raw HTML.
  return /<html\b|<!doctype\s+html/i.test(body) && !/<title[^>]*>[^<]*\bLog In\b/i.test(body);
}
export async function checkGuruSession(cookie: string, readCookie: () => string,
  request: typeof fetch = fetch, wait: () => Promise<void> = () => new Promise(resolve => setTimeout(resolve, 2000))): Promise<AuthenticationObservation & { detail?: string }> {
  const deadline = Date.now() + 10000;
  let detail = 'Guru: the protected Dashboard response did not confirm account access.';
  try {
    const response = await request.call(globalThis, origin + '/pro/', { method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'follow', signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())) });
    if (response.status === 200) {
      const body = await html(response);
      if (body && login(response, body)) return { state: 'expired/logged_out', reason: 'api_rejected' };
      if (body && privateDashboard(response, body)) {
        const control = await request.call(globalThis, origin + '/pro/', { method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'follow', signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())) });
        const controlBody = await html(control);
        if ((controlBody && login(control, controlBody)) || control.status === 401) return { state: 'authenticated', reason: 'api_authenticated' };
        detail = 'Guru: anonymous access was not rejected, so login could not be verified safely.';
      } else if (body && blocked(body)) detail = 'Guru: a website verification challenge is blocking the account check. Open Guru and complete normal access.';
    } else { await response.body?.cancel(); detail = 'Guru: account check returned HTTP ' + response.status + '. Refresh Guru and check normal website access.'; }
  } catch { detail = 'Guru: Chrome could not check the account session. Refresh the Guru tab and check its network access.'; }
  // A failed/inconclusive Dashboard probe must not suppress the existing account-only API proof.
  if (Date.now() < deadline) {
    const api = await checkSession(origin, cookie, undefined, request, { readCookie, wait, deadline });
    if (api.state !== 'unknown') return api;
  }
  return { state: 'unknown', reason: 'unverified', detail };
}
