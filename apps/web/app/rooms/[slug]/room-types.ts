export interface Card {
  rank: string;
  suit: "clubs" | "diamonds" | "hearts" | "spades";
}

export interface RoomPlayer {
  accountId: string;
  displayName: string;
  seatIndex: number;
  stack: number;
  isReady: boolean;
  isConnected: boolean;
  isSittingOut: boolean;
}

export interface HeroActionState {
  accountId: string;
  seatIndex: number;
  canAct: boolean;
  hasFolded: boolean;
  isAllIn: boolean;
  contribution: number;
  streetContribution: number;
  callAmount: number;
  minRaiseTo: number | null;
  maxRaiseTo: number;
  allowedActions: Array<"fold" | "check" | "call" | "bet" | "raise" | "all_in">;
}

export interface HandActionRecord {
  orderIndex: number;
  actorAccountId: string;
  actorSeat: number;
  type: "post_ante" | "post_small_blind" | "post_big_blind" | "fold" | "check" | "call" | "bet" | "raise" | "all_in";
  street: "preflop" | "flop" | "turn" | "river" | "showdown";
  amount: number;
  betTo: number;
  createdAt: string;
}

export interface LastHandWinner {
  accountId: string;
  seatIndex: number;
  amountWon: number;
  netChips: number;
  finalStack: number;
  handLabel?: string;
}

export interface AllInRunoutWinner {
  accountId: string;
  seatIndex: number;
  amountWon: number;
  handLabel?: string;
}

export interface AllInRunoutResult {
  board: Card[];
  winners: AllInRunoutWinner[];
}

export type RunItTwiceResponse = "yes" | "no";

export interface LastHandResult {
  handId: string;
  handNumber: number;
  board: Card[];
  totalPot: number;
  winningReason: "fold" | "showdown";
  concludedAt: string;
  actions: HandActionRecord[];
  winners: LastHandWinner[];
  revealedHoleCards: Record<string, [Card | null, Card | null]>;
  allInRunout: null | {
    startBoardCount: number;
    revealIntervalMs: number;
    revealedAccountIds: string[];
    runouts?: AllInRunoutResult[];
  };
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
  blindLevel: {
    level: number;
    smallBlind: number;
    bigBlind: number;
    ante?: number;
    durationMinutes: number;
  } | null;
  dealerSeat: number | null;
  smallBlindSeat: number | null;
  bigBlindSeat: number | null;
  startedAt: string | null;
  concludedAt: string;
  board: Card[];
  totalPot: number;
  winningReason: "fold" | "showdown";
  actions: HandActionRecord[];
  winners: LastHandWinner[];
  revealedHoleCards: Record<string, [Card | null, Card | null]>;
  allInRunout: LastHandResult["allInRunout"];
  participants: ArchivedHandParticipant[];
}

export type RevealMode = "none" | "first" | "second" | "both";

export interface RoomChatMessage {
  id: string;
  accountId: string;
  displayName: string;
  content: string;
  createdAt: string;
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

export interface RoomTurnState {
  turnSeconds: number | null;
  timeBankSeconds: number | null;
  currentTurnStartedAt: string | null;
  timeBankMsByAccount: Record<string, number>;
}

export interface RoomBlindState {
  schedule: Array<{
    level: number;
    smallBlind: number;
    bigBlind: number;
    ante?: number;
    durationMinutes: number;
  }>;
  sessionStartedAt: string | null;
  currentLevel: {
    level: number;
    smallBlind: number;
    bigBlind: number;
    ante?: number;
    durationMinutes: number;
  } | null;
  nextLevel: {
    level: number;
    smallBlind: number;
    bigBlind: number;
    ante?: number;
    durationMinutes: number;
  } | null;
  nextLevelInMs: number | null;
  snapshotAt: string;
  pausedAt: string | null;
}

export type RoomBuyInMaxRuleKind = "fixed_amount" | "chip_lead_percentage";

export interface RoomBuyInMaxRule {
  kind: RoomBuyInMaxRuleKind;
  value: number;
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

export interface RoomSnapshot {
  roomId: string;
  slug: string;
  name: string;
  adminAccountId: string;
  clubId?: string;
  visibility: "private" | "club";
  status: string;
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
  players: RoomPlayer[];
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
    blindLevel: {
      level: number;
      smallBlind: number;
      bigBlind: number;
      ante?: number;
      durationMinutes: number;
    };
    dealerSeat: number;
    smallBlindSeat: number;
    bigBlindSeat: number;
    actorSeat: number;
    actorAccountId: string | null;
    street: "preflop" | "flop" | "turn" | "river" | "showdown";
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
    heroActionState: HeroActionState | null;
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

export interface SessionState {
  account: {
    id: string;
    email: string;
    username: string;
    createdAt: string;
  };
  token: string;
}