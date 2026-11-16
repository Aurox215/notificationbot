/** Only the verification outcome is stored; platform credentials stay in the browser. */
export type AuthenticationState = 'authenticated' | 'expired/logged_out' | 'unknown';
export interface AuthenticationObservation {
  state: AuthenticationState;
  reason: 'authentication_rejected' | 'login_required' | 'explicit_logout' | 'unverified' | 'api_authenticated' | 'api_rejected';
}
export const unknownAuthentication = (): AuthenticationObservation => ({ state: 'unknown', reason: 'unverified' });

// Page extraction alone does not verify a server session.
// Successful extraction, HTTP 200, cookies and redirect presence cannot prove login.
export function authenticationFromResult(status: string): AuthenticationObservation {
  return status === 'login_required'
    ? { state: 'expired/logged_out', reason: 'login_required' }
    : unknownAuthentication();
}
