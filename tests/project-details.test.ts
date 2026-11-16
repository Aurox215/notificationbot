import { readFileSync } from 'node:fs';
﻿import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { extractProjectDetails } from '../extension/src/detail-extractor.js';
import { fetchProjectDetails } from '../extension/src/detail-fetch.js';
const parse = (html: string) => parseHTML(html).document as unknown as Document;
const pphUrl = 'https://www.peopleperhour.com/freelance-jobs/design/pdf-editing-4531294';
const pph = `<html><head><title>PDF EDITING</title></head><body><main><h1>PDF EDITING</h1><div>Posted: 4 minutes ago #4531294</div>
<h2>Description</h2><p>Experience Level: Entry</p><p>I need an experienced PDF editor to add two lines of text to an existing PDF document and keep the layout unchanged.</p>
<h2>New Proposal</h2><p>This private proposal form must not be included in the description.</p></main>
<aside><div><small>FIXED PRICE</small><strong>\u00a310</strong></div><h3>Robert S.</h3><a>100% (10)</a>
<div>Last project <span>8 Nov 2026</span></div><section><h3>Related project searches</h3><span class="skill">Editing</span></section></aside></body></html>`;
const guruUrl = 'https://www.guru.com/jobs/sports-highlight-reel/2121855';
const guru = `<html><body><main><div>Posted 1 hr ago | Job ID: 2121855</div><h1>Sports highlight reel</h1><p>Fixed Price | Under $250</p>
<div class="job-category">Design &amp; Art &gt; Video / Film / TV / DVD</div><span class="skill-tag">Video Editing</span>
<p>I have one video I need a 3-5 minute highlight video for scouts. I have the raw footage if needed.</p>
<section><h3>Job Q&amp;A</h3><p>Sorry, Q&amp;A is unavailable. Upgrade your membership.</p></section></main>
<aside><section><h3>Posted By</h3><div>Feedback <strong>100%</strong></div><div>Total Spend <span>$61</span></div><div>Jobs Paid <span>2 (67%)</span></div><div>Paid Invoices <span>2 (100%)</span></div></section>
<section><h3>More jobs from Leif H</h3><span>100% (99)</span><span class="skill-tag">Wrong related skill</span></section></aside></body></html>`;

test('PeoplePerHour detail labels map price, description and client feedback without inventing joining date or related-search skills', () => {
  const result = extractProjectDetails(parse(pph), pphUrl, 'PeoplePerHour', '4531294')!;
  assert.equal(result.budget, '\u00a310'); assert.match(result.description!, /experienced PDF editor/); assert.ok(!result.description!.includes('private proposal'));
  assert.equal(result.client!.ratingScore, '100%'); assert.equal(result.client!.reviewCount, 10); assert.equal(result.client!.joinedAt, undefined); assert.equal(result.skills, undefined);
});
test('Guru Feedback is client rating; paid invoices and jobs paid are not review counts', () => {
  const result = extractProjectDetails(parse(guru), guruUrl, 'Guru', '2121855')!;
  assert.equal(result.budget, 'Under $250'); assert.equal(result.category, 'Design & Art > Video / Film / TV / DVD'); assert.deepEqual(result.skills, ['Video Editing']);
  assert.match(result.description!, /highlight video for scouts/); assert.ok(!result.description!.includes('Upgrade your membership'));
  assert.equal(result.client!.ratingScore, '100%'); assert.equal(result.client!.reviewCount, undefined); assert.equal(result.client!.joinedAt, undefined);
});
test('explicit client joining dates and zero review counts survive; mismatched projects and login/challenge pages are rejected', () => {
  const doc = parse(pph.replace('<h3>Robert S.</h3>', '<h3>Robert S.</h3><div>Member since <span>January 2024</span></div><div>Reviews <span>0</span></div>'));
  const result = extractProjectDetails(doc, pphUrl, 'PeoplePerHour', '4531294')!; assert.equal(result.client!.joinedAt, 'January 2024'); assert.equal(result.client!.reviewCount, 0);
  assert.equal(extractProjectDetails(doc, pphUrl, 'PeoplePerHour', '9999999'), undefined);
  assert.equal(extractProjectDetails(parse('<html><body><h1>Just a moment</h1></body></html>'), pphUrl, 'PeoplePerHour', '4531294'), undefined);
});
test('detail lookup makes one same-origin GET and never follows redirects or requests client profiles', async () => {
  let calls = 0;
  const request: typeof fetch = async (url, init) => { calls++; assert.equal(String(url), pphUrl); assert.equal(init!.method, 'GET'); assert.equal(init!.redirect, 'manual'); assert.equal(init!.credentials, 'same-origin'); return new Response(pph, { headers: { 'content-type': 'text/html' } }); };
  assert.equal((await fetchProjectDetails(pphUrl, 'https://www.peopleperhour.com', 'PeoplePerHour', '4531294', request, parse)).client!.reviewCount, 10); assert.equal(calls, 1);
  await assert.rejects(fetchProjectDetails(pphUrl, 'https://www.guru.com', 'PeoplePerHour', '4531294', request, parse), /same platform/); assert.equal(calls, 1);
  for (const status of [202, 302, 403, 429]) await assert.rejects(fetchProjectDetails(pphUrl, 'https://www.peopleperhour.com', 'PeoplePerHour', '4531294', async () => new Response('blocked', { status, headers: { 'content-type': 'text/html' } }), parse), /unavailable/);
});

test('sanitized actual Guru markup supplies its primary price, category, skills, description and client feedback', () => {
  const document = parse(readFileSync('tests/fixtures/extension/guru-detail.html', 'utf8'));
  const result = extractProjectDetails(document, guruUrl, 'Guru', '2121855')!;
  assert.equal(result.budget, 'Under $250'); assert.equal(result.category, 'Design & Art > Video / Film / TV / DVD'); assert.deepEqual(result.skills, ['Video Editing']);
  assert.match(result.description!, /highlight video for scouts/); assert.ok(!result.description!.includes('Become a member')); assert.ok(!result.description!.includes('Fixed Price')); assert.ok(!result.description!.includes('Show more'));
  assert.equal(result.client!.ratingScore, '100.0%'); assert.equal(result.client!.reviewCount, undefined); assert.equal(result.client!.joinedAt, undefined);
});
