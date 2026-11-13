import type { ProjectSource, SourceProject } from './types.js';

export interface GuruSource extends ProjectSource { readonly platform: 'Guru' }
export class MockGuruSource implements GuruSource {
  readonly platform = 'Guru' as const;
  async fetchProjects(signal: AbortSignal): Promise<SourceProject[]> {
    signal.throwIfAborted();
    return [{ sourceId: 'mock-guru-1', platform: this.platform,
      title: '[MOCK] React Shopify integration', category: 'Synthetic ecommerce',
      budget: 'Synthetic: $800', skills: ['React', 'Shopify', 'TypeScript'],
      description: 'Synthetic fixture for testing. Not a real job.',
      client: { ratingScore: 'Synthetic: 5 / 5', reviewCount: 0, joinedAt: 'Synthetic: March 2023' },
      url: 'https://example.com/mock/guru/1', detectedAt: new Date() }];
  }
}
