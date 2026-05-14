import type { FastifyInstance } from "fastify";

import type { RoomRegistry } from "../runtime/room-service.js";

export async function registerRoutes(app: FastifyInstance, registry: RoomRegistry): Promise<void> {
  app.get("/health", async () => ({
    status: "ok",
    service: "game",
    timestamp: new Date().toISOString(),
  }));

  app.get("/v1/rooms", async (_request, reply) => {
    try {
      return reply.send(await registry.listPublicRooms());
    } catch (error) {
      return reply.code(500).send({ error: getErrorMessage(error) });
    }
  });

  app.post("/v1/rooms", async (request, reply) => {
    const body = request.body as Record<string, unknown>;

    try {
      const snapshot = await registry.createRoom({
        slug: optionalString(body.slug),
        name: requireString(body.name, "name"),
        adminAccountId: requireString(body.adminAccountId, "adminAccountId"),
        sessionToken: getBearerToken(request.headers.authorization),
        clubId: optionalString(body.clubId),
        visibility: optionalVisibility(body.visibility),
        isPubliclyListed: optionalBoolean(body.isPubliclyListed),
        password: optionalString(body.password),
        maxPlayers: optionalNumber(body.maxPlayers),
        startingStack: optionalNumber(body.startingStack),
        blindSchedule: Array.isArray(body.blindSchedule) ? (body.blindSchedule as never) : undefined,
        autoStartNextHand: optionalBoolean(body.autoStartNextHand),
        autoStartDelaySeconds: optionalNumber(body.autoStartDelaySeconds),
        runItTwiceEnabled: optionalBoolean(body.runItTwiceEnabled),
      });

      return reply.code(201).send(snapshot);
    } catch (error) {
      return reply.code(400).send({ error: getErrorMessage(error) });
    }
  });

  app.post("/v1/rooms/:slug/join", async (request, reply) => {
    const body = request.body as Record<string, unknown>;

    try {
      const snapshot = await registry.joinRoom({
        slug: requireString(request.params && (request.params as Record<string, unknown>).slug, "slug"),
        accountId: optionalString(body.accountId),
        password: optionalString(body.password),
      });

      return reply.send(snapshot);
    } catch (error) {
      return reply.code(400).send({ error: getErrorMessage(error) });
    }
  });

  app.get("/v1/rooms/:slug", async (request, reply) => {
    try {
      const params = request.params as Record<string, unknown>;
      const query = request.query as Record<string, unknown>;
      return reply.send(await registry.getViewerRoomSnapshot(requireString(params.slug, "slug"), optionalString(query.accountId)));
    } catch (error) {
      return reply.code(404).send({ error: getErrorMessage(error) });
    }
  });

  app.get("/v1/clubs", async (_request, reply) => {
    try {
      return reply.send(await registry.listClubs());
    } catch (error) {
      return reply.code(500).send({ error: getErrorMessage(error) });
    }
  });

  app.get("/v1/clubs/:slug", async (request, reply) => {
    try {
      const params = request.params as Record<string, unknown>;
      const club = await registry.getClubBySlug(requireString(params.slug, "slug"));

      if (!club) {
        return reply.code(404).send({ error: "Club not found." });
      }

      return reply.send(club);
    } catch (error) {
      return reply.code(404).send({ error: getErrorMessage(error) });
    }
  });

  app.get("/v1/admin/clubs", async (request, reply) => {
    try {
      await requireManagementAdmin(registry, request.headers.authorization);
      return reply.send(await registry.listManagedClubs());
    } catch (error) {
      return reply.code(403).send({ error: getErrorMessage(error) });
    }
  });

  app.post("/v1/admin/clubs", async (request, reply) => {
    const body = request.body as Record<string, unknown>;

    let admin;

    try {
      admin = await requireManagementAdmin(registry, request.headers.authorization);
    } catch (error) {
      return reply.code(403).send({ error: getErrorMessage(error) });
    }

    try {
      return reply.code(201).send(await registry.createClub({
        name: requireString(body.name, "name"),
        ownerAccountId: admin.accountId,
      }));
    } catch (error) {
      return reply.code(400).send({ error: getErrorMessage(error) });
    }
  });

  app.get("/v1/admin/users/search", async (request, reply) => {
    const query = request.query as Record<string, unknown>;

    try {
      await requireManagementAdmin(registry, request.headers.authorization);
    } catch (error) {
      return reply.code(403).send({ error: getErrorMessage(error) });
    }

    try {
      return reply.send(await registry.searchClubUsers({
        query: requireString(query.query, "query"),
        clubId: optionalString(query.clubId),
      }));
    } catch (error) {
      return reply.code(400).send({ error: getErrorMessage(error) });
    }
  });

  app.post("/v1/admin/clubs/:clubId/members", async (request, reply) => {
    const params = request.params as Record<string, unknown>;
    const body = request.body as Record<string, unknown>;

    try {
      await requireManagementAdmin(registry, request.headers.authorization);
    } catch (error) {
      return reply.code(403).send({ error: getErrorMessage(error) });
    }

    try {
      return reply.send(await registry.addClubMember({
        clubId: requireString(params.clubId, "clubId"),
        accountId: requireString(body.accountId, "accountId"),
        role: optionalClubRole(body.role),
        canManageRooms: optionalBoolean(body.canManageRooms),
        isVisibleInLeaderboard: optionalBoolean(body.isVisibleInLeaderboard),
      }));
    } catch (error) {
      return reply.code(400).send({ error: getErrorMessage(error) });
    }
  });

  app.post("/v1/admin/clubs/:clubId/leaderboard/import-player", async (request, reply) => {
    const params = request.params as Record<string, unknown>;
    const body = request.body as Record<string, unknown>;

    try {
      await requireManagementAdmin(registry, request.headers.authorization);
    } catch (error) {
      return reply.code(403).send({ error: getErrorMessage(error) });
    }

    try {
      return reply.code(201).send(await registry.createSyntheticClubPlayer({
        clubId: requireString(params.clubId, "clubId"),
        displayName: requireString(body.displayName, "displayName"),
        totalProfit: requireNumber(body.totalProfit, "totalProfit"),
        gamesPlayed: optionalNumber(body.gamesPlayed),
      }));
    } catch (error) {
      return reply.code(400).send({ error: getErrorMessage(error) });
    }
  });

  app.post("/v1/admin/clubs/:clubId/leaderboard/:accountId", async (request, reply) => {
    const params = request.params as Record<string, unknown>;
    const body = request.body as Record<string, unknown>;

    try {
      await requireManagementAdmin(registry, request.headers.authorization);
    } catch (error) {
      return reply.code(403).send({ error: getErrorMessage(error) });
    }

    try {
      return reply.send(await registry.updateClubLeaderboardEntry({
        clubId: requireString(params.clubId, "clubId"),
        accountId: requireString(params.accountId, "accountId"),
        accountIds: optionalStringArray(body.accountIds, "accountIds"),
        displayName: optionalString(body.displayName),
        totalProfit: optionalNumber(body.totalProfit),
        gamesPlayed: optionalNumber(body.gamesPlayed),
        isVisibleInLeaderboard: optionalBoolean(body.isVisibleInLeaderboard),
      }));
    } catch (error) {
      return reply.code(400).send({ error: getErrorMessage(error) });
    }
  });

  app.post("/v1/admin/clubs/:clubId/games", async (request, reply) => {
    const params = request.params as Record<string, unknown>;
    const body = request.body as Record<string, unknown>;

    try {
      await requireManagementAdmin(registry, request.headers.authorization);
    } catch (error) {
      return reply.code(403).send({ error: getErrorMessage(error) });
    }

    try {
      return reply.code(201).send(await registry.createClubGameLedger({
        clubId: requireString(params.clubId, "clubId"),
        label: requireString(body.label, "label"),
        playedAt: requireString(body.playedAt, "playedAt"),
        entries: requireClubLedgerEntries(body.entries, "entries"),
      }));
    } catch (error) {
      return reply.code(400).send({ error: getErrorMessage(error) });
    }
  });

  app.post("/v1/admin/clubs/:clubId/games/:gameId", async (request, reply) => {
    const params = request.params as Record<string, unknown>;
    const body = request.body as Record<string, unknown>;

    try {
      await requireManagementAdmin(registry, request.headers.authorization);
    } catch (error) {
      return reply.code(403).send({ error: getErrorMessage(error) });
    }

    try {
      return reply.send(await registry.updateClubGameLedger({
        clubId: requireString(params.clubId, "clubId"),
        gameId: requireString(params.gameId, "gameId"),
        label: requireString(body.label, "label"),
        playedAt: requireString(body.playedAt, "playedAt"),
        entries: requireClubLedgerEntries(body.entries, "entries"),
      }));
    } catch (error) {
      return reply.code(400).send({ error: getErrorMessage(error) });
    }
  });

  app.get("/v1/admin/rooms", async (request, reply) => {
    try {
      await requireManagementAdmin(registry, request.headers.authorization);
      return reply.send(await registry.listManagedRooms());
    } catch (error) {
      return reply.code(403).send({ error: getErrorMessage(error) });
    }
  });

  app.post("/v1/admin/rooms/expiration", async (request, reply) => {
    const body = request.body as Record<string, unknown>;

    try {
      await requireManagementAdmin(registry, request.headers.authorization);
    } catch (error) {
      return reply.code(403).send({ error: getErrorMessage(error) });
    }

    try {
      return reply.send(await registry.updateManagedRoomsAutoExpiration({
        roomIds: requireStringArray(body.roomIds, "roomIds"),
        autoExpireAfterHours: requireNullableWholeNumber(body.autoExpireAfterHours, "autoExpireAfterHours"),
      }));
    } catch (error) {
      return reply.code(400).send({ error: getErrorMessage(error) });
    }
  });

  app.post("/v1/admin/rooms/delete", async (request, reply) => {
    const body = request.body as Record<string, unknown>;

    try {
      await requireManagementAdmin(registry, request.headers.authorization);
    } catch (error) {
      return reply.code(403).send({ error: getErrorMessage(error) });
    }

    try {
      return reply.send(await registry.deleteManagedRooms({
        roomIds: requireStringArray(body.roomIds, "roomIds"),
      }));
    } catch (error) {
      return reply.code(400).send({ error: getErrorMessage(error) });
    }
  });

  app.post("/v1/rooms/:slug/seat", async (request, reply) => {
    const params = request.params as Record<string, unknown>;
    const body = request.body as Record<string, unknown>;

    try {
      const snapshot = await registry.seatPlayer({
        slug: requireString(params.slug, "slug"),
        accountId: requireString(body.accountId, "accountId"),
        displayName: requireString(body.displayName, "displayName"),
        seatIndex: requireNumber(body.seatIndex, "seatIndex"),
        requestedStack: optionalNumber(body.requestedStack),
      });

      return reply.send(snapshot);
    } catch (error) {
      return reply.code(400).send({ error: getErrorMessage(error) });
    }
  });

  app.post("/v1/rooms/:slug/ready", async (request, reply) => {
    const params = request.params as Record<string, unknown>;
    const body = request.body as Record<string, unknown>;

    try {
      const snapshot = await registry.setReady({
        slug: requireString(params.slug, "slug"),
        accountId: requireString(body.accountId, "accountId"),
        isReady: requireBoolean(body.isReady, "isReady"),
      });

      return reply.send(snapshot);
    } catch (error) {
      return reply.code(400).send({ error: getErrorMessage(error) });
    }
  });

  app.post("/v1/rooms/:slug/sit-out", async (request, reply) => {
    const params = request.params as Record<string, unknown>;
    const body = request.body as Record<string, unknown>;

    try {
      const snapshot = await registry.setSittingOut({
        slug: requireString(params.slug, "slug"),
        accountId: requireString(body.accountId, "accountId"),
        isSittingOut: requireBoolean(body.isSittingOut, "isSittingOut"),
      });

      return reply.send(snapshot);
    } catch (error) {
      return reply.code(400).send({ error: getErrorMessage(error) });
    }
  });

  app.post("/v1/rooms/:slug/leave-seat", async (request, reply) => {
    const params = request.params as Record<string, unknown>;
    const body = request.body as Record<string, unknown>;

    try {
      const snapshot = await registry.leaveSeat({
        slug: requireString(params.slug, "slug"),
        accountId: requireString(body.accountId, "accountId"),
      });

      return reply.send(snapshot);
    } catch (error) {
      return reply.code(400).send({ error: getErrorMessage(error) });
    }
  });

  app.post("/v1/rooms/:slug/react", async (request, reply) => {
    const params = request.params as Record<string, unknown>;
    const body = request.body as Record<string, unknown>;

    try {
      const snapshot = await registry.postReaction({
        slug: requireString(params.slug, "slug"),
        accountId: requireString(body.accountId, "accountId"),
        emoji: requireString(body.emoji, "emoji"),
        targetAccountId: optionalString(body.targetAccountId),
      });

      return reply.send(snapshot);
    } catch (error) {
      return reply.code(400).send({ error: getErrorMessage(error) });
    }
  });

  app.post("/v1/rooms/:slug/gesture", async (request, reply) => {
    const params = request.params as Record<string, unknown>;
    const body = request.body as Record<string, unknown>;

    try {
      const snapshot = await registry.setGesture({
        slug: requireString(params.slug, "slug"),
        accountId: requireString(body.accountId, "accountId"),
        emoji: optionalString(body.emoji),
      });

      return reply.send(snapshot);
    } catch (error) {
      return reply.code(400).send({ error: getErrorMessage(error) });
    }
  });

  app.post("/v1/rooms/:slug/chat", async (request, reply) => {
    const params = request.params as Record<string, unknown>;
    const body = request.body as Record<string, unknown>;

    try {
      const snapshot = await registry.postChatMessage({
        slug: requireString(params.slug, "slug"),
        accountId: requireString(body.accountId, "accountId"),
        displayName: optionalString(body.displayName),
        content: requireString(body.content, "content"),
      });

      return reply.send(snapshot);
    } catch (error) {
      return reply.code(400).send({ error: getErrorMessage(error) });
    }
  });

  app.post("/v1/rooms/:slug/rebuy", async (request, reply) => {
    const params = request.params as Record<string, unknown>;
    const body = request.body as Record<string, unknown>;

    try {
      const snapshot = await registry.rebuyPlayer({
        slug: requireString(params.slug, "slug"),
        accountId: requireString(body.accountId, "accountId"),
        amount: requireNumber(body.amount, "amount"),
      });

      return reply.send(snapshot);
    } catch (error) {
      return reply.code(400).send({ error: getErrorMessage(error) });
    }
  });

  app.post("/v1/rooms/:slug/seat-request/decision", async (request, reply) => {
    const params = request.params as Record<string, unknown>;
    const body = request.body as Record<string, unknown>;

    try {
      const snapshot = await registry.decideSeatRequest({
        slug: requireString(params.slug, "slug"),
        accountId: requireString(body.accountId, "accountId"),
        requestId: requireString(body.requestId, "requestId"),
        approved: requireBoolean(body.approved, "approved"),
        requestedStack: optionalNumber(body.requestedStack),
      });

      return reply.send(snapshot);
    } catch (error) {
      return reply.code(400).send({ error: getErrorMessage(error) });
    }
  });

  app.post("/v1/rooms/:slug/rebuy-request/decision", async (request, reply) => {
    const params = request.params as Record<string, unknown>;
    const body = request.body as Record<string, unknown>;

    try {
      const snapshot = await registry.decideRebuyRequest({
        slug: requireString(params.slug, "slug"),
        accountId: requireString(body.accountId, "accountId"),
        requestId: requireString(body.requestId, "requestId"),
        approved: requireBoolean(body.approved, "approved"),
        amount: optionalNumber(body.amount),
      });

      return reply.send(snapshot);
    } catch (error) {
      return reply.code(400).send({ error: getErrorMessage(error) });
    }
  });

  app.post("/v1/rooms/:slug/admin/options", async (request, reply) => {
    const params = request.params as Record<string, unknown>;
    const body = request.body as Record<string, unknown>;

    try {
      const snapshot = await registry.updateAdminOptions({
        slug: requireString(params.slug, "slug"),
        accountId: requireString(body.accountId, "accountId"),
        blindSchedule: requireBlindSchedule(body.blindSchedule),
        autoStartNextHand: requireBoolean(body.autoStartNextHand, "autoStartNextHand"),
        autoStartDelaySeconds: requireNumber(body.autoStartDelaySeconds, "autoStartDelaySeconds"),
        turnSeconds: requireNullableNumber(body.turnSeconds, "turnSeconds"),
        timeBankSeconds: requireNullableNumber(body.timeBankSeconds, "timeBankSeconds"),
        timeBankRefillHands: requireNullableNumber(body.timeBankRefillHands, "timeBankRefillHands"),
        isPubliclyListed: requireBoolean(body.isPubliclyListed, "isPubliclyListed"),
        minBuyInAmount: requireNumber(body.minBuyInAmount, "minBuyInAmount"),
        maxBuyInRule: requireRoomBuyInMaxRule(body.maxBuyInRule),
        revealAllShowdownHands: requireBoolean(body.revealAllShowdownHands, "revealAllShowdownHands"),
        runItTwiceEnabled: requireBoolean(body.runItTwiceEnabled, "runItTwiceEnabled"),
        suggestedGesturesEnabled: requireBoolean(body.suggestedGesturesEnabled, "suggestedGesturesEnabled"),
        suggestedGesturePromptProbability: requireNumber(body.suggestedGesturePromptProbability, "suggestedGesturePromptProbability"),
      });

      return reply.send(snapshot);
    } catch (error) {
      return reply.code(400).send({ error: getErrorMessage(error) });
    }
  });

  app.post("/v1/rooms/:slug/admin/pause", async (request, reply) => {
    const params = request.params as Record<string, unknown>;
    const body = request.body as Record<string, unknown>;

    try {
      const snapshot = await registry.setRoomPaused({
        slug: requireString(params.slug, "slug"),
        accountId: requireString(body.accountId, "accountId"),
        isPaused: requireBoolean(body.isPaused, "isPaused"),
      });

      return reply.send(snapshot);
    } catch (error) {
      return reply.code(400).send({ error: getErrorMessage(error) });
    }
  });

  app.post("/v1/rooms/:slug/admin/stop", async (request, reply) => {
    const params = request.params as Record<string, unknown>;
    const body = request.body as Record<string, unknown>;

    try {
      const snapshot = await registry.stopRoom({
        slug: requireString(params.slug, "slug"),
        accountId: requireString(body.accountId, "accountId"),
      });

      return reply.send(snapshot);
    } catch (error) {
      return reply.code(400).send({ error: getErrorMessage(error) });
    }
  });

  app.post("/v1/rooms/:slug/admin/archive-preview", async (request, reply) => {
    const params = request.params as Record<string, unknown>;
    const body = request.body as Record<string, unknown>;

    try {
      const preview = await registry.getRoomArchivePreview({
        slug: requireString(params.slug, "slug"),
        accountId: requireString(body.accountId, "accountId"),
      });

      return reply.send(preview);
    } catch (error) {
      return reply.code(400).send({ error: getErrorMessage(error) });
    }
  });

  app.post("/v1/rooms/:slug/admin/archive", async (request, reply) => {
    const params = request.params as Record<string, unknown>;
    const body = request.body as Record<string, unknown>;

    try {
      const snapshot = await registry.archiveRoom({
        slug: requireString(params.slug, "slug"),
        accountId: requireString(body.accountId, "accountId"),
        matchedLedgerAccounts: optionalRoomArchiveLedgerMatches(body.matchedLedgerAccounts),
      });

      return reply.send(snapshot);
    } catch (error) {
      return reply.code(400).send({ error: getErrorMessage(error) });
    }
  });

  app.post("/v1/rooms/:slug/admin/remove-player", async (request, reply) => {
    const params = request.params as Record<string, unknown>;
    const body = request.body as Record<string, unknown>;

    try {
      const snapshot = await registry.removePlayer({
        slug: requireString(params.slug, "slug"),
        accountId: requireString(body.accountId, "accountId"),
        targetAccountId: requireString(body.targetAccountId, "targetAccountId"),
      });

      return reply.send(snapshot);
    } catch (error) {
      return reply.code(400).send({ error: getErrorMessage(error) });
    }
  });

  app.post("/v1/rooms/:slug/admin/seat-bot", async (request, reply) => {
    const params = request.params as Record<string, unknown>;
    const body = request.body as Record<string, unknown>;

    try {
      const snapshot = await registry.seatBot({
        slug: requireString(params.slug, "slug"),
        accountId: requireString(body.accountId, "accountId"),
        displayName: optionalString(body.displayName),
        seatIndex: requireNumber(body.seatIndex, "seatIndex"),
        requestedStack: optionalNumber(body.requestedStack),
      });

      return reply.send(snapshot);
    } catch (error) {
      return reply.code(400).send({ error: getErrorMessage(error) });
    }
  });

  app.post("/v1/rooms/:slug/reveal-cards", async (request, reply) => {
    const params = request.params as Record<string, unknown>;
    const body = request.body as Record<string, unknown>;

    try {
      const snapshot = await registry.revealCards({
        slug: requireString(params.slug, "slug"),
        accountId: requireString(body.accountId, "accountId"),
        revealMode: requireRevealMode(body.revealMode),
      });

      return reply.send(snapshot);
    } catch (error) {
      return reply.code(400).send({ error: getErrorMessage(error) });
    }
  });

  app.post("/v1/rooms/:slug/start", async (request, reply) => {
    const params = request.params as Record<string, unknown>;
    const body = request.body as Record<string, unknown>;

    try {
      const snapshot = await registry.startHand({
        slug: requireString(params.slug, "slug"),
        accountId: requireString(body.accountId, "accountId"),
      });

      return reply.send(snapshot);
    } catch (error) {
      return reply.code(400).send({ error: getErrorMessage(error) });
    }
  });

  app.post("/v1/rooms/:slug/action", async (request, reply) => {
    const params = request.params as Record<string, unknown>;
    const body = request.body as Record<string, unknown>;

    try {
      const snapshot = await registry.actOnHand({
        slug: requireString(params.slug, "slug"),
        accountId: requireString(body.accountId, "accountId"),
        actionType: requireActionType(body.actionType),
        amount: optionalNumber(body.amount),
      });

      return reply.send(snapshot);
    } catch (error) {
      return reply.code(400).send({ error: getErrorMessage(error) });
    }
  });

  app.post("/v1/rooms/:slug/run-it-twice", async (request, reply) => {
    const params = request.params as Record<string, unknown>;
    const body = request.body as Record<string, unknown>;

    try {
      const snapshot = await registry.submitRunItTwiceDecision({
        slug: requireString(params.slug, "slug"),
        accountId: requireString(body.accountId, "accountId"),
        willing: requireBoolean(body.willing, "willing"),
      });

      return reply.send(snapshot);
    } catch (error) {
      return reply.code(400).send({ error: getErrorMessage(error) });
    }
  });
}

function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Field '${fieldName}' is required.`);
  }

  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function optionalNullableString(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }

  return optionalString(value);
}

function requireNumber(value: unknown, fieldName: string): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new Error(`Field '${fieldName}' must be a number.`);
  }

  return value;
}

function getBearerToken(authorizationHeader?: string): string | undefined {
  if (!authorizationHeader?.startsWith("Bearer ")) {
    return undefined;
  }

  return authorizationHeader.slice("Bearer ".length).trim() || undefined;
}

function requireNullableNumber(value: unknown, fieldName: string): number | null {
  if (value === null) {
    return null;
  }

  return requireNumber(value, fieldName);
}

function requireNullableWholeNumber(value: unknown, fieldName: string): number | null {
  if (value === null) {
    return null;
  }

  const parsed = requireNumber(value, fieldName);

  if (!Number.isInteger(parsed)) {
    throw new Error(`Field '${fieldName}' must be a whole number.`);
  }

  return parsed;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && !Number.isNaN(value) ? value : undefined;
}

function requireStringArray(value: unknown, fieldName: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`Field '${fieldName}' must be an array.`);
  }

  const parsed = value
    .filter((entry) => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (parsed.length === 0) {
    throw new Error(`Field '${fieldName}' must include at least one string value.`);
  }

  return parsed;
}

function optionalStringArray(value: unknown, fieldName: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  return requireStringArray(value, fieldName);
}

function requireClubLedgerEntries(value: unknown, fieldName: string) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`Field '${fieldName}' must be a non-empty array.`);
  }

  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`Field '${fieldName}[${index}]' must be an object.`);
    }

    const parsed = entry as Record<string, unknown>;

    return {
      accountId: requireString(parsed.accountId, `${fieldName}[${index}].accountId`),
      displayName: requireString(parsed.displayName, `${fieldName}[${index}].displayName`),
      hoursPlayed: optionalNullableString(parsed.hoursPlayed),
      totalBuyIn: requireNumber(parsed.totalBuyIn, `${fieldName}[${index}].totalBuyIn`),
      cashOut: requireNumber(parsed.cashOut, `${fieldName}[${index}].cashOut`),
    };
  });
}

function optionalRoomArchiveLedgerMatches(value: unknown) {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new Error("Field 'matchedLedgerAccounts' must be an array.");
  }

  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`Field 'matchedLedgerAccounts[${index}]' must be an object.`);
    }

    const parsed = entry as Record<string, unknown>;

    return {
      sourceAccountId: requireString(parsed.sourceAccountId, `matchedLedgerAccounts[${index}].sourceAccountId`),
      matchedAccountId: optionalNullableString(parsed.matchedAccountId),
    };
  });
}

function requireBoolean(value: unknown, fieldName: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`Field '${fieldName}' must be a boolean.`);
  }

  return value;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

async function requireManagementAdmin(registry: RoomRegistry, authorizationHeader?: string) {
  return registry.assertManagementAdmin(getBearerToken(authorizationHeader));
}

function optionalClubRole(value: unknown): "OWNER" | "ADMIN" | "MEMBER" | undefined {
  return value === "OWNER" || value === "ADMIN" || value === "MEMBER" ? value : undefined;
}

function optionalVisibility(value: unknown): "private" | "club" | undefined {
  return value === "private" || value === "club" ? value : undefined;
}

function requireBlindSchedule(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Field 'blindSchedule' must be a non-empty blind schedule.");
  }

  return value as never;
}

function requireRoomBuyInMaxRule(value: unknown): { kind: "fixed_amount" | "chip_lead_percentage"; value: number } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Field 'maxBuyInRule' must be an object.");
  }

  const parsed = value as Record<string, unknown>;
  const kind = parsed.kind;

  if (kind !== "fixed_amount" && kind !== "chip_lead_percentage") {
    throw new Error("Field 'maxBuyInRule.kind' must be 'fixed_amount' or 'chip_lead_percentage'.");
  }

  return {
    kind,
    value: requireNumber(parsed.value, "maxBuyInRule.value"),
  };
}

function requireActionType(value: unknown): "fold" | "check" | "call" | "bet" | "raise" | "all_in" {
  if (value === "fold" || value === "check" || value === "call" || value === "bet" || value === "raise" || value === "all_in") {
    return value;
  }

  throw new Error("Field 'actionType' must be a supported player action.");
}

function requireRevealMode(value: unknown): "none" | "first" | "second" | "both" {
  if (value === "none" || value === "first" || value === "second" || value === "both") {
    return value;
  }

  throw new Error("Field 'revealMode' must be one of: none, first, second, both.");
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected game service error.";
}
