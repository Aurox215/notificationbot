import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseHTML } from 'linkedom';
import { extractProjects } from '../extension/src/extractor.js';
import { validateScan } from '../src/ingestion/schema.js';
import { structureReport } from '../extension/src/structure-report.js';
import { formatAlert } from '../src/domain/project.js';
const fixture = (name: string) => parseHTML(readFileSync(join(process.cwd(), 'tests/fixtures/extension', name), 'utf8')).document as unknown as Document;

test('card metadata survives extraction and validation into Telegram without inventing missing client data', () => {
  for (const [platform, pageUrl, href] of [
    ['PeoplePerHour', 'https://www.peopleperhour.com/freelance-jobs', '/freelance-jobs/python-901'],
    ['Guru', 'https://www.guru.com/work/', '/jobs/python/901'],
  ] as const) {
    const document = parseHTML(`<html><body><article class="project-card"><h2><a href="${href}">Python API</a></h2>
      <span class="budget">$500</span><span class="category">Development</span><span class="skill">Python</span>
      <span class="client-rating-score">4.9 / 5</span><span class="client-review-count">0</span>
      <span class="client-join-date">January 2024</span>
      </article></body></html>`).document as unknown as Document;
    const result = extractProjects(document, pageUrl);
    const project = validateScan(result.payload).projects[0]!;
    assert.equal(project.platform, platform);
    const alert = formatAlert(project);
    for (const value of ['Python API', 'Budget: $500', 'Category: Development', 'Skills: Python', 'Client rating: 4.9 / 5', 'Client reviews: 0', 'Client joined: January 2024', new URL(href, pageUrl).href]) assert.ok(alert.includes(value), value);
    const payload = structuredClone(result.payload!);
    payload.projects[0]!.client = { reviewCount: -1 };
    assert.throws(() => validateScan(payload), /invalid_project/);
    payload.projects[0]!.client = { reviewCount: 1.5 };
    assert.throws(() => validateScan(payload), /invalid_project/);
    payload.projects[0]!.client = { ratingScore: '\u0000secret' };
    assert.throws(() => validateScan(payload), /invalid_project/);
    for (const joinedAt of ['', 'x'.repeat(151), '\u0000invalid']) {
      payload.projects[0]!.client = { joinedAt };
      assert.throws(() => validateScan(payload), /invalid_project/);
    }
    delete payload.projects[0]!.client;
    assert.equal(validateScan(payload).projects[0]!.client, undefined);
  }
});

test('PeoplePerHour fixture extracts visible cards, canonical identities, optional fields and no hidden text', () => {
  const scan = extractProjects(fixture('peopleperhour.html'), 'https://www.peopleperhour.com/freelance-jobs');
  assert.equal(scan.status, 'ok');
  const projects = scan.payload!.projects;
  assert.equal(projects.length, 2);
  assert.equal(projects[0]!.sourceId, '101');
  assert.equal(projects[0]!.title, 'Python automation & API');
  assert.equal(projects[0]!.budget, '£500 fixed');
  assert.equal(projects[0]!.description, 'Build a Python API automation.');
  assert.equal(projects[0]!.publishedAt, '2026-11-13T00:00:00Z');
  assert.ok(!projects[0]!.url.includes('?'));
  assert.ok(!projects[0]!.url.includes('#'));
  assert.equal(projects[1]!.budget, undefined);
  assert.equal(projects[1]!.publishedAt, undefined);
  assert.equal(validateScan(scan.payload).projects.length, 2);
});
test('Guru fixture extracts canonical URLs and leaves missing information absent', () => {
  const scan = extractProjects(fixture('guru.html'), 'https://www.guru.com/work/');
  assert.equal(scan.status, 'ok');
  assert.equal(scan.payload!.projects.length, 2);
  assert.equal(scan.payload!.projects[0]!.url, 'https://www.guru.com/jobs/shopify-react-integration/201');
  assert.equal(scan.payload!.projects[1]!.description, undefined);
  assert.equal(validateScan(scan.payload).projects.length, 2);
});

test('PeoplePerHour BEM cards, h6 titles and repeated unknown wrappers extract without navigation or metadata bleed', () => {
  const result = extractProjects(fixture('peopleperhour-layouts.html'), 'https://www.peopleperhour.com/freelance-jobs');
  assert.equal(result.status, 'ok');
  const projects = result.payload!.projects;
  assert.deepEqual(projects.map(p => p.sourceId), ['401', '402', '403', '404']);
  assert.equal(projects[0]!.title, 'Python API integration');
  assert.equal(projects[0]!.budget, '£750 fixed');
  assert.equal(projects[0]!.description, 'Connect an existing Python service.');
  assert.equal(projects[0]!.publishedAt, 'Posted 10 minutes ago');
  assert.deepEqual(projects[0]!.skills, ['Python', 'API']);
  assert.ok(!projects[0]!.url.includes('?'));
  assert.equal(projects[1]!.budget, undefined);
  assert.equal(projects[1]!.description, undefined);
  assert.equal(projects[1]!.publishedAt, undefined);
  assert.equal(projects[2]!.budget, '$200');
  assert.equal(projects[3]!.budget, '$400');
  assert.equal(projects[3]!.title, 'PHP project');
  assert.equal(validateScan(result.payload).projects.length, 4);
});

test('semantic fallback recognizes repeated cards directly under main but never merges different project IDs', () => {
  const document = parseHTML('<html><body><main><div><h6><a href="/freelance-jobs/first-501">First</a></h6><span class="budget">£100</span></div><div><h6><a href="/freelance-jobs/second-502">Second</a></h6></div></main></body></html>').document as unknown as Document;
  const result = extractProjects(document, 'https://www.peopleperhour.com/freelance-jobs');
  assert.equal(result.payload!.projects.length, 2);
  assert.equal(result.payload!.projects[0]!.budget, '£100');
  assert.equal(result.payload!.projects[1]!.budget, undefined);
  const mixed = parseHTML('<html><body><article><h6><a href="/freelance-jobs/first-501">First</a></h6><h6><a href="/freelance-jobs/second-502">Second</a></h6><span class="budget">£999</span></article></body></html>').document as unknown as Document;
  assert.equal(extractProjects(mixed, 'https://www.peopleperhour.com/freelance-jobs').payload, undefined);
});

test('developer structure report contains layout only and redacts account, URL, text and attribute sentinels', () => {
  const document = parseHTML('<html><body><main class="job-list account-AlicePrivate secret-token-XY123" id="private-account-id"><div class="job-list-item account-AlicePrivate"><h6><a href="/freelance-jobs/private-title-731234?token=private-cookie-value" data-token="secret-credential">PRIVATE PROJECT TITLE</a></h6></div><div class="job-list-item"><h6><a href="/freelance-jobs/other-private-731235">OTHER PRIVATE TITLE</a></h6></div></main></body></html>').document as unknown as Document;
  const report = structureReport(document, 'https://www.peopleperhour.com/freelance-jobs');
  const serialized = JSON.stringify(report);
  assert.ok(serialized.includes('job-list-item'));
  assert.ok(serialized.includes('h6'));
  for (const secret of ['AlicePrivate', 'secret-token', 'XY123', 'private-account-id', '731234', '731235', 'private-cookie-value', 'secret-credential', 'PRIVATE', 'href', 'https://']) assert.ok(!serialized.includes(secret), secret);
  const blocked = structureReport(fixture('verification.html'), 'https://www.peopleperhour.com/freelance-jobs');
  assert.equal(blocked.status, 'verification_required');
  assert.deepEqual(blocked.samples, []);
});
test('extraction distinguishes visible links with unsupported card layout from an empty page', () => {
  const document = parseHTML('<html><body><div class="unknown-layout"><h2><a href="/freelance-jobs/python-api-999">Python API</a></h2></div></body></html>').document as unknown as Document;
  const result = extractProjects(document, 'https://www.peopleperhour.com/freelance-jobs');
  assert.equal(result.status, 'no_projects');
  assert.equal(result.diagnostics!.visibleProjectLinks, 1);
  assert.equal(result.diagnostics!.matchedCards, 0);
  assert.match(result.detail, /layout was not recognized/);
  assert.equal(result.payload, undefined);
});
test('login, verification, unsupported and empty pages never produce an ingestion payload', () => {
  assert.equal(extractProjects(fixture('login.html'), 'https://www.guru.com/work/').status, 'login_required');
  assert.equal(extractProjects(fixture('login.html'), 'https://www.guru.com/login.aspx?ReturnUrl=/work/').status, 'login_required');
  const verification = extractProjects(fixture('verification.html'), 'https://www.peopleperhour.com/freelance-jobs');
  assert.equal(verification.status, 'verification_required');
  assert.equal(verification.payload, undefined);
  assert.equal(extractProjects(fixture('guru.html'), 'https://evil.example/work/').status, 'unsupported');
  const empty = parseHTML('<html><body><h1>Find jobs</h1></body></html>').document as unknown as Document;
  assert.equal(extractProjects(empty, 'https://www.guru.com/work/').status, 'no_projects');
});

test('real-style card footer ages are extracted on both platforms without sidebar links blocking completeness', () => {
  for (const [platform, pageUrl, prefix, age] of [
    ['PeoplePerHour', 'https://www.peopleperhour.com/freelance-jobs', '/freelance-jobs/project-', '7 minutes ago'],
    ['Guru', 'https://www.guru.com/work/', '/jobs/project/', 'Posted 7 mins ago \u00b7 2 Quotes Received'],
  ] as const) {
    const { document } = parseHTML(`<html><body><nav><h2><a href="${prefix}999">Unrelated navigation project</a></h2></nav><div class="loader">Unrelated page widget</div><main><section>
      <article class="project-card"><h2><a href="${prefix}1">Pinned older project</a></h2><footer><span>4 hours ago</span><span>7 proposals</span></footer></article>
      <article class="project-card"><h2><a href="${prefix}2">New project</a></h2><p class="description">We reviewed a proposal 12 minutes ago.</p><footer><span>${age}</span></footer></article>
    </section></main></body></html>`);
    Object.defineProperty(document, 'readyState', { value: 'complete' });
    for (const source of ['dom', 'html'] as const) {
      const result = extractProjects(document as unknown as Document, pageUrl, source);
      assert.equal(result.status, 'ok', platform); assert.equal(result.payload!.projects.length, 2);
      assert.equal(result.payload!.projects[1]!.publishedAt, age); assert.equal(result.payload!.listing!.completeness, 'complete');
    }
  }
});

test('unknown publication text in descriptions cannot become a publication timestamp', () => {
  const { document } = parseHTML('<html><body><article class="project-card"><h2><a href="/freelance-jobs/project-2">Project</a></h2><p class="description"><span>7 minutes ago</span></p></article></body></html>');
  assert.equal(extractProjects(document as unknown as Document, 'https://www.peopleperhour.com/freelance-jobs').payload!.projects[0]!.publishedAt, undefined);
});

test('publication reader includes sibling footers outside an inner card without borrowing another project age', () => {
  for (const [url, prefix] of [['https://www.peopleperhour.com/freelance-jobs', '/freelance-jobs/project-'], ['https://www.guru.com/work/', '/jobs/project/']] as const) {
    const { document } = parseHTML(`<html><body><main><section>
      <div class="outer"><div data-project-id="1"><h2><a href="${prefix}1">Pinned old project</a></h2></div><footer>4 hours ago <span>7 proposals</span></footer></div>
      <div class="outer"><div data-project-id="2"><h2><a href="${prefix}2">New project</a></h2></div><footer><small><span>7</span> minutes ago</small><span>1 proposal</span></footer></div>
    </section></main></body></html>`);
    const result = extractProjects(document as unknown as Document, url, 'html');
    assert.match(result.payload!.projects[0]!.publishedAt!, /^4 hours ago(?: 7 proposals)?$/);
    assert.match(result.payload!.projects[1]!.publishedAt!, /^7 minutes ago/);
  }
});
