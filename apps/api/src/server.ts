import Fastify from "fastify";
import cors from "@fastify/cors";
import { disconnectPrisma } from "../../../packages/db/src/index.js";

import { authRoutes } from "./routes/auth.js";
import { healthRoutes } from "./routes/health.js";
import { mediaRoutes } from "./routes/media.js";
import type { AuthService } from "./services/auth-service.js";
import { PrismaAuthService } from "./services/prisma-auth-service.js";

export function buildApiServer(authService: AuthService = new PrismaAuthService()) {
  const app = Fastify({ logger: true });

  app.register(cors, {
    origin: true,
  });

  app.addHook("onClose", async () => {
    await disconnectPrisma();
  });

  app.addHook("onReady", async () => {
    if (typeof authService.initialize === "function") {
      await authService.initialize();
    }
  });

  app.register(async (instance) => {
    await healthRoutes(instance);
    await authRoutes(instance, authService);
    await mediaRoutes(instance, authService);
  });

  return app;
}
