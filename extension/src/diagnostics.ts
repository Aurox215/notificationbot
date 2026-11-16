export class DiagnosticError extends Error {
  constructor(readonly code: string, readonly stage: string, message: string, readonly httpStatus?: number) { super(message); }
}
export function diagnostic(error: unknown): DiagnosticError {
  // Never expose raw Chrome/fetch exceptions, URLs, headers, credentials, or response bodies.
  return error instanceof DiagnosticError ? error : new DiagnosticError('unexpected_error', 'extension', 'Unexpected extension error. Reload the extension and manually refresh the listing tab, then scan again.');
}
