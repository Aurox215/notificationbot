import { canonicalProject } from '../shared/identity.js';
﻿import type { SourceProject } from '../shared/types.js';
import { validateScan } from '../shared/schema.js';
import type { ProjectDetails } from './detail-extractor.js';
import { DiagnosticError } from './diagnostics.js';
export async function enrichProject(project: SourceProject): Promise<ProjectDetails> {
  if (!project.url) throw new DiagnosticError('detail_missing_url', 'content_script', 'A project URL is required to read detail fields.');
  const origin = new URL(project.url).origin;
  const tabs = (await chrome.tabs.query({ url: [origin + '/*'] })).filter(tab => tab.id !== undefined && !tab.discarded && tab.status !== 'loading');
  const tab = tabs.find(tab => tab.url && canonicalProject(tab.url, project.platform)?.sourceId === project.sourceId) ?? tabs[0];
  if (tab?.id === undefined) throw new DiagnosticError('detail_tab_missing', 'content_script', 'Keep a platform tab open to read new-project details.');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([chrome.tabs.sendMessage(tab.id, { type: 'PROJECT_DETAIL', url: project.url, sourceId: project.sourceId }), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new DiagnosticError('detail_timeout', 'content_script', 'Reading project details timed out. Listing information will be used.')), 12000); })]);
    if (!result?.ok || !result.details || typeof result.details !== 'object') throw new DiagnosticError('detail_unavailable', 'content_script', 'Project detail fields could not be read. Listing information will be used.');
    // Whitelist and validate metadata; never accept a changed identity, publication cutoff or recipient from a page.
    const input = result.details as ProjectDetails;
    const fields: ProjectDetails = { ...(input.budget ? { budget: input.budget } : {}), ...(input.category ? { category: input.category } : {}), ...(input.skills ? { skills: input.skills } : {}), ...(input.description ? { description: input.description } : {}), ...(input.client ? { client: input.client } : {}) };
    validateScan({ platform: project.platform, pageUrl: origin + (project.platform === 'Guru' ? '/work/' : '/freelance-jobs'), projects: [{ ...project, ...fields }] });
    return fields;
  } finally { if (timer) clearTimeout(timer); }
}
