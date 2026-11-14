import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { parseHTML } from 'linkedom';

test('DOM observation scans changed visible cards, preserves Scan Now and never retrieves or refreshes pages', async () => {
  const { document } = parseHTML(readFileSync('tests/fixtures/extension/peopleperhour.html', 'utf8'));
  Object.defineProperty(document, 'visibilityState', { value: 'visible', writable: true });
  const timers = new Map<number, () => void>(); let sequence = 0;
  let mutation!: () => void;
  let listener!: (message: { type: string; enabled?: boolean }, sender: { id: string }, reply: (value: unknown) => void) => void;
  const messages: { type: string; extraction: { status: string; payload?: { projects: unknown[] } } }[] = [];
  let networkCalls = 0;
  const source = readFileSync(resolve('extension/dist/content.js'), 'utf8');
  runInNewContext(source, {
    URL,
    document, location: { href: 'https://www.peopleperhour.com/freelance-jobs', reload: () => { throw new Error('Unexpected page refresh'); } },
    MutationObserver: class { constructor(callback: () => void) { mutation = callback; } observe() {} },
    setTimeout: (fn: () => void, _ms: number) => { const id = ++sequence; timers.set(id, fn); return id; },
    clearTimeout: (id: number) => { timers.delete(id); },
    fetch: () => { networkCalls++; throw new Error('Unexpected website retrieval'); },
    chrome: { runtime: { id: 'self', onMessage: { addListener: (fn: typeof listener) => { listener = fn; } },
      sendMessage: async (message: typeof messages[number]) => { if (message.type === 'GET_SCAN_STATE') return { enabled: true }; messages.push(message); return { accepted: true }; } } },
  });
  const flush = async () => {
    const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(fn => fn());
    await new Promise<void>(done => setImmediate(done));
  };
  await flush();
  assert.equal(messages.length, 1);
  mutation(); mutation(); await flush();
  assert.equal(messages.length, 1); // unchanged successful snapshots stay quiet
  document.body.insertAdjacentHTML('beforeend', '<article class="project-card"><h2><a href="/freelance-jobs/new-python-999">New Python job</a></h2></article>');
  mutation(); await flush();
  assert.equal(messages.length, 2);
  assert.equal(messages[1]!.extraction.payload!.projects.length, 3);
  let manual: unknown;
  listener({ type: 'SCAN_PAGE' }, { id: 'self' }, value => { manual = value; });
  assert.equal((manual as { status: string }).status, 'ok');
  document.body.insertAdjacentHTML('afterbegin', '<h1>Verify that you are not a robot</h1>');
  mutation(); await flush();
  assert.equal(messages.at(-1)!.extraction.status, 'verification_required');
  assert.equal(messages.at(-1)!.extraction.payload, undefined);
  assert.equal(networkCalls, 0);
  listener({ type: 'SCAN_STATE_CHANGED', enabled: false }, { id: 'self' }, () => {});
  const stoppedCount = messages.length;
  mutation(); await flush();
  assert.equal(messages.length, stoppedCount);
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', writable: true });
  listener({ type: 'SCAN_STATE_CHANGED', enabled: true }, { id: 'self' }, () => {});
  await flush();
  assert.equal(messages.length, stoppedCount + 1); // Background tabs are no longer excluded.
});
