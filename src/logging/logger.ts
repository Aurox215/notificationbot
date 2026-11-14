export interface LogFields {
  event?: string;
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
