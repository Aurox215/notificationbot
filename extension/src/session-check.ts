import type { AuthenticationObservation } from './authentication.js';
const unknown = (): AuthenticationObservation => ({ state: 'unknown', reason: 'unverified' });
const isJson = (type: string) => /^application\/(?:[a-z0-9.+-]+\+)?json(?:\s*;|$)/i.test(type.trim());
// Public application identifiers used by the website, not account credentials.
// Observed page configuration takes precedence when the site changes its keys.
const peoplePerHourApplication = { app_id: '23h2j27d', app_key: '48c4a5fb862168be0a029894f4eca210' };
export function peoplePerHourSessionUrl(configuration?: string): string {
  const origin = 'https://www.peopleperhour.com';
  const observed = savedSearchConfiguration(origin, configuration ? [configuration] : []);
  const url = new URL('/v2/members/me', origin);
  for (const key of ['app_id', 'app_key'] as const) url.searchParams.set(key,
    observed ? new URL(observed).searchParams.get(key)! : peoplePerHourApplication[key]);
  return url.href;
}
export function peoplePerHourSessionResult(status: number, type: string, body: unknown): AuthenticationObservation {
  if (status !== 200 || !isJson(type) || !body || typeof body !== 'object' || Array.isArray(body)) return sessionResult(status, type, body).state === 'expired/logged_out'
    ? { state: 'expired/logged_out', reason: 'api_rejected' } : unknown();
  const record = body as Record<string, unknown>;
  if (Object.keys(record).some(key => /^(error|errors|message|exception)$/i.test(key))) return unknown();
  const member = record.member;
  if (member && typeof member === 'object' && !Array.isArray(member)) {
    const id = (member as Record<string, unknown>).id;
    if ((typeof id === 'string' && /^[1-9]\d*$/.test(id)) || (typeof id === 'number' && Number.isSafeInteger(id) && id > 0)) {
      return { state: 'authenticated', reason: 'api_authenticated' };
    }
    return unknown();
  }
  // Observed guest contract: a shared envelope, without a member record.
  if ((member === undefined || member === null) && record.shared && typeof record.shared === 'object' && !Array.isArray(record.shared)) {
    return { state: 'expired/logged_out', reason: 'api_rejected' };
  }
  return unknown();
}
export function sessionResult(status: number, type: string, body: unknown): AuthenticationObservation {
  // An explicit application-key error is not a session rejection.
  const record = body && typeof body === 'object' ? body as Record<string, unknown> : undefined;
  const message = typeof body === 'string' ? body : JSON.stringify(body ?? '');
  if (/invalid.app.key|invalid.app.id|captcha|challenge|rate.limit/i.test(message)) return unknown();
  if (status === 401 && /authorization has been denied|unauthori[sz]ed|authentication|required|expired|invalid.token/i.test(message)) {
    return { state: 'expired/logged_out', reason: 'api_rejected' };
  }
  if (status !== 200 || !isJson(type) || !record) return unknown();
  if (Object.keys(record).some(k => /^(error|errors|message|exception|exceptionmessage)$/i.test(k)) ||
    record.success === false || record.Success === false || record.IsSuccess === false) return unknown();
  return { state: 'authenticated', reason: 'api_authenticated' };
}
export function savedSearchConfiguration(origin: string, urls: string[]): string | undefined {
  for (const value of urls) {
    try {
      const url = new URL(value);
      if (url.origin !== origin || !['/v2/user/savedSearches', '/v2/members/me'].includes(url.pathname) || !url.searchParams.get('app_id') || !url.searchParams.get('app_key')) continue;
      const clean = new URL('/v2/user/savedSearches', origin);
      for (const key of ['app_id', 'app_key']) clean.searchParams.set(key, url.searchParams.get(key)!);
      return clean.href;
    } catch { /* Ignore unrelated resource names. */ }
  }
  return undefined;
}
// Runs only in the isolated content script. Platform tokens never cross runtime messages.
export async function checkSession(origin: string, cookie: string, configuration?: string,
  request: typeof fetch = fetch, refreshCheck?: { readCookie(): string; wait(): Promise<void>; confirmed?: boolean; verifyBrowserSession?: boolean; deadline?: number }): Promise<AuthenticationObservation> {
  let url: string;
  const refreshPending = origin === 'https://www.guru.com' && cookie.split(';').some(p => /^_refreshToken=.+/.test(p.trim()));
  const deadline = refreshCheck?.deadline ?? Date.now() + 10000;
  const signal = AbortSignal.timeout(Math.max(1, deadline - Date.now()));
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (origin === 'https://www.guru.com') {
    url = origin + '/api/v1/search/savedsearches/get/';
    const token = cookie.split(';').map(p => p.trim()).find(p => p.startsWith('_accessToken='))?.slice('_accessToken='.length);
    if (token) {
      try { headers.Authorization = 'Bearer ' + decodeURIComponent(token); } catch { return unknown(); }
    }
  } else if (origin === 'https://www.peopleperhour.com') {
    url = peoplePerHourSessionUrl(configuration);
  } else return unknown();
  try {
    const response = await request(url, { method: 'GET', credentials: 'same-origin', headers,
      cache: 'no-store', redirect: 'error', signal });
    if (response.status !== 200 && response.status !== 401) return unknown();
    if (Number(response.headers.get('content-length') ?? 0) > 262144) return unknown();
    const reader = response.body?.getReader();
    if (!reader) return unknown();
    const chunks: Uint8Array[] = []; let length = 0;
    while (true) {
      const next = await reader.read(); if (next.done) break;
      length += next.value.byteLength;
      if (length > 262144) { await reader.cancel(); return unknown(); }
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const text = new TextDecoder().decode(bytes);
    let body: unknown = text;
    try { body = JSON.parse(text); } catch { /* XML authorization errors are also explicit server responses. */ }
    if (origin === 'https://www.peopleperhour.com') {
      return peoplePerHourSessionResult(response.status, response.headers.get('content-type') ?? '', body);
    }
    const observation = sessionResult(response.status, response.headers.get('content-type') ?? '', body);
    // A rejected access token alone cannot disprove a browser session that may
    // still refresh. Let Guru's own page refresh it; never submit refresh tokens.
    if (observation.state === 'expired/logged_out' && refreshPending && !refreshCheck?.confirmed) {
      if (!refreshCheck) return unknown();
      await refreshCheck.wait();
      const latest = refreshCheck.readCookie();
      const sessionCookies = (value: string) => value.split(';').map(part => part.trim()).filter(part => /^_(?:access|refresh)Token=/.test(part)).sort().join(';');
      // A changed token means Guru is still renewing the session; do not declare logout.
      if (sessionCookies(latest) !== sessionCookies(cookie)) return unknown();
      return checkSession(origin, latest, configuration, request, { ...refreshCheck, confirmed: true, deadline });
    }
    if (observation.state !== 'authenticated') return observation;
    // Prove this API is account-only. An anonymous success (even an empty list)
    // must never be mistaken for evidence of a signed-in session.
    const control = await request(url, { method: 'GET', credentials: 'omit', headers: { Accept: 'application/json' },
      cache: 'no-store', redirect: 'error', signal });
    if (control.status !== 401) { await control.body?.cancel(); return unknown(); }
    const controlReader = control.body?.getReader(); if (!controlReader) return unknown();
    const controlChunks: Uint8Array[] = []; let controlSize = 0;
    while (true) {
      const next = await controlReader.read(); if (next.done) break;
      controlSize += next.value.byteLength;
      if (controlSize > 262144) { await controlReader.cancel(); return unknown(); }
      controlChunks.push(next.value);
    }
    const controlBytes = new Uint8Array(controlSize); let controlOffset = 0;
    for (const chunk of controlChunks) { controlBytes.set(chunk, controlOffset); controlOffset += chunk.length; }
    const controlText = new TextDecoder().decode(controlBytes);
    let controlBody: unknown = controlText;
    try { controlBody = JSON.parse(controlText); } catch { /* XML authorization errors are supported. */ }
    const accountOnly = sessionResult(control.status, control.headers.get('content-type') ?? '', controlBody).state === 'expired/logged_out';
    if (!accountOnly) return unknown();
    if (refreshCheck?.verifyBrowserSession) {
      // A surviving bearer token may still work after the browser's actual session has logged out.
      // Confirm the browser session with the observed protected dashboard route, not a UI label.
      const dashboard = await request(origin + '/pro/', { method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'follow', signal });
      let loginRedirect = false;
      try { const target = new URL(dashboard.url); loginRedirect = dashboard.ok && dashboard.redirected && target.origin === origin && /^\/login\.aspx\/?$/i.test(target.pathname); } catch { /* Missing/unrelated redirect targets cannot prove logout. */ }
      await dashboard.body?.cancel();
      if (loginRedirect) return { state: 'expired/logged_out', reason: 'api_rejected' };
    }
    return observation;
  } catch { return unknown(); }
}
