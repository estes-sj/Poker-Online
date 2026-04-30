import Fastify from "fastify";
import cors from "@fastify/cors";
import { disconnectPrisma } from "../../../packages/db/src/index.js";
import { RawData, WebSocket, WebSocketServer } from "ws";

import { registerRoutes } from "./http/routes.js";
import { PrismaRoomRegistry } from "./runtime/prisma-room-registry.js";
import type { AutoExpiringRoom, RoomRegistry, RoomSnapshot } from "./runtime/room-service.js";

const BOT_ACCOUNT_ID_PREFIX = "bot_";
const BOT_ACTION_DELAY_MS = 900;

interface ClientMessage {
  type: "subscribe_room" | "seat_player" | "set_ready" | "admin_start_hand";
  slug: string;
  accountId?: string;
  displayName?: string;
  seatIndex?: number;
  isReady?: boolean;
}

interface Subscription {
  slug: string;
  accountId?: string;
}

export function buildGameServer() {
  const subscriptions = new Map<WebSocket, Subscription>();
  const autoStartTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const bustCleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const roomExpirationTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const turnTimeoutTimers = new Map<string, ReturnType<typeof setTimeout>>();
  let roomExpirationBootstrapRetryTimer: ReturnType<typeof setTimeout> | null = null;
  const app = Fastify({ logger: true });
  let registry!: RoomRegistry;

  const broadcastRoom = async (slug: string) => {
    for (const [socket, subscription] of subscriptions.entries()) {
      if (subscription.slug !== slug || socket.readyState !== WebSocket.OPEN) {
        continue;
      }

      try {
        const snapshot = await registry.getViewerRoomSnapshot(slug, subscription.accountId);
        socket.send(JSON.stringify({
          type: "room_snapshot",
          payload: snapshot,
        }));
      } catch (error) {
        socket.send(JSON.stringify({ type: "error", message: getErrorMessage(error) }));
      }
    }
  };

  const clearAutoStartTimer = (slug: string) => {
    const timer = autoStartTimers.get(slug);

    if (!timer) {
      return;
    }

    clearTimeout(timer);
    autoStartTimers.delete(slug);
  };

  const clearTurnTimeoutTimer = (slug: string) => {
    const timer = turnTimeoutTimers.get(slug);

    if (!timer) {
      return;
    }

    clearTimeout(timer);
    turnTimeoutTimers.delete(slug);
  };

  const clearBustCleanupTimer = (slug: string) => {
    const timer = bustCleanupTimers.get(slug);

    if (!timer) {
      return;
    }

    clearTimeout(timer);
    bustCleanupTimers.delete(slug);
  };

  const clearRoomExpirationTimer = (slug: string) => {
    const timer = roomExpirationTimers.get(slug);

    if (!timer) {
      return;
    }

    clearTimeout(timer);
    roomExpirationTimers.delete(slug);
  };

  const clearRoomExpirationBootstrapRetryTimer = () => {
    if (!roomExpirationBootstrapRetryTimer) {
      return;
    }

    clearTimeout(roomExpirationBootstrapRetryTimer);
    roomExpirationBootstrapRetryTimer = null;
  };

  const handleDeletedRooms = async (slugs: string[]) => {
    const deletedSlugs = new Set(slugs);

    for (const slug of deletedSlugs) {
      clearAutoStartTimer(slug);
      clearBustCleanupTimer(slug);
      clearRoomExpirationTimer(slug);
      clearTurnTimeoutTimer(slug);
    }

    for (const [socket, subscription] of subscriptions.entries()) {
      if (!deletedSlugs.has(subscription.slug)) {
        continue;
      }

      subscriptions.delete(socket);

      if (socket.readyState !== WebSocket.OPEN) {
        continue;
      }

      socket.send(JSON.stringify({
        type: "error",
        message: "This room was deleted by the admin.",
      }));
      socket.close(1000, "Room deleted");
    }
  };

  const getBustCleanupDueAtMs = (snapshot: RoomSnapshot): number | null => {
    if (snapshot.currentHand || !snapshot.lastCompletedHand) {
      return null;
    }

    const winningAccountIds = new Set(snapshot.lastCompletedHand.winners.map((winner) => winner.accountId));
    const hasBustedLoser = snapshot.players.some((player) => player.stack <= 0 && !winningAccountIds.has(player.accountId));

    if (!hasBustedLoser) {
      return null;
    }

    const concludedAtMs = Date.parse(snapshot.lastCompletedHand.concludedAt);

    if (Number.isNaN(concludedAtMs)) {
      return Date.now();
    }

    const allInRunout = snapshot.lastCompletedHand.allInRunout;

    if (!allInRunout || allInRunout.startBoardCount >= snapshot.lastCompletedHand.board.length || allInRunout.revealIntervalMs <= 0) {
      return concludedAtMs;
    }

    return concludedAtMs + Math.max(0, snapshot.lastCompletedHand.board.length - allInRunout.startBoardCount) * allInRunout.revealIntervalMs;
  };

  const executeBustCleanup = async (slug: string) => {
    let snapshot: RoomSnapshot;

    try {
      snapshot = await registry.getRoomSnapshot(slug);
    } catch (error) {
      app.log.warn({ slug, error }, "Unable to read room before scheduled busted-seat cleanup.");
      return;
    }

    const cleanupDueAtMs = getBustCleanupDueAtMs(snapshot);

    if (cleanupDueAtMs === null) {
      return;
    }

    if (cleanupDueAtMs > Date.now()) {
      await scheduleRoomBustCleanup(slug);
      return;
    }

    try {
      await registry.cleanupBustedPlayers(slug);
    } catch (error) {
      app.log.debug({ slug, error }, "Scheduled busted-seat cleanup did not resolve cleanly.");
    }
  };

  const scheduleRoomBustCleanup = async (slug: string) => {
    clearBustCleanupTimer(slug);

    let snapshot: RoomSnapshot;

    try {
      snapshot = await registry.getRoomSnapshot(slug);
    } catch (error) {
      app.log.warn({ slug, error }, "Unable to schedule busted-seat cleanup.");
      return;
    }

    const cleanupDueAtMs = getBustCleanupDueAtMs(snapshot);

    if (cleanupDueAtMs === null) {
      return;
    }

    const delayMs = Math.max(0, cleanupDueAtMs - Date.now());
    bustCleanupTimers.set(slug, setTimeout(() => {
      bustCleanupTimers.delete(slug);
      void executeBustCleanup(slug);
    }, delayMs));
  };

  const scheduleRoomExpirationFromEntry = (room: AutoExpiringRoom | null) => {
    if (!room) {
      return;
    }

    clearRoomExpirationTimer(room.slug);

    const dueAtMs = Date.parse(room.expiresAt);

    if (Number.isNaN(dueAtMs)) {
      app.log.warn({ slug: room.slug, expiresAt: room.expiresAt }, "Skipping invalid room-expiration timestamp.");
      return;
    }

    const delayMs = Math.max(0, dueAtMs - Date.now());
    roomExpirationTimers.set(room.slug, setTimeout(() => {
      roomExpirationTimers.delete(room.slug);
      void executeRoomExpiration(room.slug);
    }, delayMs));
  };

  const executeRoomExpiration = async (slug: string) => {
    let room: AutoExpiringRoom | null;

    try {
      room = await registry.getAutoExpiringRoom(slug);
    } catch (error) {
      app.log.warn({ slug, error }, "Unable to read room before scheduled expiration.");
      return;
    }

    if (!room) {
      return;
    }

    const dueAtMs = Date.parse(room.expiresAt);

    if (Number.isNaN(dueAtMs)) {
      app.log.warn({ slug, expiresAt: room.expiresAt }, "Skipping invalid room-expiration timestamp.");
      return;
    }

    if (dueAtMs > Date.now()) {
      await scheduleRoomExpiration(slug);
      return;
    }

    try {
      const result = await registry.deleteManagedRooms({
        roomIds: [room.roomId],
      });

      if (result.deletedSlugs.length > 0) {
        app.log.info({ slug }, "Deleted room after idle auto-expiration.");
      }
    } catch (error) {
      app.log.warn({ slug, error }, "Unable to delete room after scheduled expiration.");
    }
  };

  const scheduleRoomExpiration = async (slug: string) => {
    clearRoomExpirationTimer(slug);

    let room: AutoExpiringRoom | null;

    try {
      room = await registry.getAutoExpiringRoom(slug);
    } catch (error) {
      app.log.warn({ slug, error }, "Unable to schedule room expiration.");
      return;
    }

    if (!room) {
      return;
    }

    scheduleRoomExpirationFromEntry(room);
  };

  const scheduleExistingRoomExpirations = async () => {
    let rooms: AutoExpiringRoom[];

    try {
      rooms = await registry.listAutoExpiringRooms();
    } catch (error) {
      app.log.warn({ error }, "Unable to load room expirations during startup.");

      if (!roomExpirationBootstrapRetryTimer) {
        roomExpirationBootstrapRetryTimer = setTimeout(() => {
          roomExpirationBootstrapRetryTimer = null;
          void scheduleExistingRoomExpirations();
        }, 5000);
      }

      return;
    }

    clearRoomExpirationBootstrapRetryTimer();

    for (const room of rooms) {
      scheduleRoomExpirationFromEntry(room);
    }
  };

  const shouldScheduleAutoStart = (snapshot: RoomSnapshot): boolean => {
    return Boolean(
      snapshot.autoStartNextHand
      && snapshot.nextHandStartsAt
      && !snapshot.currentHand
      && snapshot.status !== "paused"
    );
  };

  const startScheduledHand = async (slug: string) => {
    let snapshot: RoomSnapshot;

    try {
      snapshot = await registry.getRoomSnapshot(slug);
    } catch (error) {
      app.log.warn({ slug, error }, "Unable to read room before scheduled auto-start.");
      return;
    }

    if (!shouldScheduleAutoStart(snapshot)) {
      return;
    }

    const nextHandTime = Date.parse(snapshot.nextHandStartsAt!);

    if (Number.isNaN(nextHandTime)) {
      app.log.warn({ slug, nextHandStartsAt: snapshot.nextHandStartsAt }, "Skipping invalid auto-start timestamp.");
      return;
    }

    if (nextHandTime > Date.now()) {
      await scheduleRoomAutoStart(slug);
      return;
    }

    try {
      await registry.startHand({
        slug,
        accountId: snapshot.adminAccountId,
      });
    } catch (error) {
      app.log.debug({ slug, error }, "Scheduled auto-start did not start a hand.");
    }
  };

  const scheduleRoomAutoStart = async (slug: string) => {
    clearAutoStartTimer(slug);

    let snapshot: RoomSnapshot;

    try {
      snapshot = await registry.getRoomSnapshot(slug);
    } catch (error) {
      app.log.warn({ slug, error }, "Unable to schedule room auto-start.");
      return;
    }

    if (!shouldScheduleAutoStart(snapshot)) {
      return;
    }

    const nextHandTime = Date.parse(snapshot.nextHandStartsAt!);

    if (Number.isNaN(nextHandTime)) {
      app.log.warn({ slug, nextHandStartsAt: snapshot.nextHandStartsAt }, "Skipping invalid auto-start timestamp.");
      return;
    }

    const delayMs = Math.max(0, nextHandTime - Date.now());
    autoStartTimers.set(slug, setTimeout(() => {
      autoStartTimers.delete(slug);
      void startScheduledHand(slug);
    }, delayMs));
  };

  const shouldScheduleTurnTimeout = (snapshot: RoomSnapshot): boolean => {
    return Boolean(
      snapshot.currentHand
      && snapshot.currentHand.actorAccountId
      && snapshot.turnState.currentTurnStartedAt
      && snapshot.turnState.turnSeconds !== null
      && snapshot.status === "active"
    );
  };

  const getRemainingTurnMs = (snapshot: RoomSnapshot): number | null => {
    if (!shouldScheduleTurnTimeout(snapshot)) {
      return null;
    }

    const turnStartedAt = Date.parse(snapshot.turnState.currentTurnStartedAt!);

    if (Number.isNaN(turnStartedAt)) {
      return null;
    }

    const actorAccountId = snapshot.currentHand!.actorAccountId!;
    const decisionBudgetMs = (snapshot.turnState.turnSeconds ?? 0) * 1000;
    const timeBankMs = snapshot.turnState.timeBankSeconds === null
      ? 0
      : snapshot.turnState.timeBankMsByAccount[actorAccountId] ?? snapshot.turnState.timeBankSeconds * 1000;
    const totalBudgetMs = decisionBudgetMs + timeBankMs;
    return Math.max(0, totalBudgetMs - (Date.now() - turnStartedAt));
  };

  const executeBotTurn = async (slug: string) => {
    let snapshot: RoomSnapshot;

    try {
      snapshot = await registry.getRoomSnapshot(slug);
    } catch (error) {
      app.log.warn({ slug, error }, "Unable to read room before scheduled bot action.");
      return;
    }

    const actorAccountId = snapshot.currentHand?.actorAccountId;

    if (!actorAccountId || !isBotAccountId(actorAccountId) || snapshot.status !== "active") {
      return;
    }

    try {
      const actorSnapshot = await registry.getRoomSnapshot(slug, actorAccountId);
      const botAction = chooseBotTurnAction(actorSnapshot.currentHand?.heroActionState ?? null);

      if (!botAction) {
        await scheduleRoomTurnTimeout(slug);
        return;
      }

      await registry.actOnHand({
        slug,
        accountId: actorAccountId,
        actionType: botAction.actionType,
        amount: botAction.amount,
      });
    } catch (error) {
      app.log.debug({ slug, error }, "Bot auto-action did not resolve cleanly.");
    }
  };

  const executeTurnTimeout = async (slug: string) => {
    let snapshot: RoomSnapshot;

    try {
      snapshot = await registry.getRoomSnapshot(slug);
    } catch (error) {
      app.log.warn({ slug, error }, "Unable to read room before scheduled turn timeout.");
      return;
    }

    const remainingTurnMs = getRemainingTurnMs(snapshot);

    if (remainingTurnMs === null) {
      return;
    }

    if (remainingTurnMs > 0) {
      await scheduleRoomTurnTimeout(slug);
      return;
    }

    const actorAccountId = snapshot.currentHand?.actorAccountId;

    if (!actorAccountId) {
      return;
    }

    try {
      const actorSnapshot = await registry.getRoomSnapshot(slug, actorAccountId);
      const heroActionState = actorSnapshot.currentHand?.heroActionState;

      if (!heroActionState?.canAct) {
        await scheduleRoomTurnTimeout(slug);
        return;
      }

      const actionType = heroActionState.allowedActions.includes("check") ? "check" : "fold";
      await registry.actOnHand({
        slug,
        accountId: actorAccountId,
        actionType,
      });
    } catch (error) {
      app.log.debug({ slug, error }, "Turn timeout auto-action did not resolve cleanly.");
    }
  };

  const scheduleRoomTurnTimeout = async (slug: string) => {
    clearTurnTimeoutTimer(slug);

    let snapshot: RoomSnapshot;

    try {
      snapshot = await registry.getRoomSnapshot(slug);
    } catch (error) {
      app.log.warn({ slug, error }, "Unable to schedule room turn timeout.");
      return;
    }

    if (snapshot.currentHand?.actorAccountId && isBotAccountId(snapshot.currentHand.actorAccountId) && snapshot.status === "active") {
      turnTimeoutTimers.set(slug, setTimeout(() => {
        turnTimeoutTimers.delete(slug);
        void executeBotTurn(slug);
      }, BOT_ACTION_DELAY_MS));
      return;
    }

    const remainingTurnMs = getRemainingTurnMs(snapshot);

    if (remainingTurnMs === null) {
      return;
    }

    turnTimeoutTimers.set(slug, setTimeout(() => {
      turnTimeoutTimers.delete(slug);
      void executeTurnTimeout(slug);
    }, remainingTurnMs));
  };

  registry = new PrismaRoomRegistry(async (slug) => {
    await broadcastRoom(slug);
    await scheduleRoomBustCleanup(slug);
    await scheduleRoomAutoStart(slug);
    await scheduleRoomExpiration(slug);
    await scheduleRoomTurnTimeout(slug);
  }, async (slugs) => {
    await handleDeletedRooms(slugs);
  });
  const websocketServer = new WebSocketServer({ noServer: true });

  app.register(cors, {
    origin: true,
  });

  app.addHook("onClose", async () => {
    for (const timer of autoStartTimers.values()) {
      clearTimeout(timer);
    }

    for (const timer of bustCleanupTimers.values()) {
      clearTimeout(timer);
    }

    for (const timer of roomExpirationTimers.values()) {
      clearTimeout(timer);
    }

    for (const timer of turnTimeoutTimers.values()) {
      clearTimeout(timer);
    }

    autoStartTimers.clear();
    bustCleanupTimers.clear();
    roomExpirationTimers.clear();
    turnTimeoutTimers.clear();
    clearRoomExpirationBootstrapRetryTimer();
    await disconnectPrisma();
  });

  app.addHook("onReady", async () => {
    await scheduleExistingRoomExpirations();
  });

  app.register(async (instance) => {
    await registerRoutes(instance, registry);
  });

  app.server.on("upgrade", (request, socket, head) => {
    if (!request.url?.startsWith("/ws")) {
      socket.destroy();
      return;
    }

    websocketServer.handleUpgrade(request, socket, head, (websocket: WebSocket) => {
      websocketServer.emit("connection", websocket, request);
    });
  });

  websocketServer.on("connection", (socket: WebSocket) => {
    socket.send(JSON.stringify({ type: "connected" }));

    socket.on("message", async (message: RawData) => {
      const payload = safeParse(message.toString());

      if (!payload) {
        socket.send(JSON.stringify({ type: "error", message: "Message must be valid JSON." }));
        return;
      }

      try {
        await handleClientMessage(registry, subscriptions, socket, payload, scheduleRoomBustCleanup, scheduleRoomAutoStart, scheduleRoomTurnTimeout);
      } catch (error) {
        socket.send(JSON.stringify({ type: "error", message: getErrorMessage(error) }));
      }
    });

    socket.on("close", () => {
      void handleSocketClose(registry, subscriptions, socket);
    });
  });

  return { app, registry };
}

async function handleClientMessage(
  registry: RoomRegistry,
  subscriptions: Map<WebSocket, Subscription>,
  socket: WebSocket,
  payload: unknown,
  scheduleRoomBustCleanup: (slug: string) => Promise<void>,
  scheduleRoomAutoStart: (slug: string) => Promise<void>,
  scheduleRoomTurnTimeout: (slug: string) => Promise<void>
): Promise<void> {
  const message = payload as Partial<ClientMessage>;

  if (typeof message.type !== "string" || typeof message.slug !== "string") {
    throw new Error("Messages must include a type and room slug.");
  }

  switch (message.type) {
    case "subscribe_room": {
      const accountId = typeof message.accountId === "string" ? message.accountId : undefined;

      subscriptions.set(socket, {
        slug: message.slug,
        accountId,
      });

      const snapshot = accountId
        ? await registry.setPlayerConnection({
            slug: message.slug,
            accountId,
            isConnected: true,
          })
        : await registry.getViewerRoomSnapshot(message.slug, message.accountId);

      socket.send(JSON.stringify({
        type: "room_snapshot",
        payload: snapshot,
      }));

      await scheduleRoomBustCleanup(message.slug);
      await scheduleRoomAutoStart(message.slug);
      await scheduleRoomTurnTimeout(message.slug);

      return;
    }
    case "seat_player": {
      const accountId = requireString(message.accountId, "accountId");

      subscriptions.set(socket, {
        slug: message.slug,
        accountId,
      });

      await registry.seatPlayer({
        slug: message.slug,
        accountId,
        displayName: requireString(message.displayName, "displayName"),
        seatIndex: requireNumber(message.seatIndex, "seatIndex"),
      });
      return;
    }
    case "set_ready": {
      await registry.setReady({
        slug: message.slug,
        accountId: requireString(message.accountId, "accountId"),
        isReady: requireBoolean(message.isReady, "isReady"),
      });
      return;
    }
    case "admin_start_hand": {
      await registry.startHand({
        slug: message.slug,
        accountId: requireString(message.accountId, "accountId"),
      });
      return;
    }
    default:
      throw new Error(`Unsupported message type: ${String(message.type)}`);
  }
}

async function handleSocketClose(
  registry: RoomRegistry,
  subscriptions: Map<WebSocket, Subscription>,
  socket: WebSocket
): Promise<void> {
  const subscription = subscriptions.get(socket);
  subscriptions.delete(socket);

  if (!subscription?.accountId) {
    return;
  }

  try {
    await registry.setPlayerConnection({
      slug: subscription.slug,
      accountId: subscription.accountId,
      isConnected: false,
    });
  } catch {
    // Ignore disconnect cleanup failures after the socket is already gone.
  }
}

function safeParse(raw: string): unknown | null {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} must be a non-empty string.`);
  }

  return value;
}

function requireNumber(value: unknown, fieldName: string): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new Error(`${fieldName} must be a valid number.`);
  }

  return value;
}

function requireBoolean(value: unknown, fieldName: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${fieldName} must be a boolean.`);
  }

  return value;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unexpected error.";
}

function isBotAccountId(accountId: string): boolean {
  return accountId.startsWith(BOT_ACCOUNT_ID_PREFIX);
}

function chooseBotTurnAction(
  actionState: NonNullable<NonNullable<RoomSnapshot["currentHand"]>["heroActionState"]> | null,
): { actionType: "fold" | "check" | "call" | "bet" | "raise" | "all_in"; amount?: number } | null {
  if (!actionState?.canAct) {
    return null;
  }

  const aggressiveAction = actionState.allowedActions.includes("raise")
    ? "raise"
    : actionState.allowedActions.includes("bet")
      ? "bet"
      : null;

  if (actionState.allowedActions.includes("check")) {
    if (aggressiveAction && actionState.minRaiseTo !== null && Math.random() < 0.24) {
      return {
        actionType: aggressiveAction,
        amount: actionState.minRaiseTo,
      };
    }

    return { actionType: "check" };
  }

  if (actionState.allowedActions.includes("call")) {
    const callPressure = actionState.callAmount / Math.max(actionState.maxRaiseTo, 1);

    if (aggressiveAction && actionState.minRaiseTo !== null && callPressure <= 0.12 && Math.random() < 0.18) {
      return {
        actionType: aggressiveAction,
        amount: actionState.minRaiseTo,
      };
    }

    if (callPressure <= 0.3 || Math.random() < 0.2) {
      return { actionType: "call" };
    }
  }

  if (actionState.allowedActions.includes("all_in") && actionState.maxRaiseTo > 0 && Math.random() < 0.08) {
    return { actionType: "all_in" };
  }

  if (actionState.allowedActions.includes("fold")) {
    return { actionType: "fold" };
  }

  return null;
}
