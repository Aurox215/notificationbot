import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { extractProjects } from '../extension/src/extractor.js';
import { pollListing } from '../extension/src/polling.js';

const parse = (html: string) => parseHTML(html).document as unknown as Document;
for (const url of ['https://www.peopleperhour.com/freelance-jobs', 'https://www.guru.com/work/']) {
  test(`${new URL(url).hostname}: explicit manual logout, authentication rejection and ambiguous access`, async () => {
    const logout = extractProjects(parse('<html><body><h1>You have been logged out</h1></body></html>'), url);
    assert.equal(logout.status, 'login_required');
    assert.equal(logout.authentication?.reason, 'explicit_logout');
    // An expired server session is detectable when the server rejects authentication,
    // without inspecting a token or assuming a client-side expiry timestamp.
    const expired = await pollListing(url, async () => new Response('', { status: 401 }), parse);
    assert.equal(expired.authentication?.state, 'expired/logged_out');
    const network = await pollListing(url, async () => { throw new Error('private upstream'); }, parse);
    assert.equal(network.authentication?.state ?? 'unknown', 'unknown');
    for (const status of [302, 403, 429]) {
      const ambiguous = await pollListing(url, async () => new Response('', { status }), parse);
      assert.equal(ambiguous.authentication?.state ?? 'unknown', 'unknown');
    }
    const mereLink = extractProjects(parse('<html><body><a href="/logout">Log out</a><a href="/login">Log in</a></body></html>'), url);
    assert.equal(mereLink.authentication?.state ?? 'unknown', 'unknown');
  });
}
