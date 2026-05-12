import type {
  BlindLevel,
  Card,
  CreateTableInput,
  HandActionRecord,
  LastHandResult,
  PlayerActionState,
  PlayerActionType,
  RunItTwiceResponse,
  TableState,
} from "@poker/domain";

export interface CreateRoomRequest {
  slug?: string;
  name: string;
  adminAccountId: string;
  sessionToken?: string;
  clubId?: string;
  visibility?: CreateTableInput["visibility"];
  isPubliclyListed?: boolean;
  password?: string;
  maxPlayers?: number;
  startingStack?: number;
  blindSchedule?: BlindLevel[];
  autoStartNextHand?: boolean;
  autoStartDelaySeconds?: number;
  runItTwiceEnabled?: boolean;
  revealAllShowdownHands?: boolean;
}

export interface SeatPlayerRequest {
  slug: string;
  accountId: string;
  displayName: string;
  seatIndex: number;
  requestedStack?: number;
}

export interface SeatBotRequest {
  slug: string;
  accountId: string;
  displayName?: string;
  seatIndex: number;
  requestedStack?: number;
}

export interface PlayerReadyRequest {
  slug: string;
  accountId: string;
  isReady: boolean;
}

export interface PlayerSitOutRequest {
  slug: string;
  accountId: string;
  isSittingOut: boolean;
}

export interface LeaveSeatRequest {
  slug: string;
  accountId: string;
}

export interface RoomReactionRequest {
  slug: string;
  accountId: string;
  emoji: string;
}

export interface RoomGestureRequest {
  slug: string;
  accountId: string;
  emoji?: string;
}

export interface RoomChatRequest {
  slug: string;
  accountId: string;
  displayName?: string;
  content: string;
}

export interface RoomRebuyRequest {
  slug: string;
  accountId: string;
  amount: number;
}

export interface RoomSeatRequestDecision {
  slug: string;
  accountId: string;
  requestId: string;
  approved: boolean;
  requestedStack?: number;
}

export interface RoomRebuyRequestDecision {
  slug: string;
  accountId: string;
  requestId: string;
  approved: boolean;
  amount?: number;
}

export type RevealMode = "none" | "first" | "second" | "both";

export interface RoomRevealCardsRequest {
  slug: string;
  accountId: string;
  revealMode: RevealMode;
}

export interface PlayerConnectionRequest {
  slug: string;
  accountId: string;
  isConnected: boolean;
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

export type RoomBuyInMaxRuleKind = "fixed_amount" | "chip_lead_percentage";

export interface RoomBuyInMaxRule {
  kind: RoomBuyInMaxRuleKind;
  value: number;
}

export interface UpdateRoomAdminOptionsRequest {
  slug: string;
  accountId: string;
  blindSchedule: BlindLevel[];
  autoStartNextHand: boolean;
  autoStartDelaySeconds: number;
  turnSeconds: number | null;
  timeBankSeconds: number | null;
  timeBankRefillHands: number | null;
  isPubliclyListed: boolean;
  minBuyInAmount: number;
  maxBuyInRule: RoomBuyInMaxRule;
  revealAllShowdownHands: boolean;
  runItTwiceEnabled: boolean;
}

export interface RoomManagementAdmin {
  accountId: string;
  username: string;
}

export type ClubRoleValue = "OWNER" | "ADMIN" | "MEMBER";

export interface ClubLeaderboardEntry {
  entryKey: string;
  accountId: string;
  accountIds: string[];
  username: string;
  displayName?: string;
  totalProfit: number;
  gamesPlayed: number;
  updatedAt: string;
  isSynthetic: boolean;
  isVisibleInLeaderboard: boolean;
  isDerivedFromRecordedGames: boolean;
  isBalancingEntry: boolean;
}

export interface ClubGameLedgerEntry {
  accountId: string;
  username: string;
  displayName: string;
  hoursPlayed: string | null;
  totalBuyIn: number;
  cashOut: number;
  netResult: number;
  isSynthetic: boolean;
}

export interface ClubGameLedger {
  gameId: string;
  label: string;
  playedAt: string;
  importedAt: string;
  entryCount: number;
  ledger: ClubGameLedgerEntry[];
}

export interface ClubMemberSummary {
  accountId: string;
  username: string;
  email: string;
  role: ClubRoleValue;
  canManageRooms: boolean;
  isVisibleInLeaderboard: boolean;
  joinedAt: string;
  isSynthetic: boolean;
}

export interface ClubSummary {
  clubId: string;
  slug: string;
  name: string;
  ownerUsername: string;
  memberCount: number;
  linkedRoomCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ClubDetails extends ClubSummary {
  leaderboard: ClubLeaderboardEntry[];
  gameHistory: ClubGameLedger[];
}

export interface ManagedClubSummary extends ClubSummary {
  ownerAccountId: string;
  members: ClubMemberSummary[];
  leaderboard: ClubLeaderboardEntry[];
  gameHistory: ClubGameLedger[];
}

export interface ClubUserSearchResult {
  accountId: string;
  username: string;
  email: string;
  createdAt: string;
  isMember: boolean;
}

export interface CreateClubRequest {
  name: string;
  ownerAccountId: string;
}

export interface AddClubMemberRequest {
  clubId: string;
  accountId: string;
  role?: ClubRoleValue;
  canManageRooms?: boolean;
  isVisibleInLeaderboard?: boolean;
}

export interface SearchClubUsersRequest {
  query: string;
  clubId?: string;
}

export interface CreateSyntheticClubPlayerRequest {
  clubId: string;
  displayName: string;
  totalProfit: number;
  gamesPlayed?: number;
}

export interface UpdateClubLeaderboardEntryRequest {
  clubId: string;
  accountId: string;
  accountIds?: string[];
  displayName?: string;
  totalProfit?: number;
  gamesPlayed?: number;
  isVisibleInLeaderboard?: boolean;
}

export interface UpdateClubGameLedgerEntryRequest {
  accountId: string;
  displayName: string;
  hoursPlayed?: string | null;
  totalBuyIn: number;
  cashOut: number;
}

export interface UpdateClubGameLedgerRequest {
  clubId: string;
  gameId: string;
  label: string;
  playedAt: string;
  entries: UpdateClubGameLedgerEntryRequest[];
}

export interface ManagedRoomSummary {
  roomId: string;
  slug: string;
  name: string;
  clubName: string | null;
  adminAccountId: string;
  adminUsername: string;
  visibility: TableState["visibility"];
  status: TableState["status"];
  passwordProtected: boolean;
  maxPlayers: number;
  seatedPlayerCount: number;
  connectedPlayerCount: number;
  handCount: number;
  pendingSeatRequestCount: number;
  pendingRebuyRequestCount: number;
  createdAt: string;
  lastActivityAt: string;
  autoExpireAfterHours: number | null;
  expiresAt: string | null;
  archivedAt: string | null;
}

export interface PublicRoomSummary {
  roomId: string;
  slug: string;
  name: string;
  clubName: string | null;
  adminUsername: string;
  visibility: TableState["visibility"];
  status: TableState["status"];
  passwordProtected: boolean;
  maxPlayers: number;
  seatedPlayerCount: number;
  handCount: number;
  createdAt: string;
  lastActivityAt: string;
  archivedAt: string | null;
}

export interface AutoExpiringRoom {
  roomId: string;
  slug: string;
  lastActivityAt: string;
  autoExpireAfterHours: number;
  expiresAt: string;
}

export interface UpdateManagedRoomsAutoExpirationRequest {
  roomIds: string[];
  autoExpireAfterHours: number | null;
}

export interface DeleteManagedRoomsRequest {
  roomIds: string[];
}

export interface DeleteManagedRoomsResult {
  deletedRoomIds: string[];
  deletedSlugs: string[];
}

export interface GetRoomArchivePreviewRequest {
  slug: string;
  accountId: string;
}

export interface RoomArchiveLedgerMatchRequest {
  sourceAccountId: string;
  matchedAccountId?: string | null;
}

export interface ArchiveRoomRequest {
  slug: string;
  accountId: string;
  matchedLedgerAccounts?: RoomArchiveLedgerMatchRequest[];
}

export interface RoomArchiveUserOption {
  accountId: string;
  username: string;
  isClubMember: boolean;
}

export interface RoomArchiveLedgerRow {
  sourceAccountId: string;
  sourceUsername: string;
  displayName: string;
  totalBuyIn: number;
  buyOut: number;
  stack: number;
  cashOut: number;
  wins: number;
  rebuys: number;
  netResult: number;
}

export interface RoomArchivePreview {
  roomId: string;
  slug: string;
  name: string;
  clubId: string;
  clubName: string;
  label: string;
  playedAt: string;
  ledger: RoomArchiveLedgerRow[];
  users: RoomArchiveUserOption[];
}

export interface ArchivedHandParticipant {
  accountId: string;
  displayName: string;
  seatIndex: number;
  finalStack: number;
  wasDealtIn: boolean;
}

export interface ArchivedHandRecord {
  handId: string;
  handNumber: number;
  blindLevel: BlindLevel | null;
  dealerSeat: number | null;
  smallBlindSeat: number | null;
  bigBlindSeat: number | null;
  startedAt: string | null;
  concludedAt: string;
  board: Card[];
  totalPot: number;
  winningReason: LastHandResult["winningReason"];
  actions: HandActionRecord[];
  winners: LastHandResult["winners"];
  revealedHoleCards: LastHandResult["revealedHoleCards"];
  allInRunout: LastHandResult["allInRunout"];
  participants: ArchivedHandParticipant[];
}

export interface SetRoomPausedRequest {
  slug: string;
  accountId: string;
  isPaused: boolean;
}

export interface StopRoomRequest {
  slug: string;
  accountId: string;
}

export interface RemovePlayerRequest {
  slug: string;
  accountId: string;
  targetAccountId: string;
}

export interface RoomActionRequest {
  slug: string;
  accountId: string;
  actionType: PlayerActionType;
  amount?: number;
}

export interface RoomRunItTwiceDecisionRequest {
  slug: string;
  accountId: string;
  willing: boolean;
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
  blindState: RoomBlindState;
  adminOptions: RoomAdminOptionsState;
  nextHandStartsAt: string | null;
  handCount: number;
  players: TableState["players"];
  chatMessages: RoomChatMessage[];
  seatReactions: RoomSeatReaction[];
  seatGestures: RoomSeatGesture[];
  buyInState: RoomBuyInState;
  ledgerState: RoomLedgerState;
  playerStats: RoomPlayerStatsState;
  turnState: RoomTurnState;
  pendingSeatRequests: RoomPendingSeatRequest[];
  pendingRebuyRequests: RoomPendingRebuyRequest[];
  currentHand: null | {
    id: string;
    handNumber: number;
    blindLevel: BlindLevel;
    dealerSeat: number;
    smallBlindSeat: number;
    bigBlindSeat: number;
    actorSeat: number;
    actorAccountId: string | null;
    street: string;
    board: Card[];
    pot: number;
    currentBet: number;
    contributions: Record<string, number>;
    streetContributions: Record<string, number>;
    foldedAccountIds: string[];
    playersToAct: string[];
    startedAt: string;
    actions: HandActionRecord[];
    heroHoleCards: [Card, Card] | null;
    heroActionState: PlayerActionState | null;
    runItTwicePrompt: null | {
      eligibleAccountIds: string[];
      responsesByAccountId: Record<string, RunItTwiceResponse>;
      createdAt: string;
    };
    playerCardCounts: Record<string, number>;
    remainingDeckCount: number;
  };
  lastCompletedHand: LastHandResult | null;
  recentCompletedHands: LastHandResult[];
  archive: null | {
    archivedAt: string;
    archivedByAccountId: string;
    hands: ArchivedHandRecord[];
  };
  lastCompletedHandRevealState: null | {
    forced: boolean;
    currentMode: RevealMode;
    allowedModes: RevealMode[];
  };
}

export interface RoomChatMessage {
  id: string;
  accountId: string;
  displayName: string;
  content: string;
  createdAt: string;
}

export interface RoomTurnState {
  turnSeconds: number | null;
  timeBankSeconds: number | null;
  currentTurnStartedAt: string | null;
  timeBankMsByAccount: Record<string, number>;
}

export interface RoomBlindState {
  schedule: BlindLevel[];
  sessionStartedAt: string | null;
  currentLevel: BlindLevel | null;
  nextLevel: BlindLevel | null;
  nextLevelInMs: number | null;
  snapshotAt: string;
  pausedAt: string | null;
}

export interface RoomAdminOptionsState {
  decisionTimeSeconds: number | null;
  timeBankSeconds: number | null;
  timeBankRefillHands: number | null;
  isPubliclyListed: boolean;
  minBuyInAmount: number;
  maxBuyInRule: RoomBuyInMaxRule;
  revealAllShowdownHands: boolean;
  runItTwiceEnabled: boolean;
}

export interface RoomSeatReaction {
  id: string;
  accountId: string;
  emoji: string;
  createdAt: string;
  expiresAt: string;
}

export interface RoomSeatGesture {
  accountId: string;
  emoji: string;
  updatedAt: string;
}

export interface RoomBuyInState {
  minRebuyAmount: number;
  maxRebuyAmount: number;
  buyInTotalByAccount: Record<string, number>;
}

export interface RoomLedgerState {
  displayNameByAccount: Record<string, string>;
  buyOutByAccount: Record<string, number>;
}

export interface RoomPlayerStatsState {
  handsWonByAccount: Record<string, number>;
  rebuyCountByAccount: Record<string, number>;
}

export interface RoomPendingSeatRequest {
  id: string;
  accountId: string;
  displayName: string;
  seatIndex: number;
  requestedStack: number;
  createdAt: string;
}

export interface RoomPendingRebuyRequest {
  id: string;
  accountId: string;
  displayName: string;
  amount: number;
  createdAt: string;
}

export interface RoomRegistry {
  createRoom(input: CreateRoomRequest): Promise<RoomSnapshot>;
  joinRoom(input: JoinRoomRequest): Promise<RoomSnapshot>;
  listClubs(): Promise<ClubSummary[]>;
  getClubBySlug(slug: string): Promise<ClubDetails | null>;
  listPublicRooms(): Promise<PublicRoomSummary[]>;
  seatPlayer(input: SeatPlayerRequest): Promise<RoomSnapshot>;
  seatBot(input: SeatBotRequest): Promise<RoomSnapshot>;
  setReady(input: PlayerReadyRequest): Promise<RoomSnapshot>;
  setSittingOut(input: PlayerSitOutRequest): Promise<RoomSnapshot>;
  leaveSeat(input: LeaveSeatRequest): Promise<RoomSnapshot>;
  postReaction(input: RoomReactionRequest): Promise<RoomSnapshot>;
  setGesture(input: RoomGestureRequest): Promise<RoomSnapshot>;
  postChatMessage(input: RoomChatRequest): Promise<RoomSnapshot>;
  rebuyPlayer(input: RoomRebuyRequest): Promise<RoomSnapshot>;
  decideSeatRequest(input: RoomSeatRequestDecision): Promise<RoomSnapshot>;
  decideRebuyRequest(input: RoomRebuyRequestDecision): Promise<RoomSnapshot>;
  updateAdminOptions(input: UpdateRoomAdminOptionsRequest): Promise<RoomSnapshot>;
  setRoomPaused(input: SetRoomPausedRequest): Promise<RoomSnapshot>;
  stopRoom(input: StopRoomRequest): Promise<RoomSnapshot>;
  archiveRoom(input: ArchiveRoomRequest): Promise<RoomSnapshot>;
  removePlayer(input: RemovePlayerRequest): Promise<RoomSnapshot>;
  revealCards(input: RoomRevealCardsRequest): Promise<RoomSnapshot>;
  setPlayerConnection(input: PlayerConnectionRequest): Promise<RoomSnapshot>;
  cleanupBustedPlayers(slug: string): Promise<RoomSnapshot>;
  startHand(input: StartHandRequest): Promise<RoomSnapshot>;
  actOnHand(input: RoomActionRequest): Promise<RoomSnapshot>;
  submitRunItTwiceDecision(input: RoomRunItTwiceDecisionRequest): Promise<RoomSnapshot>;
  expirePendingRunItTwiceDecision(slug: string): Promise<RoomSnapshot>;
  resolvePendingRunItTwiceDecision(slug: string): Promise<RoomSnapshot>;
  getRoomArchivePreview(input: GetRoomArchivePreviewRequest): Promise<RoomArchivePreview>;
  getRoomSnapshot(slug: string, accountId?: string): Promise<RoomSnapshot>;
  getViewerRoomSnapshot(slug: string, accountId?: string): Promise<RoomSnapshot>;
  assertManagementAdmin(sessionToken?: string): Promise<RoomManagementAdmin>;
  listManagedClubs(): Promise<ManagedClubSummary[]>;
  createClub(input: CreateClubRequest): Promise<ManagedClubSummary>;
  searchClubUsers(input: SearchClubUsersRequest): Promise<ClubUserSearchResult[]>;
  addClubMember(input: AddClubMemberRequest): Promise<ManagedClubSummary>;
  createSyntheticClubPlayer(input: CreateSyntheticClubPlayerRequest): Promise<ManagedClubSummary>;
  updateClubLeaderboardEntry(input: UpdateClubLeaderboardEntryRequest): Promise<ManagedClubSummary>;
  updateClubGameLedger(input: UpdateClubGameLedgerRequest): Promise<ManagedClubSummary>;
  listManagedRooms(): Promise<ManagedRoomSummary[]>;
  listAutoExpiringRooms(): Promise<AutoExpiringRoom[]>;
  getAutoExpiringRoom(slug: string): Promise<AutoExpiringRoom | null>;
  updateManagedRoomsAutoExpiration(input: UpdateManagedRoomsAutoExpirationRequest): Promise<ManagedRoomSummary[]>;
  deleteManagedRooms(input: DeleteManagedRoomsRequest): Promise<DeleteManagedRoomsResult>;
}
