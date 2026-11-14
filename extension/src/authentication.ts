/** No platform credential values are read, stored or included in this state. */
export type AuthenticationState = 'authenticated' | 'expired/logged_out' | 'unknown';
export interface AuthenticationObservation {
  state: AuthenticationState;
  reason: 'authentication_rejected' | 'login_required' | 'explicit_logout' | 'unverified';
}
export const unknownAuthentication = (): AuthenticationObservation => ({ state: 'unknown', reason: 'unverified' });

// There is currently no verified positive session-check mechanism for either site.
// Successful extraction, HTTP 200, cookies and redirect presence cannot prove login.
export function authenticationFromResult(status: string): AuthenticationObservation {
  return status === 'login_required'
    ? { state: 'expired/logged_out', reason: 'login_required' }
    : unknownAuthentication();
}
