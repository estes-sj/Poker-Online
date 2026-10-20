export interface AccountProfile {
  id: string;
  /** Null for guest accounts, which have no real email address. */
  email: string | null;
  username: string;
  /** Name shown at the table. Guests pick it; registered accounts use their username. */
  displayName: string;
  isGuest: boolean;
  createdAt: string;
}

export interface AuthResult {
  account: AccountProfile;
  token: string;
}

export interface GuestAuthResult extends AuthResult {
  /** Shown to the guest once. Only its hash is stored. */
  recoveryCode: string;
}

export interface DeviceLinkCode {
  code: string;
  expiresAt: string;
}

export interface AuthService {
  initialize?(): Promise<void>;
  register(input: { email: string; username: string; password: string }): Promise<AuthResult>;
  login(input: { identifier: string; password: string }): Promise<AuthResult>;
  getAccountByToken(token: string): Promise<AccountProfile | null>;
  createGuest(input: { displayName: string; roomSlug?: string }): Promise<GuestAuthResult>;
  recoverGuest(input: { recoveryCode: string }): Promise<AuthResult>;
  rotateGuestRecoveryCode(token: string): Promise<{ recoveryCode: string }>;
  createDeviceLinkCode(token: string): Promise<DeviceLinkCode>;
  claimDeviceLinkCode(input: { code: string }): Promise<AuthResult>;
  upgradeGuest(token: string, input: { email: string; username?: string; password: string }): Promise<AuthResult>;
}

/** Thrown when a request is valid but not allowed, so routes can answer 403 instead of 400. */
export class ForbiddenError extends Error {}
