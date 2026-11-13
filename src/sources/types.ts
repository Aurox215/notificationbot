import type { ProjectAlert } from '../domain/project.js';
export type Platform = ProjectAlert['platform'];
export const platforms: Platform[] = ['PeoplePerHour', 'Guru'];
export interface SourceProject extends ProjectAlert { sourceId: string }
export interface ProjectSource {
  readonly platform: Platform;
  fetchProjects(signal: AbortSignal): Promise<SourceProject[]>;
}
