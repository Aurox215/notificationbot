import type { ProjectSource, SourceProject } from './types.js';

export interface PeoplePerHourSource extends ProjectSource { readonly platform: 'PeoplePerHour' }
export class MockPeoplePerHourSource implements PeoplePerHourSource {
  readonly platform = 'PeoplePerHour' as const;
  async fetchProjects(signal: AbortSignal): Promise<SourceProject[]> {
    signal.throwIfAborted();
    return [{ sourceId: 'mock-pph-1', platform: this.platform,
      title: '[MOCK] Python AI automation', category: 'Synthetic web development',
      budget: 'Synthetic: £500', skills: ['Python', 'AI', 'API'],
      description: 'Synthetic fixture for testing. Not a real job.',
      client: { ratingScore: 'Synthetic: 4.9 / 5', reviewCount: 12, joinedAt: 'Synthetic: January 2024' },
      url: 'https://example.com/mock/peopleperhour/1', detectedAt: new Date() }];
  }
}
