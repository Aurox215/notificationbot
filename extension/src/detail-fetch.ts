import { canonicalProject } from '../../src/ingestion/identity.js';
import type { Platform } from '../../src/sources/types.js';
import { DiagnosticError } from './diagnostics.js';
import { extractProjectDetails, type ProjectDetails } from './detail-extractor.js';
import { inertDocument } from './polling.js';
export async function fetchProjectDetails(url: string, origin: string, platform: Platform, sourceId: string,
  request: typeof fetch = fetch, parse: (html: string) => Document = inertDocument): Promise<ProjectDetails> {
  const identity = canonicalProject(url, platform);
  if (!identity || identity.sourceId !== sourceId || new URL(identity.url).origin !== origin) throw new DiagnosticError('detail_source_invalid', 'content_script', 'Project details must come from the same platform and project.');
  const response = await request.call(globalThis, identity.url, { method: 'GET', credentials: 'same-origin', redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(10000) });
  if (!response.ok || [202, 403, 429].includes(response.status) || response.type === 'opaqueredirect' || response.headers.get('x-amzn-waf-action') === 'challenge' || !(response.headers.get('content-type') ?? '').includes('text/html')) throw new DiagnosticError('detail_unavailable', 'content_script', 'The project detail page is unavailable or requires normal website access. Listing information will be used.');
  const reader = response.body?.getReader(); if (!reader) throw new DiagnosticError('detail_empty', 'content_script', 'The project detail response was empty.');
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) { const next = await reader.read(); if (next.done) break; size += next.value.length; if (size > 2 * 1024 * 1024) { await reader.cancel(); throw new DiagnosticError('detail_too_large', 'content_script', 'The project detail response exceeded the size limit.'); } chunks.push(next.value); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const details = extractProjectDetails(parse(new TextDecoder().decode(bytes)), identity.url, platform, sourceId);
  if (!details) throw new DiagnosticError('detail_unrecognized', 'content_script', 'Project detail fields could not be read. Listing information will be used.');
  return details;
}
