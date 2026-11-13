export class DiagnosticError extends Error {
  constructor(readonly code: string, readonly stage: string, message: string, readonly httpStatus?: number) { super(message); }
}
export function diagnostic(error: unknown): DiagnosticError {
  // Never expose raw Chrome/fetch exceptions, URLs, headers, credentials, or response bodies.
  return error instanceof DiagnosticError ? error : new DiagnosticError('unexpected_error', 'extension', 'Unexpected extension error. Reload the extension and manually refresh the listing tab, then scan again.');
}
export function httpFailure(status: number, ingest: boolean): DiagnosticError {
  if (status === 401) return new DiagnosticError('authentication_expired', 'authentication', 'Authentication expired or was revoked. Connect Telegram again.', status);
  if (status === 410) return new DiagnosticError('pairing_expired', 'pairing', 'Pairing expired or was already claimed. Connect Telegram again.', status);
  if (status === 403) return new DiagnosticError('request_forbidden', 'authorization', 'Backend refused this request (HTTP 403). Check the server origin/proxy configuration; this does not prove the session expired.', status);
  if (status === 429) return new DiagnosticError('rate_limited', 'network', 'Backend rate limit reached. Wait a minute before scanning again.', status);
  if (ingest && [400, 413, 415].includes(status)) return new DiagnosticError('scan_rejected', 'validation', `Scan rejected by backend validation (HTTP ${status}). No successful ingestion was confirmed.`, status);
  if (status >= 500) return new DiagnosticError('ingestion_failed', 'ingestion', `Backend returned HTTP ${status}. Ingestion was not confirmed. You can safely scan again after the server issue is fixed.`, status);
  return new DiagnosticError('request_rejected', 'network', `Backend rejected the request (HTTP ${status}).`, status);
}
