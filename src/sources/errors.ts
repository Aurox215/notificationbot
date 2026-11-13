export type SourceErrorCode = 'network' | 'timeout' | 'rate_limit' | 'authentication' | 'permission' | 'configuration' | 'invalid_data' | 'unexpected';

export class SourceError extends Error {
  constructor(readonly code: SourceErrorCode, readonly retryAfterMs = 0) {
    // Deliberately no raw upstream error message: it may contain credentials or response data.
    super(`Project source error: ${code}`);
  }
  get retryable(): boolean { return !['authentication', 'permission', 'configuration'].includes(this.code); }
}
