import { randomBytes, createHash } from 'node:crypto';
import type { Store } from '../persistence/store.js';

export const hashSecret = (secret: string) => createHash('sha256').update(secret).digest('hex');
const secret = () => randomBytes(32).toString('base64url');
// SQL stays behind Store. A future PostgreSQL implementation can implement this contract.
export type AccountRepository = Pick<Store, 'createPairing' | 'proposePairing' | 'approvePairing' | 'claimPairing' | 'sessionUser' | 'revokeSession' | 'disconnectUser'>;
export class AccountLinks {
  constructor(private readonly repository: AccountRepository, private readonly botUsername: string, private readonly now: () => number = Date.now) {}
  start(pollSecret: string) {
    if (!/^[A-Za-z0-9_-]{43,128}$/.test(pollSecret)) throw new Error('invalid_proof');
    const pairingId = randomBytes(16).toString('hex');
    const linkSecret = secret();
    const confirmationCode = randomBytes(4).toString('hex').toUpperCase();
    const expiresAt = this.now() + 5 * 60 * 1000;
    this.repository.createPairing(pairingId, hashSecret(linkSecret), hashSecret(pollSecret), confirmationCode, expiresAt, this.now());
    return { pairingId, confirmationCode, expiresAt, telegramUrl: `https://t.me/${this.botUsername}?start=aurox_${linkSecret}` };
  }
  propose(payload: string, userId: string): string | undefined {
    if (!/^aurox_[A-Za-z0-9_-]{43}$/.test(payload)) return undefined;
    return this.repository.proposePairing(hashSecret(payload.slice(6)), userId, this.now());
  }
  approve(userId: string, code: string): boolean {
    return /^[A-F0-9]{8}$/.test(code) && this.repository.approvePairing(userId, code, this.now());
  }
  claim(pairingId: string, pollSecret: string) {
    if (!/^[a-f0-9]{32}$/.test(pairingId) || !/^[A-Za-z0-9_-]{43,128}$/.test(pollSecret)) return { status: 'invalid' as const };
    const sessionToken = secret();
    const expiresAt = this.now() + 30 * 24 * 60 * 60 * 1000;
    const status = this.repository.claimPairing(pairingId, hashSecret(pollSecret), randomBytes(16).toString('hex'), hashSecret(sessionToken), expiresAt, this.now());
    return status === 'connected' ? { status, sessionToken, expiresAt } : { status };
  }
  authenticate(authorization: string | undefined): string | undefined {
    if (!authorization || !/^Bearer [A-Za-z0-9_-]{43}$/.test(authorization)) return undefined;
    return this.repository.sessionUser(hashSecret(authorization.slice(7)), this.now());
  }
  revoke(authorization: string): void { this.repository.revokeSession(hashSecret(authorization.slice(7))); }
  disconnect(userId: string): void { this.repository.disconnectUser(userId); }
}
