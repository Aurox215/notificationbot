export interface LogFields {
  event?: string;
  healthy?: boolean;
  mode?: 'extension' | 'mock';
  schedulerRunning?: boolean;
  schedulerStale?: boolean;
  lastCycleCompletedAt?: number | null;
  activeSubscribers?: number;
  pendingProjects?: number;
  lastBrowserContactAt?: number | null;
  platformStatus?: string;
  noticeType?: 'login_required' | 'recovered';
  platformAccess?: { platform: string; status: string; count: number }[];
  platform?: 'PeoplePerHour' | 'Guru';
  errorCode?: string;
  consecutiveFailures?: number;
  retryAt?: number | null;
  durationMs?: number;
  projectCount?: number;
  inserted?: number;
  baseline?: boolean;
  matching?: number;
  keywordExcluded?: number;
  alertsEnabled?: boolean;
}
export function log(level: 'info' | 'error', message: string, fields: LogFields = {}): void {
  // Fields are operational metadata only. Never pass upstream messages, URLs or credentials.
  const entry = JSON.stringify({ timestamp: new Date().toISOString(), level, message, ...fields });
  if (level === 'error') console.error(entry);
  else console.log(entry);
}
