import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

import { prisma } from "../../../../packages/db/src/index.js";
import { getRoomCreationAdminConfig, isConfiguredRoomCreationAdmin } from "../../../../packages/db/src/room-creation-policy.js";
import type { PrismaClient } from "@prisma/client";

import type { AccountProfile, AuthResult, AuthService } from "./auth-service.js";

const SESSION_TTL_DAYS = 7;

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

    if (!session || session.expiresAt.getTime() <= Date.now()) {
      return null;
    }

    return toAccountProfile(session.user);
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

  private async issueSession(userId: string): Promise<string> {
    const token = `session_${randomBytes(32).toString("hex")}`;
    const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

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

function toAccountProfile(user: { id: string; email: string; username: string; createdAt: Date }): AccountProfile {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    createdAt: user.createdAt.toISOString(),
  };
}

function isUniqueConstraintError(error: unknown): error is { code: string; meta?: { target?: string[] } } {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const candidate = error as { code?: string; meta?: { target?: string[] } };
  return candidate.code === "P2002";
}
