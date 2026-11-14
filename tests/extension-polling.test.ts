import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { pollListing } from '../extension/src/polling.js';
const url = 'https://www.peopleperhour.com/freelance-jobs';
const parse = (html: string) => parseHTML(html).document as unknown as Document;
test('background polling performs only a same-origin listing GET and extracts real response fields', async () => {
  let calls = 0;
  const request: typeof fetch = async (target, options) => {
    calls++;
    assert.equal(target, url);
    assert.equal(options!.method, 'GET');
    assert.equal(options!.credentials, 'same-origin');
    assert.equal(options!.redirect, 'manual');
    assert.equal(options!.headers, undefined);
    return new Response(readFileSync('tests/fixtures/extension/peopleperhour-layouts.html', 'utf8'), { headers: { 'content-type': 'text/html' } });
  };
  const result = await pollListing(url, request, parse);
  assert.equal(result.status, 'ok');
  assert.equal(result.payload!.projects.length, 4);
  assert.equal(calls, 1);
});
test('polling identifies login redirects and access restrictions without following or bypassing them', async () => {
  assert.equal((await pollListing(url, async () => new Response('', { status: 302 }), parse)).status, 'poll_unsupported');
  const rejected = await pollListing(url, async () => new Response('', { status: 401 }), parse);
  assert.equal(rejected.status, 'login_required');
  assert.equal(rejected.authentication?.state, 'expired/logged_out');
  for (const status of [202, 403, 429]) assert.equal((await pollListing(url, async () => new Response('', { status }), parse)).status, 'verification_required');
  const login = await pollListing('https://www.guru.com/work/', async () => new Response(readFileSync('tests/fixtures/extension/login.html', 'utf8'), { headers: { 'content-type': 'text/html' } }), parse);
  assert.equal(login.status, 'login_required');
  const pphLogin = await pollListing(url, async () => new Response(readFileSync('tests/fixtures/extension/peopleperhour-login.html', 'utf8'), { headers: { 'content-type': 'text/html' } }), parse);
  assert.equal(pphLogin.status, 'login_required');
});
test('JS shells, network errors, invalid content and unsupported URLs are not reported as successful polling', async () => {
  assert.equal((await pollListing(url, async () => new Response('<html><body><div id="app"></div><script>throw new Error("not executed")</script></body></html>', { headers: { 'content-type': 'text/html' } }), parse)).status, 'poll_unsupported');
  assert.equal((await pollListing(url, async () => { throw new Error('secret upstream'); }, parse)).status, 'poll_failed');
  assert.equal((await pollListing(url, async () => new Response('{}', { headers: { 'content-type': 'application/json' } }), parse)).status, 'poll_unsupported');
  let called = false;
  assert.equal((await pollListing('https://evil.example/', async () => { called = true; return new Response(); }, parse)).status, 'unsupported');
  assert.equal(called, false);
});
