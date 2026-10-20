import type { FastifyInstance, FastifyReply } from "fastify";

import { ForbiddenError, type AuthService } from "../services/auth-service.js";
import { RateLimiter } from "../services/rate-limit.js";

const TEN_MINUTES_MS = 10 * 60 * 1000;

export async function authRoutes(app: FastifyInstance, authService: AuthService): Promise<void> {
  const codeLimiter = new RateLimiter(10, 300, TEN_MINUTES_MS);
  const loginLimiter = new RateLimiter(10, 500, TEN_MINUTES_MS);
  const guestLimiter = new RateLimiter(20, 500, TEN_MINUTES_MS);

  app.post("/v1/auth/register", async (request, reply) => {
    const body = request.body as Partial<{ email: string; username: string; password: string }>;

    try {
      const result = await authService.register({
        email: requireString(body.email, "email"),
        username: requireString(body.username, "username"),
        password: requireString(body.password, "password"),
      });

      return reply.code(201).send(result);
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : "Unable to register account.",
      });
    }
  });

  app.post("/v1/auth/login", async (request, reply) => {
    const body = request.body as Partial<{ identifier: string; password: string }>;

    if (!loginLimiter.take(request, "login")) {
      return sendTooManyAttempts(reply);
    }

    try {
      const result = await authService.login({
        identifier: requireString(body.identifier, "identifier"),
        password: requireString(body.password, "password"),
      });

      return reply.send(result);
    } catch (error) {
      return reply.code(401).send({
        error: error instanceof Error ? error.message : "Unable to sign in.",
      });
    }
  });

  app.get("/v1/auth/me", async (request, reply) => {
    const token = getBearerToken(request.headers.authorization);

    if (!token) {
      return reply.code(401).send({ error: "Missing bearer token." });
    }

    const account = await authService.getAccountByToken(token);

    if (!account) {
      return reply.code(401).send({ error: "Invalid session token." });
    }

    return reply.send({ account });
  });

  app.post("/v1/auth/guest", async (request, reply) => {
    const body = (request.body ?? {}) as Partial<{ displayName: string; roomSlug: string }>;

    if (!guestLimiter.take(request, "guest")) {
      return sendTooManyAttempts(reply);
    }

    try {
      const result = await authService.createGuest({
        displayName: requireString(body.displayName, "displayName"),
        roomSlug: typeof body.roomSlug === "string" && body.roomSlug.trim() ? body.roomSlug.trim() : undefined,
      });

      return reply.code(201).send(result);
    } catch (error) {
      return sendError(reply, error, "Unable to create a guest.");
    }
  });

  app.post("/v1/auth/guest/recover", async (request, reply) => {
    const body = (request.body ?? {}) as Partial<{ recoveryCode: string }>;

    if (!codeLimiter.take(request, "code")) {
      return sendTooManyAttempts(reply);
    }

    try {
      return reply.send(await authService.recoverGuest({ recoveryCode: requireString(body.recoveryCode, "recoveryCode") }));
    } catch (error) {
      return sendError(reply, error, "That recovery code is not valid.");
    }
  });

  app.post("/v1/auth/guest/recovery-code", async (request, reply) => {
    try {
      return reply.send(await authService.rotateGuestRecoveryCode(requireBearerToken(request.headers.authorization)));
    } catch (error) {
      return sendError(reply, error, "Unable to create a new recovery code.");
    }
  });

  app.post("/v1/auth/device-link", async (request, reply) => {
    try {
      return reply.send(await authService.createDeviceLinkCode(requireBearerToken(request.headers.authorization)));
    } catch (error) {
      return sendError(reply, error, "Unable to create a device code.");
    }
  });

  app.post("/v1/auth/device-link/claim", async (request, reply) => {
    const body = (request.body ?? {}) as Partial<{ code: string }>;

    if (!codeLimiter.take(request, "code")) {
      return sendTooManyAttempts(reply);
    }

    try {
      return reply.send(await authService.claimDeviceLinkCode({ code: requireString(body.code, "code") }));
    } catch (error) {
      return sendError(reply, error, "That code is not valid or has expired.");
    }
  });

  app.post("/v1/auth/upgrade", async (request, reply) => {
    const body = (request.body ?? {}) as Partial<{ email: string; username: string; password: string }>;

    try {
      const result = await authService.upgradeGuest(requireBearerToken(request.headers.authorization), {
        email: requireString(body.email, "email"),
        username: typeof body.username === "string" ? body.username : undefined,
        password: requireString(body.password, "password"),
      });

      return reply.send(result);
    } catch (error) {
      return sendError(reply, error, "Unable to create the full account.");
    }
  });
}

function sendError(reply: FastifyReply, error: unknown, fallbackMessage: string) {
  return reply.code(error instanceof ForbiddenError ? 403 : 400).send({
    error: error instanceof Error ? error.message : fallbackMessage,
  });
}

function sendTooManyAttempts(reply: FastifyReply) {
  return reply.code(429).send({ error: "Too many attempts. Wait a few minutes and try again." });
}

function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Field '${fieldName}' is required.`);
  }

  return value.trim();
}

function requireBearerToken(authorizationHeader?: string): string {
  const token = getBearerToken(authorizationHeader);

  if (!token) {
    throw new ForbiddenError("Sign in to continue.");
  }

  return token;
}

function getBearerToken(authorizationHeader?: string): string | null {
  if (!authorizationHeader?.startsWith("Bearer ")) {
    return null;
  }

  return authorizationHeader.slice("Bearer ".length).trim() || null;
}
