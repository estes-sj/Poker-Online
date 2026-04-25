import { createHash } from "node:crypto";

import { Prisma, RoomStatus, RoomVisibility, type PrismaClient } from "@prisma/client";
import { prisma } from "../../../../packages/db/src/index.js";
import { getRoomCreationAdminConfig, isConfiguredRoomCreationAdmin } from "../../../../packages/db/src/room-creation-policy.js";
import {
  addPlayerChips,
  BlindLevel,
  Card,
  LastHandResult,
  Street,
  applyPlayerAction,
  createTable,
  getActivePlayers,
  getBlindLevelAtElapsedMinutes,
  getPlayerActionState,
  leaveSeat,
  normalizeBlindSchedule,
  pauseTable,
  resumeTable,
  seatPlayer,
  setPlayerConnection,
  setPlayerReady,
  setPlayerSittingOut,
  startHand,
  TableState,
} from "@poker/domain";

import { hashSecret, verifySecret } from "./passwords.js";
import type {
  AutoExpiringRoom,
  CreateRoomRequest,
  DeleteManagedRoomsRequest,
  DeleteManagedRoomsResult,
  JoinRoomRequest,
  LeaveSeatRequest,
  ManagedRoomSummary,
  RemovePlayerRequest,
  RevealMode,
  RoomAdminOptionsState,
  RoomBlindState,
  RoomBuyInState,
  RoomChatMessage,
  RoomChatRequest,
  RoomGestureRequest,
  RoomPendingRebuyRequest,
  RoomPendingSeatRequest,
  RoomPlayerStatsState,
  RoomReactionRequest,
  RoomRevealCardsRequest,
  RoomRebuyRequestDecision,
  RoomSeatGesture,
  RoomSeatReaction,
  RoomRebuyRequest,
  RoomSeatRequestDecision,
  SetRoomPausedRequest,
  PlayerConnectionRequest,
  PlayerReadyRequest,
  PlayerSitOutRequest,
  RoomActionRequest,
  RoomRegistry,
  RoomSnapshot,
  RoomTurnState,
  RoomManagementAdmin,
  SeatPlayerRequest,
  StartHandRequest,
  StopRoomRequest,
  UpdateManagedRoomsAutoExpirationRequest,
  UpdateRoomAdminOptionsRequest,
} from "./room-service.js";

const DEFAULT_BLIND_SCHEDULE: BlindLevel[] = [
  { level: 1, smallBlind: 100, bigBlind: 200, durationMinutes: 20 },
  { level: 2, smallBlind: 200, bigBlind: 400, durationMinutes: 20 },
  { level: 3, smallBlind: 400, bigBlind: 800, durationMinutes: 20 },
];

const DEFAULT_TURN_SECONDS = 18;
const DEFAULT_TIMEBANK_SECONDS = 60;
const MAX_CHAT_MESSAGES = 40;
const MAX_SEAT_REACTIONS = 12;
const MAX_SEAT_GESTURES = 12;
const MAX_RECENT_COMPLETED_HANDS = 12;
const REACTION_DURATION_MS = 4_000;
const MAX_AUTO_EXPIRE_HOURS = 24 * 365;

type PrismaClientLike = PrismaClient;

interface PersistedRoomRecord {
  id: string;
  slug: string;
  name: string;
  adminId: string;
  clubId: string | null;
  visibility: RoomVisibility;
  status: RoomStatus;
  passwordHash: string | null;
  maxPlayers: number;
  startingStack: number;
  autoStartNextHand: boolean;
  autoStartDelaySeconds: number;
  autoExpireAfterHours: number | null;
  blindSchedule: Prisma.JsonValue;
  runtimeState: Prisma.JsonValue | null;
  createdAt: Date;
  lastActivityAt: Date;
  updatedAt: Date;
}

interface ManagedPersistedRoomRecord extends PersistedRoomRecord {
  admin: {
    username: string;
  };
}

interface PersistedRoomRuntimeState {
  table: TableState;
  joinedViewerAccountIds: string[];
  chatMessages: RoomChatMessage[];
  seatReactions: RoomSeatReaction[];
  seatGestures: RoomSeatGesture[];
  buyInState: RoomBuyInState;
  playerStats: RoomPlayerStatsState;
  turnState: RoomTurnState;
  adminOptions: RoomAdminOptionsState;
  pendingSeatRequests: RoomPendingSeatRequest[];
  pendingRebuyRequests: RoomPendingRebuyRequest[];
  pauseState: {
    pausedAt: string | null;
    totalPausedMs: number;
  };
  recentCompletedHands: LastHandResult[];
  lastCompletedHandHoleCards: Record<string, [Card, Card]> | null;
}

export class PrismaRoomRegistry implements RoomRegistry {
  constructor(
    private readonly onRoomUpdated?: (slug: string) => Promise<void> | void,
    private readonly onRoomsDeleted?: (slugs: string[]) => Promise<void> | void,
    private readonly database: PrismaClientLike = prisma
  ) {}

  async createRoom(input: CreateRoomRequest): Promise<RoomSnapshot> {
    const slug = await this.allocateSlug(input.slug ?? input.name);
    const name = input.name.trim();

    const adminUser = await this.assertAdminExists(input.adminAccountId);
    await this.assertRoomCreationAllowed(adminUser, input.sessionToken);
    await this.assertClubExists(input.clubId);

    const baseTable = createTable({
      slug,
      name,
      adminAccountId: input.adminAccountId,
      clubId: input.clubId,
      visibility: input.visibility ?? "private",
      maxPlayers: input.maxPlayers ?? 8,
      startingStack: input.startingStack ?? 20_000,
      blindSchedule: input.blindSchedule ?? DEFAULT_BLIND_SCHEDULE,
      autoStartNextHand: input.autoStartNextHand ?? true,
      autoStartDelaySeconds: input.autoStartDelaySeconds ?? 8,
      revealAllShowdownHands: input.revealAllShowdownHands ?? false,
      passwordProtected: Boolean(input.password?.trim()),
    });

    const table: TableState = {
      ...baseTable,
      roomId: baseTable.roomId,
    };

    const runtimeState = createRuntimeState(table);

    await this.database.room.create({
      data: {
        id: table.roomId,
        slug,
        name,
        adminId: input.adminAccountId,
        clubId: input.clubId,
        visibility: toPrismaVisibility(table.visibility),
        passwordHash: input.password?.trim() ? hashSecret(input.password.trim()) : null,
        maxPlayers: table.maxPlayers,
        startingStack: table.startingStack,
        autoStartNextHand: table.autoStartNextHand,
        autoStartDelaySeconds: table.autoStartDelaySeconds,
        blindSchedule: toJsonValue(table.blindSchedule),
        status: toPrismaStatus(table.status),
        runtimeState: toJsonValue(runtimeState),
      },
    });

    await this.onRoomUpdated?.(slug);
    return this.toSnapshot(runtimeState, input.adminAccountId);
  }

  async assertManagementAdmin(sessionToken?: string): Promise<RoomManagementAdmin> {
    const config = getRoomCreationAdminConfig();

    if (!config.adminUsername) {
      throw new Error("ROOM_CREATION_ADMIN_USERNAME must be set before room management is available.");
    }

    if (!sessionToken) {
      throw new Error(`Sign in as ${config.adminUsername} before opening room management.`);
    }

    const sessionAccount = await this.getAccountBySessionToken(sessionToken);

    if (!sessionAccount || !isConfiguredRoomCreationAdmin(sessionAccount.username, config.adminUsername)) {
      throw new Error(`Only ${config.adminUsername} can manage rooms on this site.`);
    }

    return {
      accountId: sessionAccount.id,
      username: sessionAccount.username,
    };
  }

  async listManagedRooms(): Promise<ManagedRoomSummary[]> {
    const rooms = await this.database.room.findMany({
      orderBy: [
        { status: "asc" },
        { lastActivityAt: "desc" },
      ],
      select: {
        id: true,
        slug: true,
        name: true,
        adminId: true,
        clubId: true,
        visibility: true,
        status: true,
        passwordHash: true,
        maxPlayers: true,
        startingStack: true,
        autoStartNextHand: true,
        autoStartDelaySeconds: true,
        autoExpireAfterHours: true,
        blindSchedule: true,
        runtimeState: true,
        createdAt: true,
        lastActivityAt: true,
        updatedAt: true,
        admin: {
          select: {
            username: true,
          },
        },
      },
    });

    return rooms.map((room) => buildManagedRoomSummary(room, this.requireRuntimeState(room)));
  }

  async listAutoExpiringRooms(): Promise<AutoExpiringRoom[]> {
    const rooms = await this.database.room.findMany({
      where: {
        autoExpireAfterHours: {
          not: null,
        },
      },
      select: {
        id: true,
        slug: true,
        lastActivityAt: true,
        autoExpireAfterHours: true,
      },
    });

    return rooms
      .map((room) => buildAutoExpiringRoom(room))
      .filter((room): room is AutoExpiringRoom => room !== null);
  }

  async getAutoExpiringRoom(slug: string): Promise<AutoExpiringRoom | null> {
    const room = await this.database.room.findUnique({
      where: { slug },
      select: {
        id: true,
        slug: true,
        lastActivityAt: true,
        autoExpireAfterHours: true,
      },
    });

    if (!room) {
      return null;
    }

    return buildAutoExpiringRoom(room);
  }

  async updateManagedRoomsAutoExpiration(input: UpdateManagedRoomsAutoExpirationRequest): Promise<ManagedRoomSummary[]> {
    const roomIds = normalizeManagedRoomIds(input.roomIds);
    const autoExpireAfterHours = normalizeAutoExpireAfterHours(input.autoExpireAfterHours);

    await this.database.room.updateMany({
      where: {
        id: {
          in: roomIds,
        },
      },
      data: {
        autoExpireAfterHours,
      },
    });

    const rooms = await this.database.room.findMany({
      where: {
        id: {
          in: roomIds,
        },
      },
      orderBy: {
        lastActivityAt: "desc",
      },
      select: {
        id: true,
        slug: true,
        name: true,
        adminId: true,
        clubId: true,
        visibility: true,
        status: true,
        passwordHash: true,
        maxPlayers: true,
        startingStack: true,
        autoStartNextHand: true,
        autoStartDelaySeconds: true,
        autoExpireAfterHours: true,
        blindSchedule: true,
        runtimeState: true,
        createdAt: true,
        lastActivityAt: true,
        updatedAt: true,
        admin: {
          select: {
            username: true,
          },
        },
      },
    });

    for (const room of rooms) {
      await this.onRoomUpdated?.(room.slug);
    }

    return rooms.map((room) => buildManagedRoomSummary(room, this.requireRuntimeState(room)));
  }

  async deleteManagedRooms(input: DeleteManagedRoomsRequest): Promise<DeleteManagedRoomsResult> {
    const roomIds = normalizeManagedRoomIds(input.roomIds);
    const rooms = await this.database.$transaction(async (transaction) => {
      const existingRooms = await transaction.room.findMany({
        where: {
          id: {
            in: roomIds,
          },
        },
        select: {
          id: true,
          slug: true,
        },
      });

      if (existingRooms.length === 0) {
        return [];
      }

      await transaction.room.deleteMany({
        where: {
          id: {
            in: existingRooms.map((room) => room.id),
          },
        },
      });

      return existingRooms;
    });

    const deletedSlugs = rooms.map((room) => room.slug);

    if (deletedSlugs.length > 0) {
      await this.onRoomsDeleted?.(deletedSlugs);
    }

    return {
      deletedRoomIds: rooms.map((room) => room.id),
      deletedSlugs,
    };
  }

  async joinRoom(input: JoinRoomRequest): Promise<RoomSnapshot> {
    const room = await this.requireRoom(input.slug);
    const runtimeState = this.requireRuntimeState(room);

    if (room.passwordHash && !input.accountId) {
      throw new Error("Sign in before joining a password-protected room.");
    }

    if (room.passwordHash && !verifySecret(input.password ?? "", room.passwordHash)) {
      throw new Error("Room password is incorrect.");
    }

    if (!input.accountId) {
      return this.toSnapshot(runtimeState, input.accountId);
    }

    const joinedViewerAccountIds = ensureJoinedViewerAccountIds([...runtimeState.joinedViewerAccountIds, input.accountId], runtimeState.table);

    if (haveSameStringEntries(joinedViewerAccountIds, runtimeState.joinedViewerAccountIds)) {
      return this.toSnapshot(runtimeState, input.accountId);
    }

    const nextRuntimeState: PersistedRoomRuntimeState = {
      ...runtimeState,
      joinedViewerAccountIds,
    };

    await this.database.room.update({
      where: { id: room.id },
      data: this.roomUpdatePayload(nextRuntimeState),
    });

    await this.onRoomUpdated?.(input.slug);
    return this.toSnapshot(nextRuntimeState, input.accountId);
  }

  async seatPlayer(input: SeatPlayerRequest): Promise<RoomSnapshot> {
    const room = await this.requireRoom(input.slug);
    const runtimeState = this.requireRuntimeState(room);
    this.assertViewerHasRoomAccess(runtimeState, input.accountId);
    const requestedStack = normalizeRequestedStack(input.requestedStack, runtimeState.table.startingStack);

    if (runtimeState.table.adminAccountId !== input.accountId) {
      if (runtimeState.table.players.some((player) => player.accountId === input.accountId)) {
        throw new Error("Player is already seated at this table.");
      }

      if (runtimeState.table.players.some((player) => player.seatIndex === input.seatIndex)) {
        throw new Error("Seat is already occupied.");
      }

      const existingRequest = runtimeState.pendingSeatRequests.find((request) => request.accountId === input.accountId) ?? null;
      const nextRuntimeState: PersistedRoomRuntimeState = {
        ...runtimeState,
        pendingSeatRequests: [
          ...runtimeState.pendingSeatRequests.filter((request) => request.accountId !== input.accountId),
          {
            id: existingRequest?.id ?? `seatreq_${crypto.randomUUID()}`,
            accountId: input.accountId,
            displayName: input.displayName,
            seatIndex: input.seatIndex,
            requestedStack,
            createdAt: existingRequest?.createdAt ?? new Date().toISOString(),
          },
        ],
      };

      await this.database.room.update({
        where: { id: room.id },
        data: this.roomUpdatePayload(nextRuntimeState),
      });

      await this.onRoomUpdated?.(input.slug);
      return this.toSnapshot(nextRuntimeState, input.accountId);
    }

    const seatAccounting = await this.getSeatApprovalAccounting(room.id, runtimeState, input.accountId, requestedStack);
    const { nextRuntimeState, table } = applyApprovedSeat(runtimeState, {
      accountId: input.accountId,
      displayName: input.displayName,
      seatIndex: input.seatIndex,
      requestedStack,
    }, seatAccounting);

    await this.database.$transaction(async (transaction) => {
      await transaction.tableParticipant.upsert({
        where: {
          roomId_userId: {
            roomId: room.id,
            userId: input.accountId,
          },
        },
        update: {
          displayName: input.displayName,
          seatIndex: input.seatIndex,
          leftAt: null,
          buyInTotal: {
            increment: requestedStack,
          },
        },
        create: {
          roomId: room.id,
          userId: input.accountId,
          displayName: input.displayName,
          seatIndex: input.seatIndex,
          buyInTotal: requestedStack,
        },
      });

      await transaction.room.update({
        where: { id: room.id },
        data: this.roomUpdatePayload(nextRuntimeState),
      });
    });

    await this.onRoomUpdated?.(input.slug);
    return this.toSnapshot(nextRuntimeState, input.accountId);
  }

  async setReady(input: PlayerReadyRequest): Promise<RoomSnapshot> {
    const room = await this.requireRoom(input.slug);
    const runtimeState = this.requireRuntimeState(room);
    this.assertViewerHasRoomAccess(runtimeState, input.accountId);
    const table = setPlayerReady(runtimeState.table, input.accountId, input.isReady);
    const nextRuntimeState = syncRuntimeState(runtimeState, table);

    await this.database.room.update({
      where: { id: room.id },
      data: this.roomUpdatePayload(nextRuntimeState),
    });

    await this.onRoomUpdated?.(input.slug);
    return this.toSnapshot(nextRuntimeState, input.accountId);
  }

  async setSittingOut(input: PlayerSitOutRequest): Promise<RoomSnapshot> {
    const room = await this.requireRoom(input.slug);
    const runtimeState = this.requireRuntimeState(room);
    this.assertViewerHasRoomAccess(runtimeState, input.accountId);
    const table = setPlayerSittingOut(runtimeState.table, input.accountId, input.isSittingOut);
    const nextRuntimeState = syncRuntimeState(runtimeState, table);

    await this.database.room.update({
      where: { id: room.id },
      data: this.roomUpdatePayload(nextRuntimeState),
    });

    await this.onRoomUpdated?.(input.slug);
    return this.toSnapshot(nextRuntimeState, input.accountId);
  }

  async leaveSeat(input: LeaveSeatRequest): Promise<RoomSnapshot> {
    const room = await this.requireRoom(input.slug);
    const runtimeState = this.requireRuntimeState(room);
    this.assertViewerHasRoomAccess(runtimeState, input.accountId);
    const table = leaveSeat(runtimeState.table, input.accountId);
    const nextRuntimeState = syncRuntimeState(runtimeState, table);

    await this.database.$transaction(async (transaction) => {
      await transaction.tableParticipant.updateMany({
        where: {
          roomId: room.id,
          userId: input.accountId,
        },
        data: {
          seatIndex: null,
          leftAt: new Date(),
        },
      });

      await transaction.room.update({
        where: { id: room.id },
        data: this.roomUpdatePayload(nextRuntimeState),
      });
    });

    await this.onRoomUpdated?.(input.slug);
    return this.toSnapshot(nextRuntimeState, input.accountId);
  }

  async postReaction(input: RoomReactionRequest): Promise<RoomSnapshot> {
    const room = await this.requireRoom(input.slug);
    const runtimeState = this.requireRuntimeState(room);
    this.assertViewerHasRoomAccess(runtimeState, input.accountId);
    const emoji = normalizeReactionEmoji(input.emoji);
    const now = new Date();

    const nextRuntimeState: PersistedRoomRuntimeState = {
      ...runtimeState,
      seatReactions: [
        ...runtimeState.seatReactions.filter((reaction) => reaction.accountId !== input.accountId && Date.parse(reaction.expiresAt) > now.getTime()),
        {
          id: `react_${crypto.randomUUID()}`,
          accountId: input.accountId,
          emoji,
          createdAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + REACTION_DURATION_MS).toISOString(),
        },
      ].slice(-MAX_SEAT_REACTIONS),
    };

    await this.database.room.update({
      where: { id: room.id },
      data: this.roomUpdatePayload(nextRuntimeState),
    });

    await this.onRoomUpdated?.(input.slug);
    return this.toSnapshot(nextRuntimeState, input.accountId);
  }

  async setGesture(input: RoomGestureRequest): Promise<RoomSnapshot> {
    const room = await this.requireRoom(input.slug);
    const runtimeState = this.requireRuntimeState(room);
    this.assertViewerHasRoomAccess(runtimeState, input.accountId);
    const now = new Date();

    const nextRuntimeState: PersistedRoomRuntimeState = {
      ...runtimeState,
      seatGestures: input.emoji
        ? [
            ...runtimeState.seatGestures.filter((gesture) => gesture.accountId !== input.accountId),
            {
              accountId: input.accountId,
              emoji: normalizeReactionEmoji(input.emoji),
              updatedAt: now.toISOString(),
            },
          ].slice(-MAX_SEAT_GESTURES)
        : runtimeState.seatGestures.filter((gesture) => gesture.accountId !== input.accountId),
    };

    await this.database.room.update({
      where: { id: room.id },
      data: this.roomUpdatePayload(nextRuntimeState),
    });

    await this.onRoomUpdated?.(input.slug);
    return this.toSnapshot(nextRuntimeState, input.accountId);
  }

  async postChatMessage(input: RoomChatRequest): Promise<RoomSnapshot> {
    const room = await this.requireRoom(input.slug);
    const runtimeState = this.requireRuntimeState(room);
    this.assertViewerHasRoomAccess(runtimeState, input.accountId);
    const content = input.content.trim();

    if (content.length === 0) {
      throw new Error("Chat message cannot be empty.");
    }

    if (content.length > 240) {
      throw new Error("Chat messages must be 240 characters or less.");
    }

    const seatedPlayer = runtimeState.table.players.find((player) => player.accountId === input.accountId) ?? null;
    const displayName = input.displayName?.trim() || seatedPlayer?.displayName || input.accountId;
    const nextRuntimeState: PersistedRoomRuntimeState = {
      ...runtimeState,
      chatMessages: [
        ...runtimeState.chatMessages,
        {
          id: `chat_${crypto.randomUUID()}`,
          accountId: input.accountId,
          displayName,
          content,
          createdAt: new Date().toISOString(),
        },
      ].slice(-MAX_CHAT_MESSAGES),
    };

    await this.database.room.update({
      where: { id: room.id },
      data: this.roomUpdatePayload(nextRuntimeState),
    });

    await this.onRoomUpdated?.(input.slug);
    return this.toSnapshot(nextRuntimeState, input.accountId);
  }

  async rebuyPlayer(input: RoomRebuyRequest): Promise<RoomSnapshot> {
    const room = await this.requireRoom(input.slug);
    const runtimeState = this.requireRuntimeState(room);
    this.assertViewerHasRoomAccess(runtimeState, input.accountId);
    const amount = normalizeRebuyAmount(input.amount, runtimeState.buyInState.minRebuyAmount, runtimeState.buyInState.maxRebuyAmount);
    const seatedPlayer = runtimeState.table.players.find((player) => player.accountId === input.accountId) ?? null;

    if (!seatedPlayer) {
      throw new Error("Player is not seated at this table.");
    }

    if (seatedPlayer.stack > 0) {
      throw new Error("Rebuy is only available after you are out of chips.");
    }

    if (runtimeState.table.adminAccountId !== input.accountId) {
      const existingRequest = runtimeState.pendingRebuyRequests.find((request) => request.accountId === input.accountId) ?? null;
      const nextRuntimeState: PersistedRoomRuntimeState = {
        ...runtimeState,
        pendingRebuyRequests: [
          ...runtimeState.pendingRebuyRequests.filter((request) => request.accountId !== input.accountId),
          {
            id: existingRequest?.id ?? `rebuyreq_${crypto.randomUUID()}`,
            accountId: input.accountId,
            displayName: seatedPlayer.displayName,
            amount,
            createdAt: existingRequest?.createdAt ?? new Date().toISOString(),
          },
        ],
      };

      await this.database.room.update({
        where: { id: room.id },
        data: this.roomUpdatePayload(nextRuntimeState),
      });

      await this.onRoomUpdated?.(input.slug);
      return this.toSnapshot(nextRuntimeState, input.accountId);
    }

    const nextRuntimeState = applyApprovedRebuy(runtimeState, input.accountId, amount);

    await this.database.$transaction(async (transaction) => {
      await transaction.tableParticipant.updateMany({
        where: {
          roomId: room.id,
          userId: input.accountId,
        },
        data: {
          buyInTotal: {
            increment: amount,
          },
        },
      });

      await transaction.room.update({
        where: { id: room.id },
        data: this.roomUpdatePayload(nextRuntimeState),
      });
    });

    await this.onRoomUpdated?.(input.slug);
    return this.toSnapshot(nextRuntimeState, input.accountId);
  }

  async decideSeatRequest(input: RoomSeatRequestDecision): Promise<RoomSnapshot> {
    const room = await this.requireRoom(input.slug);
    const runtimeState = this.requireRuntimeState(room);
    this.assertViewerHasRoomAccess(runtimeState, input.accountId);

    if (runtimeState.table.adminAccountId !== input.accountId) {
      throw new Error("Only the room admin can approve seat requests.");
    }

    const request = runtimeState.pendingSeatRequests.find((entry) => entry.id === input.requestId) ?? null;

    if (!request) {
      throw new Error("Seat request was not found.");
    }

    if (!input.approved) {
      const nextRuntimeState: PersistedRoomRuntimeState = {
        ...runtimeState,
        pendingSeatRequests: runtimeState.pendingSeatRequests.filter((entry) => entry.id !== input.requestId),
      };

      await this.database.room.update({
        where: { id: room.id },
        data: this.roomUpdatePayload(nextRuntimeState),
      });

      await this.onRoomUpdated?.(input.slug);
      return this.toSnapshot(nextRuntimeState, input.accountId);
    }

    const requestedStack = normalizeRequestedStack(input.requestedStack, request.requestedStack);
    const approvedRequest = {
      ...request,
      requestedStack,
    } satisfies RoomPendingSeatRequest;
    const seatAccounting = await this.getSeatApprovalAccounting(room.id, runtimeState, request.accountId, requestedStack);
    const { nextRuntimeState } = applyApprovedSeat(runtimeState, approvedRequest, seatAccounting);
    const approvedRuntimeState: PersistedRoomRuntimeState = {
      ...nextRuntimeState,
      pendingSeatRequests: nextRuntimeState.pendingSeatRequests.filter((entry) => entry.id !== input.requestId),
    };

    await this.database.$transaction(async (transaction) => {
      await transaction.tableParticipant.upsert({
        where: {
          roomId_userId: {
            roomId: room.id,
            userId: request.accountId,
          },
        },
        update: {
          displayName: request.displayName,
          seatIndex: request.seatIndex,
          leftAt: null,
          buyInTotal: {
            increment: requestedStack,
          },
        },
        create: {
          roomId: room.id,
          userId: request.accountId,
          displayName: request.displayName,
          seatIndex: request.seatIndex,
          buyInTotal: requestedStack,
        },
      });

      await transaction.room.update({
        where: { id: room.id },
        data: this.roomUpdatePayload(approvedRuntimeState),
      });
    });

    await this.onRoomUpdated?.(input.slug);
    return this.toSnapshot(approvedRuntimeState, input.accountId);
  }

  async decideRebuyRequest(input: RoomRebuyRequestDecision): Promise<RoomSnapshot> {
    const room = await this.requireRoom(input.slug);
    const runtimeState = this.requireRuntimeState(room);
    this.assertViewerHasRoomAccess(runtimeState, input.accountId);

    if (runtimeState.table.adminAccountId !== input.accountId) {
      throw new Error("Only the room admin can approve rebuys.");
    }

    const request = runtimeState.pendingRebuyRequests.find((entry) => entry.id === input.requestId) ?? null;

    if (!request) {
      throw new Error("Rebuy request was not found.");
    }

    if (!input.approved) {
      const nextRuntimeState: PersistedRoomRuntimeState = {
        ...runtimeState,
        pendingRebuyRequests: runtimeState.pendingRebuyRequests.filter((entry) => entry.id !== input.requestId),
      };

      await this.database.room.update({
        where: { id: room.id },
        data: this.roomUpdatePayload(nextRuntimeState),
      });

      await this.onRoomUpdated?.(input.slug);
      return this.toSnapshot(nextRuntimeState, input.accountId);
    }

    const amount = normalizeRebuyAmount(input.amount ?? request.amount, runtimeState.buyInState.minRebuyAmount, runtimeState.buyInState.maxRebuyAmount);
    const approvedRuntimeState = {
      ...applyApprovedRebuy(runtimeState, request.accountId, amount),
      pendingRebuyRequests: runtimeState.pendingRebuyRequests.filter((entry) => entry.id !== input.requestId),
    } satisfies PersistedRoomRuntimeState;

    await this.database.$transaction(async (transaction) => {
      await transaction.tableParticipant.updateMany({
        where: {
          roomId: room.id,
          userId: request.accountId,
        },
        data: {
          buyInTotal: {
            increment: amount,
          },
        },
      });

      await transaction.room.update({
        where: { id: room.id },
        data: this.roomUpdatePayload(approvedRuntimeState),
      });
    });

    await this.onRoomUpdated?.(input.slug);
    return this.toSnapshot(approvedRuntimeState, input.accountId);
  }

  async updateAdminOptions(input: UpdateRoomAdminOptionsRequest): Promise<RoomSnapshot> {
    const room = await this.requireRoom(input.slug);
    const runtimeState = this.requireRuntimeState(room);
    this.assertViewerHasRoomAccess(runtimeState, input.accountId);

    if (runtimeState.table.adminAccountId !== input.accountId) {
      throw new Error("Only the room admin can update table options.");
    }

    const now = new Date();
    const blindSchedule = normalizeBlindSchedule(input.blindSchedule);
    const turnSeconds = normalizeOptionalWholeNumber(input.turnSeconds, "Decision time limit");
    const timeBankSeconds = normalizeOptionalWholeNumber(input.timeBankSeconds, "Time bank length");
    const timeBankRefillHands = normalizeOptionalWholeNumber(input.timeBankRefillHands, "Time bank refill hands");

    if (input.autoStartDelaySeconds < 0) {
      throw new Error("Showdown presentation time cannot be negative.");
    }

    const table: TableState = {
      ...runtimeState.table,
      blindSchedule,
      autoStartNextHand: input.autoStartNextHand,
      autoStartDelaySeconds: input.autoStartDelaySeconds,
      revealAllShowdownHands: input.revealAllShowdownHands,
      nextHandStartsAt: runtimeState.table.currentHand
        ? null
        : input.autoStartNextHand && getActivePlayers(runtimeState.table).length >= 2
          ? new Date(now.getTime() + input.autoStartDelaySeconds * 1000).toISOString()
          : null,
      updatedAt: now.toISOString(),
    };
    const nextRuntimeState: PersistedRoomRuntimeState = {
      ...runtimeState,
      table,
      adminOptions: {
        decisionTimeSeconds: turnSeconds,
        timeBankSeconds,
        timeBankRefillHands,
        revealAllShowdownHands: input.revealAllShowdownHands,
      },
      turnState: {
        turnSeconds,
        timeBankSeconds,
        currentTurnStartedAt: runtimeState.turnState.currentTurnStartedAt,
        timeBankMsByAccount: resetOrClampTimeBankEntries(runtimeState.turnState.timeBankMsByAccount, table.players, timeBankSeconds),
      },
    };

    await this.database.room.update({
      where: { id: room.id },
      data: this.roomUpdatePayload(nextRuntimeState),
    });

    await this.onRoomUpdated?.(input.slug);
    return this.toSnapshot(nextRuntimeState, input.accountId);
  }

  async setRoomPaused(input: SetRoomPausedRequest): Promise<RoomSnapshot> {
    const room = await this.requireRoom(input.slug);
    const runtimeState = this.requireRuntimeState(room);
    this.assertViewerHasRoomAccess(runtimeState, input.accountId);

    if (runtimeState.table.adminAccountId !== input.accountId) {
      throw new Error("Only the room admin can pause the table.");
    }

    const now = new Date();

    if (input.isPaused) {
      const nextRuntimeState: PersistedRoomRuntimeState = {
        ...runtimeState,
        table: pauseTable(runtimeState.table, now),
        pauseState: {
          pausedAt: runtimeState.pauseState.pausedAt ?? now.toISOString(),
          totalPausedMs: runtimeState.pauseState.totalPausedMs,
        },
      };

      await this.database.room.update({
        where: { id: room.id },
        data: this.roomUpdatePayload(nextRuntimeState),
      });

      await this.onRoomUpdated?.(input.slug);
      return this.toSnapshot(nextRuntimeState, input.accountId);
    }

    const pausedAt = runtimeState.pauseState.pausedAt ? Date.parse(runtimeState.pauseState.pausedAt) : null;
    const pauseDurationMs = pausedAt && !Number.isNaN(pausedAt) ? Math.max(0, now.getTime() - pausedAt) : 0;
    const nextRuntimeState: PersistedRoomRuntimeState = {
      ...runtimeState,
      table: resumeTable(runtimeState.table, now),
      pauseState: {
        pausedAt: null,
        totalPausedMs: runtimeState.pauseState.totalPausedMs + pauseDurationMs,
      },
      turnState: {
        ...runtimeState.turnState,
        currentTurnStartedAt: shiftIsoByMs(runtimeState.turnState.currentTurnStartedAt, pauseDurationMs),
      },
    };

    await this.database.room.update({
      where: { id: room.id },
      data: this.roomUpdatePayload(nextRuntimeState),
    });

    await this.onRoomUpdated?.(input.slug);
    return this.toSnapshot(nextRuntimeState, input.accountId);
  }

  async stopRoom(input: StopRoomRequest): Promise<RoomSnapshot> {
    const room = await this.requireRoom(input.slug);
    const runtimeState = this.requireRuntimeState(room);
    this.assertViewerHasRoomAccess(runtimeState, input.accountId);

    if (runtimeState.table.adminAccountId !== input.accountId) {
      throw new Error("Only the room admin can stop the table.");
    }

    if (runtimeState.table.currentHand) {
      throw new Error("Finish the current hand before stopping the table.");
    }

    const now = new Date();
    const table: TableState = {
      ...runtimeState.table,
      status: "waiting",
      sessionStartedAt: null,
      nextHandStartsAt: null,
      players: runtimeState.table.players.map((player) => ({ ...player, isReady: false })),
      updatedAt: now.toISOString(),
    };
    const nextRuntimeState: PersistedRoomRuntimeState = {
      ...runtimeState,
      table,
      pauseState: {
        pausedAt: null,
        totalPausedMs: 0,
      },
      turnState: {
        ...runtimeState.turnState,
        currentTurnStartedAt: null,
        timeBankMsByAccount: resetOrClampTimeBankEntries({}, table.players, runtimeState.turnState.timeBankSeconds),
      },
    };

    await this.database.room.update({
      where: { id: room.id },
      data: this.roomUpdatePayload(nextRuntimeState),
    });

    await this.onRoomUpdated?.(input.slug);
    return this.toSnapshot(nextRuntimeState, input.accountId);
  }

  async removePlayer(input: RemovePlayerRequest): Promise<RoomSnapshot> {
    const room = await this.requireRoom(input.slug);
    const runtimeState = this.requireRuntimeState(room);
    this.assertViewerHasRoomAccess(runtimeState, input.accountId);

    if (runtimeState.table.adminAccountId !== input.accountId) {
      throw new Error("Only the room admin can remove players.");
    }

    if (input.targetAccountId === runtimeState.table.adminAccountId) {
      throw new Error("The room admin cannot remove themselves.");
    }

    if (runtimeState.table.currentHand?.holeCards[input.targetAccountId]) {
      throw new Error("Finish the current hand before removing that player.");
    }

    const table = leaveSeat(runtimeState.table, input.targetAccountId);
    const nextRuntimeState: PersistedRoomRuntimeState = {
      ...syncRuntimeState(runtimeState, table),
      pendingSeatRequests: runtimeState.pendingSeatRequests.filter((request) => request.accountId !== input.targetAccountId),
      pendingRebuyRequests: runtimeState.pendingRebuyRequests.filter((request) => request.accountId !== input.targetAccountId),
    };

    await this.database.$transaction(async (transaction) => {
      await transaction.tableParticipant.updateMany({
        where: {
          roomId: room.id,
          userId: input.targetAccountId,
        },
        data: {
          seatIndex: null,
          leftAt: new Date(),
        },
      });

      await transaction.room.update({
        where: { id: room.id },
        data: this.roomUpdatePayload(nextRuntimeState),
      });
    });

    await this.onRoomUpdated?.(input.slug);
    return this.toSnapshot(nextRuntimeState, input.accountId);
  }

  async revealCards(input: RoomRevealCardsRequest): Promise<RoomSnapshot> {
    const room = await this.requireRoom(input.slug);
    const runtimeState = this.requireRuntimeState(room);
    this.assertViewerHasRoomAccess(runtimeState, input.accountId);
    const lastCompletedHand = runtimeState.table.lastCompletedHand;
    const hiddenHoleCards = runtimeState.lastCompletedHandHoleCards;

    if (!lastCompletedHand || runtimeState.table.currentHand) {
      throw new Error("Card revealing is only available immediately after a completed hand.");
    }

    if (isAllInRunoutActive(lastCompletedHand, Date.now())) {
      throw new Error("Card revealing is available after the all-in board runout finishes.");
    }

    const playerHoleCards = hiddenHoleCards?.[input.accountId];

    if (!playerHoleCards) {
      throw new Error("No revealable cards are available for this player.");
    }

    const forcedReveal = isForcedShowdownReveal(lastCompletedHand, input.accountId);
    const revealMode: RevealMode = forcedReveal ? "both" : input.revealMode;
    const revealedCards = buildRevealedHoleCards(playerHoleCards, revealMode);
    const nextLastCompletedHand: LastHandResult = {
      ...lastCompletedHand,
      revealedHoleCards: mergeRevealedHoleCards(lastCompletedHand.revealedHoleCards, input.accountId, revealedCards),
    };
    const nextRuntimeState: PersistedRoomRuntimeState = {
      ...runtimeState,
      table: {
        ...runtimeState.table,
        updatedAt: new Date().toISOString(),
        lastCompletedHand: nextLastCompletedHand,
      },
      recentCompletedHands: runtimeState.recentCompletedHands.map((hand) => hand.handId === nextLastCompletedHand.handId ? nextLastCompletedHand : hand),
    };

    await this.database.room.update({
      where: { id: room.id },
      data: this.roomUpdatePayload(nextRuntimeState),
    });

    await this.onRoomUpdated?.(input.slug);
    return this.toSnapshot(nextRuntimeState, input.accountId);
  }

  async setPlayerConnection(input: PlayerConnectionRequest): Promise<RoomSnapshot> {
    const room = await this.requireRoom(input.slug);
    const runtimeState = this.requireRuntimeState(room);
    const existingTable = runtimeState.table;
    const table = setPlayerConnection(existingTable, {
      accountId: input.accountId,
      isConnected: input.isConnected,
    });

    if (table === existingTable) {
      return this.toSnapshot(runtimeState, input.accountId);
    }

    const nextRuntimeState = syncRuntimeState(runtimeState, table);

    await this.database.room.update({
      where: { id: room.id },
      data: this.roomUpdatePayload(nextRuntimeState),
    });

    await this.onRoomUpdated?.(input.slug);
    return this.toSnapshot(nextRuntimeState, input.accountId);
  }

  async cleanupBustedPlayers(slug: string): Promise<RoomSnapshot> {
    const room = await this.requireRoom(slug);
    const runtimeState = this.requireRuntimeState(room);
    const now = new Date();
    const bustedAccountIds = getBustedPlayerAccountIdsForCleanup(runtimeState.table, now.getTime());

    if (bustedAccountIds.length === 0) {
      return this.toSnapshot(runtimeState);
    }

    const nextRuntimeState = await this.persistBustedPlayerCleanup(room, runtimeState, bustedAccountIds, now, true);
    return this.toSnapshot(nextRuntimeState);
  }

  async startHand(input: StartHandRequest): Promise<RoomSnapshot> {
    const room = await this.requireRoom(input.slug);
    let runtimeState = this.requireRuntimeState(room);
    this.assertViewerHasRoomAccess(runtimeState, input.accountId);
    const now = new Date();

    if (runtimeState.table.adminAccountId !== input.accountId) {
      throw new Error("Only the room admin can start the next hand.");
    }

    const bustedAccountIds = getBustedPlayerAccountIdsForCleanup(runtimeState.table, now.getTime());

    if (bustedAccountIds.length > 0) {
      runtimeState = await this.persistBustedPlayerCleanup(room, runtimeState, bustedAccountIds, now, false);
    }

    const existingTable = runtimeState.table;

    if (existingTable.adminAccountId !== input.accountId) {
      if (bustedAccountIds.length > 0) {
        await this.onRoomUpdated?.(input.slug);
      }

      throw new Error("Only the room admin can start the next hand.");
    }

    let table: TableState;

    try {
      table = startHand(existingTable, { now });
    } catch (error) {
      if (bustedAccountIds.length > 0) {
        await this.onRoomUpdated?.(input.slug);
      }

      throw error;
    }

    const nextRuntimeState = syncRuntimeState(runtimeState, table, { now });

    await this.database.$transaction(async (transaction) => {
      let session = await transaction.tableSession.findFirst({
        where: {
          roomId: room.id,
          endedAt: null,
        },
        orderBy: { startedAt: "desc" },
      });

      if (!session) {
        session = await transaction.tableSession.create({
          data: {
            roomId: room.id,
            startedById: input.accountId,
            blindSchedule: toJsonValue(table.blindSchedule),
          },
        });
      }

      const hand = table.currentHand;

      if (!hand) {
        throw new Error("A hand was expected after starting the table.");
      }

      await transaction.hand.create({
        data: {
          sessionId: session.id,
          handNumber: hand.handNumber,
          dealerSeat: hand.dealerSeat,
          smallBlindSeat: hand.smallBlindSeat,
          bigBlindSeat: hand.bigBlindSeat,
          smallBlind: hand.blindLevel.smallBlind,
          bigBlind: hand.blindLevel.bigBlind,
          ante: hand.blindLevel.ante ?? 0,
          street: "PREFLOP",
          boardCards: toJsonValue(hand.board),
          startedAt: new Date(hand.startedAt),
        },
      });

      await transaction.room.update({
        where: { id: room.id },
        data: this.roomUpdatePayload(nextRuntimeState),
      });
    });

    await this.onRoomUpdated?.(input.slug);
    return this.toSnapshot(nextRuntimeState, input.accountId);
  }

  async actOnHand(input: RoomActionRequest): Promise<RoomSnapshot> {
    const room = await this.requireRoom(input.slug);
    const runtimeState = this.requireRuntimeState(room);
    this.assertViewerHasRoomAccess(runtimeState, input.accountId);
    const existingTable = runtimeState.table;
    const now = new Date();
    const table = applyPlayerAction(existingTable, {
      accountId: input.accountId,
      type: input.actionType,
      amount: input.amount,
    }, now);
    const nextRuntimeState = syncRuntimeState(runtimeState, table, {
      now,
      actingAccountId: input.accountId,
    });

    await this.database.$transaction(async (transaction) => {
      await transaction.room.update({
        where: { id: room.id },
        data: this.roomUpdatePayload(nextRuntimeState),
      });

      const persistedHand = await transaction.hand.findFirst({
        where: {
          session: { roomId: room.id },
          handNumber: table.currentHand?.handNumber ?? table.lastCompletedHand?.handNumber ?? existingTable.currentHand?.handNumber,
        },
        orderBy: { startedAt: "desc" },
      });

      if (!persistedHand) {
        return;
      }

      if (table.currentHand) {
        await transaction.hand.update({
          where: { id: persistedHand.id },
          data: {
            street: toPrismaStreet(table.currentHand.street),
            boardCards: toJsonValue(table.currentHand.board),
          },
        });
        return;
      }

      const completedHand = existingTable.currentHand;

      if (!table.lastCompletedHand || !completedHand) {
        return;
      }

      await transaction.hand.update({
        where: { id: persistedHand.id },
        data: {
          street: toPrismaStreet(table.lastCompletedHand.winningReason === "showdown" ? "showdown" : completedHand.street),
          boardCards: toJsonValue(table.lastCompletedHand.board),
          completedAt: new Date(table.lastCompletedHand.concludedAt),
        },
      });

      const participantRecords = await transaction.tableParticipant.findMany({
        where: {
          roomId: room.id,
          userId: {
            in: Object.keys(completedHand.holeCards),
          },
        },
      });
      const participantByUserId = new Map(participantRecords.map((participant) => [participant.userId, participant]));
      const winningsByUserId = new Map(table.lastCompletedHand.winners.map((winner) => [winner.accountId, winner.amountWon]));

      await transaction.handResult.createMany({
        data: Object.keys(completedHand.holeCards)
          .map((accountId) => {
            const participant = participantByUserId.get(accountId);
            const player = table.players.find((entry) => entry.accountId === accountId);

            if (!participant || !player) {
              return null;
            }

            return {
              handId: persistedHand.id,
              participantId: participant.id,
              netChips: (winningsByUserId.get(accountId) ?? 0) - (completedHand.contributions[accountId] ?? 0),
              finalStack: player.stack,
              holeCards: toJsonValue(completedHand.holeCards[accountId]),
            };
          })
          .filter((record): record is NonNullable<typeof record> => record !== null),
        skipDuplicates: true,
      });
    });

    await this.onRoomUpdated?.(input.slug);
    return this.toSnapshot(nextRuntimeState, input.accountId);
  }

  async getRoomSnapshot(slug: string, accountId?: string): Promise<RoomSnapshot> {
    const room = await this.requireRoom(slug);
    const runtimeState = this.requireRuntimeState(room);
    const bustedAccountIds = getBustedPlayerAccountIdsForCleanup(runtimeState.table, Date.now());

    if (bustedAccountIds.length === 0) {
      return this.toInternalSnapshot(runtimeState, accountId);
    }

    const nextRuntimeState = await this.persistBustedPlayerCleanup(room, runtimeState, bustedAccountIds, new Date(), false);
    return this.toInternalSnapshot(nextRuntimeState, accountId);
  }

  async getViewerRoomSnapshot(slug: string, accountId?: string): Promise<RoomSnapshot> {
    const room = await this.requireRoom(slug);
    const runtimeState = this.requireRuntimeState(room);
    const bustedAccountIds = getBustedPlayerAccountIdsForCleanup(runtimeState.table, Date.now());

    if (bustedAccountIds.length === 0) {
      return this.toSnapshot(runtimeState, accountId);
    }

    const nextRuntimeState = await this.persistBustedPlayerCleanup(room, runtimeState, bustedAccountIds, new Date(), false);
    return this.toSnapshot(nextRuntimeState, accountId);
  }

  private async persistBustedPlayerCleanup(
    room: PersistedRoomRecord,
    runtimeState: PersistedRoomRuntimeState,
    bustedAccountIds: string[],
    now: Date,
    notify: boolean,
  ): Promise<PersistedRoomRuntimeState> {
    const activeBustedAccountIds = bustedAccountIds.filter((accountId) => runtimeState.table.players.some((player) => player.accountId === accountId));

    if (activeBustedAccountIds.length === 0) {
      return runtimeState;
    }

    let table = runtimeState.table;

    for (const accountId of activeBustedAccountIds) {
      table = leaveSeat(table, accountId, now);
    }

    const nextRuntimeState = syncRuntimeState({
      ...runtimeState,
      pendingRebuyRequests: runtimeState.pendingRebuyRequests.filter((request) => !activeBustedAccountIds.includes(request.accountId)),
    }, table, { now });

    await this.database.$transaction(async (transaction) => {
      await transaction.tableParticipant.updateMany({
        where: {
          roomId: room.id,
          userId: {
            in: activeBustedAccountIds,
          },
        },
        data: {
          seatIndex: null,
          leftAt: now,
        },
      });

      await transaction.room.update({
        where: { id: room.id },
        data: this.roomUpdatePayload(nextRuntimeState),
      });
    });

    if (notify) {
      await this.onRoomUpdated?.(room.slug);
    }

    return nextRuntimeState;
  }

  private roomUpdatePayload(runtimeState: PersistedRoomRuntimeState, lastActivityAt: Date = new Date()): Prisma.RoomUncheckedUpdateInput {
    const table = runtimeState.table;

    return {
      name: table.name,
      adminId: table.adminAccountId,
      clubId: table.clubId,
      visibility: toPrismaVisibility(table.visibility),
      maxPlayers: table.maxPlayers,
      startingStack: table.startingStack,
      autoStartNextHand: table.autoStartNextHand,
      autoStartDelaySeconds: table.autoStartDelaySeconds,
      blindSchedule: toJsonValue(table.blindSchedule),
      status: toPrismaStatus(table.status),
      lastActivityAt,
      runtimeState: toJsonValue(runtimeState),
    };
  }

  private async requireRoom(slug: string): Promise<PersistedRoomRecord> {
    const room = await this.database.room.findUnique({
      where: { slug },
      select: {
        id: true,
        slug: true,
        name: true,
        adminId: true,
        clubId: true,
        visibility: true,
        status: true,
        passwordHash: true,
        maxPlayers: true,
        startingStack: true,
        autoStartNextHand: true,
        autoStartDelaySeconds: true,
        autoExpireAfterHours: true,
        blindSchedule: true,
        runtimeState: true,
        createdAt: true,
        lastActivityAt: true,
        updatedAt: true,
      },
    });

    if (!room) {
      throw new Error("Room not found.");
    }

    return room;
  }

  private requireRuntimeState(room: PersistedRoomRecord): PersistedRoomRuntimeState {
    if (!room.runtimeState) {
      throw new Error("Room runtime state is missing.");
    }

    const parsed = JSON.parse(JSON.stringify(room.runtimeState)) as PersistedRoomRuntimeState | TableState;

    if (isPersistedRuntimeState(parsed)) {
      return normalizeRuntimeState(parsed);
    }

    return createRuntimeState(parsed);
  }

  private assertViewerHasRoomAccess(runtimeState: PersistedRoomRuntimeState, accountId?: string): void {
    if (!hasViewerRoomAccess(runtimeState, accountId)) {
      throw new Error("Join the room with the correct password before entering.");
    }
  }

  private async allocateSlug(seed: string): Promise<string> {
    const base = slugify(seed);
    let candidate = base;
    let suffix = 1;

    while (await this.database.room.findUnique({ where: { slug: candidate }, select: { id: true } })) {
      suffix += 1;
      candidate = `${base}-${suffix}`;
    }

    return candidate;
  }

  private async assertAdminExists(accountId: string): Promise<{ id: string; username: string }> {
    const user = await this.database.user.findUnique({
      where: { id: accountId },
      select: { id: true, username: true },
    });

    if (!user) {
      throw new Error("Admin account does not exist.");
    }

    return user;
  }

  private async assertRoomCreationAllowed(adminUser: { id: string; username: string }, sessionToken?: string): Promise<void> {
    const config = getRoomCreationAdminConfig();

    if (!config.adminOnly) {
      return;
    }

    if (!config.adminUsername) {
      throw new Error("ROOM_CREATION_ADMIN_USERNAME must be set when ROOM_CREATION_ADMIN_ONLY is enabled.");
    }

    if (!isConfiguredRoomCreationAdmin(adminUser.username, config.adminUsername)) {
      throw new Error(`Only ${config.adminUsername} can create tables on this site.`);
    }

    if (!sessionToken) {
      throw new Error(`Sign in as ${config.adminUsername} before creating a room.`);
    }

    const sessionAccount = await this.getAccountBySessionToken(sessionToken);

    if (!sessionAccount || sessionAccount.id !== adminUser.id || !isConfiguredRoomCreationAdmin(sessionAccount.username, config.adminUsername)) {
      throw new Error(`Only ${config.adminUsername} can create tables on this site.`);
    }
  }

  private async getAccountBySessionToken(token: string): Promise<{ id: string; username: string } | null> {
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const session = await this.database.session.findUnique({
      where: { tokenHash },
      select: {
        expiresAt: true,
        user: {
          select: {
            id: true,
            username: true,
          },
        },
      },
    });

    if (!session || session.expiresAt.getTime() <= Date.now()) {
      return null;
    }

    return session.user;
  }

  private async assertClubExists(clubId?: string): Promise<void> {
    if (!clubId) {
      return;
    }

    const club = await this.database.club.findUnique({
      where: { id: clubId },
      select: { id: true },
    });

    if (!club) {
      throw new Error("Club does not exist.");
    }
  }

  private async getSeatApprovalAccounting(
    roomId: string,
    runtimeState: PersistedRoomRuntimeState,
    accountId: string,
    requestedStack: number,
  ): Promise<{ nextBuyInTotal: number; countsAsRebuy: boolean }> {
    const participant = await this.database.tableParticipant.findUnique({
      where: {
        roomId_userId: {
          roomId,
          userId: accountId,
        },
      },
      select: {
        buyInTotal: true,
      },
    });

    return buildSeatApprovalAccounting(runtimeState, accountId, requestedStack, participant?.buyInTotal ?? null);
  }

  private toInternalSnapshot(runtimeState: PersistedRoomRuntimeState, accountId?: string): RoomSnapshot {
    return buildFullRoomSnapshot(runtimeState, accountId, hasViewerRoomAccess(runtimeState, accountId));
  }

  private toSnapshot(runtimeState: PersistedRoomRuntimeState, accountId?: string): RoomSnapshot {
    if (hasViewerRoomAccess(runtimeState, accountId)) {
      return buildFullRoomSnapshot(runtimeState, accountId, true);
    }

    return buildLockedRoomSnapshot(runtimeState);
  }
}

function createRuntimeState(table: TableState): PersistedRoomRuntimeState {
  return {
    table,
    joinedViewerAccountIds: ensureJoinedViewerAccountIds([], table),
    chatMessages: [],
    seatReactions: [],
    seatGestures: [],
    buyInState: {
      minRebuyAmount: Math.max(100, Math.floor(table.startingStack / 20)),
      maxRebuyAmount: table.startingStack * 5,
      buyInTotalByAccount: ensureBuyInEntries({}, table.players, table.startingStack),
    },
    playerStats: {
      handsWonByAccount: ensureCounterEntries({}, table.players),
      rebuyCountByAccount: ensureCounterEntries({}, table.players),
    },
    turnState: {
      turnSeconds: DEFAULT_TURN_SECONDS,
      timeBankSeconds: DEFAULT_TIMEBANK_SECONDS,
      currentTurnStartedAt: table.currentHand?.startedAt ?? null,
      timeBankMsByAccount: ensureTimeBankEntries({}, table.players, DEFAULT_TIMEBANK_SECONDS),
    },
    adminOptions: {
      decisionTimeSeconds: DEFAULT_TURN_SECONDS,
      timeBankSeconds: DEFAULT_TIMEBANK_SECONDS,
      timeBankRefillHands: null,
      revealAllShowdownHands: table.revealAllShowdownHands,
    },
    pendingSeatRequests: [],
    pendingRebuyRequests: [],
    pauseState: {
      pausedAt: null,
      totalPausedMs: 0,
    },
    recentCompletedHands: table.lastCompletedHand ? [table.lastCompletedHand] : [],
    lastCompletedHandHoleCards: null,
  };
}

function normalizeRuntimeState(runtimeState: PersistedRoomRuntimeState): PersistedRoomRuntimeState {
  const turnSeconds = normalizeOptionalRuntimeSetting(runtimeState.turnState?.turnSeconds, DEFAULT_TURN_SECONDS);
  const timeBankSeconds = normalizeOptionalRuntimeSetting(runtimeState.turnState?.timeBankSeconds, DEFAULT_TIMEBANK_SECONDS);
  const normalizedLastCompletedHand = normalizeCompletedHand(runtimeState.table.lastCompletedHand);
  const revealAllShowdownHands = runtimeState.adminOptions?.revealAllShowdownHands ?? runtimeState.table.revealAllShowdownHands ?? false;

  return {
    table: {
      ...runtimeState.table,
      revealAllShowdownHands,
      lastCompletedHand: normalizedLastCompletedHand,
    },
    joinedViewerAccountIds: ensureJoinedViewerAccountIds(runtimeState.joinedViewerAccountIds ?? [], runtimeState.table),
    chatMessages: Array.isArray(runtimeState.chatMessages) ? runtimeState.chatMessages.slice(-MAX_CHAT_MESSAGES) : [],
    seatReactions: Array.isArray(runtimeState.seatReactions)
      ? runtimeState.seatReactions.filter((reaction) => reaction && typeof reaction.expiresAt === "string").slice(-MAX_SEAT_REACTIONS)
      : [],
    seatGestures: Array.isArray(runtimeState.seatGestures)
      ? runtimeState.seatGestures.filter((gesture) => gesture && typeof gesture.accountId === "string" && typeof gesture.emoji === "string" && typeof gesture.updatedAt === "string").slice(-MAX_SEAT_GESTURES)
      : [],
    buyInState: {
      minRebuyAmount: runtimeState.buyInState?.minRebuyAmount ?? Math.max(100, Math.floor(runtimeState.table.startingStack / 20)),
      maxRebuyAmount: runtimeState.buyInState?.maxRebuyAmount ?? runtimeState.table.startingStack * 5,
      buyInTotalByAccount: ensureBuyInEntries(runtimeState.buyInState?.buyInTotalByAccount ?? {}, runtimeState.table.players, runtimeState.table.startingStack),
    },
    playerStats: {
      handsWonByAccount: ensureCounterEntries(runtimeState.playerStats?.handsWonByAccount ?? {}, runtimeState.table.players),
      rebuyCountByAccount: ensureCounterEntries(runtimeState.playerStats?.rebuyCountByAccount ?? {}, runtimeState.table.players),
    },
    turnState: {
      turnSeconds,
      timeBankSeconds,
      currentTurnStartedAt: runtimeState.table.currentHand
        ? runtimeState.turnState?.currentTurnStartedAt ?? runtimeState.table.currentHand.startedAt
        : null,
      timeBankMsByAccount: ensureTimeBankEntries(runtimeState.turnState?.timeBankMsByAccount ?? {}, runtimeState.table.players, timeBankSeconds),
    },
    adminOptions: {
      decisionTimeSeconds: turnSeconds,
      timeBankSeconds,
      timeBankRefillHands: normalizeOptionalRuntimeSetting(runtimeState.adminOptions?.timeBankRefillHands, null),
      revealAllShowdownHands,
    },
    pendingSeatRequests: Array.isArray(runtimeState.pendingSeatRequests)
      ? runtimeState.pendingSeatRequests.filter((request) => request && typeof request.id === "string")
      : [],
    pendingRebuyRequests: Array.isArray(runtimeState.pendingRebuyRequests)
      ? runtimeState.pendingRebuyRequests.filter((request) => request && typeof request.id === "string")
      : [],
    pauseState: {
      pausedAt: typeof runtimeState.pauseState?.pausedAt === "string" ? runtimeState.pauseState.pausedAt : null,
      totalPausedMs: typeof runtimeState.pauseState?.totalPausedMs === "number" && Number.isFinite(runtimeState.pauseState.totalPausedMs)
        ? runtimeState.pauseState.totalPausedMs
        : 0,
    },
    recentCompletedHands: normalizeCompletedHands(runtimeState.recentCompletedHands ?? (normalizedLastCompletedHand ? [normalizedLastCompletedHand] : [])),
    lastCompletedHandHoleCards: normalizeHoleCardsByAccount(runtimeState.lastCompletedHandHoleCards),
  };
}

function syncRuntimeState(
  runtimeState: PersistedRoomRuntimeState,
  table: TableState,
  options: {
    now?: Date;
    ensurePlayerAccountId?: string;
    actingAccountId?: string;
  } = {}
): PersistedRoomRuntimeState {
  const now = options.now ?? new Date();
  const turnState = debitTimeBankForAction(runtimeState.turnState, options.actingAccountId, now);
  const playerStats = syncPlayerStats(runtimeState.playerStats, runtimeState.table, table, options.ensurePlayerAccountId);
  const previousHand = runtimeState.table.currentHand;
  const nextHand = table.currentHand;
  const shouldRefillTimeBank = shouldRefillTimeBankAfterHand(runtimeState.table, table, runtimeState.adminOptions.timeBankRefillHands);
  const shouldResetTurnClock = Boolean(
    nextHand && (
      options.actingAccountId
      || !previousHand
      || previousHand.handNumber !== nextHand.handNumber
      || previousHand.actorSeat !== nextHand.actorSeat
      || previousHand.street !== nextHand.street
    )
  );

  return {
    ...runtimeState,
    table,
    joinedViewerAccountIds: ensureJoinedViewerAccountIds(runtimeState.joinedViewerAccountIds, table),
    seatReactions: runtimeState.seatReactions.filter((reaction) => Date.parse(reaction.expiresAt) > now.getTime()),
    seatGestures: filterSeatGesturesForPlayers(runtimeState.seatGestures, table.players),
    buyInState: {
      ...runtimeState.buyInState,
      minRebuyAmount: runtimeState.buyInState.minRebuyAmount,
      maxRebuyAmount: runtimeState.buyInState.maxRebuyAmount,
      buyInTotalByAccount: ensureBuyInEntries(runtimeState.buyInState.buyInTotalByAccount, table.players, table.startingStack, options.ensurePlayerAccountId),
    },
    playerStats,
    turnState: {
      ...turnState,
      currentTurnStartedAt: nextHand
        ? shouldResetTurnClock
          ? now.toISOString()
          : turnState.currentTurnStartedAt ?? nextHand.startedAt
        : null,
      timeBankMsByAccount: shouldRefillTimeBank
        ? resetOrClampTimeBankEntries({}, table.players, turnState.timeBankSeconds, options.ensurePlayerAccountId)
        : ensureTimeBankEntries(turnState.timeBankMsByAccount, table.players, turnState.timeBankSeconds, options.ensurePlayerAccountId),
    },
    adminOptions: {
      ...runtimeState.adminOptions,
      revealAllShowdownHands: table.revealAllShowdownHands,
    },
    pendingSeatRequests: runtimeState.pendingSeatRequests,
    pendingRebuyRequests: runtimeState.pendingRebuyRequests,
    pauseState: runtimeState.pauseState,
    recentCompletedHands: syncCompletedHandHistory(runtimeState.recentCompletedHands, runtimeState.table, table),
    lastCompletedHandHoleCards: syncLastCompletedHandHoleCards(runtimeState.lastCompletedHandHoleCards, runtimeState.table, table),
  };
}

function buildFullRoomSnapshot(
  runtimeState: PersistedRoomRuntimeState,
  accountId: string | undefined,
  viewerHasRoomAccess: boolean,
): RoomSnapshot {
  const table = runtimeState.table;
  const currentHand = table.currentHand
    ? {
        id: table.currentHand.id,
        handNumber: table.currentHand.handNumber,
        blindLevel: table.currentHand.blindLevel,
        dealerSeat: table.currentHand.dealerSeat,
        smallBlindSeat: table.currentHand.smallBlindSeat,
        bigBlindSeat: table.currentHand.bigBlindSeat,
        actorSeat: table.currentHand.actorSeat,
        actorAccountId: table.players.find((player) => player.seatIndex === table.currentHand?.actorSeat)?.accountId ?? null,
        street: table.currentHand.street,
        board: table.currentHand.board,
        pot: table.currentHand.pot,
        currentBet: table.currentHand.currentBet,
        contributions: table.currentHand.contributions,
        streetContributions: table.currentHand.streetContributions,
        foldedAccountIds: table.currentHand.foldedAccountIds,
        playersToAct: table.currentHand.playersToAct,
        startedAt: table.currentHand.startedAt,
        actions: table.currentHand.actions,
        heroHoleCards: accountId ? table.currentHand.holeCards[accountId] ?? null : null,
        heroActionState: accountId ? getPlayerActionState(table, accountId) : null,
        playerCardCounts: Object.fromEntries(
          Object.keys(table.currentHand.holeCards).map((playerAccountId) => [playerAccountId, 2])
        ),
        remainingDeckCount: table.currentHand.remainingDeck.length,
      }
    : null;

  return {
    roomId: table.roomId,
    slug: table.slug,
    name: table.name,
    adminAccountId: table.adminAccountId,
    clubId: table.clubId,
    visibility: table.visibility,
    status: table.status,
    passwordProtected: table.passwordProtected,
    viewerHasRoomAccess,
    maxPlayers: table.maxPlayers,
    startingStack: table.startingStack,
    autoStartNextHand: table.autoStartNextHand,
    autoStartDelaySeconds: table.autoStartDelaySeconds,
    blindState: buildBlindState(runtimeState),
    adminOptions: runtimeState.adminOptions,
    nextHandStartsAt: table.nextHandStartsAt,
    handCount: table.handCount,
    players: table.players,
    chatMessages: runtimeState.chatMessages,
    seatReactions: runtimeState.seatReactions.filter((reaction) => Date.parse(reaction.expiresAt) > Date.now()),
    seatGestures: filterSeatGesturesForPlayers(runtimeState.seatGestures, table.players),
    buyInState: {
      ...runtimeState.buyInState,
      buyInTotalByAccount: ensureBuyInEntries(runtimeState.buyInState.buyInTotalByAccount, table.players, table.startingStack),
    },
    playerStats: {
      handsWonByAccount: ensureCounterEntries(runtimeState.playerStats.handsWonByAccount, table.players),
      rebuyCountByAccount: ensureCounterEntries(runtimeState.playerStats.rebuyCountByAccount, table.players),
    },
    turnState: {
      ...runtimeState.turnState,
      currentTurnStartedAt: table.currentHand
        ? runtimeState.turnState.currentTurnStartedAt ?? table.currentHand.startedAt
        : null,
      timeBankMsByAccount: ensureTimeBankEntries(runtimeState.turnState.timeBankMsByAccount, table.players, runtimeState.turnState.timeBankSeconds),
    },
    pendingSeatRequests: runtimeState.pendingSeatRequests,
    pendingRebuyRequests: runtimeState.pendingRebuyRequests,
    currentHand,
    lastCompletedHand: table.lastCompletedHand,
    recentCompletedHands: runtimeState.recentCompletedHands,
    lastCompletedHandRevealState: buildLastCompletedHandRevealState(runtimeState, accountId),
  };
}

function buildLockedRoomSnapshot(runtimeState: PersistedRoomRuntimeState): RoomSnapshot {
  const table = runtimeState.table;

  return {
    roomId: table.roomId,
    slug: table.slug,
    name: table.name,
    adminAccountId: table.adminAccountId,
    clubId: table.clubId,
    visibility: table.visibility,
    status: table.status,
    passwordProtected: table.passwordProtected,
    viewerHasRoomAccess: false,
    maxPlayers: table.maxPlayers,
    startingStack: table.startingStack,
    autoStartNextHand: table.autoStartNextHand,
    autoStartDelaySeconds: table.autoStartDelaySeconds,
    blindState: {
      schedule: [],
      sessionStartedAt: null,
      currentLevel: null,
      nextLevel: null,
      nextLevelInMs: null,
      snapshotAt: new Date().toISOString(),
      pausedAt: null,
    },
    adminOptions: {
      decisionTimeSeconds: null,
      timeBankSeconds: null,
      timeBankRefillHands: null,
      revealAllShowdownHands: false,
    },
    nextHandStartsAt: null,
    handCount: 0,
    players: [],
    chatMessages: [],
    seatReactions: [],
    seatGestures: [],
    buyInState: {
      minRebuyAmount: Math.max(100, Math.floor(table.startingStack / 20)),
      maxRebuyAmount: table.startingStack * 5,
      buyInTotalByAccount: {},
    },
    playerStats: {
      handsWonByAccount: {},
      rebuyCountByAccount: {},
    },
    turnState: {
      turnSeconds: null,
      timeBankSeconds: null,
      currentTurnStartedAt: null,
      timeBankMsByAccount: {},
    },
    pendingSeatRequests: [],
    pendingRebuyRequests: [],
    currentHand: null,
    lastCompletedHand: null,
    recentCompletedHands: [],
    lastCompletedHandRevealState: null,
  };
}

function buildManagedRoomSummary(room: ManagedPersistedRoomRecord, runtimeState: PersistedRoomRuntimeState): ManagedRoomSummary {
  const expiresAt = calculateRoomExpiresAt(room.lastActivityAt, room.autoExpireAfterHours);

  return {
    roomId: room.id,
    slug: room.slug,
    name: runtimeState.table.name,
    adminAccountId: room.adminId,
    adminUsername: room.admin.username,
    visibility: runtimeState.table.visibility,
    status: runtimeState.table.status,
    passwordProtected: runtimeState.table.passwordProtected,
    maxPlayers: runtimeState.table.maxPlayers,
    seatedPlayerCount: runtimeState.table.players.length,
    connectedPlayerCount: runtimeState.table.players.filter((player) => player.isConnected).length,
    handCount: runtimeState.table.handCount,
    pendingSeatRequestCount: runtimeState.pendingSeatRequests.length,
    pendingRebuyRequestCount: runtimeState.pendingRebuyRequests.length,
    createdAt: room.createdAt.toISOString(),
    lastActivityAt: room.lastActivityAt.toISOString(),
    autoExpireAfterHours: room.autoExpireAfterHours,
    expiresAt: expiresAt?.toISOString() ?? null,
  };
}

function buildAutoExpiringRoom(room: {
  id: string;
  slug: string;
  lastActivityAt: Date;
  autoExpireAfterHours: number | null;
}): AutoExpiringRoom | null {
  if (typeof room.autoExpireAfterHours !== "number" || !Number.isInteger(room.autoExpireAfterHours) || room.autoExpireAfterHours < 1) {
    return null;
  }

  const expiresAt = calculateRoomExpiresAt(room.lastActivityAt, room.autoExpireAfterHours);

  if (!expiresAt) {
    return null;
  }

  return {
    roomId: room.id,
    slug: room.slug,
    lastActivityAt: room.lastActivityAt.toISOString(),
    autoExpireAfterHours: room.autoExpireAfterHours,
    expiresAt: expiresAt.toISOString(),
  };
}

function normalizeManagedRoomIds(roomIds: string[]): string[] {
  const normalizedRoomIds = Array.from(new Set(
    roomIds
      .filter((roomId) => typeof roomId === "string")
      .map((roomId) => roomId.trim())
      .filter((roomId) => roomId.length > 0)
  ));

  if (normalizedRoomIds.length === 0) {
    throw new Error("Select at least one room.");
  }

  return normalizedRoomIds;
}

function normalizeAutoExpireAfterHours(value: number | null): number | null {
  if (value === null || value === 0) {
    return null;
  }

  if (!Number.isInteger(value) || value < 0) {
    throw new Error("Auto-expiration must be a whole number of hours.");
  }

  if (value > MAX_AUTO_EXPIRE_HOURS) {
    throw new Error(`Auto-expiration cannot exceed ${MAX_AUTO_EXPIRE_HOURS} hours.`);
  }

  return value;
}

function calculateRoomExpiresAt(lastActivityAt: Date, autoExpireAfterHours: number | null): Date | null {
  if (typeof autoExpireAfterHours !== "number" || !Number.isInteger(autoExpireAfterHours) || autoExpireAfterHours < 1) {
    return null;
  }

  return new Date(lastActivityAt.getTime() + autoExpireAfterHours * 60 * 60 * 1000);
}

function ensureJoinedViewerAccountIds(accountIds: string[], table: TableState): string[] {
  return Array.from(new Set([
    ...accountIds.filter((accountId) => typeof accountId === "string" && accountId.length > 0),
    table.adminAccountId,
    ...table.players.map((player) => player.accountId),
  ]));
}

function hasViewerRoomAccess(runtimeState: PersistedRoomRuntimeState, accountId?: string): boolean {
  if (!runtimeState.table.passwordProtected) {
    return true;
  }

  if (!accountId) {
    return false;
  }

  return ensureJoinedViewerAccountIds(runtimeState.joinedViewerAccountIds, runtimeState.table).includes(accountId);
}

function haveSameStringEntries(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}

function syncLastCompletedHandHoleCards(
  current: PersistedRoomRuntimeState["lastCompletedHandHoleCards"],
  previousTable: TableState,
  nextTable: TableState
): PersistedRoomRuntimeState["lastCompletedHandHoleCards"] {
  if (nextTable.currentHand) {
    return null;
  }

  const completedHand = nextTable.lastCompletedHand;
  const previousCompletedHandNumber = previousTable.lastCompletedHand?.handNumber ?? null;

  if (previousTable.currentHand && completedHand && completedHand.handNumber === previousTable.currentHand.handNumber && completedHand.handNumber !== previousCompletedHandNumber) {
    return cloneHoleCards(previousTable.currentHand.holeCards);
  }

  return completedHand ? normalizeHoleCardsByAccount(current) : null;
}

function syncCompletedHandHistory(
  currentHistory: PersistedRoomRuntimeState["recentCompletedHands"],
  previousTable: TableState,
  nextTable: TableState
): PersistedRoomRuntimeState["recentCompletedHands"] {
  const normalizedHistory = normalizeCompletedHands(currentHistory);
  const completedHand = nextTable.lastCompletedHand;
  const previousCompletedHandNumber = previousTable.lastCompletedHand?.handNumber ?? null;

  if (!previousTable.currentHand || !completedHand) {
    return normalizedHistory;
  }

  if (completedHand.handNumber !== previousTable.currentHand.handNumber || completedHand.handNumber === previousCompletedHandNumber) {
    return normalizedHistory;
  }

  return [
    completedHand,
    ...normalizedHistory.filter((entry) => entry?.handNumber !== completedHand.handNumber),
  ].slice(0, MAX_RECENT_COMPLETED_HANDS);
}

function normalizeCompletedHands(value: PersistedRoomRuntimeState["recentCompletedHands"] | undefined): PersistedRoomRuntimeState["recentCompletedHands"] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<number>();

  return value
    .map((entry) => normalizeCompletedHand(entry))
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry && typeof entry.handNumber === "number" && typeof entry.handId === "string"))
    .filter((entry) => {
      if (seen.has(entry.handNumber)) {
        return false;
      }

      seen.add(entry.handNumber);
      return true;
    })
    .slice(0, MAX_RECENT_COMPLETED_HANDS);
}

function normalizeCompletedHand(value: LastHandResult | null | undefined): LastHandResult | null {
  if (!value) {
    return null;
  }

  return {
    ...value,
    actions: Array.isArray(value.actions) ? value.actions.map((action) => ({ ...action })) : [],
    winners: Array.isArray(value.winners) ? value.winners.map((winner) => ({ ...winner })) : [],
    board: Array.isArray(value.board) ? [...value.board] : [],
    revealedHoleCards: Object.fromEntries(
      Object.entries(value.revealedHoleCards ?? {}).map(([accountId, cards]) => [
        accountId,
        [cards?.[0] ?? null, cards?.[1] ?? null] as [Card | null, Card | null],
      ])
    ),
    allInRunout: value.allInRunout && typeof value.allInRunout.startBoardCount === "number" && typeof value.allInRunout.revealIntervalMs === "number"
      ? {
          startBoardCount: value.allInRunout.startBoardCount,
          revealIntervalMs: value.allInRunout.revealIntervalMs,
          revealedAccountIds: Array.isArray(value.allInRunout.revealedAccountIds)
            ? value.allInRunout.revealedAccountIds.filter((accountId): accountId is string => typeof accountId === "string")
            : [],
        }
      : null,
  };
}

function normalizeHoleCardsByAccount(value: PersistedRoomRuntimeState["lastCompletedHandHoleCards"] | undefined): PersistedRoomRuntimeState["lastCompletedHandHoleCards"] {
  if (!value || typeof value !== "object") {
    return null;
  }

  return cloneHoleCards(value);
}

function cloneHoleCards(value: Record<string, [Card, Card]>): Record<string, [Card, Card]> {
  return Object.fromEntries(
    Object.entries(value).map(([accountId, cards]) => [accountId, [...cards] as [Card, Card]])
  );
}

function buildLastCompletedHandRevealState(runtimeState: PersistedRoomRuntimeState, accountId?: string): RoomSnapshot["lastCompletedHandRevealState"] {
  if (!accountId || runtimeState.table.currentHand || !runtimeState.table.lastCompletedHand || !runtimeState.lastCompletedHandHoleCards?.[accountId]) {
    return null;
  }

  const lastCompletedHand = runtimeState.table.lastCompletedHand;

  if (isAllInRunoutActive(lastCompletedHand, Date.now())) {
    return null;
  }

  const forced = isForcedShowdownReveal(lastCompletedHand, accountId);
  const currentMode = getRevealModeFromCards(lastCompletedHand.revealedHoleCards[accountId]);

  return {
    forced,
    currentMode,
    allowedModes: forced ? ["both"] : ["none", "first", "second", "both"],
  };
}

function isForcedShowdownReveal(lastCompletedHand: LastHandResult, accountId: string): boolean {
  return lastCompletedHand.winningReason === "showdown" && (
    lastCompletedHand.winners.some((winner) => winner.accountId === accountId)
    || lastCompletedHand.allInRunout?.revealedAccountIds.includes(accountId) === true
  );
}

function isAllInRunoutActive(lastCompletedHand: LastHandResult, nowMs: number): boolean {
  const allInRunout = lastCompletedHand.allInRunout;

  if (!allInRunout || allInRunout.startBoardCount >= lastCompletedHand.board.length || allInRunout.revealIntervalMs <= 0) {
    return false;
  }

  const concludedAtMs = Date.parse(lastCompletedHand.concludedAt);

  if (Number.isNaN(concludedAtMs)) {
    return false;
  }

  const revealedCount = allInRunout.startBoardCount + Math.floor(Math.max(0, nowMs - concludedAtMs) / allInRunout.revealIntervalMs);
  return revealedCount < lastCompletedHand.board.length;
}

function getBustedPlayerAccountIdsForCleanup(table: TableState, nowMs: number): string[] {
  const lastCompletedHand = table.lastCompletedHand;

  if (table.currentHand || !lastCompletedHand || isAllInRunoutActive(lastCompletedHand, nowMs)) {
    return [];
  }

  const winnerAccountIds = new Set(lastCompletedHand.winners.map((winner) => winner.accountId));

  return table.players
    .filter((player) => player.stack <= 0 && !winnerAccountIds.has(player.accountId))
    .map((player) => player.accountId);
}

function buildRevealedHoleCards(cards: [Card, Card], revealMode: RevealMode): [Card | null, Card | null] {
  switch (revealMode) {
    case "first":
      return [cards[0], null];
    case "second":
      return [null, cards[1]];
    case "both":
      return [...cards];
    default:
      return [null, null];
  }
}

function mergeRevealedHoleCards(
  current: LastHandResult["revealedHoleCards"],
  accountId: string,
  nextCards: [Card | null, Card | null]
): LastHandResult["revealedHoleCards"] {
  const nextRevealed = { ...current };

  if (nextCards[0] === null && nextCards[1] === null) {
    delete nextRevealed[accountId];
    return nextRevealed;
  }

  nextRevealed[accountId] = nextCards;
  return nextRevealed;
}

function getRevealModeFromCards(cards: [Card | null, Card | null] | undefined): RevealMode {
  if (!cards) {
    return "none";
  }

  if (cards[0] && cards[1]) {
    return "both";
  }

  if (cards[0]) {
    return "first";
  }

  if (cards[1]) {
    return "second";
  }

  return "none";
}

function syncPlayerStats(
  current: RoomPlayerStatsState,
  previousTable: TableState,
  nextTable: TableState,
  ensurePlayerAccountId?: string
): RoomPlayerStatsState {
  const nextStats: RoomPlayerStatsState = {
    handsWonByAccount: ensureCounterEntries(current.handsWonByAccount, nextTable.players, ensurePlayerAccountId),
    rebuyCountByAccount: ensureCounterEntries(current.rebuyCountByAccount, nextTable.players, ensurePlayerAccountId),
  };
  const completedHand = nextTable.lastCompletedHand;
  const previousCompletedHandNumber = previousTable.lastCompletedHand?.handNumber ?? null;

  if (!previousTable.currentHand || !completedHand) {
    return nextStats;
  }

  if (completedHand.handNumber !== previousTable.currentHand.handNumber || completedHand.handNumber === previousCompletedHandNumber) {
    return nextStats;
  }

  for (const winner of completedHand.winners) {
    nextStats.handsWonByAccount[winner.accountId] = (nextStats.handsWonByAccount[winner.accountId] ?? 0) + 1;
  }

  return nextStats;
}

function debitTimeBankForAction(turnState: RoomTurnState, actingAccountId: string | undefined, now: Date): RoomTurnState {
  if (!actingAccountId || !turnState.currentTurnStartedAt || turnState.turnSeconds === null || turnState.timeBankSeconds === null) {
    return turnState;
  }

  const turnStartedAt = Date.parse(turnState.currentTurnStartedAt);

  if (Number.isNaN(turnStartedAt)) {
    return turnState;
  }

  const elapsedMs = Math.max(0, now.getTime() - turnStartedAt);
  const overflowMs = Math.max(0, elapsedMs - turnState.turnSeconds * 1000);

  if (overflowMs === 0) {
    return turnState;
  }

  const currentValue = turnState.timeBankMsByAccount[actingAccountId] ?? turnState.timeBankSeconds * 1000;

  return {
    ...turnState,
    timeBankMsByAccount: {
      ...turnState.timeBankMsByAccount,
      [actingAccountId]: Math.max(0, currentValue - overflowMs),
    },
  };
}

function ensureTimeBankEntries(
  current: Record<string, number>,
  players: TableState["players"],
  timeBankSeconds: number | null,
  ensurePlayerAccountId?: string
): Record<string, number> {
  if (timeBankSeconds === null) {
    return {};
  }

  const nextEntries = { ...current };
  const defaultValue = timeBankSeconds * 1000;

  for (const player of players) {
    nextEntries[player.accountId] ??= defaultValue;
  }

  if (ensurePlayerAccountId) {
    nextEntries[ensurePlayerAccountId] ??= defaultValue;
  }

  return nextEntries;
}

function resetOrClampTimeBankEntries(
  current: Record<string, number>,
  players: TableState["players"],
  timeBankSeconds: number | null,
  ensurePlayerAccountId?: string
): Record<string, number> {
  if (timeBankSeconds === null) {
    return {};
  }

  const maximumValue = timeBankSeconds * 1000;
  const nextEntries = ensureTimeBankEntries(current, players, timeBankSeconds, ensurePlayerAccountId);

  return Object.fromEntries(
    Object.entries(nextEntries).map(([accountId, value]) => [accountId, Math.max(0, Math.min(maximumValue, value))])
  );
}

function normalizeOptionalRuntimeSetting(value: number | null | undefined, fallback: number | null): number | null {
  if (value === undefined) {
    return fallback;
  }

  return value === null ? null : value;
}

function normalizeOptionalWholeNumber(value: number | null, label: string): number | null {
  if (value === null) {
    return null;
  }

  const normalized = Math.floor(value);

  if (!Number.isFinite(normalized) || normalized < 0) {
    throw new Error(`${label} must be blank or a non-negative integer.`);
  }

  return normalized;
}

function normalizeRequestedStack(value: number | undefined, fallback: number): number {
  const normalized = Math.floor(value ?? fallback);

  if (!Number.isFinite(normalized) || normalized <= 0) {
    throw new Error("Requested stack must be a positive integer.");
  }

  return normalized;
}

function normalizeRebuyAmount(value: number, minAmount: number, maxAmount: number): number {
  const normalized = Math.floor(value);

  if (!Number.isFinite(normalized) || normalized <= 0) {
    throw new Error("Rebuy amount must be a positive integer.");
  }

  if (normalized < minAmount) {
    throw new Error(`Rebuy amount must be at least ${minAmount}.`);
  }

  if (normalized > maxAmount) {
    throw new Error(`Rebuy amount cannot exceed ${maxAmount}.`);
  }

  return normalized;
}

function shouldRefillTimeBankAfterHand(previousTable: TableState, nextTable: TableState, refillHands: number | null): boolean {
  if (!refillHands || refillHands <= 0) {
    return false;
  }

  if (!previousTable.currentHand || !nextTable.lastCompletedHand) {
    return false;
  }

  const previousCompletedHandNumber = previousTable.lastCompletedHand?.handNumber ?? null;

  if (nextTable.lastCompletedHand.handNumber !== previousTable.currentHand.handNumber || nextTable.lastCompletedHand.handNumber === previousCompletedHandNumber) {
    return false;
  }

  return nextTable.lastCompletedHand.handNumber % refillHands === 0;
}

function shiftIsoByMs(value: string | null, offsetMs: number): string | null {
  if (!value || offsetMs === 0) {
    return value;
  }

  const parsed = Date.parse(value);

  if (Number.isNaN(parsed)) {
    return value;
  }

  return new Date(parsed + offsetMs).toISOString();
}

function buildBlindState(runtimeState: PersistedRoomRuntimeState): RoomBlindState {
  const snapshotAt = new Date().toISOString();
  const schedule = runtimeState.table.blindSchedule;
  const sessionStartedAt = runtimeState.table.sessionStartedAt;

  if (!sessionStartedAt || schedule.length === 0) {
    return {
      schedule,
      sessionStartedAt,
      currentLevel: schedule[0] ?? null,
      nextLevel: null,
      nextLevelInMs: null,
      snapshotAt,
      pausedAt: runtimeState.pauseState.pausedAt,
    };
  }

  const sessionStartedAtMs = Date.parse(sessionStartedAt);

  if (Number.isNaN(sessionStartedAtMs)) {
    return {
      schedule,
      sessionStartedAt,
      currentLevel: schedule[0] ?? null,
      nextLevel: null,
      nextLevelInMs: null,
      snapshotAt,
      pausedAt: runtimeState.pauseState.pausedAt,
    };
  }

  const nowMs = Date.now();
  const currentPauseMs = runtimeState.pauseState.pausedAt ? Math.max(0, nowMs - Date.parse(runtimeState.pauseState.pausedAt)) : 0;
  const elapsedActiveMs = Math.max(0, nowMs - sessionStartedAtMs - runtimeState.pauseState.totalPausedMs - currentPauseMs);
  const elapsedMinutes = Math.floor(elapsedActiveMs / 60000);
  const currentLevel = getBlindLevelAtElapsedMinutes(schedule, elapsedMinutes);
  const currentLevelIndex = Math.max(0, schedule.findIndex((level) => level.level === currentLevel.level));
  const nextLevel = currentLevelIndex >= 0 && currentLevelIndex + 1 < schedule.length ? schedule[currentLevelIndex + 1]! : null;
  const nextLevelInMs = nextLevel
    ? Math.max(0, schedule.slice(0, currentLevelIndex + 1).reduce((total, level) => total + level.durationMinutes * 60_000, 0) - elapsedActiveMs)
    : null;

  return {
    schedule,
    sessionStartedAt,
    currentLevel,
    nextLevel,
    nextLevelInMs,
    snapshotAt,
    pausedAt: runtimeState.pauseState.pausedAt,
  };
}

function applyApprovedSeat(
  runtimeState: PersistedRoomRuntimeState,
  request: Pick<RoomPendingSeatRequest, "accountId" | "displayName" | "seatIndex" | "requestedStack">,
  seatAccounting = buildSeatApprovalAccounting(runtimeState, request.accountId, request.requestedStack, null),
): { nextRuntimeState: PersistedRoomRuntimeState; table: TableState } {
  const table = seatPlayer(runtimeState.table, {
    accountId: request.accountId,
    displayName: request.displayName,
    seatIndex: request.seatIndex,
    stack: request.requestedStack,
  });
  const syncedRuntimeState = syncRuntimeState(runtimeState, table, {
    ensurePlayerAccountId: request.accountId,
  });

  return {
    table,
    nextRuntimeState: {
      ...syncedRuntimeState,
      buyInState: {
        ...syncedRuntimeState.buyInState,
        buyInTotalByAccount: {
          ...syncedRuntimeState.buyInState.buyInTotalByAccount,
          [request.accountId]: seatAccounting.nextBuyInTotal,
        },
      },
      playerStats: seatAccounting.countsAsRebuy
        ? {
            ...syncedRuntimeState.playerStats,
            rebuyCountByAccount: {
              ...syncedRuntimeState.playerStats.rebuyCountByAccount,
              [request.accountId]: (syncedRuntimeState.playerStats.rebuyCountByAccount[request.accountId] ?? 0) + 1,
            },
          }
        : syncedRuntimeState.playerStats,
    },
  };
}

function buildSeatApprovalAccounting(
  runtimeState: PersistedRoomRuntimeState,
  accountId: string,
  requestedStack: number,
  persistedBuyInTotal: number | null,
): { nextBuyInTotal: number; countsAsRebuy: boolean } {
  const hasRuntimeBuyIn = Object.prototype.hasOwnProperty.call(runtimeState.buyInState.buyInTotalByAccount, accountId);
  const hasRuntimeRebuyCount = Object.prototype.hasOwnProperty.call(runtimeState.playerStats.rebuyCountByAccount, accountId);
  const countsAsRebuy = persistedBuyInTotal !== null || hasRuntimeBuyIn || hasRuntimeRebuyCount;
  const previousBuyInTotal = Math.max(
    persistedBuyInTotal ?? 0,
    runtimeState.buyInState.buyInTotalByAccount[accountId] ?? 0,
  );

  return {
    nextBuyInTotal: countsAsRebuy ? previousBuyInTotal + requestedStack : requestedStack,
    countsAsRebuy,
  };
}

function applyApprovedRebuy(
  runtimeState: PersistedRoomRuntimeState,
  accountId: string,
  amount: number
): PersistedRoomRuntimeState {
  const now = new Date();
  const table = addPlayerChips(runtimeState.table, accountId, amount, now);
  const syncedRuntimeState = syncRuntimeState(runtimeState, table, {
    now,
    ensurePlayerAccountId: accountId,
  });

  return {
    ...syncedRuntimeState,
    buyInState: {
      ...syncedRuntimeState.buyInState,
      buyInTotalByAccount: {
        ...syncedRuntimeState.buyInState.buyInTotalByAccount,
        [accountId]: (syncedRuntimeState.buyInState.buyInTotalByAccount[accountId] ?? table.startingStack) + amount,
      },
    },
    playerStats: {
      ...syncedRuntimeState.playerStats,
      rebuyCountByAccount: {
        ...syncedRuntimeState.playerStats.rebuyCountByAccount,
        [accountId]: (syncedRuntimeState.playerStats.rebuyCountByAccount[accountId] ?? 0) + 1,
      },
    },
  };
}

function ensureBuyInEntries(
  current: Record<string, number>,
  players: TableState["players"],
  defaultBuyIn: number,
  ensurePlayerAccountId?: string
): Record<string, number> {
  const nextEntries = { ...current };

  for (const player of players) {
    nextEntries[player.accountId] ??= defaultBuyIn;
  }

  if (ensurePlayerAccountId) {
    nextEntries[ensurePlayerAccountId] ??= defaultBuyIn;
  }

  return nextEntries;
}

function ensureCounterEntries(
  current: Record<string, number>,
  players: TableState["players"],
  ensurePlayerAccountId?: string
): Record<string, number> {
  const nextEntries = { ...current };

  for (const player of players) {
    nextEntries[player.accountId] ??= 0;
  }

  if (ensurePlayerAccountId) {
    nextEntries[ensurePlayerAccountId] ??= 0;
  }

  return nextEntries;
}

function normalizeReactionEmoji(value: string): string {
  const emoji = value.trim();

  if (!emoji) {
    throw new Error("Reaction emoji is required.");
  }

  if (emoji.length > 8) {
    throw new Error("Reaction emoji is too long.");
  }

  return emoji;
}

function filterSeatGesturesForPlayers(gestures: RoomSeatGesture[], players: TableState["players"]): RoomSeatGesture[] {
  const activeAccountIds = new Set(players.map((player) => player.accountId));
  return gestures.filter((gesture) => activeAccountIds.has(gesture.accountId));
}

function isPersistedRuntimeState(value: unknown): value is PersistedRoomRuntimeState {
  if (!value || typeof value !== "object") {
    return false;
  }

  return "table" in value;
}

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug.length > 0 ? slug : "poker-room";
}

function toPrismaVisibility(visibility: TableState["visibility"]): RoomVisibility {
  return visibility === "club" ? "CLUB" : "PRIVATE";
}

function toPrismaStatus(status: TableState["status"]): RoomStatus {
  switch (status) {
    case "active":
      return "ACTIVE";
    case "paused":
      return "PAUSED";
    default:
      return "WAITING";
  }
}

function toPrismaStreet(street: Street): "PREFLOP" | "FLOP" | "TURN" | "RIVER" | "SHOWDOWN" {
  switch (street) {
    case "flop":
      return "FLOP";
    case "turn":
      return "TURN";
    case "river":
      return "RIVER";
    case "showdown":
      return "SHOWDOWN";
    default:
      return "PREFLOP";
  }
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
