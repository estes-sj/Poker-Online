import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

import { prisma } from "../../../../packages/db/src/index.js";
import { getGuestMode, readRoomAllowGuestsOption, roomAllowsGuests } from "../../../../packages/db/src/guest-policy.js";
import { getRoomCreationAdminConfig, isConfiguredRoomCreationAdmin } from "../../../../packages/db/src/room-creation-policy.js";
import type { PrismaClient } from "@prisma/client";

import { ForbiddenError, type AccountProfile, type AuthResult, type AuthService, type DeviceLinkCode, type GuestAuthResult } from "./auth-service.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const SESSION_TTL_DAYS = 7;
const GUEST_SESSION_TTL_DAYS = 90;
const LAST_SEEN_UPDATE_INTERVAL_MS = 60 * 60 * 1000;
const DEVICE_LINK_TTL_MS = 10 * 60 * 1000;
const DEVICE_LINK_CODE_LENGTH = 6;
const RECOVERY_CODE_LENGTH = 12;
const GUEST_EMAIL_DOMAIN = "guest.invalid";
// Guests never sign in with a password; this value can never match verifyPassword.
const GUEST_PASSWORD_HASH = "guest";
// Crockford base32 without I, L, O and U, so codes are easy to read aloud and type.
const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

type PrismaClientLike = PrismaClient;

export class PrismaAuthService implements AuthService {
  private configuredAdminInitPromise: Promise<void> | null = null;

  constructor(private readonly database: PrismaClientLike = prisma) {}

  async initialize(): Promise<void> {
    await this.ensureConfiguredAdminAccount();
  }

  async register(input: { email: string; username: string; password: string }): Promise<AuthResult> {
    await this.ensureConfiguredAdminAccount();
    const email = normalizeEmail(input.email);
    const username = input.username.trim();

    if (username.length < 3) {
      throw new Error("Username must contain at least 3 characters.");
    }

    if (input.password.length < 8) {
      throw new Error("Password must contain at least 8 characters.");
    }

    try {
      const user = await this.database.user.create({
        data: {
          email,
          username,
          passwordHash: hashPassword(input.password),
        },
      });

      const token = await this.issueSession(user.id);
      return {
        account: toAccountProfile(user),
        token,
      };
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        const target = Array.isArray(error.meta?.target) ? error.meta.target : [];

        if (target.includes("email")) {
          throw new Error("Email address is already registered.");
        }

        if (target.includes("username")) {
          throw new Error("Username is already taken.");
        }
      }

      throw error instanceof Error ? error : new Error("Unable to register account.");
    }
  }

  async login(input: { identifier: string; password: string }): Promise<AuthResult> {
    await this.ensureConfiguredAdminAccount();
    const identifier = input.identifier.trim().toLowerCase();
    const user = await this.database.user.findFirst({
      where: {
        OR: [
          { email: identifier },
          { username: { equals: identifier, mode: "insensitive" } },
        ],
      },
    });

    if (!user || !verifyPassword(input.password, user.passwordHash)) {
      throw new Error("Invalid credentials.");
    }

    const token = await this.issueSession(user.id);
    return {
      account: toAccountProfile(user),
      token,
    };
  }

  async getAccountByToken(token: string): Promise<AccountProfile | null> {
    const tokenHash = hashSessionToken(token);
    const session = await this.database.session.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    const now = Date.now();

    if (!session || session.expiresAt.getTime() <= now) {
      return null;
    }

    // Sliding expiry: active sessions are extended once they pass half of their lifetime.
    const ttlMs = getSessionTtlDays(session.user.isGuest) * DAY_MS;

    if (session.expiresAt.getTime() - now < ttlMs / 2) {
      await this.database.session.update({
        where: { id: session.id },
        data: { expiresAt: new Date(now + ttlMs) },
      });
    }

    if (!session.user.lastSeenAt || now - session.user.lastSeenAt.getTime() > LAST_SEEN_UPDATE_INTERVAL_MS) {
      await this.database.user.update({
        where: { id: session.user.id },
        data: { lastSeenAt: new Date(now) },
      });
    }

    return toAccountProfile(session.user);
  }

  async createGuest(input: { displayName: string; roomSlug?: string }): Promise<GuestAuthResult> {
    const displayName = input.displayName.trim().replace(/\s+/g, " ");

    if (displayName.length < 2 || displayName.length > 24) {
      throw new Error("Display name must be between 2 and 24 characters.");
    }

    await this.assertGuestsAllowed(input.roomSlug);

    const recoveryCode = generateCode(RECOVERY_CODE_LENGTH);
    const usernameBase = toUsernameBase(displayName);

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const suffix = randomBytes(4).readUInt32BE(0) % 10_000;

      try {
        const user = await this.database.user.create({
          data: {
            email: `guest-${randomBytes(12).toString("hex")}@${GUEST_EMAIL_DOMAIN}`,
            username: `${usernameBase}-${String(suffix).padStart(4, "0")}`,
            passwordHash: GUEST_PASSWORD_HASH,
            isGuest: true,
            displayName,
            recoveryCodeHash: hashCode(recoveryCode),
            lastSeenAt: new Date(),
          },
        });

        const token = await this.issueSession(user.id, true);
        return {
          account: toAccountProfile(user),
          token,
          recoveryCode: formatRecoveryCode(recoveryCode),
        };
      } catch (error) {
        if (!isUniqueConstraintError(error)) {
          throw error;
        }
      }
    }

    throw new Error("Unable to create a guest right now. Try again.");
  }

  async recoverGuest(input: { recoveryCode: string }): Promise<AuthResult> {
    const user = await this.database.user.findUnique({
      where: { recoveryCodeHash: hashCode(normalizeCode(input.recoveryCode)) },
    });

    if (!user || !user.isGuest) {
      throw new Error("That recovery code is not valid.");
    }

    const token = await this.issueSession(user.id, true);
    return { account: toAccountProfile(user), token };
  }

  async rotateGuestRecoveryCode(token: string): Promise<{ recoveryCode: string }> {
    const account = await this.requireAccount(token);

    if (!account.isGuest) {
      throw new ForbiddenError("Only guest accounts use recovery codes.");
    }

    const recoveryCode = generateCode(RECOVERY_CODE_LENGTH);
    await this.database.user.update({
      where: { id: account.id },
      data: { recoveryCodeHash: hashCode(recoveryCode) },
    });

    return { recoveryCode: formatRecoveryCode(recoveryCode) };
  }

  async createDeviceLinkCode(token: string): Promise<DeviceLinkCode> {
    const account = await this.requireAccount(token);
    const expiresAt = new Date(Date.now() + DEVICE_LINK_TTL_MS);

    // Only the newest unused code stays valid for an account.
    await this.database.deviceLinkCode.deleteMany({ where: { userId: account.id, usedAt: null } });

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const code = generateCode(DEVICE_LINK_CODE_LENGTH);

      try {
        await this.database.deviceLinkCode.create({
          data: {
            userId: account.id,
            codeHash: hashCode(code),
            expiresAt,
          },
        });

        return { code, expiresAt: expiresAt.toISOString() };
      } catch (error) {
        if (!isUniqueConstraintError(error)) {
          throw error;
        }
      }
    }

    throw new Error("Unable to create a device code right now. Try again.");
  }

  async claimDeviceLinkCode(input: { code: string }): Promise<AuthResult> {
    const now = new Date();
    const codeHash = hashCode(normalizeCode(input.code));

    // updateMany makes the claim atomic: a code can only be used once.
    const claimed = await this.database.deviceLinkCode.updateMany({
      where: { codeHash, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });

    if (claimed.count !== 1) {
      throw new Error("That code is not valid or has expired.");
    }

    const linkCode = await this.database.deviceLinkCode.findUnique({
      where: { codeHash },
      include: { user: true },
    });

    if (!linkCode) {
      throw new Error("That code is not valid or has expired.");
    }

    const token = await this.issueSession(linkCode.userId, linkCode.user.isGuest);
    return { account: toAccountProfile(linkCode.user), token };
  }

  async upgradeGuest(token: string, input: { email: string; username?: string; password: string }): Promise<AuthResult> {
    const account = await this.requireAccount(token);

    if (!account.isGuest) {
      throw new ForbiddenError("This account is already a full account.");
    }

    const email = normalizeEmail(input.email);
    const username = input.username?.trim() || account.username;

    if (username.length < 3) {
      throw new Error("Username must contain at least 3 characters.");
    }

    if (input.password.length < 8) {
      throw new Error("Password must contain at least 8 characters.");
    }

    try {
      const user = await this.database.user.update({
        where: { id: account.id },
        data: {
          email,
          username,
          passwordHash: hashPassword(input.password),
          isGuest: false,
          recoveryCodeHash: null,
        },
      });

      // Existing guest sessions keep working, now on the registered account's lifetime.
      return { account: toAccountProfile(user), token };
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        const target = Array.isArray(error.meta?.target) ? error.meta.target : [];

        if (target.includes("email")) {
          throw new Error("Email address is already registered.");
        }

        if (target.includes("username")) {
          throw new Error("Username is already taken.");
        }
      }

      throw error instanceof Error ? error : new Error("Unable to upgrade this account.");
    }
  }

  private async requireAccount(token: string): Promise<AccountProfile> {
    const account = await this.getAccountByToken(token);

    if (!account) {
      throw new ForbiddenError("Your session has expired. Sign in again to continue.");
    }

    return account;
  }

  private async assertGuestsAllowed(roomSlug?: string): Promise<void> {
    const mode = await getGuestMode(this.database);

    if (mode === "off") {
      throw new ForbiddenError("Guest play is turned off on this site.");
    }

    if (mode === "all") {
      return;
    }

    const room = roomSlug
      ? await this.database.room.findUnique({ where: { slug: roomSlug }, select: { status: true, runtimeState: true } })
      : null;

    if (!room || room.status === "ARCHIVED" || !roomAllowsGuests(mode, readRoomAllowGuestsOption(room.runtimeState))) {
      throw new ForbiddenError("This table requires a full account.");
    }
  }

  private async ensureConfiguredAdminAccount(): Promise<void> {
    if (!this.configuredAdminInitPromise) {
      this.configuredAdminInitPromise = this.upsertConfiguredAdminAccount().catch((error) => {
        this.configuredAdminInitPromise = null;
        throw error;
      });
    }

    await this.configuredAdminInitPromise;
  }

  private async upsertConfiguredAdminAccount(): Promise<void> {
    const config = getRoomCreationAdminConfig();
    const hasExplicitAdminConfig = Boolean(config.adminUsername || config.adminPassword);

    if (!config.adminOnly && !hasExplicitAdminConfig) {
      return;
    }

    if (!config.adminUsername || !config.adminPassword) {
      throw new Error("ROOM_CREATION_ADMIN_USERNAME and ROOM_CREATION_ADMIN_PASSWORD must both be set when configuring the room-creation admin account.");
    }

    const existingUser = await this.database.user.findFirst({
      where: {
        username: {
          equals: config.adminUsername,
          mode: "insensitive",
        },
      },
      select: {
        id: true,
        username: true,
        passwordHash: true,
      },
    });

    if (existingUser) {
      if (isConfiguredRoomCreationAdmin(existingUser.username, config.adminUsername) && verifyPassword(config.adminPassword, existingUser.passwordHash)) {
        return;
      }

      await this.database.user.update({
        where: { id: existingUser.id },
        data: {
          username: config.adminUsername,
          passwordHash: hashPassword(config.adminPassword),
        },
      });
      return;
    }

    await this.database.user.create({
      data: {
        email: config.adminEmail ?? "table.admin@local.poker",
        username: config.adminUsername,
        passwordHash: hashPassword(config.adminPassword),
      },
    });
  }

  private async issueSession(userId: string, isGuest = false): Promise<string> {
    const token = `session_${randomBytes(32).toString("hex")}`;
    const expiresAt = new Date(Date.now() + getSessionTtlDays(isGuest) * DAY_MS);

    await this.database.session.create({
      data: {
        userId,
        tokenHash: hashSessionToken(token),
        expiresAt,
      },
    });

    return token;
  }
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, existingHash] = storedHash.split(":");

  if (!salt || !existingHash) {
    return false;
  }

  const expected = Buffer.from(existingHash, "hex");
  const provided = Buffer.from(scryptSync(password, salt, 64).toString("hex"), "hex");

  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

function normalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase();

  if (!normalized.includes("@")) {
    throw new Error("Email address must be valid.");
  }

  return normalized;
}

function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function toAccountProfile(user: { id: string; email: string; username: string; displayName: string | null; isGuest: boolean; createdAt: Date }): AccountProfile {
  return {
    id: user.id,
    email: user.isGuest ? null : user.email,
    username: user.username,
    displayName: user.displayName ?? user.username,
    isGuest: user.isGuest,
    createdAt: user.createdAt.toISOString(),
  };
}

function getSessionTtlDays(isGuest: boolean): number {
  return isGuest ? GUEST_SESSION_TTL_DAYS : SESSION_TTL_DAYS;
}

function generateCode(length: number): string {
  const bytes = randomBytes(length);
  let code = "";

  for (const byte of bytes) {
    code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  }

  return code;
}

/** Accepts codes typed with dashes, spaces, lowercase, or the look-alike letters Crockford maps. */
function normalizeCode(code: string): string {
  return code
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
}

function formatRecoveryCode(code: string): string {
  return code.match(/.{1,4}/g)?.join("-") ?? code;
}

function hashCode(code: string): string {
  return createHash("sha256").update(`code:${code}`).digest("hex");
}

function toUsernameBase(displayName: string): string {
  const base = displayName
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 16);

  return base.length >= 2 ? base : "guest";
}

function isUniqueConstraintError(error: unknown): error is { code: string; meta?: { target?: string[] } } {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const candidate = error as { code?: string; meta?: { target?: string[] } };
  return candidate.code === "P2002";
}
