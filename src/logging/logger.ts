export function log(level: 'info' | 'error', message: string): void {
  const entry = JSON.stringify({ timestamp: new Date().toISOString(), level, message });
  if (level === 'error') console.error(entry);
  else console.log(entry);
}
