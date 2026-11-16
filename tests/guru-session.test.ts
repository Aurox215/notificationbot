import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { parseHTML } from 'linkedom';
﻿import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkGuruSession } from '../extension/src/guru-session.js';
const origin = 'https://www.guru.com';
const privatePage = '<html><head><title>Guru Dashboard</title></head><body><div id="dashboard-app"></div></body></html>';
const loginPage = readFileSync('tests/fixtures/extension/guru-login-shell.html', 'utf8');
function page(body: string, url: string, redirected = false) {
  const response = new Response(body, { headers: { 'content-type': 'text/html' } }); Object.defineProperty(response, 'url', { value: url }); Object.defineProperty(response, 'redirected', { value: redirected }); return response;
}
test('Guru signed-in Dashboard proof works independently of saved-search API and unreadable browser token cookies', async () => {
  const calls: string[] = [];
  const auth = await checkGuruSession('', () => '', async (url, init) => { calls.push(String(url)); assert.equal(String(url), origin + '/pro/'); return init!.credentials === 'omit' ? page(loginPage, origin + '/login.aspx?ReturnUrl=pro', true) : page(privatePage, origin + '/pro/'); });
  assert.equal(auth.state, 'authenticated'); assert.equal(auth.reason, 'api_authenticated'); assert.equal(calls.length, 2); assert.ok(!JSON.stringify(auth).includes('5504206'));
});
test('Guru server redirect to the login form confirms logout without consulting a surviving access token', async () => {
  let calls = 0; const auth = await checkGuruSession('_accessToken=surviving', () => '_accessToken=surviving', async url => { calls++; assert.equal(String(url), origin + '/pro/'); return page(loginPage, origin + '/login.aspx', true); });
  assert.equal(auth.state, 'expired/logged_out'); assert.equal(calls, 1);
});
test('Guru public dashboard shells, anonymous successes and verification challenges cannot establish login', async () => {
  for (const html of [privatePage, '<html><h1>Dashboard</h1><p>Guru ID: {{accountId}}</p></html>', '<html><title>Just a moment</title><h1>Verify you are human</h1></html>']) {
    const auth = await checkGuruSession('', () => '', async url => String(url).endsWith('/pro/') ? page(html, origin + '/pro/') : Response.json({ data: [] }));
    assert.equal(auth.state, 'unknown'); assert.ok(auth.detail);
  }
});
test('an inconclusive Guru dashboard cannot prevent the independent account-only API fallback', async () => {
  const auth = await checkGuruSession('_accessToken=valid', () => '', async (url, init) => {
    if (String(url).endsWith('/pro/')) return page('<html><h1>Dashboard shell</h1></html>', origin + '/pro/');
    return init!.credentials === 'omit' ? Response.json({ Message: 'Authorization has been denied for this request.' }, { status: 401 }) : Response.json({ data: [] });
  });
  assert.equal(auth.state, 'authenticated');
});

test('compiled Guru content script returns independently verified login and logout observations without exposing account details', async () => {
  const { document } = parseHTML(privatePage); Object.defineProperty(document, 'cookie', { value: '', writable: true });
  let signedIn = true; let listener: any;
  runInNewContext(readFileSync('extension/dist/content.js', 'utf8'), {
    document, location: { origin, href: origin + '/pro/' }, URL, AbortSignal, TextDecoder,
    MutationObserver: class { observe() {} }, setTimeout: () => 1, clearTimeout: () => {},
    chrome: { runtime: { id: 'self', onMessage: { addListener: (fn: any) => { listener = fn; } }, sendMessage: async () => ({ enabled: false }) } },
    fetch: async (url: string, init: RequestInit) => { assert.equal(url, origin + '/pro/'); return signedIn && init.credentials === 'same-origin' ? page(privatePage, origin + '/pro/') : page(loginPage, origin + '/login.aspx', true); },
  });
  const check = () => new Promise<any>(resolve => listener({ type: 'CHECK_AUTH', force: true }, { id: 'self' }, resolve));
  const loggedIn = await check(); assert.equal(loggedIn.authentication.state, 'authenticated'); assert.ok(!JSON.stringify(loggedIn).includes('5504206'));
  signedIn = false; const loggedOut = await check(); assert.equal(loggedOut.authentication.state, 'expired/logged_out');
});

test('captured Guru login shell has no server-rendered password field and still proves logout', async () => {
  assert.ok(!/<input/i.test(loginPage));
  const auth = await checkGuruSession('', () => '', async () => page(loginPage, origin + '/login.aspx?ReturnUrl=%2fpro%2f', true));
  assert.equal(auth.state, 'expired/logged_out');
});
test('Guru login URL alone and cross-origin redirects do not prove logout', async () => {
  for (const [body, url] of [[ '<html><title>Just a moment</title></html>', origin + '/login.aspx' ], [loginPage, 'https://example.com/login.aspx']]) {
    const auth = await checkGuruSession('', () => '', async target => String(target).endsWith('/pro/') ? page(body!, url!, true) : Response.json({data: []}));
    assert.equal(auth.state, 'unknown');
  }
});
