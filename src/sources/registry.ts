import { MockPeoplePerHourSource } from './peopleperhour.js';
import { MockGuruSource } from './guru.js';
import type { ProjectSource } from './types.js';

// No verified project API/feed or permitted polling frequency is established.
// Add live implementations only after the evidence in docs/phase-3-live-sources.md is resolved.
export function createSources(mode: string = 'mock'): ProjectSource[] {
  if (mode === 'extension') return []; // Ingestion is manual; the scheduler only dispatches stored projects.
  if (mode !== 'mock') throw new Error('Only mock or manual extension sources are available; live authorization and frequency are unverified. See docs/phase-3-live-sources.md.');
  return [new MockPeoplePerHourSource(), new MockGuruSource()];
}
