import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSession, sessionResult, savedSearchConfiguration, peoplePerHourSessionResult } from '../extension/src/session-check.js';

const guru = 'https://www.guru.com';
const pph = 'https://www.peopleperhour.com';
test('Guru server check supplies its existing browser token only to the exact same-origin GET', async () => {
  let calls = 0;
  const request: typeof fetch = async (url, init) => {
    calls++;
    assert.equal(url, guru + '/api/v1/search/savedsearches/get/');
    assert.equal(init!.method, 'GET'); assert.equal(init!.cache, 'no-store');
    assert.equal(init!.redirect, 'error');
    if (init!.credentials === 'omit') {
      assert.equal(new Headers(init!.headers).has('Authorization'), false);
      return Response.json({ Message: 'Authorization has been denied for this request.' }, { status: 401 });
    }
    assert.equal(init!.credentials, 'same-origin');
    assert.equal(new Headers(init!.headers).get('Authorization'), 'Bearer synthetic-token');
    return Response.json([]);
  };
  const result = await checkSession(guru, 'other=value; _accessToken=synthetic-token', undefined, request);
  assert.deepEqual(result, { state: 'authenticated', reason: 'api_authenticated' });
  assert.ok(!JSON.stringify(result).includes('synthetic-token')); assert.equal(calls, 2);
});
test('API authorization rejection is negative; HTML, redirects, key errors and network failures remain unknown', async () => {
  assert.equal(sessionResult(401, 'application/xml', '<Error><Message>Authorization has been denied for this request.</Message></Error>').state, 'expired/logged_out');
  for (const [status, type, body] of [
    [200, 'text/html', '<h1>Dashboard</h1>'], [200, 'application/json', { errors: 'invalid-app-key' }],
    [401, 'application/json', { errors: 'invalid-app-key' }], [403, 'application/json', {}],
    [429, 'application/json', {}], [200, 'application/json', null], [200, 'application/json', { success: false }],
    [302, 'application/json', {}], [401, 'text/html', 'challenge'], [200, 'application/json', { Message: 'denied' }]
  ] as const) assert.equal(sessionResult(status, type, body).state, 'unknown');
  const denied = await checkSession(guru, '', undefined, async () => new Response('<Error><Message>Authorization has been denied for this request.</Message></Error>', { status: 401 }));
  assert.equal(denied.state, 'expired/logged_out');
  assert.equal((await checkSession(guru, '', undefined, async () => { throw new Error('secret'); })).state, 'unknown');
  assert.equal((await checkSession(guru, '', undefined, async () => Response.json('not an account'))).state, 'unknown');
  assert.equal((await checkSession(guru, '', undefined, async () => new Response('x'.repeat(262145)))).state, 'unknown');
});
test('PeoplePerHour current-member probe works without resource discovery and strips unrelated query parameters', async () => {
  const candidate = pph + '/v2/user/savedSearches?app_id=public-id&app_key=public-key&access_token=never-copy';
  const config = savedSearchConfiguration(pph, ['https://evil.example/v2/user/savedSearches?app_id=x&app_key=y', candidate]);
  assert.equal(config, pph + '/v2/user/savedSearches?app_id=public-id&app_key=public-key');
  let calls = 0;
  const request: typeof fetch = async (url, init) => {
    calls++; assert.equal(new URL(String(url)).pathname, '/v2/members/me'); assert.equal(new Headers(init!.headers).has('Authorization'), false);
    return new Response(JSON.stringify({ member: { id: '123' }, shared: {} }), { headers: { 'content-type': 'application/vnd.api+json' } });
  };
  assert.equal((await checkSession(pph, '', undefined, request)).state, 'authenticated'); assert.equal(calls, 1);
  assert.equal((await checkSession(pph, '', config, request)).state, 'authenticated'); assert.equal(calls, 2);
  assert.equal((await checkSession('https://evil.example', 'token', config, request)).state, 'unknown'); assert.equal(calls, 2);
});
test('anonymous API success cannot falsely establish login', async () => {
  for (const response of [[], { data: [] }]) {
    const result = await checkSession(guru, '_accessToken=synthetic', undefined, async () => Response.json(response));
    assert.equal(result.state, 'unknown');
  }
});

test('a possibly refreshable Guru access token does not falsely assert logout', async () => {
  const result = await checkSession(guru, '_refreshToken=synthetic-refresh', undefined,
    async () => Response.json({ Message: 'Authorization has been denied for this request.' }, { status: 401 }));
  assert.equal(result.state, 'unknown');
  assert.ok(!JSON.stringify(result).includes('synthetic-refresh'));
});

test('PeoplePerHour vendor JSON and HTTP-200 guest envelopes distinguish real account state', async () => {
  const type = 'application/vnd.api+json; charset=utf-8';
  assert.equal(peoplePerHourSessionResult(200, type, { member: { id: '123', email: 'never-export@example.invalid' }, shared: {} }).state, 'authenticated');
  const guest = { shared: { handie: { 'guest.neverLoggedIn': true } } };
  assert.equal(peoplePerHourSessionResult(200, type, guest).state, 'expired/logged_out');
  for (const body of [{}, [], { data: [] }, { member: {} }, { errors: 'invalid-app-key' }, { shared: {}, errors: 'blocked' }]) {
    assert.equal(peoplePerHourSessionResult(200, type, body).state, 'unknown');
  }
  assert.equal(peoplePerHourSessionResult(403, 'text/html', guest).state, 'unknown');
  let calls = 0;
  const request: typeof fetch = async () => {
    calls++; return new Response(JSON.stringify(guest), { headers: { 'content-type': type } });
  };
  const result = await checkSession(pph, '', undefined, request);
  assert.equal(result.state, 'expired/logged_out'); assert.equal(calls, 1);
  assert.deepEqual(Object.keys(result).sort(), ['reason', 'state']);
});

test('Guru confirms logout after refresh grace when stale refresh cookies cannot renew a rejected session', async () => {
  let calls = 0; let waits = 0; const cookie = '_accessToken=expired; _refreshToken=stale';
  const result = await checkSession(guru, cookie, undefined, async () => { calls++; return Response.json({ Message: 'Authorization has been denied for this request.' }, { status: 401 }); }, { readCookie: () => cookie, wait: async () => { waits++; } });
  assert.equal(result.state, 'expired/logged_out'); assert.equal(result.reason, 'api_rejected'); assert.equal(calls, 2); assert.equal(waits, 1); assert.ok(!JSON.stringify(result).includes('expired;'));
});

test('Guru refresh recovery or a changed session cookie cannot produce a false logout notice', async () => {
  const cookie = '_accessToken=old; _refreshToken=refresh'; let calls = 0;
  const recovered = await checkSession(guru, cookie, undefined, async (_url, init) => { calls++; return calls === 1 || init?.credentials === 'omit' ? Response.json({ Message: 'Authorization has been denied for this request.' }, { status: 401 }) : Response.json({ data: [] }); }, { readCookie: () => cookie, wait: async () => {} });
  assert.equal(recovered.state, 'authenticated'); assert.equal(calls, 3);
  const changing = await checkSession(guru, cookie, undefined, async () => Response.json({ Message: 'Authorization has been denied for this request.' }, { status: 401 }), { readCookie: () => '_accessToken=new; _refreshToken=refresh', wait: async () => {} });
  assert.equal(changing.state, 'unknown');
});

test('Guru detects browser logout even when a surviving bearer token still accesses the account API', async () => {
  let requests = 0;
  const request: typeof fetch = async (url, init) => {
    requests++;
    if (String(url).endsWith('/pro/')) { assert.equal(init!.credentials, 'same-origin'); const response = new Response('<html>Log In</html>', { headers: { 'content-type': 'text/html' } }); Object.defineProperty(response, 'url', { value: guru + '/login.aspx?ReturnUrl=pro' }); Object.defineProperty(response, 'redirected', { value: true }); return response; }
    return init!.credentials === 'omit' ? Response.json({ Message: 'Authorization has been denied for this request.' }, { status: 401 }) : Response.json({ data: [] });
  };
  const result = await checkSession(guru, '_accessToken=surviving-token', undefined, request, { readCookie: () => '', wait: async () => {}, verifyBrowserSession: true });
  assert.equal(result.state, 'expired/logged_out'); assert.equal(requests, 3);
});

test('Guru protected-route redirects to consent or another origin do not falsely declare logout', async () => {
  for (const target of [guru + '/consent', 'https://example.invalid/login.aspx']) {
    const request: typeof fetch = async (url, init) => {
      if (String(url).endsWith('/pro/')) { const response = new Response('Consent'); Object.defineProperty(response, 'url', { value: target }); Object.defineProperty(response, 'redirected', { value: true }); return response; }
      return init!.credentials === 'omit' ? Response.json({ Message: 'Authorization has been denied for this request.' }, { status: 401 }) : Response.json({ data: [] });
    };
    const result = await checkSession(guru, '_accessToken=active', undefined, request, { readCookie: () => '', wait: async () => {}, verifyBrowserSession: true });
    assert.equal(result.state, 'authenticated');
  }
});
