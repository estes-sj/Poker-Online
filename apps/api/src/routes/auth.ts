import type { FastifyInstance } from "fastify";

import type { AuthService } from "../services/auth-service.js";

export async function authRoutes(app: FastifyInstance, authService: AuthService): Promise<void> {
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
}

function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Field '${fieldName}' is required.`);
  }

  return value.trim();
}

function getBearerToken(authorizationHeader?: string): string | null {
  if (!authorizationHeader?.startsWith("Bearer ")) {
    return null;
  }

  return authorizationHeader.slice("Bearer ".length).trim() || null;
}
