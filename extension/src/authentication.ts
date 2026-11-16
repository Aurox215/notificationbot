/** Only the verification outcome is stored; platform credentials stay in the browser. */
export type AuthenticationState = 'authenticated' | 'expired/logged_out' | 'unknown';
export interface AuthenticationObservation {
  state: AuthenticationState;
  reason: 'authentication_rejected' | 'login_required' | 'explicit_logout' | 'unverified' | 'api_authenticated' | 'api_rejected';
}
