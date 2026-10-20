import Fastify from "fastify";
import cors from "@fastify/cors";
import { disconnectPrisma, prisma } from "../../../packages/db/src/index.js";

import { authRoutes } from "./routes/auth.js";
import { healthRoutes } from "./routes/health.js";
import { mediaRoutes } from "./routes/media.js";
import type { AuthService } from "./services/auth-service.js";
import { retireInactiveGuests } from "./services/guest-retirement.js";
import { PrismaAuthService } from "./services/prisma-auth-service.js";

const GUEST_RETIREMENT_INTERVAL_MS = 60 * 60 * 1000;

export function buildApiServer(authService: AuthService = new PrismaAuthService()) {
  const app = Fastify({ logger: true });
  let guestRetirementTimer: ReturnType<typeof setInterval> | null = null;

  const runGuestRetirement = () => {
    retireInactiveGuests(prisma)
      .then((summary) => {
        if (summary.retiredGuests > 0) {
          app.log.info({ summary }, "Retired inactive guest accounts");
        }
      })
      .catch((error: unknown) => {
        app.log.error(error, "Guest retirement failed");
      });
  };

  app.register(cors, {
    origin: true,
  });

  app.addHook("onClose", async () => {
    if (guestRetirementTimer) {
      clearInterval(guestRetirementTimer);
    }

    await disconnectPrisma();
  });

  app.addHook("onReady", async () => {
    if (typeof authService.initialize === "function") {
      await authService.initialize();
    }

    runGuestRetirement();
    guestRetirementTimer = setInterval(runGuestRetirement, GUEST_RETIREMENT_INTERVAL_MS);
  });

  app.register(async (instance) => {
    await healthRoutes(instance);
    await authRoutes(instance, authService);
    await mediaRoutes(instance, authService);
  });

  return app;
}
