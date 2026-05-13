import { createHash, randomUUID } from "node:crypto";

import { Prisma, RoomStatus, RoomVisibility, type PrismaClient } from "@prisma/client";
import { prisma } from "../../../../packages/db/src/index.js";
import { getRoomCreationAdminConfig, isConfiguredRoomCreationAdmin } from "../../../../packages/db/src/room-creation-policy.js";
import {
  addPlayerChips,
  applyRunItTwiceDecision,
  BlindLevel,
  Card,
  expirePendingRunItTwiceDecision,
  isRunItTwiceVotingComplete,
  LastHandResult,
  resolvePendingRunItTwiceDecision,
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
  AddClubMemberRequest,
  ArchiveRoomRequest,
  ArchivedHandRecord,
  AutoExpiringRoom,
  ClubDetails,
  ClubGameLedger,
  ClubGameLedgerEntry,
  ClubLeaderboardEntry,
  ClubMemberSummary,
  ClubSummary,
  ClubUserSearchResult,
  CreateClubGameLedgerRequest,
  CreateClubRequest,
  CreateRoomRequest,
  CreateSyntheticClubPlayerRequest,
  DeleteManagedRoomsRequest,
  DeleteManagedRoomsResult,
  GetRoomArchivePreviewRequest,
  JoinRoomRequest,
  ManagedClubSummary,
  LeaveSeatRequest,
  ManagedRoomSummary,
  PublicRoomSummary,
  RemovePlayerRequest,
  RevealMode,
  RoomAdminOptionsState,
  RoomBlindState,
  RoomBuyInMaxRule,
  RoomBuyInState,
  RoomChatMessage,
  RoomChatRequest,
  RoomGestureRequest,
  RoomLedgerState,
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
  RoomArchiveLedgerRow,
  RoomArchivePreview,
  RoomArchiveUserOption,
  RoomRegistry,
  RoomRunItTwiceDecisionRequest,
  RoomSnapshot,
  RoomTurnState,
  RoomManagementAdmin,
  SeatBotRequest,
  SeatPlayerRequest,
  SearchClubUsersRequest,
  StartHandRequest,
  StopRoomRequest,
  UpdateClubGameLedgerRequest,
  UpdateClubLeaderboardEntryRequest,
  UpdateManagedRoomsAutoExpirationRequest,
  UpdateRoomAdminOptionsRequest,
} from "./room-service.js";

const DEFAULT_BLIND_SCHEDULE: BlindLevel[] = [
  { level: 1, smallBlind: 100, bigBlind: 200, durationMinutes: 20 },
  { level: 2, smallBlind: 200, bigBlind: 400, durationMinutes: 20 },
  { level: 3, smallBlind: 400, bigBlind: 800, durationMinutes: 20 },
];

const DEFAULT_TURN_SECONDS = 20;
const DEFAULT_TIMEBANK_SECONDS = 15;
const MAX_CHAT_MESSAGES = 40;
const MAX_SEAT_REACTIONS = 12;
const MAX_SEAT_GESTURES = 12;
const MAX_RECENT_COMPLETED_HANDS = 12;
const REACTION_DURATION_MS = 4_000;
const MAX_AUTO_EXPIRE_HOURS = 24 * 365;
const BOT_ACCOUNT_ID_PREFIX = "bot_";
const BOT_EMAIL_DOMAIN = "bots.local";
const CLUB_IMPORT_EMAIL_DOMAIN = "club-import.local";
const MAX_CLUB_USER_SEARCH_RESULTS = 12;
const DEFAULT_MAX_BUY_IN_PERCENTAGE = 50;

type PrismaClientLike = PrismaClient;
type PrismaTransactionClient = Omit<PrismaClientLike, "$on" | "$connect" | "$disconnect" | "$use" | "$transaction" | "$extends">;
type RankingRecalculationClient = Pick<PrismaClientLike, "clubLedgerEntry" | "userRanking">;
type ClubLeaderboardDisplayNameTransactionDelegate = {
  upsert(args: {
    where: {
      clubId_normalizedDisplayName: {
        clubId: string;
        normalizedDisplayName: string;
      };
    };
    update: {
      displayName: string;
      isVisibleInLeaderboard: boolean;
    };
    create: {
      clubId: string;
      normalizedDisplayName: string;
      displayName: string;
      isVisibleInLeaderboard: boolean;
    };
  }): Promise<unknown>;
};

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
  club: {
    name: string;
  } | null;
}

interface PersistedClubRecord {
  id: string;
  slug: string;
  name: string;
  ownerId: string;
  createdAt: Date;
  updatedAt: Date;
  owner: {
    username: string;
  };
  _count: {
    memberships: number;
    rooms: number;
  };
}

interface PersistedClubMembershipRecord {
  role: "OWNER" | "ADMIN" | "MEMBER";
  canManageRooms: boolean;
  isVisibleInLeaderboard: boolean;
  joinedAt: Date;
  user: {
    id: string;
    username: string;
    email: string;
  };
}

interface PersistedClubRankingRecord {
  totalProfit: bigint;
  gamesPlayed: number;
  updatedAt: Date;
  user: {
    id: string;
    username: string;
    email: string;
  };
}

interface PersistedClubLedgerEntryRecord {
  displayName: string;
  hoursPlayed: string | null;
  totalBuyIn: number;
  cashOut: number;
  netResult: number;
  playerOrder: number;
  user: {
    id: string;
    username: string;
    email: string;
  };
}

interface PersistedClubLedgerGameRecord {
  id: string;
  label: string;
  playedAt: Date;
  importedAt: Date;
  entries: PersistedClubLedgerEntryRecord[];
}

interface PersistedClubLeaderboardDisplayNameRecord {
  normalizedDisplayName: string;
  displayName: string;
  isVisibleInLeaderboard: boolean;
  updatedAt: Date;
}

interface ManagedPersistedClubRecord extends PersistedClubRecord {
  memberships: PersistedClubMembershipRecord[];
  rankings: PersistedClubRankingRecord[];
  ledgerGames: PersistedClubLedgerGameRecord[];
  leaderboardDisplayNames: PersistedClubLeaderboardDisplayNameRecord[];
}

interface PersistedRoomRuntimeState {
  table: TableState;
  joinedViewerAccountIds: string[];
  chatMessages: RoomChatMessage[];
  seatReactions: RoomSeatReaction[];
  seatGestures: RoomSeatGesture[];
  buyInState: RoomBuyInState;
  ledgerState: RoomLedgerState;
  playerStats: RoomPlayerStatsState;
  turnState: RoomTurnState;
  adminOptions: RoomAdminOptionsState;
  pendingSeatRequests: RoomPendingSeatRequest[];
  pendingRebuyRequests: RoomPendingRebuyRequest[];
  pauseState: {
    pausedAt: string | null;
    totalPausedMs: number;
  };
  handHistory: ArchivedHandRecord[];
  recentCompletedHands: LastHandResult[];
  lastCompletedHandHoleCards: Record<string, [Card, Card]> | null;
  archivedAt: string | null;
  archivedByAccountId: string | null;
}

interface RoomArchiveSourceLedgerRow {
  sourceAccountId: string;
  displayName: string;
  totalBuyIn: number;
  buyOut: number;
  stack: number;
  cashOut: number;
  wins: number;
  rebuys: number;
  netResult: number;
}

interface MergedRoomArchiveLedgerEntry {
  accountId: string;
  displayName: string;
  totalBuyIn: number;
  cashOut: number;
  netResult: number;
  playerOrder: number;
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
      runItTwiceEnabled: input.runItTwiceEnabled ?? true,
      passwordProtected: Boolean(input.password?.trim()),
    });

    const table: TableState = {
      ...baseTable,
      roomId: baseTable.roomId,
    };

    const runtimeState = createRuntimeState(table, input.isPubliclyListed ?? true);

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

  async listClubs(): Promise<ClubSummary[]> {
    const clubs = await this.database.club.findMany({
      orderBy: [
        { name: "asc" },
      ],
      select: {
        id: true,
        slug: true,
        name: true,
        ownerId: true,
        createdAt: true,
        updatedAt: true,
        owner: {
          select: {
            username: true,
          },
        },
        _count: {
          select: {
            memberships: true,
            rooms: true,
          },
        },
      },
    });

    return clubs.map((club) => buildClubSummary(club));
  }

  async getClubBySlug(slug: string): Promise<ClubDetails | null> {
    const club = await this.database.club.findUnique({
      where: { slug },
      select: {
        id: true,
        slug: true,
        name: true,
        ownerId: true,
        createdAt: true,
        updatedAt: true,
        owner: {
          select: {
            username: true,
          },
        },
        _count: {
          select: {
            memberships: true,
            rooms: true,
          },
        },
        memberships: {
          orderBy: [
            { joinedAt: "asc" },
          ],
          select: {
            role: true,
            canManageRooms: true,
            isVisibleInLeaderboard: true,
            joinedAt: true,
            user: {
              select: {
                id: true,
                username: true,
                email: true,
              },
            },
          },
        },
        rankings: {
          where: {
            scope: "CLUB",
          },
          orderBy: [
            { totalProfit: "desc" },
            { updatedAt: "desc" },
          ],
          select: {
            totalProfit: true,
            gamesPlayed: true,
            updatedAt: true,
            user: {
              select: {
                id: true,
                username: true,
                email: true,
              },
            },
          },
        },
        ledgerGames: {
          orderBy: [
            { playedAt: "desc" },
            { importedAt: "desc" },
          ],
          select: {
            id: true,
            label: true,
            playedAt: true,
            importedAt: true,
            entries: {
              orderBy: [
                { playerOrder: "asc" },
              ],
              select: {
                displayName: true,
                hoursPlayed: true,
                totalBuyIn: true,
                cashOut: true,
                netResult: true,
                playerOrder: true,
                user: {
                  select: {
                    id: true,
                    username: true,
                    email: true,
                  },
                },
              },
            },
          },
        },
        leaderboardDisplayNames: {
          orderBy: [
            { displayName: "asc" },
          ],
          select: {
            normalizedDisplayName: true,
            displayName: true,
            isVisibleInLeaderboard: true,
            updatedAt: true,
          },
        },
      },
    });

    if (!club) {
      return null;
    }

    return buildClubDetails(club, club.rankings, club.memberships, club.ledgerGames, club.leaderboardDisplayNames);
  }

  async listManagedClubs(): Promise<ManagedClubSummary[]> {
    const clubs = await this.database.club.findMany({
      orderBy: [
        { createdAt: "asc" },
      ],
      select: {
        id: true,
        slug: true,
        name: true,
        ownerId: true,
        createdAt: true,
        updatedAt: true,
        owner: {
          select: {
            username: true,
          },
        },
        _count: {
          select: {
            memberships: true,
            rooms: true,
          },
        },
        memberships: {
          orderBy: [
            { joinedAt: "asc" },
          ],
          select: {
            role: true,
            canManageRooms: true,
            isVisibleInLeaderboard: true,
            joinedAt: true,
            user: {
              select: {
                id: true,
                username: true,
                email: true,
              },
            },
          },
        },
        rankings: {
          where: {
            scope: "CLUB",
          },
          orderBy: [
            { totalProfit: "desc" },
            { updatedAt: "desc" },
          ],
          select: {
            totalProfit: true,
            gamesPlayed: true,
            updatedAt: true,
            user: {
              select: {
                id: true,
                username: true,
                email: true,
              },
            },
          },
        },
        ledgerGames: {
          orderBy: [
            { playedAt: "desc" },
            { importedAt: "desc" },
          ],
          select: {
            id: true,
            label: true,
            playedAt: true,
            importedAt: true,
            entries: {
              orderBy: [
                { playerOrder: "asc" },
              ],
              select: {
                displayName: true,
                hoursPlayed: true,
                totalBuyIn: true,
                cashOut: true,
                netResult: true,
                playerOrder: true,
                user: {
                  select: {
                    id: true,
                    username: true,
                    email: true,
                  },
                },
              },
            },
          },
        },
        leaderboardDisplayNames: {
          orderBy: [
            { displayName: "asc" },
          ],
          select: {
            normalizedDisplayName: true,
            displayName: true,
            isVisibleInLeaderboard: true,
            updatedAt: true,
          },
        },
      },
    });

    return clubs.map((club) => buildManagedClubSummary(club));
  }

  async createClub(input: CreateClubRequest): Promise<ManagedClubSummary> {
    const owner = await this.assertAdminExists(input.ownerAccountId);
    const name = normalizeClubName(input.name);
    const slug = await this.allocateClubSlug(name);

    const club = await this.database.club.create({
      data: {
        slug,
        name,
        ownerId: owner.id,
        memberships: {
          create: {
            userId: owner.id,
            role: "OWNER",
            canManageRooms: true,
            isVisibleInLeaderboard: true,
          },
        },
      },
      select: {
        id: true,
      },
    });

    return this.getManagedClubSummaryById(club.id);
  }

  async searchClubUsers(input: SearchClubUsersRequest): Promise<ClubUserSearchResult[]> {
    const query = normalizeClubUserSearchQuery(input.query);

    if (!query) {
      return [];
    }

    const users = await this.database.user.findMany({
      where: {
        NOT: [
          {
            id: {
              startsWith: BOT_ACCOUNT_ID_PREFIX,
            },
          },
          {
            email: {
              endsWith: `@${BOT_EMAIL_DOMAIN}`,
            },
          },
          {
            email: {
              endsWith: `@${CLUB_IMPORT_EMAIL_DOMAIN}`,
            },
          },
        ],
        OR: [
          {
            username: {
              contains: query,
              mode: "insensitive",
            },
          },
          {
            email: {
              contains: query,
              mode: "insensitive",
            },
          },
        ],
      },
      orderBy: {
        createdAt: "desc",
      },
      take: MAX_CLUB_USER_SEARCH_RESULTS,
      select: {
        id: true,
        username: true,
        email: true,
        createdAt: true,
        memberships: {
          where: {
            clubId: input.clubId ?? "",
          },
          select: {
            id: true,
          },
        },
      },
    });

    return users.map((user) => ({
      accountId: user.id,
      username: user.username,
      email: user.email,
      createdAt: user.createdAt.toISOString(),
      isMember: user.memberships.length > 0,
    }));
  }

  async addClubMember(input: AddClubMemberRequest): Promise<ManagedClubSummary> {
    await this.assertClubExists(input.clubId);

    const user = await this.database.user.findUnique({
      where: { id: input.accountId },
      select: { id: true },
    });

    if (!user) {
      throw new Error("User does not exist.");
    }

    if (isBotAccountId(input.accountId)) {
      throw new Error("Bots cannot be added to club leaderboards.");
    }

    await this.database.clubMembership.upsert({
      where: {
        clubId_userId: {
          clubId: input.clubId,
          userId: input.accountId,
        },
      },
      update: {
        role: input.role ?? undefined,
        canManageRooms: input.canManageRooms ?? undefined,
        isVisibleInLeaderboard: input.isVisibleInLeaderboard ?? undefined,
      },
      create: {
        clubId: input.clubId,
        userId: input.accountId,
        role: input.role ?? "MEMBER",
        canManageRooms: input.canManageRooms ?? false,
        isVisibleInLeaderboard: input.isVisibleInLeaderboard ?? true,
      },
    });

    return this.getManagedClubSummaryById(input.clubId);
  }

  async createSyntheticClubPlayer(input: CreateSyntheticClubPlayerRequest): Promise<ManagedClubSummary> {
    const club = await this.database.club.findUnique({
      where: { id: input.clubId },
      select: {
        id: true,
      },
    });

    if (!club) {
      throw new Error("Club does not exist.");
    }

    const displayName = normalizeSyntheticClubDisplayName(input.displayName);
    const totalProfit = normalizeRankingChipValue(input.totalProfit, "totalProfit");
    const gamesPlayed = normalizeGamesPlayed(input.gamesPlayed ?? 0, "gamesPlayed");
    const username = await this.allocateUniqueUsername(displayName);
    const email = `club_import_${randomUUID()}@${CLUB_IMPORT_EMAIL_DOMAIN}`;

    const user = await this.database.user.create({
      data: {
        email,
        username,
        passwordHash: hashSecret(`club-import:${club.id}:${randomUUID()}`),
      },
      select: {
        id: true,
      },
    });

    await this.database.clubMembership.create({
      data: {
        clubId: club.id,
        userId: user.id,
      },
    });

    if (totalProfit !== 0 || gamesPlayed !== 0) {
      await this.database.userRanking.create({
        data: {
          userId: user.id,
          clubId: club.id,
          scope: "CLUB",
          scopeKey: buildClubScopeKey(club.id),
          totalProfit: BigInt(totalProfit),
          gamesPlayed,
        },
      });
    }

    return this.getManagedClubSummaryById(club.id);
  }

  async updateClubLeaderboardEntry(input: UpdateClubLeaderboardEntryRequest): Promise<ManagedClubSummary> {
    await this.assertClubExists(input.clubId);

    const targetAccountIds = Array.from(new Set([input.accountId, ...(input.accountIds ?? [])]));
    const users = await this.database.user.findMany({
      where: {
        id: {
          in: targetAccountIds,
        },
      },
      select: {
        id: true,
        username: true,
      },
    });

    if (users.length !== targetAccountIds.length) {
      throw new Error("One or more leaderboard users do not exist.");
    }

    if (targetAccountIds.some((accountId) => isBotAccountId(accountId))) {
      throw new Error("Bots cannot appear on club leaderboards.");
    }

    const hasTotalUpdate = input.totalProfit !== undefined || input.gamesPlayed !== undefined;

    if (hasTotalUpdate && (input.totalProfit === undefined || input.gamesPlayed === undefined)) {
      throw new Error("Leaderboard updates must include both totalProfit and gamesPlayed together.");
    }

    if (!hasTotalUpdate && input.isVisibleInLeaderboard === undefined) {
      throw new Error("Provide leaderboard totals or visibility to update.");
    }

    const leaderboardDisplayName = input.displayName?.trim() || (targetAccountIds.length === 1 ? users[0]?.username : undefined);
    const normalizedDisplayName = leaderboardDisplayName
      ? normalizeClubLeaderboardDisplayNameKey(leaderboardDisplayName)
      : undefined;

    if (input.isVisibleInLeaderboard !== undefined && !normalizedDisplayName) {
      throw new Error("Leaderboard visibility updates require a display name.");
    }

    if (hasTotalUpdate && targetAccountIds.length > 1) {
      throw new Error("Grouped leaderboard rows recalculate from recorded display names. Only visibility can be changed here.");
    }

    if (hasTotalUpdate && normalizedDisplayName) {
      const recordedEntries = await this.database.clubLedgerEntry.findMany({
        where: {
          userId: input.accountId,
          game: {
            clubId: input.clubId,
          },
        },
        select: {
          displayName: true,
        },
      });

      if (recordedEntries.some((entry) => normalizeClubLeaderboardDisplayNameKey(entry.displayName) === normalizedDisplayName)) {
        throw new Error("Recorded leaderboard rows recalculate from recorded games. Only visibility can be changed here.");
      }
    }

    const totalProfit = input.totalProfit !== undefined
      ? normalizeRankingChipValue(input.totalProfit, "totalProfit")
      : undefined;
    const gamesPlayed = input.gamesPlayed !== undefined
      ? normalizeGamesPlayed(input.gamesPlayed, "gamesPlayed")
      : undefined;
    const scopeKey = buildClubScopeKey(input.clubId);

    await this.database.$transaction(async (transaction: PrismaTransactionClient) => {
      if (input.isVisibleInLeaderboard !== undefined && normalizedDisplayName && leaderboardDisplayName) {
        const leaderboardDisplayNameDelegate = (transaction as PrismaTransactionClient & {
          clubLeaderboardDisplayName: ClubLeaderboardDisplayNameTransactionDelegate;
        }).clubLeaderboardDisplayName;

        await leaderboardDisplayNameDelegate.upsert({
          where: {
            clubId_normalizedDisplayName: {
              clubId: input.clubId,
              normalizedDisplayName,
            },
          },
          update: {
            displayName: leaderboardDisplayName,
            isVisibleInLeaderboard: input.isVisibleInLeaderboard,
          },
          create: {
            clubId: input.clubId,
            normalizedDisplayName,
            displayName: leaderboardDisplayName,
            isVisibleInLeaderboard: input.isVisibleInLeaderboard,
          },
        });
      }

      if (totalProfit !== undefined && gamesPlayed !== undefined) {
        await transaction.clubMembership.upsert({
          where: {
            clubId_userId: {
              clubId: input.clubId,
              userId: input.accountId,
            },
          },
          update: {},
          create: {
            clubId: input.clubId,
            userId: input.accountId,
          },
        });

        await transaction.userRanking.upsert({
          where: {
            userId_scopeKey: {
              userId: input.accountId,
              scopeKey,
            },
          },
          update: {
            clubId: input.clubId,
            scope: "CLUB",
            totalProfit: BigInt(totalProfit),
            gamesPlayed,
          },
          create: {
            userId: input.accountId,
            clubId: input.clubId,
            scope: "CLUB",
            scopeKey,
            totalProfit: BigInt(totalProfit),
            gamesPlayed,
          },
        });
      }
    });

    return this.getManagedClubSummaryById(input.clubId);
  }

  async createClubGameLedger(input: CreateClubGameLedgerRequest): Promise<ManagedClubSummary> {
    await this.assertClubExists(input.clubId);

    const label = normalizeClubLedgerGameLabel(input.label);
    const playedAt = normalizeClubLedgerPlayedAt(input.playedAt);
    const normalizedEntries = input.entries.map((entry) => ({
      accountId: entry.accountId,
      displayName: normalizeSyntheticClubDisplayName(entry.displayName),
      hoursPlayed: normalizeClubLedgerHoursPlayed(entry.hoursPlayed),
      totalBuyIn: normalizeNonNegativeChipValue(entry.totalBuyIn, "totalBuyIn"),
      cashOut: normalizeNonNegativeChipValue(entry.cashOut, "cashOut"),
    }));

    if (normalizedEntries.length === 0) {
      throw new Error("Games must include at least one ledger entry.");
    }

    const accountIds = normalizedEntries.map((entry) => entry.accountId);
    const uniqueAccountIds = Array.from(new Set(accountIds));

    if (uniqueAccountIds.length !== accountIds.length) {
      throw new Error("Games must not include the same player more than once.");
    }

    if (uniqueAccountIds.some((accountId) => isBotAccountId(accountId))) {
      throw new Error("Bots cannot appear in recorded club games.");
    }

    const memberships = await this.database.clubMembership.findMany({
      where: {
        clubId: input.clubId,
        userId: {
          in: uniqueAccountIds,
        },
      },
      select: {
        userId: true,
      },
    });

    if (memberships.length !== uniqueAccountIds.length) {
      throw new Error("Recorded game entries must belong to club members.");
    }

    await this.database.$transaction(async (transaction) => {
      await transaction.clubLedgerGame.create({
        data: {
          clubId: input.clubId,
          source: "IMPORTED_WORKBOOK",
          sourceKey: randomUUID(),
          label,
          playedAt,
          entries: {
            create: normalizedEntries.map((entry, index) => ({
              userId: entry.accountId,
              displayName: entry.displayName,
              hoursPlayed: entry.hoursPlayed,
              totalBuyIn: entry.totalBuyIn,
              cashOut: entry.cashOut,
              netResult: entry.cashOut - entry.totalBuyIn,
              playerOrder: index,
            })),
          },
        },
      });

      await this.recalculateImportedWorkbookRankings(transaction, input.clubId, uniqueAccountIds);
    });

    return this.getManagedClubSummaryById(input.clubId);
  }

  async updateClubGameLedger(input: UpdateClubGameLedgerRequest): Promise<ManagedClubSummary> {
    await this.assertClubExists(input.clubId);

    const label = normalizeClubLedgerGameLabel(input.label);
    const playedAt = normalizeClubLedgerPlayedAt(input.playedAt);
    const normalizedEntries = input.entries.map((entry) => ({
      accountId: entry.accountId,
      displayName: normalizeSyntheticClubDisplayName(entry.displayName),
      hoursPlayed: normalizeClubLedgerHoursPlayed(entry.hoursPlayed),
      totalBuyIn: normalizeNonNegativeChipValue(entry.totalBuyIn, "totalBuyIn"),
      cashOut: normalizeNonNegativeChipValue(entry.cashOut, "cashOut"),
    }));

    if (normalizedEntries.length === 0) {
      throw new Error("Games must include at least one ledger entry.");
    }

    const game = await this.database.clubLedgerGame.findFirst({
      where: {
        id: input.gameId,
        clubId: input.clubId,
        source: "IMPORTED_WORKBOOK",
      },
      select: {
        id: true,
        entries: {
          orderBy: [
            { playerOrder: "asc" },
          ],
          select: {
            userId: true,
          },
        },
      },
    });

    if (!game) {
      throw new Error("Imported game does not exist.");
    }

    const existingUserIds = game.entries.map((entry) => entry.userId).sort();
    const nextUserIds = normalizedEntries.map((entry) => entry.accountId).sort();

    if (existingUserIds.length !== nextUserIds.length || existingUserIds.some((userId, index) => userId !== nextUserIds[index])) {
      throw new Error("Game edits must keep the same players for now.");
    }

    await this.database.$transaction(async (transaction) => {
      await transaction.clubLedgerGame.update({
        where: { id: game.id },
        data: {
          label,
          playedAt,
        },
      });

      for (const [index, entry] of normalizedEntries.entries()) {
        await transaction.clubLedgerEntry.update({
          where: {
            gameId_userId: {
              gameId: game.id,
              userId: entry.accountId,
            },
          },
          data: {
            displayName: entry.displayName,
            hoursPlayed: entry.hoursPlayed,
            totalBuyIn: entry.totalBuyIn,
            cashOut: entry.cashOut,
            netResult: entry.cashOut - entry.totalBuyIn,
            playerOrder: index,
          },
        });
      }

      await this.recalculateImportedWorkbookRankings(transaction, input.clubId, existingUserIds);
    });

    return this.getManagedClubSummaryById(input.clubId);
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
        club: {
          select: {
            name: true,
          },
        },
      },
    });

    return rooms.map((room) => buildManagedRoomSummary(room, this.requireRuntimeState(room)));
  }

  async listPublicRooms(): Promise<PublicRoomSummary[]> {
    const rooms = await this.database.room.findMany({
      orderBy: [
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
        club: {
          select: {
            name: true,
          },
        },
      },
    });

    return rooms.flatMap((room) => {
      const runtimeState = this.requireRuntimeState(room);

      return isRoomPubliclyListed(runtimeState.adminOptions)
        ? [buildPublicRoomSummary(room, runtimeState)]
        : [];
    });
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
        club: {
          select: {
            name: true,
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
    this.assertRoomIsMutable(runtimeState);
    this.assertViewerHasRoomAccess(runtimeState, input.accountId);
    const requestedStack = normalizeRequestedStack(
      input.requestedStack,
      runtimeState.table.startingStack,
      runtimeState.buyInState.minRebuyAmount,
      runtimeState.buyInState.maxRebuyAmount,
    );

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

  async seatBot(input: SeatBotRequest): Promise<RoomSnapshot> {
    const room = await this.requireRoom(input.slug);
    const runtimeState = this.requireRuntimeState(room);
    this.assertRoomIsMutable(runtimeState);
    this.assertViewerHasRoomAccess(runtimeState, input.accountId);

    if (runtimeState.table.adminAccountId !== input.accountId) {
      throw new Error("Only the room admin can seat bots.");
    }

    const requestedStack = normalizeRequestedStack(
      input.requestedStack,
      runtimeState.table.startingStack,
      runtimeState.buyInState.minRebuyAmount,
      runtimeState.buyInState.maxRebuyAmount,
    );
    const displayName = normalizeBotDisplayName(input.displayName, runtimeState.table);
    const botAccountId = `${BOT_ACCOUNT_ID_PREFIX}${crypto.randomUUID()}`;
    const botUsername = buildBotUsername(room.slug, botAccountId);
    const botEmail = `${botUsername}@bots.local`;
    const botPasswordSecret = `bot:${botAccountId}:${crypto.randomUUID()}`;
    const seatAccounting = buildSeatApprovalAccounting(runtimeState, botAccountId, requestedStack, null);
    const approvedSeat = applyApprovedSeat(runtimeState, {
      accountId: botAccountId,
      displayName,
      seatIndex: input.seatIndex,
      requestedStack,
    }, seatAccounting);
    const readyTable = setPlayerReady(approvedSeat.table, botAccountId, true);
    const nextRuntimeState = syncRuntimeState(approvedSeat.nextRuntimeState, readyTable, {
      ensurePlayerAccountId: botAccountId,
    });

    await this.database.$transaction(async (transaction) => {
      await transaction.user.create({
        data: {
          id: botAccountId,
          email: botEmail,
          username: botUsername,
          passwordHash: hashSecret(botPasswordSecret),
        },
      });

      await transaction.tableParticipant.create({
        data: {
          roomId: room.id,
          userId: botAccountId,
          displayName,
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
    this.assertRoomIsMutable(runtimeState);
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
    this.assertRoomIsMutable(runtimeState);
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
    this.assertRoomIsMutable(runtimeState);
    this.assertViewerHasRoomAccess(runtimeState, input.accountId);
    const departingPlayer = runtimeState.table.players.find((player) => player.accountId === input.accountId) ?? null;
    const table = leaveSeat(runtimeState.table, input.accountId);
    const nextRuntimeState = departingPlayer
      ? applyLedgerCashOuts(syncRuntimeState(runtimeState, table), [departingPlayer])
      : syncRuntimeState(runtimeState, table);

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
    this.assertRoomIsMutable(runtimeState);
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
    this.assertRoomIsMutable(runtimeState);
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
    this.assertRoomIsMutable(runtimeState);
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
    this.assertRoomIsMutable(runtimeState);
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
    this.assertRoomIsMutable(runtimeState);
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

    const requestedStack = normalizeRequestedStack(
      input.requestedStack,
      request.requestedStack,
      runtimeState.buyInState.minRebuyAmount,
      runtimeState.buyInState.maxRebuyAmount,
    );
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
    this.assertRoomIsMutable(runtimeState);
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
    this.assertRoomIsMutable(runtimeState);
    this.assertViewerHasRoomAccess(runtimeState, input.accountId);

    if (runtimeState.table.adminAccountId !== input.accountId) {
      throw new Error("Only the room admin can update table options.");
    }

    const now = new Date();
    const blindSchedule = normalizeBlindSchedule(input.blindSchedule);
    const turnSeconds = normalizeOptionalWholeNumber(input.turnSeconds, "Decision time limit");
    const timeBankSeconds = normalizeOptionalWholeNumber(input.timeBankSeconds, "Time bank length");
    const timeBankRefillHands = normalizeOptionalWholeNumber(input.timeBankRefillHands, "Time bank refill hands");
    const buyInOptions = normalizeRoomBuyInAdminOptions(runtimeState.table, {
      minBuyInAmount: input.minBuyInAmount,
      maxBuyInRule: input.maxBuyInRule,
    });

    if (input.autoStartDelaySeconds < 0) {
      throw new Error("Showdown presentation time cannot be negative.");
    }

    const table: TableState = {
      ...runtimeState.table,
      blindSchedule,
      autoStartNextHand: input.autoStartNextHand,
      autoStartDelaySeconds: input.autoStartDelaySeconds,
      revealAllShowdownHands: input.revealAllShowdownHands,
      runItTwiceEnabled: input.runItTwiceEnabled,
      nextHandStartsAt: runtimeState.table.currentHand
        ? null
        : input.autoStartNextHand && getActivePlayers(runtimeState.table).length >= 2
          ? new Date(now.getTime() + input.autoStartDelaySeconds * 1000).toISOString()
          : null,
      updatedAt: now.toISOString(),
    };
    const nextAdminOptions = {
      decisionTimeSeconds: turnSeconds,
      timeBankSeconds,
      timeBankRefillHands,
      isPubliclyListed: input.isPubliclyListed,
      minBuyInAmount: buyInOptions.minBuyInAmount,
      maxBuyInRule: buyInOptions.maxBuyInRule,
      revealAllShowdownHands: input.revealAllShowdownHands,
      runItTwiceEnabled: input.runItTwiceEnabled,
    } satisfies RoomAdminOptionsState;
    const nextRuntimeState: PersistedRoomRuntimeState = {
      ...runtimeState,
      table,
      adminOptions: nextAdminOptions,
      buyInState: buildRuntimeBuyInState(table, nextAdminOptions, runtimeState.buyInState.buyInTotalByAccount),
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
    this.assertRoomIsMutable(runtimeState);
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
    this.assertRoomIsMutable(runtimeState);
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
      players: runtimeState.table.players.map((player) => ({
        ...player,
        isReady: isBotAccountId(player.accountId),
      })),
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

  async getRoomArchivePreview(input: GetRoomArchivePreviewRequest): Promise<RoomArchivePreview> {
    const room = await this.requireRoom(input.slug);
    const runtimeState = this.requireRuntimeState(room);
    this.assertViewerHasRoomAccess(runtimeState, input.accountId);

    if (runtimeState.table.adminAccountId !== input.accountId) {
      throw new Error("Only the room admin can archive the table.");
    }

    if (runtimeState.table.status === "archived") {
      throw new Error("Table is already archived.");
    }

    if (runtimeState.table.currentHand) {
      throw new Error("Finish the current hand before archiving the table.");
    }

    if (!room.clubId) {
      throw new Error("Only club rooms can be matched before archive.");
    }

    const club = await this.database.club.findUnique({
      where: { id: room.clubId },
      select: {
        id: true,
        name: true,
      },
    });

    if (!club) {
      throw new Error("Club does not exist.");
    }

    const handHistory = getArchivedHandHistory(runtimeState);

    if (handHistory.length === 0) {
      throw new Error("Play at least one hand before archiving the table.");
    }

    const ledgerRows = buildRoomArchiveLedgerRows(runtimeState).filter((row) => !isBotAccountId(row.sourceAccountId));

    if (ledgerRows.length === 0) {
      throw new Error("No eligible player ledger rows are available for club archive.");
    }

    const sourceUsers = await this.database.user.findMany({
      where: {
        id: {
          in: ledgerRows.map((row) => row.sourceAccountId),
        },
      },
      select: {
        id: true,
        username: true,
      },
    });
    const sourceUsernameByAccountId = new Map(sourceUsers.map((user) => [user.id, user.username]));

    return {
      roomId: room.id,
      slug: room.slug,
      name: room.name,
      clubId: club.id,
      clubName: club.name,
      label: room.name,
      playedAt: deriveRoomArchivePlayedAt(handHistory, runtimeState.table.updatedAt).toISOString(),
      ledger: ledgerRows.map((row) => ({
        sourceAccountId: row.sourceAccountId,
        sourceUsername: sourceUsernameByAccountId.get(row.sourceAccountId) ?? row.sourceAccountId,
        displayName: row.displayName,
        totalBuyIn: row.totalBuyIn,
        buyOut: row.buyOut,
        stack: row.stack,
        cashOut: row.cashOut,
        wins: row.wins,
        rebuys: row.rebuys,
        netResult: row.netResult,
      } satisfies RoomArchiveLedgerRow)),
      users: await this.listRoomArchiveUserOptions(club.id),
    };
  }

  async archiveRoom(input: ArchiveRoomRequest): Promise<RoomSnapshot> {
    const room = await this.requireRoom(input.slug);
    const runtimeState = this.requireRuntimeState(room);
    this.assertViewerHasRoomAccess(runtimeState, input.accountId);

    if (runtimeState.table.adminAccountId !== input.accountId) {
      throw new Error("Only the room admin can archive the table.");
    }

    if (runtimeState.table.status === "archived") {
      throw new Error("Table is already archived.");
    }

    if (runtimeState.table.currentHand) {
      throw new Error("Finish the current hand before archiving the table.");
    }

    const handHistory = getArchivedHandHistory(runtimeState);

    if (handHistory.length === 0) {
      throw new Error("Play at least one hand before archiving the table.");
    }

    const clubArchiveLedgerRows = room.clubId
      ? buildRoomArchiveLedgerRows(runtimeState).filter((row) => !isBotAccountId(row.sourceAccountId))
      : [];

    const now = new Date();
    const table: TableState = {
      ...runtimeState.table,
      status: "archived",
      sessionStartedAt: null,
      nextHandStartsAt: null,
      players: runtimeState.table.players.map((player) => ({
        ...player,
        isReady: false,
        isConnected: false,
        isSittingOut: false,
      })),
      updatedAt: now.toISOString(),
    };
    const nextRuntimeState: PersistedRoomRuntimeState = {
      ...runtimeState,
      table,
      chatMessages: [],
      seatReactions: [],
      seatGestures: [],
      pauseState: {
        pausedAt: null,
        totalPausedMs: 0,
      },
      turnState: {
        ...runtimeState.turnState,
        currentTurnStartedAt: null,
        timeBankMsByAccount: resetOrClampTimeBankEntries({}, table.players, runtimeState.turnState.timeBankSeconds),
      },
      pendingSeatRequests: [],
      pendingRebuyRequests: [],
      handHistory,
      archivedAt: now.toISOString(),
      archivedByAccountId: input.accountId,
    };

    await this.database.$transaction(async (transaction) => {
      await transaction.tableSession.updateMany({
        where: {
          roomId: room.id,
          endedAt: null,
        },
        data: {
          endedAt: now,
        },
      });

      if (room.clubId && clubArchiveLedgerRows.length > 0) {
        await this.applyClubArchiveRecording(
          transaction,
          room,
          runtimeState,
          handHistory,
          clubArchiveLedgerRows,
          input.matchedLedgerAccounts,
        );
      }

      await transaction.room.update({
        where: { id: room.id },
        data: {
          ...this.roomUpdatePayload(nextRuntimeState, now),
          autoExpireAfterHours: null,
        },
      });
    });

    await this.onRoomUpdated?.(input.slug);
    return this.toSnapshot(nextRuntimeState, input.accountId);
  }

  async removePlayer(input: RemovePlayerRequest): Promise<RoomSnapshot> {
    const room = await this.requireRoom(input.slug);
    const runtimeState = this.requireRuntimeState(room);
    this.assertRoomIsMutable(runtimeState);
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

    const departingPlayer = runtimeState.table.players.find((player) => player.accountId === input.targetAccountId) ?? null;
    const table = leaveSeat(runtimeState.table, input.targetAccountId);
    const nextRuntimeState: PersistedRoomRuntimeState = {
      ...(departingPlayer
        ? applyLedgerCashOuts(syncRuntimeState(runtimeState, table), [departingPlayer])
        : syncRuntimeState(runtimeState, table)),
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
    this.assertRoomIsMutable(runtimeState);
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
    this.assertRoomIsMutable(runtimeState);
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
    this.assertRoomIsMutable(runtimeState);
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
    this.assertRoomIsMutable(runtimeState);
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
    const overdueBlindMs = getBlindClockOverrunMs(runtimeState, now.getTime());

    try {
      table = startHand(existingTable, {
        now,
        elapsedBlindMinutes: getElapsedBlindMinutes(runtimeState, now.getTime()),
      });

      if (overdueBlindMs > 0) {
        table = {
          ...table,
          sessionStartedAt: shiftIsoByMs(table.sessionStartedAt, overdueBlindMs),
        };
      }
    } catch (error) {
      if (bustedAccountIds.length > 0) {
        await this.onRoomUpdated?.(input.slug);
      }

      throw error;
    }

    let persistedRuntimeState = syncRuntimeState(runtimeState, table, { now });

    try {
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

        const latestPersistedHand = await transaction.hand.findFirst({
          where: {
            sessionId: session.id,
          },
          orderBy: { handNumber: "desc" },
        });

        const nextHandNumber = Math.max(
          table.handCount,
          latestPersistedHand?.handNumber ?? 0,
        );
        const persistedTable = nextHandNumber === table.handCount
          ? table
          : renumberStartedHand(table, nextHandNumber + 1);

        persistedRuntimeState = persistedTable === table
          ? persistedRuntimeState
          : syncRuntimeState(runtimeState, persistedTable, { now });

        const hand = persistedTable.currentHand;

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
          data: this.roomUpdatePayload(persistedRuntimeState),
        });
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError
        && error.code === "P2002"
      ) {
        const latestSnapshot = await this.getRoomSnapshot(input.slug, input.accountId);

        if (latestSnapshot.currentHand) {
          return latestSnapshot;
        }
      }

      throw error;
    }

    await this.onRoomUpdated?.(input.slug);
    return this.toSnapshot(persistedRuntimeState, input.accountId);
  }

  async actOnHand(input: RoomActionRequest): Promise<RoomSnapshot> {
    const room = await this.requireRoom(input.slug);
    const runtimeState = this.requireRuntimeState(room);
    this.assertRoomIsMutable(runtimeState);
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
      const persistedHandResults = Object.keys(completedHand.holeCards)
        .map((accountId) => {
          const participant = participantByUserId.get(accountId);
          const player = table.players.find((entry) => entry.accountId === accountId);

          if (!participant || !player) {
            return null;
          }

          return {
            accountId,
            participantId: participant.id,
            netChips: (winningsByUserId.get(accountId) ?? 0) - (completedHand.contributions[accountId] ?? 0),
            finalStack: player.stack,
            holeCards: completedHand.holeCards[accountId],
          };
        })
        .filter((record): record is NonNullable<typeof record> => record !== null);

      await transaction.handResult.createMany({
        data: persistedHandResults.map((record) => ({
          handId: persistedHand.id,
          participantId: record.participantId,
          netChips: record.netChips,
          finalStack: record.finalStack,
          holeCards: toJsonValue(record.holeCards),
        })),
        skipDuplicates: true,
      });

      if (room.clubId) {
        await this.upsertClubRankingsForHand(transaction, room.clubId, persistedHandResults.map((record) => ({
          accountId: record.accountId,
          netChips: record.netChips,
        })));
      }
    });

    await this.onRoomUpdated?.(input.slug);
    return this.toSnapshot(nextRuntimeState, input.accountId);
  }

  async submitRunItTwiceDecision(input: RoomRunItTwiceDecisionRequest): Promise<RoomSnapshot> {
    const room = await this.requireRoom(input.slug);
    const runtimeState = this.requireRuntimeState(room);
    this.assertRoomIsMutable(runtimeState);
    this.assertViewerHasRoomAccess(runtimeState, input.accountId);
    const now = new Date();
    const table = applyRunItTwiceDecision(runtimeState.table, {
      accountId: input.accountId,
      willing: input.willing,
    }, now);
    const nextRuntimeState = syncRuntimeState(runtimeState, table, { now });

    await this.database.$transaction(async (transaction) => {
      await transaction.room.update({
        where: { id: room.id },
        data: this.roomUpdatePayload(nextRuntimeState),
      });
    });

    await this.onRoomUpdated?.(input.slug);
    return this.toSnapshot(nextRuntimeState, input.accountId);
  }

  async expirePendingRunItTwiceDecision(slug: string): Promise<RoomSnapshot> {
    const room = await this.requireRoom(slug);
    const runtimeState = this.requireRuntimeState(room);
    this.assertRoomIsMutable(runtimeState);
    const now = new Date();
    const table = expirePendingRunItTwiceDecision(runtimeState.table, now);
    const nextRuntimeState = syncRuntimeState(runtimeState, table, { now });

    await this.database.$transaction(async (transaction) => {
      await transaction.room.update({
        where: { id: room.id },
        data: this.roomUpdatePayload(nextRuntimeState),
      });
    });

    await this.onRoomUpdated?.(slug);
    return this.toSnapshot(nextRuntimeState);
  }

  async resolvePendingRunItTwiceDecision(slug: string): Promise<RoomSnapshot> {
    const room = await this.requireRoom(slug);
    const runtimeState = this.requireRuntimeState(room);
    this.assertRoomIsMutable(runtimeState);

    if (!isRunItTwiceVotingComplete(runtimeState.table.currentHand?.runItTwicePrompt ?? null)) {
      throw new Error("Run it twice voting is not complete.");
    }

    const now = new Date();
    const table = resolvePendingRunItTwiceDecision(runtimeState.table, now);
    const nextRuntimeState = syncRuntimeState(runtimeState, table, { now });

    await this.database.$transaction(async (transaction) => {
      await transaction.room.update({
        where: { id: room.id },
        data: this.roomUpdatePayload(nextRuntimeState),
      });
    });

    await this.onRoomUpdated?.(slug);
    return this.toSnapshot(nextRuntimeState);
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
    const departingPlayers = activeBustedAccountIds
      .map((accountId) => runtimeState.table.players.find((player) => player.accountId === accountId) ?? null)
      .filter((player): player is TableState["players"][number] => player !== null);

    for (const accountId of activeBustedAccountIds) {
      table = leaveSeat(table, accountId, now);
    }

    const nextRuntimeState = applyLedgerCashOuts(syncRuntimeState({
      ...runtimeState,
      pendingRebuyRequests: runtimeState.pendingRebuyRequests.filter((request) => !activeBustedAccountIds.includes(request.accountId)),
    }, table, { now }), departingPlayers);

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

  private assertRoomIsMutable(runtimeState: PersistedRoomRuntimeState): void {
    if (runtimeState.table.status === "archived") {
      throw new Error("Archived rooms are read-only.");
    }
  }

  private assertViewerHasRoomAccess(runtimeState: PersistedRoomRuntimeState, accountId?: string): void {
    if (!hasViewerRoomAccess(runtimeState, accountId)) {
      throw new Error("Join the room with the correct password before entering.");
    }
  }

  private async getManagedClubSummaryById(clubId: string): Promise<ManagedClubSummary> {
    const club = await this.database.club.findUnique({
      where: { id: clubId },
      select: {
        id: true,
        slug: true,
        name: true,
        ownerId: true,
        createdAt: true,
        updatedAt: true,
        owner: {
          select: {
            username: true,
          },
        },
        _count: {
          select: {
            memberships: true,
            rooms: true,
          },
        },
        memberships: {
          orderBy: [
            { joinedAt: "asc" },
          ],
          select: {
            role: true,
            canManageRooms: true,
            isVisibleInLeaderboard: true,
            joinedAt: true,
            user: {
              select: {
                id: true,
                username: true,
                email: true,
              },
            },
          },
        },
        rankings: {
          where: {
            scope: "CLUB",
          },
          orderBy: [
            { totalProfit: "desc" },
            { updatedAt: "desc" },
          ],
          select: {
            totalProfit: true,
            gamesPlayed: true,
            updatedAt: true,
            user: {
              select: {
                id: true,
                username: true,
                email: true,
              },
            },
          },
        },
        ledgerGames: {
          orderBy: [
            { playedAt: "desc" },
            { importedAt: "desc" },
          ],
          select: {
            id: true,
            label: true,
            playedAt: true,
            importedAt: true,
            entries: {
              orderBy: [
                { playerOrder: "asc" },
              ],
              select: {
                displayName: true,
                hoursPlayed: true,
                totalBuyIn: true,
                cashOut: true,
                netResult: true,
                playerOrder: true,
                user: {
                  select: {
                    id: true,
                    username: true,
                    email: true,
                  },
                },
              },
            },
          },
        },
        leaderboardDisplayNames: {
          orderBy: [
            { displayName: "asc" },
          ],
          select: {
            normalizedDisplayName: true,
            displayName: true,
            isVisibleInLeaderboard: true,
            updatedAt: true,
          },
        },
      },
    });

    if (!club) {
      throw new Error("Club does not exist.");
    }

    return buildManagedClubSummary(club);
  }

  private async recalculateImportedWorkbookRankings(
    database: RankingRecalculationClient,
    clubId: string,
    userIds: string[],
  ): Promise<void> {
    const uniqueUserIds = Array.from(new Set(userIds));

    if (uniqueUserIds.length === 0) {
      return;
    }

    const entries = await database.clubLedgerEntry.findMany({
      where: {
        userId: {
          in: uniqueUserIds,
        },
        game: {
          clubId,
          source: "IMPORTED_WORKBOOK",
        },
      },
      select: {
        userId: true,
        netResult: true,
      },
    });

    const totalsByUserId = new Map(uniqueUserIds.map((userId) => [userId, {
      totalProfit: 0,
      gamesPlayed: 0,
    }]));

    for (const entry of entries) {
      const aggregate = totalsByUserId.get(entry.userId);

      if (!aggregate) {
        continue;
      }

      aggregate.totalProfit += entry.netResult;
      aggregate.gamesPlayed += 1;
    }

    const scopeKey = buildClubScopeKey(clubId);

    for (const [userId, aggregate] of totalsByUserId) {
      await database.userRanking.upsert({
        where: {
          userId_scopeKey: {
            userId,
            scopeKey,
          },
        },
        update: {
          clubId,
          scope: "CLUB",
          totalProfit: BigInt(aggregate.totalProfit),
          gamesPlayed: aggregate.gamesPlayed,
        },
        create: {
          userId,
          clubId,
          scope: "CLUB",
          scopeKey,
          totalProfit: BigInt(aggregate.totalProfit),
          gamesPlayed: aggregate.gamesPlayed,
        },
      });
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

  private async allocateClubSlug(seed: string): Promise<string> {
    const base = slugifyClubName(seed);
    let candidate = base;
    let suffix = 1;

    while (await this.database.club.findUnique({ where: { slug: candidate }, select: { id: true } })) {
      suffix += 1;
      candidate = `${base}-${suffix}`;
    }

    return candidate;
  }

  private async allocateUniqueUsername(seed: string): Promise<string> {
    const base = seed.trim() || "Imported player";
    let candidate = base;
    let suffix = 1;

    while (await this.database.user.findFirst({
      where: {
        username: {
          equals: candidate,
          mode: "insensitive",
        },
      },
      select: {
        id: true,
      },
    })) {
      suffix += 1;
      candidate = `${base} ${suffix}`;
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

  private async listRoomArchiveUserOptions(clubId: string): Promise<RoomArchiveUserOption[]> {
    const users = await this.database.user.findMany({
      where: buildSelectableClubUserWhere(),
      orderBy: {
        username: "asc",
      },
      select: {
        id: true,
        username: true,
        memberships: {
          where: {
            clubId,
          },
          select: {
            id: true,
          },
        },
      },
    });

    return users
      .map((user) => ({
        accountId: user.id,
        username: user.username,
        isClubMember: user.memberships.length > 0,
      }))
      .sort((left, right) => Number(right.isClubMember) - Number(left.isClubMember) || left.username.localeCompare(right.username));
  }

  private async applyClubArchiveRecording(
    transaction: Prisma.TransactionClient,
    room: PersistedRoomRecord,
    runtimeState: PersistedRoomRuntimeState,
    handHistory: ArchivedHandRecord[],
    ledgerRows: RoomArchiveSourceLedgerRow[],
    matchedLedgerAccounts?: ArchiveRoomRequest["matchedLedgerAccounts"],
  ): Promise<void> {
    if (!room.clubId || ledgerRows.length === 0) {
      return;
    }

    const { sourceToMatchedAccountId, matchedUsernameByAccountId } = await this.resolveRoomArchiveMatchState(
      room.clubId,
      ledgerRows,
      matchedLedgerAccounts,
    );

    await this.reconcileArchivedRoomClubRankings(transaction, room.clubId, room.id, sourceToMatchedAccountId);

    const mergedEntries = mergeRoomArchiveLedgerRows(ledgerRows, sourceToMatchedAccountId, matchedUsernameByAccountId);
    const label = normalizeClubLedgerGameLabel(room.name);
    const playedAt = deriveRoomArchivePlayedAt(handHistory, runtimeState.table.updatedAt);

    await transaction.clubLedgerGame.upsert({
      where: {
        clubId_source_sourceKey: {
          clubId: room.clubId,
          source: "IMPORTED_WORKBOOK",
          sourceKey: buildArchivedRoomClubSourceKey(room.id),
        },
      },
      update: {
        label,
        playedAt,
        entries: {
          deleteMany: {},
          create: mergedEntries.map((entry, index) => ({
            userId: entry.accountId,
            displayName: entry.displayName,
            hoursPlayed: null,
            totalBuyIn: entry.totalBuyIn,
            cashOut: entry.cashOut,
            netResult: entry.netResult,
            playerOrder: index,
          })),
        },
      },
      create: {
        clubId: room.clubId,
        source: "IMPORTED_WORKBOOK",
        sourceKey: buildArchivedRoomClubSourceKey(room.id),
        label,
        playedAt,
        entries: {
          create: mergedEntries.map((entry, index) => ({
            userId: entry.accountId,
            displayName: entry.displayName,
            hoursPlayed: null,
            totalBuyIn: entry.totalBuyIn,
            cashOut: entry.cashOut,
            netResult: entry.netResult,
            playerOrder: index,
          })),
        },
      },
    });
  }

  private async resolveRoomArchiveMatchState(
    clubId: string,
    ledgerRows: RoomArchiveSourceLedgerRow[],
    matchedLedgerAccounts?: ArchiveRoomRequest["matchedLedgerAccounts"],
  ): Promise<{
    sourceToMatchedAccountId: Map<string, string>;
    matchedUsernameByAccountId: Map<string, string>;
  }> {
    const knownSourceAccountIds = new Set(ledgerRows.map((row) => row.sourceAccountId));
    const requestedMatchBySourceAccountId = new Map<string, string | null>();

    for (const match of matchedLedgerAccounts ?? []) {
      if (requestedMatchBySourceAccountId.has(match.sourceAccountId)) {
        throw new Error(`Duplicate archive match provided for '${match.sourceAccountId}'.`);
      }

      if (!knownSourceAccountIds.has(match.sourceAccountId)) {
        throw new Error(`Unknown archive ledger row '${match.sourceAccountId}'.`);
      }

      requestedMatchBySourceAccountId.set(match.sourceAccountId, match.matchedAccountId ?? null);
    }

    const matchedAccountIds = Array.from(new Set(ledgerRows.map((row) => requestedMatchBySourceAccountId.get(row.sourceAccountId) ?? row.sourceAccountId)));
    const matchedUsers = await this.database.user.findMany({
      where: {
        id: {
          in: matchedAccountIds,
        },
        ...buildSelectableClubUserWhere(),
      },
      select: {
        id: true,
        username: true,
        memberships: {
          where: {
            clubId,
          },
          select: {
            id: true,
          },
        },
      },
    });

    if (matchedUsers.length !== matchedAccountIds.length) {
      throw new Error("One or more selected archive matches are not valid user accounts.");
    }

    const matchedUsernameByAccountId = new Map(matchedUsers.map((user) => [user.id, user.username]));
    const sourceToMatchedAccountId = new Map<string, string>();

    for (const row of ledgerRows) {
      const matchedAccountId = requestedMatchBySourceAccountId.get(row.sourceAccountId) ?? row.sourceAccountId;
      sourceToMatchedAccountId.set(row.sourceAccountId, matchedAccountId);
    }

    return {
      sourceToMatchedAccountId,
      matchedUsernameByAccountId,
    };
  }

  private async reconcileArchivedRoomClubRankings(
    transaction: Prisma.TransactionClient,
    clubId: string,
    roomId: string,
    sourceToMatchedAccountId: ReadonlyMap<string, string>,
  ): Promise<void> {
    const handResults = await transaction.handResult.findMany({
      where: {
        participant: {
          roomId,
        },
      },
      select: {
        netChips: true,
        participant: {
          select: {
            userId: true,
          },
        },
      },
    });

    const sourceAdjustments = new Map<string, { totalProfit: number; gamesPlayed: number }>();

    for (const result of handResults) {
      const sourceAccountId = result.participant.userId;

      if (!sourceToMatchedAccountId.has(sourceAccountId) || isBotAccountId(sourceAccountId)) {
        continue;
      }

      const current = sourceAdjustments.get(sourceAccountId) ?? { totalProfit: 0, gamesPlayed: 0 };
      current.totalProfit += result.netChips;
      current.gamesPlayed += 1;
      sourceAdjustments.set(sourceAccountId, current);
    }

    if (sourceAdjustments.size === 0) {
      return;
    }

    const scopeKey = buildClubScopeKey(clubId);

    for (const [sourceAccountId, adjustment] of sourceAdjustments) {
      await transaction.userRanking.updateMany({
        where: {
          userId: sourceAccountId,
          scopeKey,
        },
        data: {
          totalProfit: {
            decrement: BigInt(adjustment.totalProfit),
          },
          gamesPlayed: {
            decrement: adjustment.gamesPlayed,
          },
        },
      });
    }

    const matchedAdjustments = new Map<string, { totalProfit: number; gamesPlayed: number }>();

    for (const [sourceAccountId, adjustment] of sourceAdjustments) {
      const matchedAccountId = sourceToMatchedAccountId.get(sourceAccountId) ?? sourceAccountId;
      const current = matchedAdjustments.get(matchedAccountId) ?? { totalProfit: 0, gamesPlayed: 0 };
      current.totalProfit += adjustment.totalProfit;
      current.gamesPlayed += adjustment.gamesPlayed;
      matchedAdjustments.set(matchedAccountId, current);
    }

    await transaction.clubMembership.createMany({
      data: Array.from(matchedAdjustments.keys()).map((accountId) => ({
        clubId,
        userId: accountId,
      })),
      skipDuplicates: true,
    });

    for (const [matchedAccountId, adjustment] of matchedAdjustments) {
      await transaction.userRanking.upsert({
        where: {
          userId_scopeKey: {
            userId: matchedAccountId,
            scopeKey,
          },
        },
        update: {
          clubId,
          scope: "CLUB",
          totalProfit: {
            increment: BigInt(adjustment.totalProfit),
          },
          gamesPlayed: {
            increment: adjustment.gamesPlayed,
          },
        },
        create: {
          userId: matchedAccountId,
          clubId,
          scope: "CLUB",
          scopeKey,
          totalProfit: BigInt(adjustment.totalProfit),
          gamesPlayed: adjustment.gamesPlayed,
        },
      });
    }

    await transaction.userRanking.deleteMany({
      where: {
        clubId,
        scopeKey,
        userId: {
          in: Array.from(sourceAdjustments.keys()),
        },
        gamesPlayed: 0,
        totalProfit: BigInt(0),
      },
    });
  }

  private async upsertClubRankingsForHand(
    transaction: Prisma.TransactionClient,
    clubId: string,
    deltas: Array<{ accountId: string; netChips: number }>,
  ): Promise<void> {
    const applicableDeltas = deltas.filter((delta) => !isBotAccountId(delta.accountId));

    if (applicableDeltas.length === 0) {
      return;
    }

    await transaction.clubMembership.createMany({
      data: Array.from(new Set(applicableDeltas.map((delta) => delta.accountId))).map((accountId) => ({
        clubId,
        userId: accountId,
      })),
      skipDuplicates: true,
    });

    const scopeKey = buildClubScopeKey(clubId);

    for (const delta of applicableDeltas) {
      await transaction.userRanking.upsert({
        where: {
          userId_scopeKey: {
            userId: delta.accountId,
            scopeKey,
          },
        },
        update: {
          clubId,
          scope: "CLUB",
          totalProfit: {
            increment: BigInt(delta.netChips),
          },
          gamesPlayed: {
            increment: 1,
          },
        },
        create: {
          userId: delta.accountId,
          clubId,
          scope: "CLUB",
          scopeKey,
          totalProfit: BigInt(delta.netChips),
          gamesPlayed: 1,
        },
      });
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

function createRuntimeState(table: TableState, isPubliclyListed = true): PersistedRoomRuntimeState {
  const adminOptions = buildDefaultRoomAdminOptions(table, isPubliclyListed);

  return {
    table,
    joinedViewerAccountIds: ensureJoinedViewerAccountIds([], table),
    chatMessages: [],
    seatReactions: [],
    seatGestures: [],
    buyInState: buildRuntimeBuyInState(table, adminOptions, {}),
    ledgerState: ensureLedgerState(undefined, table.players),
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
    adminOptions,
    pendingSeatRequests: [],
    pendingRebuyRequests: [],
    pauseState: {
      pausedAt: null,
      totalPausedMs: 0,
    },
    handHistory: table.lastCompletedHand ? [buildFallbackArchivedHandRecord(table.lastCompletedHand, table.players)] : [],
    recentCompletedHands: table.lastCompletedHand ? [table.lastCompletedHand] : [],
    lastCompletedHandHoleCards: null,
    archivedAt: null,
    archivedByAccountId: null,
  };
}

function normalizeRuntimeState(runtimeState: PersistedRoomRuntimeState): PersistedRoomRuntimeState {
  const turnSeconds = normalizeOptionalRuntimeSetting(runtimeState.turnState?.turnSeconds, DEFAULT_TURN_SECONDS);
  const timeBankSeconds = normalizeOptionalRuntimeSetting(runtimeState.turnState?.timeBankSeconds, DEFAULT_TIMEBANK_SECONDS);
  const normalizedLastCompletedHand = normalizeCompletedHand(runtimeState.table.lastCompletedHand);
  const normalizedRecentCompletedHands = normalizeCompletedHands(runtimeState.recentCompletedHands ?? (normalizedLastCompletedHand ? [normalizedLastCompletedHand] : []));
  const normalizedHandHistory = normalizeArchivedHandHistory(runtimeState.handHistory);
  const revealAllShowdownHands = runtimeState.adminOptions?.revealAllShowdownHands ?? runtimeState.table.revealAllShowdownHands ?? false;
  const runItTwiceEnabled = runtimeState.adminOptions?.runItTwiceEnabled ?? runtimeState.table.runItTwiceEnabled ?? false;
  const buyInOptions = normalizeRoomBuyInAdminOptions(runtimeState.table, runtimeState.adminOptions);

  return {
    table: {
      ...runtimeState.table,
      revealAllShowdownHands,
      runItTwiceEnabled,
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
    buyInState: buildRuntimeBuyInState(runtimeState.table, buyInOptions, runtimeState.buyInState?.buyInTotalByAccount ?? {}),
    ledgerState: ensureLedgerState(runtimeState.ledgerState, runtimeState.table.players),
    playerStats: {
      handsWonByAccount: ensureCounterEntries(runtimeState.playerStats?.handsWonByAccount ?? {}, runtimeState.table.players),
      rebuyCountByAccount: ensureCounterEntries(runtimeState.playerStats?.rebuyCountByAccount ?? {}, runtimeState.table.players),
    },
    turnState: {
      turnSeconds,
      timeBankSeconds,
      currentTurnStartedAt: runtimeState.table.currentHand
        ? runtimeState.turnState?.currentTurnStartedAt ?? runtimeState.table.currentHand.runItTwicePrompt?.createdAt ?? runtimeState.table.currentHand.startedAt
        : null,
      timeBankMsByAccount: ensureTimeBankEntries(runtimeState.turnState?.timeBankMsByAccount ?? {}, runtimeState.table.players, timeBankSeconds),
    },
    adminOptions: {
      decisionTimeSeconds: turnSeconds,
      timeBankSeconds,
      timeBankRefillHands: normalizeOptionalRuntimeSetting(runtimeState.adminOptions?.timeBankRefillHands, null),
      isPubliclyListed: isRoomPubliclyListed(runtimeState.adminOptions),
      minBuyInAmount: buyInOptions.minBuyInAmount,
      maxBuyInRule: buyInOptions.maxBuyInRule,
      revealAllShowdownHands,
      runItTwiceEnabled,
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
    handHistory: normalizedHandHistory.length > 0
      ? normalizedHandHistory
      : normalizedRecentCompletedHands.map((hand) => buildFallbackArchivedHandRecord(hand, runtimeState.table.players)),
    recentCompletedHands: normalizedRecentCompletedHands,
    lastCompletedHandHoleCards: normalizeHoleCardsByAccount(runtimeState.lastCompletedHandHoleCards),
    archivedAt: typeof runtimeState.archivedAt === "string" ? runtimeState.archivedAt : null,
    archivedByAccountId: typeof runtimeState.archivedByAccountId === "string" ? runtimeState.archivedByAccountId : null,
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
  const adminOptions = {
    ...runtimeState.adminOptions,
    revealAllShowdownHands: table.revealAllShowdownHands,
    runItTwiceEnabled: table.runItTwiceEnabled,
  } satisfies RoomAdminOptionsState;
  const previousHand = runtimeState.table.currentHand;
  const nextHand = table.currentHand;
  const shouldRefillTimeBank = shouldRefillTimeBankAfterHand(runtimeState.table, table, adminOptions.timeBankRefillHands);
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
    buyInState: buildRuntimeBuyInState(table, adminOptions, runtimeState.buyInState.buyInTotalByAccount, options.ensurePlayerAccountId),
    ledgerState: ensureLedgerState(runtimeState.ledgerState, table.players),
    playerStats,
    turnState: {
      ...turnState,
      currentTurnStartedAt: nextHand
        ? nextHand.runItTwicePrompt
          ? turnState.currentTurnStartedAt ?? nextHand.runItTwicePrompt.createdAt
          : shouldResetTurnClock
          ? now.toISOString()
          : turnState.currentTurnStartedAt ?? nextHand.startedAt
        : null,
      timeBankMsByAccount: shouldRefillTimeBank
        ? resetOrClampTimeBankEntries({}, table.players, turnState.timeBankSeconds, options.ensurePlayerAccountId)
        : ensureTimeBankEntries(turnState.timeBankMsByAccount, table.players, turnState.timeBankSeconds, options.ensurePlayerAccountId),
    },
    adminOptions,
    pendingSeatRequests: runtimeState.pendingSeatRequests,
    pendingRebuyRequests: runtimeState.pendingRebuyRequests,
    pauseState: runtimeState.pauseState,
    handHistory: syncArchivedHandHistory(runtimeState.handHistory, runtimeState.table, table),
    recentCompletedHands: syncCompletedHandHistory(runtimeState.recentCompletedHands, runtimeState.table, table),
    lastCompletedHandHoleCards: syncLastCompletedHandHoleCards(runtimeState.lastCompletedHandHoleCards, runtimeState.table, table),
    archivedAt: runtimeState.archivedAt,
    archivedByAccountId: runtimeState.archivedByAccountId,
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
        actorAccountId: table.currentHand.runItTwicePrompt
          ? null
          : table.players.find((player) => player.seatIndex === table.currentHand?.actorSeat)?.accountId ?? null,
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
        runItTwicePrompt: table.currentHand.runItTwicePrompt,
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
    ledgerState: ensureLedgerState(runtimeState.ledgerState, table.players),
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
    archive: runtimeState.archivedAt && table.status === "archived"
      ? {
          archivedAt: runtimeState.archivedAt,
          archivedByAccountId: runtimeState.archivedByAccountId ?? table.adminAccountId,
          hands: getArchivedHandHistory(runtimeState),
        }
      : null,
    lastCompletedHandRevealState: buildLastCompletedHandRevealState(runtimeState, accountId),
  };
}

function buildLockedRoomSnapshot(runtimeState: PersistedRoomRuntimeState): RoomSnapshot {
  const table = runtimeState.table;
  const buyInOptions = normalizeRoomBuyInAdminOptions(table, runtimeState.adminOptions);
  const lockedBuyInState = buildRuntimeBuyInState(table, buyInOptions, {});

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
      isPubliclyListed: isRoomPubliclyListed(runtimeState.adminOptions),
      minBuyInAmount: buyInOptions.minBuyInAmount,
      maxBuyInRule: buyInOptions.maxBuyInRule,
      revealAllShowdownHands: false,
      runItTwiceEnabled: false,
    },
    nextHandStartsAt: null,
    handCount: 0,
    players: [],
    chatMessages: [],
    seatReactions: [],
    seatGestures: [],
    buyInState: lockedBuyInState,
    ledgerState: {
      displayNameByAccount: {},
      buyOutByAccount: {},
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
    archive: null,
    lastCompletedHandRevealState: null,
  };
}

function buildManagedRoomSummary(room: ManagedPersistedRoomRecord, runtimeState: PersistedRoomRuntimeState): ManagedRoomSummary {
  const expiresAt = calculateRoomExpiresAt(room.lastActivityAt, room.autoExpireAfterHours);

  return {
    roomId: room.id,
    slug: room.slug,
    name: runtimeState.table.name,
    clubName: room.club?.name ?? null,
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
    archivedAt: runtimeState.archivedAt,
  };
}

function buildPublicRoomSummary(room: ManagedPersistedRoomRecord, runtimeState: PersistedRoomRuntimeState): PublicRoomSummary {
  return {
    roomId: room.id,
    slug: room.slug,
    name: runtimeState.table.name,
    clubName: room.club?.name ?? null,
    adminUsername: room.admin.username,
    visibility: runtimeState.table.visibility,
    status: runtimeState.table.status,
    passwordProtected: runtimeState.table.passwordProtected,
    maxPlayers: runtimeState.table.maxPlayers,
    seatedPlayerCount: runtimeState.table.players.length,
    handCount: runtimeState.table.handCount,
    createdAt: room.createdAt.toISOString(),
    lastActivityAt: room.lastActivityAt.toISOString(),
    archivedAt: runtimeState.archivedAt,
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

function syncArchivedHandHistory(
  currentHistory: PersistedRoomRuntimeState["handHistory"],
  previousTable: TableState,
  nextTable: TableState,
): PersistedRoomRuntimeState["handHistory"] {
  const normalizedHistory = normalizeArchivedHandHistory(currentHistory);
  const completedHand = nextTable.lastCompletedHand;
  const previousCompletedHandNumber = previousTable.lastCompletedHand?.handNumber ?? null;

  if (!previousTable.currentHand || !completedHand) {
    return normalizedHistory;
  }

  if (completedHand.handNumber !== previousTable.currentHand.handNumber || completedHand.handNumber === previousCompletedHandNumber) {
    return normalizedHistory;
  }

  const nextArchivedHand = buildArchivedHandRecord(previousTable, nextTable, completedHand);

  return [
    nextArchivedHand,
    ...normalizedHistory.filter((entry) => entry.handId !== nextArchivedHand.handId && entry.handNumber !== nextArchivedHand.handNumber),
  ];
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
          runouts: Array.isArray(value.allInRunout.runouts)
            ? value.allInRunout.runouts.map((runout) => ({
                board: Array.isArray(runout?.board) ? [...runout.board] : [],
                winners: Array.isArray(runout?.winners)
                  ? runout.winners
                    .filter((winner) => winner && typeof winner.accountId === "string" && typeof winner.seatIndex === "number" && typeof winner.amountWon === "number")
                    .map((winner) => ({
                      accountId: winner.accountId,
                      seatIndex: winner.seatIndex,
                      amountWon: winner.amountWon,
                      handLabel: typeof winner.handLabel === "string" ? winner.handLabel : undefined,
                    }))
                  : [],
              }))
            : undefined,
        }
      : null,
  };
}

function normalizeArchivedHandHistory(value: PersistedRoomRuntimeState["handHistory"] | undefined): PersistedRoomRuntimeState["handHistory"] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<number>();

  return value
    .map((entry) => normalizeArchivedHand(entry))
    .filter((entry): entry is ArchivedHandRecord => Boolean(entry))
    .filter((entry) => {
      if (seen.has(entry.handNumber)) {
        return false;
      }

      seen.add(entry.handNumber);
      return true;
    });
}

function normalizeArchivedHand(value: ArchivedHandRecord | null | undefined): ArchivedHandRecord | null {
  if (!value || typeof value.concludedAt !== "string") {
    return null;
  }

  const normalizedCompletedHand = normalizeCompletedHand({
    handId: value.handId,
    handNumber: value.handNumber,
    board: value.board,
    totalPot: value.totalPot,
    winningReason: value.winningReason,
    concludedAt: value.concludedAt,
    actions: value.actions,
    winners: value.winners,
    revealedHoleCards: value.revealedHoleCards,
    allInRunout: value.allInRunout,
  });

  if (!normalizedCompletedHand) {
    return null;
  }

  return {
    ...normalizedCompletedHand,
    blindLevel: value.blindLevel && typeof value.blindLevel.smallBlind === "number" && typeof value.blindLevel.bigBlind === "number" && typeof value.blindLevel.durationMinutes === "number"
      ? { ...value.blindLevel }
      : null,
    dealerSeat: typeof value.dealerSeat === "number" ? value.dealerSeat : null,
    smallBlindSeat: typeof value.smallBlindSeat === "number" ? value.smallBlindSeat : null,
    bigBlindSeat: typeof value.bigBlindSeat === "number" ? value.bigBlindSeat : null,
    startedAt: typeof value.startedAt === "string" ? value.startedAt : null,
    participants: Array.isArray(value.participants)
      ? value.participants
        .filter((participant) => participant && typeof participant.accountId === "string" && typeof participant.displayName === "string" && typeof participant.seatIndex === "number")
        .map((participant) => ({
          accountId: participant.accountId,
          displayName: participant.displayName,
          seatIndex: participant.seatIndex,
          finalStack: typeof participant.finalStack === "number" && Number.isFinite(participant.finalStack)
            ? Math.max(0, Math.floor(participant.finalStack))
            : 0,
          wasDealtIn: participant.wasDealtIn === true,
        }))
      : [],
  };
}

function buildArchivedHandRecord(previousTable: TableState, nextTable: TableState, completedHand: LastHandResult): ArchivedHandRecord {
  const previousHand = previousTable.currentHand;

  if (!previousHand) {
    return buildFallbackArchivedHandRecord(completedHand, nextTable.players);
  }

  const normalizedCompletedHand = normalizeCompletedHand(completedHand);
  const finalPlayerByAccountId = new Map(nextTable.players.map((player) => [player.accountId, player]));

  return {
    handId: normalizedCompletedHand?.handId ?? completedHand.handId,
    handNumber: normalizedCompletedHand?.handNumber ?? completedHand.handNumber,
    blindLevel: { ...previousHand.blindLevel },
    dealerSeat: previousHand.dealerSeat,
    smallBlindSeat: previousHand.smallBlindSeat,
    bigBlindSeat: previousHand.bigBlindSeat,
    startedAt: previousHand.startedAt,
    concludedAt: normalizedCompletedHand?.concludedAt ?? completedHand.concludedAt,
    board: normalizedCompletedHand?.board ?? [...completedHand.board],
    totalPot: normalizedCompletedHand?.totalPot ?? completedHand.totalPot,
    winningReason: normalizedCompletedHand?.winningReason ?? completedHand.winningReason,
    actions: normalizedCompletedHand?.actions ?? completedHand.actions.map((action) => ({ ...action })),
    winners: normalizedCompletedHand?.winners ?? completedHand.winners.map((winner) => ({ ...winner })),
    revealedHoleCards: normalizedCompletedHand?.revealedHoleCards ?? {},
    allInRunout: normalizedCompletedHand?.allInRunout ?? null,
    participants: previousTable.players
      .map((player) => ({
        accountId: player.accountId,
        displayName: player.displayName,
        seatIndex: player.seatIndex,
        finalStack: Math.max(0, finalPlayerByAccountId.get(player.accountId)?.stack ?? 0),
        wasDealtIn: Object.prototype.hasOwnProperty.call(previousHand.holeCards, player.accountId),
      }))
      .sort((left, right) => left.seatIndex - right.seatIndex),
  };
}

function buildFallbackArchivedHandRecord(completedHand: LastHandResult, players: TableState["players"]): ArchivedHandRecord {
  const normalizedCompletedHand = normalizeCompletedHand(completedHand);
  const playerByAccountId = new Map(players.map((player) => [player.accountId, player]));
  const participantAccountIds = Array.from(new Set([
    ...players.map((player) => player.accountId),
    ...Object.keys(completedHand.revealedHoleCards ?? {}),
    ...completedHand.actions.map((action) => action.actorAccountId),
    ...completedHand.winners.map((winner) => winner.accountId),
  ]));
  const seatByAccountId = new Map<string, number>();

  for (const action of completedHand.actions) {
    seatByAccountId.set(action.actorAccountId, action.actorSeat);
  }

  for (const winner of completedHand.winners) {
    seatByAccountId.set(winner.accountId, winner.seatIndex);
  }

  return {
    handId: normalizedCompletedHand?.handId ?? completedHand.handId,
    handNumber: normalizedCompletedHand?.handNumber ?? completedHand.handNumber,
    blindLevel: null,
    dealerSeat: null,
    smallBlindSeat: null,
    bigBlindSeat: null,
    startedAt: null,
    concludedAt: normalizedCompletedHand?.concludedAt ?? completedHand.concludedAt,
    board: normalizedCompletedHand?.board ?? [...completedHand.board],
    totalPot: normalizedCompletedHand?.totalPot ?? completedHand.totalPot,
    winningReason: normalizedCompletedHand?.winningReason ?? completedHand.winningReason,
    actions: normalizedCompletedHand?.actions ?? completedHand.actions.map((action) => ({ ...action })),
    winners: normalizedCompletedHand?.winners ?? completedHand.winners.map((winner) => ({ ...winner })),
    revealedHoleCards: normalizedCompletedHand?.revealedHoleCards ?? {},
    allInRunout: normalizedCompletedHand?.allInRunout ?? null,
    participants: participantAccountIds
      .map((accountId, index) => {
        const player = playerByAccountId.get(accountId);
        const winner = completedHand.winners.find((entry) => entry.accountId === accountId) ?? null;

        return {
          accountId,
          displayName: player?.displayName ?? accountId,
          seatIndex: player?.seatIndex ?? seatByAccountId.get(accountId) ?? index,
          finalStack: Math.max(0, player?.stack ?? winner?.finalStack ?? 0),
          wasDealtIn: Object.prototype.hasOwnProperty.call(completedHand.revealedHoleCards, accountId)
            || completedHand.actions.some((action) => action.actorAccountId === accountId)
            || completedHand.winners.some((entry) => entry.accountId === accountId),
        };
      })
      .sort((left, right) => left.seatIndex - right.seatIndex),
  };
}

function getArchivedHandHistory(runtimeState: PersistedRoomRuntimeState): PersistedRoomRuntimeState["handHistory"] {
  const normalizedHistory = normalizeArchivedHandHistory(runtimeState.handHistory);

  if (normalizedHistory.length > 0) {
    return normalizedHistory;
  }

  return normalizeArchivedHandHistory(
    runtimeState.recentCompletedHands.map((hand) => buildFallbackArchivedHandRecord(hand, runtimeState.table.players))
  );
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
  if (runtimeState.table.status === "archived" || !accountId || runtimeState.table.currentHand || !runtimeState.table.lastCompletedHand || !runtimeState.lastCompletedHandHoleCards?.[accountId]) {
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

  if (!allInRunout || allInRunout.revealIntervalMs <= 0) {
    return false;
  }

  const concludedAtMs = Date.parse(lastCompletedHand.concludedAt);

  if (Number.isNaN(concludedAtMs)) {
    return false;
  }

  const totalRevealSteps = allInRunout.runouts?.length
    ? allInRunout.runouts.reduce((total, runout) => total + Math.max(0, runout.board.length - allInRunout.startBoardCount), 0)
    : Math.max(0, lastCompletedHand.board.length - allInRunout.startBoardCount);
  const revealedSteps = Math.floor(Math.max(0, nowMs - concludedAtMs) / allInRunout.revealIntervalMs);
  return revealedSteps < totalRevealSteps;
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

function buildDefaultRoomBuyInMaxRule(): RoomBuyInMaxRule {
  return {
    kind: "chip_lead_percentage",
    value: DEFAULT_MAX_BUY_IN_PERCENTAGE,
  };
}

function buildDefaultRoomAdminOptions(table: TableState, isPubliclyListed = true): RoomAdminOptionsState {
  return {
    decisionTimeSeconds: DEFAULT_TURN_SECONDS,
    timeBankSeconds: DEFAULT_TIMEBANK_SECONDS,
    timeBankRefillHands: null,
    isPubliclyListed,
    minBuyInAmount: table.startingStack,
    maxBuyInRule: buildDefaultRoomBuyInMaxRule(),
    revealAllShowdownHands: table.revealAllShowdownHands,
    runItTwiceEnabled: table.runItTwiceEnabled,
  };
}

function isRoomPubliclyListed(
  adminOptions: Pick<RoomAdminOptionsState, "isPubliclyListed"> | Partial<Pick<RoomAdminOptionsState, "isPubliclyListed">> | undefined,
): boolean {
  return adminOptions?.isPubliclyListed ?? true;
}

function normalizePositiveWholeNumber(value: number | undefined, fallback: number, label: string): number {
  const normalized = Math.floor(value ?? fallback);

  if (!Number.isFinite(normalized) || normalized <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }

  return normalized;
}

function normalizeRoomBuyInAdminOptions(
  table: TableState,
  adminOptions: Pick<RoomAdminOptionsState, "minBuyInAmount" | "maxBuyInRule"> | Partial<Pick<RoomAdminOptionsState, "minBuyInAmount" | "maxBuyInRule">> | undefined,
): Pick<RoomAdminOptionsState, "minBuyInAmount" | "maxBuyInRule"> {
  const defaultOptions = buildDefaultRoomAdminOptions(table);
  const configuredRule = adminOptions?.maxBuyInRule;
  const fallbackRule = defaultOptions.maxBuyInRule;
  const kind = configuredRule?.kind === "fixed_amount" || configuredRule?.kind === "chip_lead_percentage"
    ? configuredRule.kind
    : fallbackRule.kind;

  return {
    minBuyInAmount: normalizePositiveWholeNumber(adminOptions?.minBuyInAmount, defaultOptions.minBuyInAmount, "Minimum buy-in"),
    maxBuyInRule: {
      kind,
      value: normalizePositiveWholeNumber(
        configuredRule?.value,
        fallbackRule.value,
        kind === "chip_lead_percentage" ? "Chip leader percentage" : "Maximum buy-in",
      ),
    },
  };
}

function getChipLeaderStack(table: TableState): number {
  return table.players.reduce((largestStack, player) => Math.max(largestStack, player.stack), 0);
}

function resolveConfiguredMaxBuyInAmount(table: TableState, maxBuyInRule: RoomBuyInMaxRule): number {
  if (maxBuyInRule.kind === "fixed_amount") {
    return maxBuyInRule.value;
  }

  return Math.max(table.startingStack, Math.floor(getChipLeaderStack(table) * (maxBuyInRule.value / 100)));
}

function buildRuntimeBuyInState(
  table: TableState,
  adminOptions: Pick<RoomAdminOptionsState, "minBuyInAmount" | "maxBuyInRule">,
  buyInTotalByAccount: Record<string, number>,
  ensurePlayerAccountId?: string,
): RoomBuyInState {
  const buyInOptions = normalizeRoomBuyInAdminOptions(table, adminOptions);

  return {
    minRebuyAmount: buyInOptions.minBuyInAmount,
    maxRebuyAmount: Math.max(buyInOptions.minBuyInAmount, resolveConfiguredMaxBuyInAmount(table, buyInOptions.maxBuyInRule)),
    buyInTotalByAccount: ensureBuyInEntries(buyInTotalByAccount, table.players, table.startingStack, ensurePlayerAccountId),
  };
}

function normalizeRequestedStack(value: number | undefined, fallback: number, minAmount: number, maxAmount: number): number {
  const normalized = Math.floor(value ?? fallback);

  if (!Number.isFinite(normalized) || normalized <= 0) {
    throw new Error("Requested stack must be a positive integer.");
  }

  if (normalized < minAmount) {
    throw new Error(`Requested stack must be at least ${minAmount}.`);
  }

  if (normalized > maxAmount) {
    throw new Error(`Requested stack cannot exceed ${maxAmount}.`);
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

function renumberStartedHand(table: TableState, handNumber: number): TableState {
  if (!table.currentHand) {
    return table;
  }

  return {
    ...table,
    handCount: handNumber,
    currentHand: {
      ...table.currentHand,
      handNumber,
    },
  };
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
  const elapsedActiveMs = getElapsedBlindMs(runtimeState, nowMs);
  const currentLevel = getDisplayedBlindLevel(runtimeState, schedule) ?? schedule[0] ?? null;
  const currentLevelIndex = Math.max(0, getBlindLevelIndex(schedule, currentLevel));
  const nextLevel = currentLevelIndex + 1 < schedule.length ? schedule[currentLevelIndex + 1]! : null;
  const nextLevelInMs = nextLevel
    ? Math.max(0, getBlindLevelEndMs(schedule, currentLevelIndex) - elapsedActiveMs)
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

function getElapsedBlindMinutes(runtimeState: PersistedRoomRuntimeState, nowMs: number): number {
  return Math.floor(getElapsedBlindMs(runtimeState, nowMs) / 60000);
}

function getDisplayedBlindLevel(runtimeState: PersistedRoomRuntimeState, schedule: BlindLevel[]): BlindLevel | null {
  if (runtimeState.table.currentHand?.blindLevel) {
    return runtimeState.table.currentHand.blindLevel;
  }

  const mostRecentAppliedLevel = runtimeState.handHistory.find((hand) => hand.blindLevel)?.blindLevel ?? null;

  if (mostRecentAppliedLevel) {
    return mostRecentAppliedLevel;
  }

  return schedule[0] ?? null;
}

function getBlindLevelIndex(schedule: BlindLevel[], targetLevel: BlindLevel | null): number {
  if (!targetLevel) {
    return -1;
  }

  const byLevelNumber = schedule.findIndex((level) => level.level === targetLevel.level);

  if (byLevelNumber >= 0) {
    return byLevelNumber;
  }

  return schedule.findIndex((level) => (
    level.smallBlind === targetLevel.smallBlind
    && level.bigBlind === targetLevel.bigBlind
    && (level.ante ?? 0) === (targetLevel.ante ?? 0)
    && level.durationMinutes === targetLevel.durationMinutes
  ));
}

function getBlindLevelEndMs(schedule: BlindLevel[], levelIndex: number): number {
  return schedule
    .slice(0, levelIndex + 1)
    .reduce((total, level) => total + level.durationMinutes * 60_000, 0);
}

function getElapsedBlindMs(runtimeState: PersistedRoomRuntimeState, nowMs: number): number {
  const rawElapsedMs = getRawElapsedBlindMs(runtimeState, nowMs);
  const schedule = runtimeState.table.blindSchedule;

  if (schedule.length === 0) {
    return rawElapsedMs;
  }

  const currentLevel = getDisplayedBlindLevel(runtimeState, schedule);
  const currentLevelIndex = Math.max(0, getBlindLevelIndex(schedule, currentLevel));

  return Math.min(rawElapsedMs, getBlindLevelEndMs(schedule, currentLevelIndex));
}

function getBlindClockOverrunMs(runtimeState: PersistedRoomRuntimeState, nowMs: number): number {
  return Math.max(0, getRawElapsedBlindMs(runtimeState, nowMs) - getElapsedBlindMs(runtimeState, nowMs));
}

function getRawElapsedBlindMs(runtimeState: PersistedRoomRuntimeState, nowMs: number): number {
  const sessionStartedAt = runtimeState.table.sessionStartedAt;

  if (!sessionStartedAt) {
    return 0;
  }

  const sessionStartedAtMs = Date.parse(sessionStartedAt);

  if (Number.isNaN(sessionStartedAtMs)) {
    return 0;
  }

  const pausedAtMs = runtimeState.pauseState.pausedAt ? Date.parse(runtimeState.pauseState.pausedAt) : Number.NaN;
  const currentPauseMs = Number.isNaN(pausedAtMs) ? 0 : Math.max(0, nowMs - pausedAtMs);

  return Math.max(0, nowMs - sessionStartedAtMs - runtimeState.pauseState.totalPausedMs - currentPauseMs);
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

function normalizeBotDisplayName(displayName: string | undefined, table: TableState): string {
  const trimmed = displayName?.trim();

  if (trimmed) {
    return trimmed;
  }

  return `Bot ${table.players.filter((player) => isBotAccountId(player.accountId)).length + 1}`;
}

function buildBotUsername(slug: string, accountId: string): string {
  const slugPart = slug.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "room";
  const suffix = accountId.slice(BOT_ACCOUNT_ID_PREFIX.length, BOT_ACCOUNT_ID_PREFIX.length + 12).replace(/[^a-z0-9]+/g, "");
  return `bot_${slugPart}_${suffix}`;
}

function isBotAccountId(accountId: string): boolean {
  return accountId.startsWith(BOT_ACCOUNT_ID_PREFIX);
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

function ensureLedgerState(
  current: RoomLedgerState | null | undefined,
  players: TableState["players"]
): RoomLedgerState {
  const displayNameByAccount = Object.fromEntries(
    Object.entries(current?.displayNameByAccount ?? {}).filter(([, displayName]) => typeof displayName === "string" && displayName.trim().length > 0)
  );
  const buyOutByAccount = Object.fromEntries(
    Object.entries(current?.buyOutByAccount ?? {})
      .filter(([, amount]) => typeof amount === "number" && Number.isFinite(amount) && amount >= 0)
      .map(([accountId, amount]) => [accountId, Math.floor(amount)])
  );

  for (const player of players) {
    displayNameByAccount[player.accountId] = player.displayName;
  }

  return {
    displayNameByAccount,
    buyOutByAccount,
  };
}

function applyLedgerCashOuts(
  runtimeState: PersistedRoomRuntimeState,
  departingPlayers: Array<TableState["players"][number]>
): PersistedRoomRuntimeState {
  if (departingPlayers.length === 0) {
    return runtimeState;
  }

  const ledgerState = ensureLedgerState(runtimeState.ledgerState, runtimeState.table.players);

  for (const player of departingPlayers) {
    ledgerState.displayNameByAccount[player.accountId] = player.displayName;
    ledgerState.buyOutByAccount[player.accountId] = (ledgerState.buyOutByAccount[player.accountId] ?? 0) + Math.max(0, player.stack);
  }

  return {
    ...runtimeState,
    ledgerState,
  };
}

function buildRoomArchiveLedgerRows(runtimeState: PersistedRoomRuntimeState): RoomArchiveSourceLedgerRow[] {
  const accountIds = new Set<string>();

  runtimeState.table.players.forEach((player) => accountIds.add(player.accountId));
  Object.keys(runtimeState.buyInState.buyInTotalByAccount).forEach((accountId) => accountIds.add(accountId));
  Object.keys(runtimeState.ledgerState.buyOutByAccount).forEach((accountId) => accountIds.add(accountId));
  Object.keys(runtimeState.ledgerState.displayNameByAccount).forEach((accountId) => accountIds.add(accountId));
  Object.keys(runtimeState.playerStats.handsWonByAccount).forEach((accountId) => accountIds.add(accountId));
  Object.keys(runtimeState.playerStats.rebuyCountByAccount).forEach((accountId) => accountIds.add(accountId));

  return Array.from(accountIds)
    .map((accountId) => {
      const player = runtimeState.table.players.find((entry) => entry.accountId === accountId) ?? null;
      const totalBuyIn = runtimeState.buyInState.buyInTotalByAccount[accountId] ?? (player ? runtimeState.table.startingStack : 0);
      const buyOut = runtimeState.ledgerState.buyOutByAccount[accountId] ?? 0;
      const stack = player?.stack ?? 0;
      const wins = runtimeState.playerStats.handsWonByAccount[accountId] ?? 0;
      const rebuys = runtimeState.playerStats.rebuyCountByAccount[accountId] ?? 0;
      const cashOut = buyOut + stack;

      return {
        sourceAccountId: accountId,
        displayName: player?.displayName ?? runtimeState.ledgerState.displayNameByAccount[accountId] ?? accountId,
        totalBuyIn,
        buyOut,
        stack,
        cashOut,
        wins,
        rebuys,
        netResult: cashOut - totalBuyIn,
      } satisfies RoomArchiveSourceLedgerRow;
    })
    .filter((row) => row.totalBuyIn > 0 || row.buyOut > 0 || row.stack > 0 || row.wins > 0 || row.rebuys > 0)
    .sort((left, right) => right.netResult - left.netResult || right.wins - left.wins || right.stack - left.stack || left.displayName.localeCompare(right.displayName));
}

function mergeRoomArchiveLedgerRows(
  ledgerRows: RoomArchiveSourceLedgerRow[],
  sourceToMatchedAccountId: ReadonlyMap<string, string>,
  matchedUsernameByAccountId: ReadonlyMap<string, string>,
): MergedRoomArchiveLedgerEntry[] {
  const mergedByAccountId = new Map<string, {
    accountId: string;
    displayNames: Set<string>;
    totalBuyIn: number;
    cashOut: number;
    playerOrder: number;
  }>();

  for (const [index, row] of ledgerRows.entries()) {
    const matchedAccountId = sourceToMatchedAccountId.get(row.sourceAccountId) ?? row.sourceAccountId;
    const merged = mergedByAccountId.get(matchedAccountId) ?? {
      accountId: matchedAccountId,
      displayNames: new Set<string>(),
      totalBuyIn: 0,
      cashOut: 0,
      playerOrder: index,
    };

    merged.displayNames.add(row.displayName);
    merged.totalBuyIn += row.totalBuyIn;
    merged.cashOut += row.cashOut;
    merged.playerOrder = Math.min(merged.playerOrder, index);
    mergedByAccountId.set(matchedAccountId, merged);
  }

  return Array.from(mergedByAccountId.values())
    .sort((left, right) => left.playerOrder - right.playerOrder)
    .map((entry, index) => {
      const displayNames = Array.from(entry.displayNames).filter((value) => value.trim().length > 0);
      const displayName = displayNames.length === 1 && displayNames[0]
        ? displayNames[0]
        : matchedUsernameByAccountId.get(entry.accountId) ?? displayNames[0] ?? entry.accountId;

      return {
        accountId: entry.accountId,
        displayName,
        totalBuyIn: entry.totalBuyIn,
        cashOut: entry.cashOut,
        netResult: entry.cashOut - entry.totalBuyIn,
        playerOrder: index,
      } satisfies MergedRoomArchiveLedgerEntry;
    });
}

function deriveRoomArchivePlayedAt(handHistory: ArchivedHandRecord[], updatedAt: string): Date {
  let earliestTimestamp = Number.POSITIVE_INFINITY;

  for (const hand of handHistory) {
    const candidate = Date.parse(hand.startedAt ?? hand.concludedAt);

    if (!Number.isNaN(candidate) && candidate < earliestTimestamp) {
      earliestTimestamp = candidate;
    }
  }

  if (Number.isFinite(earliestTimestamp)) {
    return new Date(earliestTimestamp);
  }

  const fallbackTimestamp = Date.parse(updatedAt);
  return new Date(Number.isNaN(fallbackTimestamp) ? Date.now() : fallbackTimestamp);
}

function buildArchivedRoomClubSourceKey(roomId: string): string {
  return `archived-room:${roomId}`;
}

function buildSelectableClubUserWhere(): Prisma.UserWhereInput {
  return {
    NOT: [
      {
        id: {
          startsWith: BOT_ACCOUNT_ID_PREFIX,
        },
      },
      {
        email: {
          endsWith: `@${BOT_EMAIL_DOMAIN}`,
        },
      },
      {
        email: {
          endsWith: `@${CLUB_IMPORT_EMAIL_DOMAIN}`,
        },
      },
    ],
  };
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

  const emojiLength = typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
    ? Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(emoji)).length
    : Array.from(emoji).length;

  if (emojiLength > 1) {
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

function slugifyClubName(value: string): string {
  const slug = slugify(value);
  return slug === "poker-room" ? "club" : slug;
}

function normalizeClubName(value: string): string {
  const name = value.trim();

  if (name.length < 2) {
    throw new Error("Club name must contain at least 2 characters.");
  }

  return name;
}

function normalizeClubUserSearchQuery(value: string): string | null {
  const query = value.trim();
  return query.length >= 2 ? query : null;
}

function normalizeSyntheticClubDisplayName(value: string): string {
  const displayName = value.trim();

  if (displayName.length < 2) {
    throw new Error("Imported player name must contain at least 2 characters.");
  }

  return displayName;
}

function normalizeRankingChipValue(value: number, fieldName: string): number {
  if (!Number.isInteger(value)) {
    throw new Error(`Field '${fieldName}' must be a whole number.`);
  }

  return value;
}

function normalizeGamesPlayed(value: number, fieldName: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Field '${fieldName}' must be a whole number greater than or equal to zero.`);
  }

  return value;
}

function normalizeNonNegativeChipValue(value: number, fieldName: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Field '${fieldName}' must be a whole number greater than or equal to zero.`);
  }

  return value;
}

function normalizeClubLedgerGameLabel(value: string): string {
  const label = value.trim();

  if (label.length === 0) {
    throw new Error("Game label must not be empty.");
  }

  return label;
}

function normalizeClubLedgerPlayedAt(value: string): Date {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    throw new Error("Played date must not be empty.");
  }

  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
    ? new Date(`${trimmed}T00:00:00.000Z`)
    : new Date(trimmed);

  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Played date must be a valid date.");
  }

  return parsed;
}

function normalizeClubLedgerHoursPlayed(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildClubScopeKey(clubId: string): string {
  return `club:${clubId}`;
}

function isImportedClubUserEmail(email: string): boolean {
  return email.toLowerCase().endsWith(`@${CLUB_IMPORT_EMAIL_DOMAIN}`);
}

function isSyntheticClubUser(user: { id: string; email: string }): boolean {
  return isBotAccountId(user.id) || isImportedClubUserEmail(user.email);
}

function buildClubSummary(club: PersistedClubRecord): ClubSummary {
  return {
    clubId: club.id,
    slug: club.slug,
    name: club.name,
    ownerUsername: club.owner.username,
    memberCount: club._count.memberships,
    linkedRoomCount: club._count.rooms,
    createdAt: club.createdAt.toISOString(),
    updatedAt: club.updatedAt.toISOString(),
  };
}

interface AggregatedClubLeaderboardEntry {
  entryKey: string;
  accountId: string;
  accountIds: Set<string>;
  username: string;
  displayName?: string;
  totalProfit: bigint;
  gamesPlayed: number;
  updatedAt: Date;
  isSynthetic: boolean;
  isVisibleInLeaderboard: boolean;
  isDerivedFromRecordedGames: boolean;
}

function buildClubLeaderboardEntry(
  ranking: AggregatedClubLeaderboardEntry,
): ClubLeaderboardEntry {
  return {
    entryKey: ranking.entryKey,
    accountId: ranking.accountId,
    accountIds: Array.from(ranking.accountIds).sort(),
    username: ranking.username,
    displayName: ranking.displayName,
    totalProfit: Number(ranking.totalProfit),
    gamesPlayed: ranking.gamesPlayed,
    updatedAt: ranking.updatedAt.toISOString(),
    isSynthetic: ranking.isSynthetic,
    isVisibleInLeaderboard: ranking.isVisibleInLeaderboard,
    isDerivedFromRecordedGames: ranking.isDerivedFromRecordedGames,
    isBalancingEntry: false,
  };
}

function buildClubLeaderboardBalancingEntry(entries: ClubLeaderboardEntry[]): ClubLeaderboardEntry | null {
  if (entries.length === 0) {
    return null;
  }

  const totalProfit = entries.reduce((sum, entry) => sum + entry.totalProfit, 0);
  const gamesPlayed = entries.reduce((sum, entry) => sum + entry.gamesPlayed, 0);
  let latestUpdatedAt = new Date(0).toISOString();

  for (const entry of entries) {
    if (Date.parse(entry.updatedAt) > Date.parse(latestUpdatedAt)) {
      latestUpdatedAt = entry.updatedAt;
    }
  }

  return {
    entryKey: "solo-balance",
    accountId: "solo-balance",
    accountIds: [],
    username: "(Others)",
    displayName: "(Others)",
    totalProfit: -totalProfit,
    gamesPlayed,
    updatedAt: latestUpdatedAt,
    isSynthetic: true,
    isVisibleInLeaderboard: true,
    isDerivedFromRecordedGames: false,
    isBalancingEntry: true,
  };
}

function buildClubGameLedgerEntry(entry: PersistedClubLedgerEntryRecord): ClubGameLedgerEntry {
  return {
    accountId: entry.user.id,
    username: entry.user.username,
    displayName: entry.displayName,
    hoursPlayed: entry.hoursPlayed,
    totalBuyIn: entry.totalBuyIn,
    cashOut: entry.cashOut,
    netResult: entry.netResult,
    isSynthetic: isSyntheticClubUser(entry.user),
  };
}

function buildClubGameLedger(game: PersistedClubLedgerGameRecord): ClubGameLedger {
  return {
    gameId: game.id,
    label: game.label,
    playedAt: game.playedAt.toISOString(),
    importedAt: game.importedAt.toISOString(),
    entryCount: game.entries.length,
    ledger: game.entries.map((entry) => buildClubGameLedgerEntry(entry)),
  };
}

function buildClubMemberSummary(membership: PersistedClubMembershipRecord): ClubMemberSummary {
  return {
    accountId: membership.user.id,
    username: membership.user.username,
    email: membership.user.email,
    role: membership.role,
    canManageRooms: membership.canManageRooms,
    isVisibleInLeaderboard: membership.isVisibleInLeaderboard,
    joinedAt: membership.joinedAt.toISOString(),
    isSynthetic: isSyntheticClubUser(membership.user),
  };
}

function shouldIncludePublicClubLeaderboardRanking(ranking: AggregatedClubLeaderboardEntry): boolean {
  if (!ranking.isVisibleInLeaderboard) {
    return false;
  }

  return (ranking.displayName ?? ranking.username).trim().toLowerCase() !== "others";
}

function normalizeClubLeaderboardDisplayNameKey(displayName: string): string {
  return displayName.trim().toLowerCase();
}

function buildClubLeaderboardVisibilityByDisplayName(
  leaderboardDisplayNames: PersistedClubLeaderboardDisplayNameRecord[],
): Map<string, boolean> {
  return new Map(leaderboardDisplayNames.map((entry) => [entry.normalizedDisplayName, entry.isVisibleInLeaderboard]));
}

function buildClubLeaderboardVisibilityByUserId(
  memberships: PersistedClubMembershipRecord[],
): Map<string, boolean> {
  return new Map(memberships.map((membership) => [membership.user.id, membership.isVisibleInLeaderboard]));
}

function buildClubLeaderboardEntries(
  rankings: PersistedClubRankingRecord[],
  memberships: PersistedClubMembershipRecord[],
  gameHistory: PersistedClubLedgerGameRecord[],
  leaderboardDisplayNames: PersistedClubLeaderboardDisplayNameRecord[],
  options?: {
    includeHidden?: boolean;
  },
): ClubLeaderboardEntry[] {
  const visibilityByUserId = buildClubLeaderboardVisibilityByUserId(memberships);
  const visibilityByDisplayName = buildClubLeaderboardVisibilityByDisplayName(leaderboardDisplayNames);
  const aggregatedByDisplayName = new Map<string, AggregatedClubLeaderboardEntry>();
  const recordedTotalsByUserId = new Map<string, { totalProfit: bigint; gamesPlayed: number }>();

  const includeHidden = options?.includeHidden ?? false;

  const collectRanking = (input: {
    groupingLabel: string;
    accountId: string;
    username: string;
    displayName?: string;
    totalProfit: bigint;
    gamesPlayed: number;
    updatedAt: Date;
    isSynthetic: boolean;
    defaultIsVisibleInLeaderboard: boolean;
    isDerivedFromRecordedGames: boolean;
  }) => {
    const groupingKey = normalizeClubLeaderboardDisplayNameKey(input.groupingLabel);

    if (groupingKey.length === 0) {
      return;
    }

    const aggregate = aggregatedByDisplayName.get(groupingKey);

    if (aggregate) {
      aggregate.accountIds.add(input.accountId);
      aggregate.totalProfit += input.totalProfit;
      aggregate.gamesPlayed += input.gamesPlayed;

      if (input.updatedAt.getTime() > aggregate.updatedAt.getTime()) {
        aggregate.updatedAt = input.updatedAt;
      }

      if (!aggregate.displayName && input.displayName) {
        aggregate.displayName = input.displayName;
      }

      aggregate.isSynthetic &&= input.isSynthetic;
      aggregate.isVisibleInLeaderboard &&= input.defaultIsVisibleInLeaderboard;
      aggregate.isDerivedFromRecordedGames ||= input.isDerivedFromRecordedGames;
      return;
    }

    aggregatedByDisplayName.set(groupingKey, {
      entryKey: groupingKey,
      accountId: input.accountId,
      accountIds: new Set([input.accountId]),
      username: input.username,
      displayName: input.displayName,
      totalProfit: input.totalProfit,
      gamesPlayed: input.gamesPlayed,
      updatedAt: input.updatedAt,
      isSynthetic: input.isSynthetic,
      isVisibleInLeaderboard: input.defaultIsVisibleInLeaderboard,
      isDerivedFromRecordedGames: input.isDerivedFromRecordedGames,
    });
  };

  for (const game of gameHistory) {
    for (const entry of game.entries) {
      const displayName = entry.displayName.trim() || entry.user.username;
      const recordedTotals = recordedTotalsByUserId.get(entry.user.id) ?? {
        totalProfit: BigInt(0),
        gamesPlayed: 0,
      };

      recordedTotals.totalProfit += BigInt(entry.netResult);
      recordedTotals.gamesPlayed += 1;
      recordedTotalsByUserId.set(entry.user.id, recordedTotals);

      collectRanking({
        groupingLabel: displayName,
        accountId: entry.user.id,
        username: entry.user.username,
        displayName: entry.displayName.trim() || undefined,
        totalProfit: BigInt(entry.netResult),
        gamesPlayed: 1,
        updatedAt: game.importedAt,
        isSynthetic: isSyntheticClubUser(entry.user),
        defaultIsVisibleInLeaderboard: visibilityByUserId.get(entry.user.id) ?? true,
        isDerivedFromRecordedGames: true,
      });
    }
  }

  for (const ranking of rankings) {
    const recordedTotals = recordedTotalsByUserId.get(ranking.user.id);
    const remainingTotalProfit = recordedTotals
      ? ranking.totalProfit - recordedTotals.totalProfit
      : ranking.totalProfit;
    const remainingGamesPlayed = recordedTotals
      ? ranking.gamesPlayed - recordedTotals.gamesPlayed
      : ranking.gamesPlayed;

    if (recordedTotals && remainingTotalProfit === BigInt(0) && remainingGamesPlayed === 0) {
      continue;
    }

    collectRanking({
      groupingLabel: ranking.user.username,
      accountId: ranking.user.id,
      username: ranking.user.username,
      totalProfit: remainingTotalProfit,
      gamesPlayed: remainingGamesPlayed,
      updatedAt: ranking.updatedAt,
      isSynthetic: isSyntheticClubUser(ranking.user),
      defaultIsVisibleInLeaderboard: visibilityByUserId.get(ranking.user.id) ?? true,
      isDerivedFromRecordedGames: false,
    });
  }

  for (const [displayNameKey, aggregate] of aggregatedByDisplayName) {
    const visibilityOverride = visibilityByDisplayName.get(displayNameKey);

    if (visibilityOverride !== undefined) {
      aggregate.isVisibleInLeaderboard = visibilityOverride;
    }
  }

  const leaderboardEntries = Array.from(aggregatedByDisplayName.values())
    .filter((ranking) => includeHidden || shouldIncludePublicClubLeaderboardRanking(ranking))
    .sort((left, right) => {
      if (left.totalProfit !== right.totalProfit) {
        return left.totalProfit > right.totalProfit ? -1 : 1;
      }

      if (left.updatedAt.getTime() !== right.updatedAt.getTime()) {
        return right.updatedAt.getTime() - left.updatedAt.getTime();
      }

      return (left.displayName ?? left.username).localeCompare(right.displayName ?? right.username);
    })
    .map((ranking) => buildClubLeaderboardEntry(ranking));

  if (!includeHidden) {
    const balancingEntry = buildClubLeaderboardBalancingEntry(leaderboardEntries);

    if (balancingEntry) {
      leaderboardEntries.push(balancingEntry);
    }
  }

  return leaderboardEntries;
}

function buildClubDetails(
  club: PersistedClubRecord,
  rankings: PersistedClubRankingRecord[],
  memberships: PersistedClubMembershipRecord[],
  gameHistory: PersistedClubLedgerGameRecord[],
  leaderboardDisplayNames: PersistedClubLeaderboardDisplayNameRecord[],
): ClubDetails {
  return {
    ...buildClubSummary(club),
    leaderboard: buildClubLeaderboardEntries(rankings, memberships, gameHistory, leaderboardDisplayNames),
    gameHistory: gameHistory.map((game) => buildClubGameLedger(game)),
  };
}

function buildManagedClubSummary(club: ManagedPersistedClubRecord): ManagedClubSummary {
  return {
    ...buildClubSummary(club),
    ownerAccountId: club.ownerId,
    members: club.memberships.map((membership) => buildClubMemberSummary(membership)),
    leaderboard: buildClubLeaderboardEntries(club.rankings, club.memberships, club.ledgerGames, club.leaderboardDisplayNames, {
      includeHidden: true,
    }),
    gameHistory: club.ledgerGames.map((game) => buildClubGameLedger(game)),
  };
}

function toPrismaVisibility(visibility: TableState["visibility"]): RoomVisibility {
  return visibility === "club" ? "CLUB" : "PRIVATE";
}

function toPrismaStatus(status: TableState["status"]): RoomStatus {
  switch (status) {
    case "active":
      return "ACTIVE";
    case "archived":
      return "ARCHIVED";
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
