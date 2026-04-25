import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";

export interface AccountProfile {
  id: string;
  email: string;
  username: string;
  createdAt: string;
}

interface UserRecord extends AccountProfile {
  passwordHash: string;
  passwordSalt: string;
}

interface SessionRecord {
  token: string;
  userId: string;
  createdAt: string;
}

export class InMemoryAuthService {
  private readonly usersById = new Map<string, UserRecord>();
  private readonly sessionsByToken = new Map<string, SessionRecord>();

  register(input: { email: string; username: string; password: string }): { account: AccountProfile; token: string } {
    const email = normalizeEmail(input.email);
    const username = input.username.trim();

    if (username.length < 3) {
      throw new Error("Username must contain at least 3 characters.");
    }

    if (input.password.length < 8) {
      throw new Error("Password must contain at least 8 characters.");
    }

    if ([...this.usersById.values()].some((user) => user.email === email)) {
      throw new Error("Email address is already registered.");
    }

    if ([...this.usersById.values()].some((user) => user.username.toLowerCase() === username.toLowerCase())) {
      throw new Error("Username is already taken.");
    }

    const now = new Date().toISOString();
    const passwordSalt = randomBytes(16).toString("hex");
    const passwordHash = hashPassword(input.password, passwordSalt);
    const account: UserRecord = {
      id: `acct_${randomUUID()}`,
      email,
      username,
      passwordHash,
      passwordSalt,
      createdAt: now,
    };

    this.usersById.set(account.id, account);

    return {
      account: toAccountProfile(account),
      token: this.issueSession(account.id),
    };
  }

  login(input: { identifier: string; password: string }): { account: AccountProfile; token: string } {
    const identifier = input.identifier.trim().toLowerCase();
    const account = [...this.usersById.values()].find(
      (user) => user.email === identifier || user.username.toLowerCase() === identifier
    );

    if (!account) {
      throw new Error("Invalid credentials.");
    }

    const expected = Buffer.from(account.passwordHash, "hex");
    const provided = Buffer.from(hashPassword(input.password, account.passwordSalt), "hex");

    if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
      throw new Error("Invalid credentials.");
    }

    return {
      account: toAccountProfile(account),
      token: this.issueSession(account.id),
    };
  }

  getAccountByToken(token: string): AccountProfile | null {
    const session = this.sessionsByToken.get(token);

    if (!session) {
      return null;
    }

    const account = this.usersById.get(session.userId);
    return account ? toAccountProfile(account) : null;
  }

  private issueSession(userId: string): string {
    const token = `session_${randomUUID()}`;
    this.sessionsByToken.set(token, {
      token,
      userId,
      createdAt: new Date().toISOString(),
    });
    return token;
  }
}

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 64).toString("hex");
}

function normalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase();

  if (!normalized.includes("@")) {
    throw new Error("Email address must be valid.");
  }

  return normalized;
}

function toAccountProfile(user: UserRecord): AccountProfile {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    createdAt: user.createdAt,
  };
}
