import type { ProjectAlert } from './project.js';
export type Platform = ProjectAlert['platform'];
export const platforms: Platform[] = ['PeoplePerHour', 'Guru'];
export interface SourceProject extends ProjectAlert { sourceId: string }
