import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseHTML } from 'linkedom';
import { extractProjects } from '../extension/src/extractor.js';
import { validateScan } from '../src/ingestion/schema.js';
const fixture = (name: string) => parseHTML(readFileSync(join(process.cwd(), 'tests/fixtures/extension', name), 'utf8')).document as unknown as Document;

test('PeoplePerHour fixture extracts visible cards, canonical identities, optional fields and no hidden text', () => {
  const scan = extractProjects(fixture('peopleperhour.html'), 'https://www.peopleperhour.com/freelance-jobs');
  assert.equal(scan.status, 'ok');
  const projects = scan.payload!.projects;
  assert.equal(projects.length, 2);
  assert.equal(projects[0]!.sourceId, '101');
  assert.equal(projects[0]!.title, 'Python automation & API');
  assert.equal(projects[0]!.budget, '£500 fixed');
  assert.equal(projects[0]!.description, 'Build a Python API automation.');
  assert.equal(projects[0]!.publishedAt, 'Posted 5 minutes ago');
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
