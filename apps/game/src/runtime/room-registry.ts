import {
  BlindLevel,
  Card,
  CreateTableInput,
  TableState,
  createTable,
  seatPlayer,
  setPlayerReady,
  startHand,
} from "@poker/domain";

import { hashSecret, verifySecret } from "./passwords.js";

const DEFAULT_BLIND_SCHEDULE: BlindLevel[] = [
  { level: 1, smallBlind: 100, bigBlind: 200, durationMinutes: 20 },
  { level: 2, smallBlind: 200, bigBlind: 400, durationMinutes: 20 },
  { level: 3, smallBlind: 400, bigBlind: 800, durationMinutes: 20 },
];

interface RoomRecord {
  table: TableState;
  passwordHash?: string;
  joinedViewerAccountIds: string[];
}

export interface CreateRoomRequest {
  slug?: string;
  name: string;
  adminAccountId: string;
  clubId?: string;
  visibility?: CreateTableInput["visibility"];
  password?: string;
  maxPlayers?: number;
  startingStack?: number;
  blindSchedule?: BlindLevel[];
  autoStartNextHand?: boolean;
  autoStartDelaySeconds?: number;
}

export interface SeatPlayerRequest {
  slug: string;
  accountId: string;
  displayName: string;
  seatIndex: number;
}

export interface PlayerReadyRequest {
  slug: string;
  accountId: string;
  isReady: boolean;
}

export interface JoinRoomRequest {
  slug: string;
  accountId?: string;
  password?: string;
}

export interface StartHandRequest {
  slug: string;
  accountId: string;
}

export interface RoomSnapshot {
  roomId: string;
  slug: string;
  name: string;
  adminAccountId: string;
  clubId?: string;
  visibility: TableState["visibility"];
  status: TableState["status"];
  passwordProtected: boolean;
  viewerHasRoomAccess: boolean;
  maxPlayers: number;
  startingStack: number;
  autoStartNextHand: boolean;
  autoStartDelaySeconds: number;
  handCount: number;
  players: TableState["players"];
  currentHand: null | {
    id: string;
    handNumber: number;
    blindLevel: BlindLevel;
    dealerSeat: number;
    smallBlindSeat: number;
    bigBlindSeat: number;
    actorSeat: number;
    street: string;
    board: Card[];
    pot: number;
    currentBet: number;
    contributions: Record<string, number>;
    startedAt: string;
    heroHoleCards: [Card, Card] | null;
    playerCardCounts: Record<string, number>;
    remainingDeckCount: number;
  };
}

export class InMemoryRoomRegistry {
  private readonly roomsBySlug = new Map<string, RoomRecord>();

  constructor(private readonly onRoomUpdated?: (slug: string) => void) {}

  createRoom(input: CreateRoomRequest): RoomSnapshot {
    const slug = this.allocateSlug(input.slug ?? input.name);

    const table = createTable({
      slug,
      name: input.name.trim(),
      adminAccountId: input.adminAccountId,
      clubId: input.clubId,
      visibility: input.visibility ?? "private",
      maxPlayers: input.maxPlayers ?? 8,
      startingStack: input.startingStack ?? 20_000,
      blindSchedule: input.blindSchedule ?? DEFAULT_BLIND_SCHEDULE,
      autoStartNextHand: input.autoStartNextHand ?? true,
      autoStartDelaySeconds: input.autoStartDelaySeconds ?? 8,
      passwordProtected: Boolean(input.password?.trim()),
    });

    this.roomsBySlug.set(slug, {
      table,
      passwordHash: input.password?.trim() ? hashSecret(input.password.trim()) : undefined,
      joinedViewerAccountIds: ensureJoinedViewerAccountIds([], table),
    });

    this.onRoomUpdated?.(slug);
    return this.getViewerRoomSnapshot(slug, input.adminAccountId);
  }

  joinRoom(input: JoinRoomRequest): RoomSnapshot {
    const room = this.getRoomRecord(input.slug);

    if (room.passwordHash && !input.accountId) {
      throw new Error("Sign in before joining a password-protected room.");
    }

    if (room.passwordHash && !verifySecret(input.password ?? "", room.passwordHash)) {
      throw new Error("Room password is incorrect.");
    }

    if (input.accountId) {
      room.joinedViewerAccountIds = ensureJoinedViewerAccountIds([...room.joinedViewerAccountIds, input.accountId], room.table);
      this.onRoomUpdated?.(input.slug);
    }

    return this.toViewerSnapshot(room, input.accountId);
  }

  seatPlayer(input: SeatPlayerRequest): RoomSnapshot {
    const room = this.getRoomRecord(input.slug);
    assertViewerHasRoomAccess(room, input.accountId);
    room.table = seatPlayer(room.table, {
      accountId: input.accountId,
      displayName: input.displayName,
      seatIndex: input.seatIndex,
    });
    room.joinedViewerAccountIds = ensureJoinedViewerAccountIds(room.joinedViewerAccountIds, room.table);

    this.onRoomUpdated?.(input.slug);
    return this.toViewerSnapshot(room, input.accountId);
  }

  setReady(input: PlayerReadyRequest): RoomSnapshot {
    const room = this.getRoomRecord(input.slug);
    assertViewerHasRoomAccess(room, input.accountId);
    room.table = setPlayerReady(room.table, input.accountId, input.isReady);
    room.joinedViewerAccountIds = ensureJoinedViewerAccountIds(room.joinedViewerAccountIds, room.table);

    this.onRoomUpdated?.(input.slug);
    return this.toViewerSnapshot(room, input.accountId);
  }

  startHand(input: StartHandRequest): RoomSnapshot {
    const room = this.getRoomRecord(input.slug);

    if (room.table.adminAccountId !== input.accountId) {
      throw new Error("Only the room admin can start the next hand.");
    }

    room.table = startHand(room.table);
    room.joinedViewerAccountIds = ensureJoinedViewerAccountIds(room.joinedViewerAccountIds, room.table);

    this.onRoomUpdated?.(input.slug);
    return this.toViewerSnapshot(room, input.accountId);
  }

  getRoomSnapshot(slug: string, accountId?: string): RoomSnapshot {
    return this.toSnapshot(this.getRoomRecord(slug), accountId);
  }

  getViewerRoomSnapshot(slug: string, accountId?: string): RoomSnapshot {
    return this.toViewerSnapshot(this.getRoomRecord(slug), accountId);
  }

  private getRoomRecord(slug: string): RoomRecord {
    const room = this.roomsBySlug.get(slug);

    if (!room) {
      throw new Error("Room not found.");
    }

    return room;
  }

  private toSnapshot(room: RoomRecord, accountId?: string): RoomSnapshot {
    const table = room.table;
    const viewerHasRoomAccess = hasViewerRoomAccess(room, accountId);
    const currentHand = table.currentHand
      ? {
          id: table.currentHand.id,
          handNumber: table.currentHand.handNumber,
          blindLevel: table.currentHand.blindLevel,
          dealerSeat: table.currentHand.dealerSeat,
          smallBlindSeat: table.currentHand.smallBlindSeat,
          bigBlindSeat: table.currentHand.bigBlindSeat,
          actorSeat: table.currentHand.actorSeat,
          street: table.currentHand.street,
          board: table.currentHand.board,
          pot: table.currentHand.pot,
          currentBet: table.currentHand.currentBet,
          contributions: table.currentHand.contributions,
          startedAt: table.currentHand.startedAt,
          heroHoleCards: accountId ? table.currentHand.holeCards[accountId] ?? null : null,
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
      handCount: table.handCount,
      players: table.players,
      currentHand,
    };
  }

  private toViewerSnapshot(room: RoomRecord, accountId?: string): RoomSnapshot {
    if (hasViewerRoomAccess(room, accountId)) {
      return this.toSnapshot(room, accountId);
    }

    const table = room.table;

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
      handCount: 0,
      players: [],
      currentHand: null,
    };
  }

  private allocateSlug(seed: string): string {
    const base = slugify(seed);
    let candidate = base;
    let suffix = 1;

    while (this.roomsBySlug.has(candidate)) {
      suffix += 1;
      candidate = `${base}-${suffix}`;
    }

    return candidate;
  }
}

function ensureJoinedViewerAccountIds(accountIds: string[], table: TableState): string[] {
  return Array.from(new Set([
    ...accountIds,
    table.adminAccountId,
    ...table.players.map((player) => player.accountId),
  ]));
}

function hasViewerRoomAccess(room: RoomRecord, accountId?: string): boolean {
  if (!room.table.passwordProtected) {
    return true;
  }

  if (!accountId) {
    return false;
  }

  return ensureJoinedViewerAccountIds(room.joinedViewerAccountIds, room.table).includes(accountId);
}

function assertViewerHasRoomAccess(room: RoomRecord, accountId?: string): void {
  if (!hasViewerRoomAccess(room, accountId)) {
    throw new Error("Join the room with the correct password before entering.");
  }
}

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug.length > 0 ? slug : "poker-room";
}
