export interface AccountProfile {
  id: string;
  email: string;
  username: string;
  createdAt: string;
}

export interface AuthResult {
  account: AccountProfile;
  token: string;
}

export interface AuthService {
  initialize?(): Promise<void>;
  register(input: { email: string; username: string; password: string }): Promise<AuthResult>;
  login(input: { identifier: string; password: string }): Promise<AuthResult>;
  getAccountByToken(token: string): Promise<AccountProfile | null>;
}
