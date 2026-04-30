import { BlindLevel, getBlindLevelAtElapsedMinutes, normalizeBlindSchedule } from "./blinds.js";
import { Card, buildDeck, dealHoleCards, shuffleDeck } from "./cards.js";
import { compareEvaluatedHands, evaluateHoldemHand } from "./hand-evaluator.js";

export type RoomVisibility = "private" | "club";
export type TableStatus = "waiting" | "active" | "paused";
export type Street = "preflop" | "flop" | "turn" | "river" | "showdown";
export type HandActionType = "post_ante" | "post_small_blind" | "post_big_blind" | "fold" | "check" | "call" | "bet" | "raise" | "all_in";
export type PlayerActionType = "fold" | "check" | "call" | "bet" | "raise" | "all_in";

export interface CreateTableInput {
  slug: string;
  name: string;
  adminAccountId: string;
  clubId?: string;
  visibility: RoomVisibility;
  maxPlayers: number;
  startingStack: number;
  blindSchedule: BlindLevel[];
  autoStartNextHand: boolean;
  autoStartDelaySeconds: number;
  revealAllShowdownHands?: boolean;
  runItTwiceEnabled?: boolean;
  passwordProtected: boolean;
}

export interface TablePlayer {
  accountId: string;
  displayName: string;
  seatIndex: number;
  stack: number;
  isReady: boolean;
  isConnected: boolean;
  isSittingOut: boolean;
  joinedAt: string;
}

export interface HandState {
  id: string;
  handNumber: number;
  blindLevel: BlindLevel;
  dealerSeat: number;
  smallBlindSeat: number;
  bigBlindSeat: number;
  actorSeat: number;
  street: Street;
  board: Card[];
  holeCards: Record<string, [Card, Card]>;
  remainingDeck: Card[];
  pot: number;
  currentBet: number;
  contributions: Record<string, number>;
  streetContributions: Record<string, number>;
  foldedAccountIds: string[];
  playersToAct: string[];
  lastRaiseSize: number;
  actions: HandActionRecord[];
  startedAt: string;
  runItTwicePrompt: RunItTwicePromptState | null;
}

export interface HandActionRecord {
  orderIndex: number;
  actorAccountId: string;
  actorSeat: number;
  type: HandActionType;
  street: Street;
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

export interface RunItTwicePromptState {
  eligibleAccountIds: string[];
  responsesByAccountId: Record<string, RunItTwiceResponse>;
  createdAt: string;
}

export type RevealedHoleCards = [Card | null, Card | null];

export interface AllInRunoutState {
  startBoardCount: number;
  revealIntervalMs: number;
  revealedAccountIds: string[];
  runouts?: AllInRunoutResult[];
}

export interface LastHandResult {
  handId: string;
  handNumber: number;
  board: Card[];
  totalPot: number;
  winningReason: "fold" | "showdown";
  concludedAt: string;
  actions: HandActionRecord[];
  winners: LastHandWinner[];
  revealedHoleCards: Record<string, RevealedHoleCards>;
  allInRunout: AllInRunoutState | null;
}

export interface TableState {
  roomId: string;
  slug: string;
  name: string;
  adminAccountId: string;
  clubId?: string;
  visibility: RoomVisibility;
  createdAt: string;
  updatedAt: string;
  status: TableStatus;
  buttonSeat: number | null;
  sessionStartedAt: string | null;
  nextHandStartsAt: string | null;
  passwordProtected: boolean;
  maxPlayers: number;
  startingStack: number;
  blindSchedule: BlindLevel[];
  autoStartNextHand: boolean;
  autoStartDelaySeconds: number;
  revealAllShowdownHands: boolean;
  runItTwiceEnabled: boolean;
  handCount: number;
  players: TablePlayer[];
  currentHand: HandState | null;
  lastCompletedHand: LastHandResult | null;
}

export interface StartHandOptions {
  now?: Date;
  random?: () => number;
  deck?: Card[];
}

export interface FinishHandOptions {
  now?: Date;
}

export interface PlayerActionInput {
  accountId: string;
  type: PlayerActionType;
  amount?: number;
}

export interface RunItTwiceDecisionInput {
  accountId: string;
  willing: boolean;
}

export interface PlayerActionState {
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
  allowedActions: PlayerActionType[];
}

export interface PlayerConnectionInput {
  accountId: string;
  isConnected: boolean;
}

const ALL_IN_RUNOUT_REVEAL_INTERVAL_MS = 2_000;

export function createTable(input: CreateTableInput, now: Date = new Date()): TableState {
  if (input.maxPlayers < 2 || input.maxPlayers > 10) {
    throw new Error("Table size must be between 2 and 10 players.");
  }

  if (input.startingStack <= 0) {
    throw new Error("Starting stack must be greater than zero.");
  }

  if (input.autoStartDelaySeconds < 0) {
    throw new Error("Auto-start delay cannot be negative.");
  }

  return {
    roomId: createId("room"),
    slug: input.slug,
    name: input.name,
    adminAccountId: input.adminAccountId,
    clubId: input.clubId,
    visibility: input.visibility,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    status: "waiting",
    buttonSeat: null,
    sessionStartedAt: null,
    nextHandStartsAt: null,
    passwordProtected: input.passwordProtected,
    maxPlayers: input.maxPlayers,
    startingStack: input.startingStack,
    blindSchedule: normalizeBlindSchedule(input.blindSchedule),
    autoStartNextHand: input.autoStartNextHand,
    autoStartDelaySeconds: input.autoStartDelaySeconds,
    revealAllShowdownHands: input.revealAllShowdownHands ?? false,
    runItTwiceEnabled: input.runItTwiceEnabled ?? false,
    handCount: 0,
    players: [],
    currentHand: null,
    lastCompletedHand: null,
  };
}

export function seatPlayer(
  table: TableState,
  player: Pick<TablePlayer, "accountId" | "displayName"> & { seatIndex: number; stack?: number },
  now: Date = new Date()
): TableState {
  validateSeatIndex(table, player.seatIndex);

  if (table.players.some((entry) => entry.accountId === player.accountId)) {
    throw new Error("Player is already seated at this table.");
  }

  if (table.players.some((entry) => entry.seatIndex === player.seatIndex)) {
    throw new Error("Seat is already occupied.");
  }

  const initialStack = player.stack ?? table.startingStack;

  if (!Number.isInteger(initialStack) || initialStack <= 0) {
    throw new Error("Initial stack must be a positive integer.");
  }

  return {
    ...table,
    updatedAt: now.toISOString(),
    players: [...table.players, {
      accountId: player.accountId,
      displayName: player.displayName,
      seatIndex: player.seatIndex,
      stack: initialStack,
      isReady: false,
      isConnected: true,
      isSittingOut: false,
      joinedAt: now.toISOString(),
    }].sort((left, right) => left.seatIndex - right.seatIndex),
  };
}

export function leaveSeat(table: TableState, accountId: string, now: Date = new Date()): TableState {
  const seatedPlayer = table.players.find((player) => player.accountId === accountId);

  if (!seatedPlayer) {
    throw new Error("Player is not seated at this table.");
  }

  if (table.currentHand?.holeCards[accountId]) {
    throw new Error("Cannot leave a seat while a hand is in progress. Sit out instead.");
  }

  const players = table.players.filter((player) => player.accountId !== accountId);

  return {
    ...table,
    updatedAt: now.toISOString(),
    players,
    nextHandStartsAt: getActivePlayers({ ...table, players }).length >= 2 ? table.nextHandStartsAt : null,
  };
}

export function setPlayerSittingOut(
  table: TableState,
  accountId: string,
  isSittingOut: boolean,
  now: Date = new Date()
): TableState {
  let found = false;

  const players = table.players.map((player) => {
    if (player.accountId !== accountId) {
      return player;
    }

    found = true;

    return {
      ...player,
      isSittingOut,
      isReady: isSittingOut ? false : player.isReady,
    };
  });

  if (!found) {
    throw new Error("Player is not seated at this table.");
  }

  return {
    ...table,
    updatedAt: now.toISOString(),
    players,
    nextHandStartsAt: getActivePlayers({ ...table, players }).length >= 2 ? table.nextHandStartsAt : null,
  };
}

export function setPlayerReady(
  table: TableState,
  accountId: string,
  isReady: boolean,
  now: Date = new Date()
): TableState {
  let found = false;

  const players = table.players.map((player) => {
    if (player.accountId !== accountId) {
      return player;
    }

    found = true;
    return {
      ...player,
      isReady,
    };
  });

  if (!found) {
    throw new Error("Player is not seated at this table.");
  }

  return {
    ...table,
    updatedAt: now.toISOString(),
    players,
  };
}

export function setPlayerConnection(
  table: TableState,
  input: PlayerConnectionInput,
  now: Date = new Date()
): TableState {
  let hasSeatedPlayer = false;
  let changed = false;

  const players = table.players.map((player) => {
    if (player.accountId !== input.accountId) {
      return player;
    }

    hasSeatedPlayer = true;

    if (player.isConnected === input.isConnected) {
      return player;
    }

    changed = true;
    return {
      ...player,
      isConnected: input.isConnected,
    };
  });

  if (!hasSeatedPlayer || !changed) {
    return table;
  }

  return {
    ...table,
    updatedAt: now.toISOString(),
    players,
  };
}

export function addPlayerChips(
  table: TableState,
  accountId: string,
  amount: number,
  now: Date = new Date()
): TableState {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error("Chip add amount must be a positive integer.");
  }

  if (table.currentHand?.holeCards[accountId]) {
    throw new Error("Cannot adjust a stack while that player is in the current hand.");
  }

  let found = false;

  const players = table.players.map((player) => {
    if (player.accountId !== accountId) {
      return player;
    }

    found = true;
    return {
      ...player,
      stack: player.stack + amount,
    };
  });

  if (!found) {
    throw new Error("Player is not seated at this table.");
  }

  return {
    ...table,
    updatedAt: now.toISOString(),
    players,
  };
}

export function pauseTable(table: TableState, now: Date = new Date()): TableState {
  return {
    ...table,
    status: "paused",
    updatedAt: now.toISOString(),
    nextHandStartsAt: null,
  };
}

export function resumeTable(table: TableState, now: Date = new Date()): TableState {
  return {
    ...table,
    status: table.currentHand ? "active" : "waiting",
    updatedAt: now.toISOString(),
  };
}

export function finishHand(table: TableState, options: FinishHandOptions = {}): TableState {
  const now = options.now ?? new Date();

  if (!table.currentHand) {
    return table;
  }

  const nextHandStartsAt = table.autoStartNextHand
    ? new Date(now.getTime() + table.autoStartDelaySeconds * 1000).toISOString()
    : null;

  return {
    ...table,
    status: "waiting",
    currentHand: null,
    nextHandStartsAt,
    updatedAt: now.toISOString(),
  };
}

export function startHand(table: TableState, options: StartHandOptions = {}): TableState {
  const now = options.now ?? new Date();
  const random = options.random ?? Math.random;

  if (table.status === "paused") {
    throw new Error("Table is paused.");
  }

  if (table.currentHand) {
    throw new Error("A hand is already in progress.");
  }

  const activePlayers = getActivePlayers(table);

  if (activePlayers.length < 2) {
    throw new Error("At least two ready, seated players are required.");
  }

  const sessionStartedAt = table.sessionStartedAt ?? now.toISOString();
  const elapsedMinutes = Math.floor((now.getTime() - new Date(sessionStartedAt).getTime()) / 60000);
  const blindLevel = getBlindLevelAtElapsedMinutes(table.blindSchedule, elapsedMinutes);

  const dealerSeat = getNextDealerSeat(table.buttonSeat, activePlayers);
  const { smallBlindSeat, bigBlindSeat, actorSeat } = getBlindSeats(activePlayers, dealerSeat);
  const deck = options.deck ? [...options.deck] : shuffleDeck(buildDeck(), random);
  const dealingOrder = rotatePlayersFromSeat(activePlayers, smallBlindSeat, 0).map((player) => player.accountId);
  const { holeCards, remainingDeck } = dealHoleCards(dealingOrder, deck);
  const contributions: Record<string, number> = {};
  const streetContributions: Record<string, number> = {};
  const updatedPlayers = table.players.map((player) => ({ ...player }));
  let pot = 0;

  const anteActions = blindLevel.ante && blindLevel.ante > 0
    ? activePlayers.map((activePlayer, index) => {
        const posted = postAnte(updatedPlayers, activePlayer.accountId, blindLevel.ante!, contributions);
        pot += posted;

        return createHandAction(updatedPlayers, activePlayer.seatIndex, "post_ante", "preflop", posted, 0, index, now);
      })
    : [];

  const smallBlindPosted = postBlind(updatedPlayers, smallBlindSeat, blindLevel.smallBlind, contributions, streetContributions);
  const bigBlindPosted = postBlind(updatedPlayers, bigBlindSeat, blindLevel.bigBlind, contributions, streetContributions);
  pot += smallBlindPosted;
  pot += bigBlindPosted;

  const actions = [
    ...anteActions,
    createHandAction(updatedPlayers, smallBlindSeat, "post_small_blind", "preflop", smallBlindPosted, streetContributions[getAccountIdAtSeat(updatedPlayers, smallBlindSeat)] ?? smallBlindPosted, anteActions.length, now),
    createHandAction(updatedPlayers, bigBlindSeat, "post_big_blind", "preflop", bigBlindPosted, streetContributions[getAccountIdAtSeat(updatedPlayers, bigBlindSeat)] ?? bigBlindPosted, anteActions.length + 1, now),
  ];
  const playersToAct = buildPlayersToAct(activePlayers, actorSeat).filter((accountId) => {
    const player = updatedPlayers.find((entry) => entry.accountId === accountId);
    return Boolean(player && player.stack > 0);
  });

  return {
    ...table,
    updatedAt: now.toISOString(),
    status: "active",
    buttonSeat: dealerSeat,
    sessionStartedAt,
    nextHandStartsAt: null,
    handCount: table.handCount + 1,
    players: updatedPlayers,
    lastCompletedHand: null,
    currentHand: {
      id: createId("hand"),
      handNumber: table.handCount + 1,
      blindLevel,
      dealerSeat,
      smallBlindSeat,
      bigBlindSeat,
      actorSeat,
      street: "preflop",
      board: [],
      holeCards,
      remainingDeck,
      pot,
      currentBet: Math.max(...Object.values(contributions), 0),
      contributions,
      streetContributions,
      foldedAccountIds: [],
      playersToAct,
      lastRaiseSize: blindLevel.bigBlind,
      actions,
      startedAt: now.toISOString(),
      runItTwicePrompt: null,
    },
  };
}

export function applyPlayerAction(table: TableState, input: PlayerActionInput, now: Date = new Date()): TableState {
  if (!table.currentHand) {
    throw new Error("A hand is not currently in progress.");
  }

  if (table.currentHand.runItTwicePrompt) {
    throw new Error("Run it twice voting is in progress.");
  }

  const nextTable = cloneTable(table);
  const hand = nextTable.currentHand!;
  const player = nextTable.players.find((entry) => entry.accountId === input.accountId);

  if (!player || !hand.holeCards[input.accountId]) {
    throw new Error("Player is not active in the current hand.");
  }

  const actionState = getPlayerActionState(nextTable, input.accountId);

  if (!actionState || !actionState.canAct) {
    throw new Error("It is not this player's turn.");
  }

  const previousCurrentBet = hand.currentBet;
  const currentStreetContribution = hand.streetContributions[input.accountId] ?? 0;
  const currentContribution = hand.contributions[input.accountId] ?? 0;
  let amountCommitted = 0;
  let betTo = currentStreetContribution;
  let opensBetting = false;

  switch (input.type) {
    case "fold": {
      hand.foldedAccountIds.push(input.accountId);
      break;
    }
    case "check": {
      if (actionState.callAmount !== 0) {
        throw new Error("Player cannot check while facing a bet.");
      }
      break;
    }
    case "call": {
      if (actionState.callAmount <= 0) {
        throw new Error("Player is not facing a bet to call.");
      }

      if (player.stack <= actionState.callAmount) {
        throw new Error("Player must use all-in when they cannot cover the full call.");
      }

      amountCommitted = commitChips(player, hand, input.accountId, actionState.callAmount);
      betTo = currentStreetContribution + amountCommitted;
      break;
    }
    case "bet":
    case "raise": {
      const targetContribution = requireTargetContribution(input.amount);

      if (input.type === "bet" && previousCurrentBet !== 0) {
        throw new Error("A bet is only valid when no wager is open.");
      }

      if (input.type === "raise" && previousCurrentBet === 0) {
        throw new Error("A raise is only valid after betting has opened.");
      }

      const minRaiseTo = actionState.minRaiseTo;

      if (minRaiseTo === null || targetContribution < minRaiseTo) {
        throw new Error("Raise amount is below the minimum legal target.");
      }

      if (targetContribution > actionState.maxRaiseTo) {
        throw new Error("Raise amount is larger than the player's available stack.");
      }

      amountCommitted = commitChips(player, hand, input.accountId, targetContribution - currentStreetContribution);
      betTo = currentStreetContribution + amountCommitted;
      hand.lastRaiseSize = betTo - previousCurrentBet;
      hand.currentBet = betTo;
      opensBetting = true;
      break;
    }
    case "all_in": {
      if (player.stack <= 0) {
        throw new Error("Player has no chips remaining.");
      }

      amountCommitted = commitChips(player, hand, input.accountId, player.stack);
      betTo = currentStreetContribution + amountCommitted;

      if (betTo > previousCurrentBet) {
        hand.lastRaiseSize = Math.max(1, betTo - previousCurrentBet);
        hand.currentBet = betTo;
        opensBetting = true;
      }
      break;
    }
    default:
      throw new Error("Unsupported player action.");
  }

  if (input.type === "call" || input.type === "all_in") {
    hand.currentBet = Math.max(hand.currentBet, hand.streetContributions[input.accountId] ?? 0);
  }

  if (input.type === "fold" || input.type === "check" || input.type === "call" || input.type === "all_in") {
    hand.playersToAct = hand.playersToAct.filter((accountId) => accountId !== input.accountId);
  }

  if (opensBetting) {
    hand.playersToAct = buildPendingResponses(nextTable.players, hand, player.seatIndex, input.accountId);
  }

  hand.playersToAct = hand.playersToAct.filter((accountId) => isActionableAccount(nextTable, hand, accountId));
  hand.actorSeat = hand.playersToAct.length > 0
    ? nextTable.players.find((entry) => entry.accountId === hand.playersToAct[0])!.seatIndex
    : player.seatIndex;
  hand.actions.push(createHandAction(nextTable.players, player.seatIndex, input.type, hand.street, amountCommitted, betTo, hand.actions.length, now));
  nextTable.updatedAt = now.toISOString();

  return settleHandIfReady(nextTable, now);
}

export function applyRunItTwiceDecision(table: TableState, input: RunItTwiceDecisionInput, now: Date = new Date()): TableState {
  const nextTable = cloneTable(table);
  const hand = nextTable.currentHand;

  if (!hand?.runItTwicePrompt) {
    throw new Error("Run it twice is not awaiting player decisions.");
  }

  if (!hand.runItTwicePrompt.eligibleAccountIds.includes(input.accountId)) {
    throw new Error("Only players involved in the showdown can vote on run it twice.");
  }

  hand.runItTwicePrompt = {
    ...hand.runItTwicePrompt,
    responsesByAccountId: {
      ...hand.runItTwicePrompt.responsesByAccountId,
      [input.accountId]: input.willing ? "yes" : "no",
    },
  };
  nextTable.updatedAt = now.toISOString();

  return nextTable;
}

export function expirePendingRunItTwiceDecision(table: TableState, now: Date = new Date()): TableState {
  const nextTable = cloneTable(table);
  const hand = nextTable.currentHand;

  if (!hand?.runItTwicePrompt) {
    throw new Error("Run it twice is not awaiting player decisions.");
  }

  const responsesByAccountId = { ...hand.runItTwicePrompt.responsesByAccountId };
  let didDefaultAnyResponse = false;

  for (const accountId of hand.runItTwicePrompt.eligibleAccountIds) {
    if (responsesByAccountId[accountId]) {
      continue;
    }

    responsesByAccountId[accountId] = "no";
    didDefaultAnyResponse = true;
  }

  if (!didDefaultAnyResponse) {
    return nextTable;
  }

  hand.runItTwicePrompt = {
    ...hand.runItTwicePrompt,
    responsesByAccountId,
  };
  nextTable.updatedAt = now.toISOString();

  return nextTable;
}

export function resolvePendingRunItTwiceDecision(table: TableState, now: Date = new Date()): TableState {
  if (!isRunItTwiceVotingComplete(table.currentHand?.runItTwicePrompt ?? null)) {
    throw new Error("Run it twice voting is not complete.");
  }

  return resolveHand(cloneTable(table), now, "showdown");
}

export function getPlayerActionState(table: TableState, accountId: string): PlayerActionState | null {
  if (!table.currentHand) {
    return null;
  }

  const hand = table.currentHand;
  const player = table.players.find((entry) => entry.accountId === accountId);

  if (!player || !hand.holeCards[accountId]) {
    return null;
  }

  const hasFolded = hand.foldedAccountIds.includes(accountId);
  const isAllIn = !hasFolded && player.stack === 0;
  const streetContribution = hand.streetContributions[accountId] ?? 0;
  const contribution = hand.contributions[accountId] ?? 0;
  const callAmount = Math.max(0, hand.currentBet - streetContribution);
  const maxRaiseTo = streetContribution + player.stack;
  const minimumTarget = hand.currentBet === 0 ? hand.lastRaiseSize : hand.currentBet + hand.lastRaiseSize;
  const minRaiseTo = maxRaiseTo > hand.currentBet && maxRaiseTo >= minimumTarget ? minimumTarget : null;
  const canAct = hand.playersToAct[0] === accountId && !hasFolded && player.stack > 0;
  const allowedActions: PlayerActionType[] = [];

  if (canAct) {
    allowedActions.push("fold");

    if (callAmount === 0) {
      allowedActions.push("check");
      if (minRaiseTo !== null) {
        allowedActions.push(hand.currentBet === 0 ? "bet" : "raise");
      }
    } else if (player.stack > callAmount) {
      allowedActions.push("call");
      if (minRaiseTo !== null) {
        allowedActions.push("raise");
      }
    }

    allowedActions.push("all_in");
  }

  return {
    accountId,
    seatIndex: player.seatIndex,
    canAct,
    hasFolded,
    isAllIn,
    contribution,
    streetContribution,
    callAmount,
    minRaiseTo,
    maxRaiseTo,
    allowedActions: Array.from(new Set(allowedActions)),
  };
}

export function getActivePlayers(table: TableState): TablePlayer[] {
  return table.players
    .filter((player) => player.isConnected && !player.isSittingOut && player.isReady && player.stack > 0)
    .sort((left, right) => left.seatIndex - right.seatIndex);
}

function getNextDealerSeat(previousButtonSeat: number | null, players: TablePlayer[]): number {
  if (previousButtonSeat === null) {
    return players[0]!.seatIndex;
  }

  return players.find((player) => player.seatIndex > previousButtonSeat)?.seatIndex ?? players[0]!.seatIndex;
}

function getBlindSeats(players: TablePlayer[], dealerSeat: number): { smallBlindSeat: number; bigBlindSeat: number; actorSeat: number } {
  if (players.length === 2) {
    const bigBlindSeat = players.find((player) => player.seatIndex !== dealerSeat)!.seatIndex;
    return {
      smallBlindSeat: dealerSeat,
      bigBlindSeat,
      actorSeat: dealerSeat,
    };
  }

  const [smallBlind, bigBlind, actor] = rotatePlayersFromSeat(players, dealerSeat, 1);

  return {
    smallBlindSeat: smallBlind!.seatIndex,
    bigBlindSeat: bigBlind!.seatIndex,
    actorSeat: actor!.seatIndex,
  };
}

function rotatePlayersFromSeat(players: TablePlayer[], seatIndex: number, offset: number): TablePlayer[] {
  const anchor = players.findIndex((player) => player.seatIndex === seatIndex);

  if (anchor === -1) {
    throw new Error("Seat rotation anchor is not occupied.");
  }

  const rotated = players.slice(anchor + offset).concat(players.slice(0, anchor + offset));
  return rotated;
}

function postBlind(
  players: TablePlayer[],
  seatIndex: number,
  blindAmount: number,
  contributions: Record<string, number>,
  streetContributions: Record<string, number>
): number {
  const player = players.find((entry) => entry.seatIndex === seatIndex);

  if (!player) {
    throw new Error("Blind seat is not occupied.");
  }

  const posted = Math.min(player.stack, blindAmount);
  player.stack -= posted;
  contributions[player.accountId] = posted;
  streetContributions[player.accountId] = posted;
  return posted;
}

function postAnte(
  players: TablePlayer[],
  accountId: string,
  anteAmount: number,
  contributions: Record<string, number>
): number {
  const player = players.find((entry) => entry.accountId === accountId);

  if (!player) {
    throw new Error("Ante player is not seated.");
  }

  const posted = Math.min(player.stack, anteAmount);
  player.stack -= posted;
  contributions[player.accountId] = (contributions[player.accountId] ?? 0) + posted;
  return posted;
}

function commitChips(player: TablePlayer, hand: HandState, accountId: string, amount: number): number {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error("Chip commitment must be a positive integer.");
  }

  if (amount > player.stack) {
    throw new Error("Player cannot commit more chips than they have available.");
  }

  player.stack -= amount;
  hand.pot += amount;
  hand.contributions[accountId] = (hand.contributions[accountId] ?? 0) + amount;
  hand.streetContributions[accountId] = (hand.streetContributions[accountId] ?? 0) + amount;
  return amount;
}

function buildPlayersToAct(players: TablePlayer[], actorSeat: number): string[] {
  return rotatePlayersFromSeat(players, actorSeat, 0).map((player) => player.accountId);
}

function buildPendingResponses(players: TablePlayer[], hand: HandState, actorSeat: number, actorAccountId: string): string[] {
  return rotatePlayersFromSeat(getPlayersStillInHand(players, hand), actorSeat, 1)
    .filter((player) => player.accountId !== actorAccountId && player.stack > 0)
    .map((player) => player.accountId);
}

function getPlayersStillInHand(players: TablePlayer[], hand: HandState): TablePlayer[] {
  const folded = new Set(hand.foldedAccountIds);
  const activeAccounts = new Set(Object.keys(hand.holeCards));
  return players
    .filter((player) => activeAccounts.has(player.accountId) && !folded.has(player.accountId))
    .sort((left, right) => left.seatIndex - right.seatIndex);
}

function isActionableAccount(table: TableState, hand: HandState, accountId: string): boolean {
  const player = table.players.find((entry) => entry.accountId === accountId);
  return Boolean(player && hand.holeCards[accountId] && !hand.foldedAccountIds.includes(accountId) && player.stack > 0);
}

function settleHandIfReady(table: TableState, now: Date): TableState {
  if (!table.currentHand) {
    return table;
  }

  if (table.currentHand.runItTwicePrompt) {
    return table;
  }

  const remainingPlayers = getPlayersStillInHand(table.players, table.currentHand);

  if (remainingPlayers.length === 1) {
    return resolveHand(table, now, "fold");
  }

  if (table.currentHand.playersToAct.length > 0) {
    return table;
  }

  const actionablePlayers = remainingPlayers.filter((player) => player.stack > 0);

  if (table.currentHand.street === "river" || actionablePlayers.length <= 1) {
    if (shouldOfferRunItTwicePrompt(table, table.currentHand, remainingPlayers, actionablePlayers)) {
      return startRunItTwicePrompt(table, remainingPlayers, now);
    }

    return resolveHand(table, now, "showdown");
  }

  return advanceStreet(table, now);
}

function advanceStreet(table: TableState, now: Date): TableState {
  const hand = table.currentHand;

  if (!hand) {
    return table;
  }

  const nextStreet = getNextStreet(hand.street);

  if (!nextStreet) {
    return resolveHand(table, now, "showdown");
  }

  const { board, remainingDeck } = dealBoardForStreet(hand.board, hand.remainingDeck, nextStreet);
  const contestingPlayers = getPlayersStillInHand(table.players, hand);
  const firstActorSeat = getFirstPostflopActorSeat(contestingPlayers, hand.dealerSeat);
  const playersToAct = firstActorSeat === null
    ? []
    : rotatePlayersFromSeat(contestingPlayers, firstActorSeat, 0)
        .filter((player) => player.stack > 0)
        .map((player) => player.accountId);

  return settleHandIfReady({
    ...table,
    updatedAt: now.toISOString(),
    currentHand: {
      ...hand,
      street: nextStreet,
      board,
      remainingDeck,
      streetContributions: Object.fromEntries(Object.keys(hand.holeCards).map((accountId) => [accountId, 0])),
      currentBet: 0,
      lastRaiseSize: hand.blindLevel.bigBlind,
      playersToAct,
      actorSeat: playersToAct.length > 0
        ? table.players.find((player) => player.accountId === playersToAct[0])!.seatIndex
        : hand.dealerSeat,
      runItTwicePrompt: null,
    },
  }, now);
}

function resolveHand(table: TableState, now: Date, winningReason: "fold" | "showdown"): TableState {
  const hand = table.currentHand;

  if (!hand) {
    return table;
  }

  const folded = new Set(hand.foldedAccountIds);
  const eligiblePlayers = table.players.filter((player) => hand.holeCards[player.accountId] && !folded.has(player.accountId));
  const showdownResolution = winningReason === "showdown"
    ? resolveShowdown(table, hand, eligiblePlayers)
    : null;
  const resolvedBoard = showdownResolution?.primaryBoard ?? hand.board;
  const allInRunout = showdownResolution?.allInRunout ?? null;
  const payouts = showdownResolution?.payouts ?? distributePots(table.players, hand, eligiblePlayers, winningReason);
  const updatedPlayers = table.players.map((player) => {
    const payout = payouts.get(player.accountId) ?? 0;
    return payout === 0
      ? player
      : {
          ...player,
          stack: player.stack + payout,
        };
  });
  const winnerEntries = Array.from(payouts.entries())
    .filter(([, amountWon]) => amountWon > 0)
    .map(([accountId, amountWon]) => {
      const player = updatedPlayers.find((entry) => entry.accountId === accountId)!;

      return {
        accountId,
        seatIndex: player.seatIndex,
        amountWon,
        netChips: amountWon - (hand.contributions[accountId] ?? 0),
        finalStack: player.stack,
        handLabel: showdownResolution?.winnerHandLabels.get(accountId),
      } satisfies LastHandWinner;
    })
    .sort((left, right) => left.seatIndex - right.seatIndex);

  return {
    ...table,
    updatedAt: now.toISOString(),
    status: "waiting",
    players: updatedPlayers,
    currentHand: null,
    nextHandStartsAt: table.autoStartNextHand
      ? new Date(now.getTime() + table.autoStartDelaySeconds * 1000 + getAllInRunoutDelayMs(allInRunout, resolvedBoard.length)).toISOString()
      : null,
    lastCompletedHand: {
      handId: hand.id,
      handNumber: hand.handNumber,
      board: resolvedBoard,
      totalPot: hand.pot,
      winningReason,
      concludedAt: now.toISOString(),
      actions: hand.actions.map((action) => ({ ...action })),
      winners: winnerEntries,
      revealedHoleCards: winningReason === "showdown"
        ? buildShowdownRevealedHoleCards(table, hand, eligiblePlayers, winnerEntries, allInRunout)
        : {},
      allInRunout,
    },
  };
}

function resolveShowdown(
  table: TableState,
  hand: HandState,
  eligiblePlayers: TablePlayer[],
): {
  primaryBoard: Card[];
  payouts: Map<string, number>;
  winnerHandLabels: Map<string, string>;
  allInRunout: AllInRunoutState | null;
} {
  const runoutCount = shouldRunItTwice(table, hand, eligiblePlayers) ? 2 : 1;
  const runoutBoards = buildRunoutBoards(hand, runoutCount);
  const pots = buildPots(table.players, hand);
  const payouts = new Map<string, number>();
  const winnerHandLabels = new Map<string, string>();
  const runoutResults: AllInRunoutResult[] = [];

  for (let runoutIndex = 0; runoutIndex < runoutBoards.length; runoutIndex += 1) {
    const { result, payouts: runoutPayouts } = resolveShowdownRunout(
      table.players,
      hand,
      eligiblePlayers,
      pots,
      runoutBoards[runoutIndex]!,
      runoutBoards.length,
      runoutIndex,
    );

    runoutResults.push(result);

    for (const [accountId, amountWon] of runoutPayouts.entries()) {
      payouts.set(accountId, (payouts.get(accountId) ?? 0) + amountWon);
    }

    if (runoutBoards.length === 1) {
      for (const winner of result.winners) {
        if (winner.handLabel) {
          winnerHandLabels.set(winner.accountId, winner.handLabel);
        }
      }
    }
  }

  return {
    primaryBoard: runoutBoards[0] ?? hand.board,
    payouts,
    winnerHandLabels,
    allInRunout: buildAllInRunoutState(hand, eligiblePlayers, "showdown", runoutResults),
  };
}

function shouldRunItTwice(table: TableState, hand: HandState, eligiblePlayers: TablePlayer[]): boolean {
  const prompt = hand.runItTwicePrompt;

  if (!prompt) {
    return false;
  }

  return table.runItTwiceEnabled
    && hand.board.length < 5
    && eligiblePlayers.length >= 2
    && prompt.eligibleAccountIds.every((accountId) => prompt.responsesByAccountId[accountId] === "yes");
}

function shouldOfferRunItTwicePrompt(
  table: TableState,
  hand: HandState,
  remainingPlayers: TablePlayer[],
  actionablePlayers: TablePlayer[],
): boolean {
  return table.runItTwiceEnabled
    && hand.street !== "river"
    && !hand.runItTwicePrompt
    && remainingPlayers.length >= 2
    && actionablePlayers.length <= 1;
}

function startRunItTwicePrompt(table: TableState, remainingPlayers: TablePlayer[], now: Date): TableState {
  if (!table.currentHand) {
    return table;
  }

  return {
    ...table,
    updatedAt: now.toISOString(),
    currentHand: {
      ...table.currentHand,
      runItTwicePrompt: {
        eligibleAccountIds: remainingPlayers
          .map((player) => player.accountId)
          .sort((left, right) => table.players.find((player) => player.accountId === left)!.seatIndex - table.players.find((player) => player.accountId === right)!.seatIndex),
        responsesByAccountId: {},
        createdAt: now.toISOString(),
      },
    },
  };
}

export function isRunItTwiceVotingComplete(prompt: RunItTwicePromptState | null): boolean {
  if (!prompt) {
    return false;
  }

  return Object.values(prompt.responsesByAccountId).includes("no")
    || prompt.eligibleAccountIds.every((accountId) => prompt.responsesByAccountId[accountId] === "yes");
}

function buildRunoutBoards(hand: HandState, runoutCount: number): Card[][] {
  if (hand.board.length === 5) {
    return [hand.board];
  }

  const boards: Card[][] = [];
  let remainingDeck = [...hand.remainingDeck];

  for (let index = 0; index < runoutCount; index += 1) {
    let board = [...hand.board];

    while (board.length < 5) {
      const nextStreet = board.length === 0 ? "flop" : board.length === 3 ? "turn" : "river";
      const dealt = dealBoardForStreet(board, remainingDeck, nextStreet);
      board = dealt.board;
      remainingDeck = dealt.remainingDeck;
    }

    boards.push(board);
  }

  return boards;
}

function buildAllInRunoutState(
  hand: HandState,
  eligiblePlayers: TablePlayer[],
  winningReason: "fold" | "showdown",
  runoutResults: AllInRunoutResult[]
): AllInRunoutState | null {
  if (winningReason !== "showdown" || runoutResults.length === 0 || hand.board.length >= runoutResults[0]!.board.length) {
    return null;
  }

  const revealedAccountIds = eligiblePlayers
    .filter((player) => player.stack === 0)
    .sort((left, right) => left.seatIndex - right.seatIndex)
    .map((player) => player.accountId);

  if (revealedAccountIds.length === 0) {
    return null;
  }

  return {
    startBoardCount: hand.board.length,
    revealIntervalMs: ALL_IN_RUNOUT_REVEAL_INTERVAL_MS,
    revealedAccountIds,
    runouts: runoutResults.length > 1 ? runoutResults : undefined,
  };
}

function getAllInRunoutDelayMs(allInRunout: AllInRunoutState | null, finalBoardCount: number): number {
  if (!allInRunout) {
    return 0;
  }

  if (allInRunout.runouts?.length) {
    return allInRunout.runouts.reduce(
      (totalDelayMs, runout) => totalDelayMs + Math.max(0, runout.board.length - allInRunout.startBoardCount) * allInRunout.revealIntervalMs,
      0,
    );
  }

  return Math.max(0, finalBoardCount - allInRunout.startBoardCount) * allInRunout.revealIntervalMs;
}

function buildShowdownRevealedHoleCards(
  table: TableState,
  hand: HandState,
  eligiblePlayers: TablePlayer[],
  winnerEntries: LastHandWinner[],
  allInRunout: AllInRunoutState | null
): Record<string, RevealedHoleCards> {
  const autoRevealAccountIds = new Set<string>();

  if (table.revealAllShowdownHands) {
    eligiblePlayers.forEach((player) => autoRevealAccountIds.add(player.accountId));
  } else {
    winnerEntries.forEach((winner) => autoRevealAccountIds.add(winner.accountId));
  }

  allInRunout?.revealedAccountIds.forEach((accountId) => autoRevealAccountIds.add(accountId));

  return Object.fromEntries(
    Array.from(autoRevealAccountIds)
      .map((accountId) => {
        const holeCards = hand.holeCards[accountId];

        if (!holeCards) {
          return null;
        }

        return [accountId, [...holeCards] as RevealedHoleCards] as const;
      })
      .filter((entry): entry is readonly [string, RevealedHoleCards] => entry !== null)
  );
}

function finalizeBoard(hand: HandState): HandState {
  if (hand.board.length === 5) {
    return hand;
  }

  const [board] = buildRunoutBoards(hand, 1);

  return {
    ...hand,
    board: board ?? hand.board,
    street: "showdown",
  };
}

function resolveShowdownRunout(
  players: TablePlayer[],
  hand: HandState,
  eligiblePlayers: TablePlayer[],
  pots: Array<{ amount: number; eligibleAccountIds: string[] }>,
  board: Card[],
  runoutCount: number,
  runoutIndex: number,
): { result: AllInRunoutResult; payouts: Map<string, number> } {
  const payouts = new Map<string, number>();
  const playerByAccountId = new Map(players.map((player) => [player.accountId, player]));
  const evaluatedHands = new Map(eligiblePlayers.map((player) => [player.accountId, evaluateHoldemHand([...hand.holeCards[player.accountId]!, ...board])]));

  for (const pot of pots) {
    const runoutAmount = getRunoutPotAmount(pot.amount, runoutCount, runoutIndex);

    if (runoutAmount <= 0) {
      continue;
    }

    const contenders = pot.eligibleAccountIds
      .map((accountId) => playerByAccountId.get(accountId)!)
      .filter((player) => eligiblePlayers.some((entry) => entry.accountId === player.accountId));

    if (contenders.length === 0) {
      continue;
    }

    const winners = getShowdownWinners(contenders, evaluatedHands);
    const orderedWinners = orderWinnersForOddChips(players, winners, hand.dealerSeat);
    const splitAmount = Math.floor(runoutAmount / orderedWinners.length);
    let remainder = runoutAmount % orderedWinners.length;

    for (const winner of orderedWinners) {
      const award = splitAmount + (remainder > 0 ? 1 : 0);
      payouts.set(winner.accountId, (payouts.get(winner.accountId) ?? 0) + award);
      remainder = Math.max(0, remainder - 1);
    }
  }

  return {
    result: {
      board: [...board],
      winners: Array.from(payouts.entries())
        .filter(([, amountWon]) => amountWon > 0)
        .map(([accountId, amountWon]) => {
          const player = playerByAccountId.get(accountId)!;

          return {
            accountId,
            seatIndex: player.seatIndex,
            amountWon,
            handLabel: evaluatedHands.get(accountId)?.label,
          } satisfies AllInRunoutWinner;
        })
        .sort((left, right) => left.seatIndex - right.seatIndex),
    },
    payouts,
  };
}

function getRunoutPotAmount(totalPotAmount: number, runoutCount: number, runoutIndex: number): number {
  const baseAmount = Math.floor(totalPotAmount / runoutCount);
  const remainder = totalPotAmount % runoutCount;
  return baseAmount + (runoutIndex < remainder ? 1 : 0);
}

function distributePots(
  players: TablePlayer[],
  hand: HandState,
  eligiblePlayers: TablePlayer[],
  winningReason: "fold" | "showdown"
): Map<string, number> {
  const payouts = new Map<string, number>();
  const pots = buildPots(players, hand);
  const playerByAccountId = new Map(players.map((player) => [player.accountId, player]));
  const evaluatedHands = winningReason === "showdown"
    ? new Map(eligiblePlayers.map((player) => [player.accountId, evaluateHoldemHand([...hand.holeCards[player.accountId]!, ...hand.board])]))
    : new Map<string, ReturnType<typeof evaluateHoldemHand>>();

  for (const pot of pots) {
    const contenders = pot.eligibleAccountIds
      .map((accountId) => playerByAccountId.get(accountId)!)
      .filter((player) => eligiblePlayers.some((entry) => entry.accountId === player.accountId));

    if (contenders.length === 0) {
      continue;
    }

    const winners = winningReason === "fold"
      ? [contenders[0]!]
      : getShowdownWinners(contenders, evaluatedHands);
    const orderedWinners = orderWinnersForOddChips(players, winners, hand.dealerSeat);
    const splitAmount = Math.floor(pot.amount / orderedWinners.length);
    let remainder = pot.amount % orderedWinners.length;

    for (const winner of orderedWinners) {
      const award = splitAmount + (remainder > 0 ? 1 : 0);
      payouts.set(winner.accountId, (payouts.get(winner.accountId) ?? 0) + award);
      remainder = Math.max(0, remainder - 1);
    }
  }

  return payouts;
}

function buildPots(players: TablePlayer[], hand: HandState): Array<{ amount: number; eligibleAccountIds: string[] }> {
  const activeAccounts = new Set(players.filter((player) => hand.holeCards[player.accountId]).map((player) => player.accountId));
  const uniqueLevels = Array.from(new Set(
    Object.entries(hand.contributions)
      .filter(([accountId, amount]) => activeAccounts.has(accountId) && amount > 0)
      .map(([, amount]) => amount)
  )).sort((left, right) => left - right);
  const folded = new Set(hand.foldedAccountIds);
  const pots: Array<{ amount: number; eligibleAccountIds: string[] }> = [];
  let previousLevel = 0;

  for (const level of uniqueLevels) {
    const involvedAccountIds = players
      .filter((player) => (hand.contributions[player.accountId] ?? 0) >= level)
      .map((player) => player.accountId);
    const amount = (level - previousLevel) * involvedAccountIds.length;
    const eligibleAccountIds = involvedAccountIds.filter((accountId) => !folded.has(accountId));

    if (amount > 0 && eligibleAccountIds.length > 0) {
      pots.push({ amount, eligibleAccountIds });
    }

    previousLevel = level;
  }

  return pots;
}

function getShowdownWinners(
  contenders: TablePlayer[],
  evaluatedHands: Map<string, ReturnType<typeof evaluateHoldemHand>>
): TablePlayer[] {
  let bestPlayer = contenders[0]!;
  let bestHand = evaluatedHands.get(bestPlayer.accountId)!;
  const winners = [bestPlayer];

  for (let index = 1; index < contenders.length; index += 1) {
    const contender = contenders[index]!;
    const contenderHand = evaluatedHands.get(contender.accountId)!;
    const comparison = compareEvaluatedHands(contenderHand, bestHand);

    if (comparison > 0) {
      bestPlayer = contender;
      bestHand = contenderHand;
      winners.splice(0, winners.length, contender);
      continue;
    }

    if (comparison === 0) {
      winners.push(contender);
    }
  }

  return winners;
}

function orderWinnersForOddChips(players: TablePlayer[], winners: TablePlayer[], dealerSeat: number): TablePlayer[] {
  const orderedPlayers = players
    .filter((player) => winners.some((winner) => winner.accountId === player.accountId))
    .sort((left, right) => left.seatIndex - right.seatIndex);
  const firstSeat = orderedPlayers.find((player) => player.seatIndex > dealerSeat)?.seatIndex ?? orderedPlayers[0]!.seatIndex;

  return rotatePlayersFromSeat(orderedPlayers, firstSeat, 0);
}

function createHandAction(
  players: TablePlayer[],
  seatIndex: number,
  type: HandActionType,
  street: Street,
  amount: number,
  betTo: number,
  orderIndex: number,
  now: Date
): HandActionRecord {
  const player = players.find((entry) => entry.seatIndex === seatIndex);

  if (!player) {
    throw new Error("Action seat is not occupied.");
  }

  return {
    orderIndex,
    actorAccountId: player.accountId,
    actorSeat: player.seatIndex,
    type,
    street,
    amount,
    betTo,
    createdAt: now.toISOString(),
  };
}

function dealBoardForStreet(board: Card[], remainingDeck: Card[], street: Exclude<Street, "preflop" | "showdown">): { board: Card[]; remainingDeck: Card[] } {
  const nextDeck = [...remainingDeck];
  const nextBoard = [...board];

  burnCard(nextDeck);

  if (street === "flop") {
    nextBoard.push(drawCard(nextDeck), drawCard(nextDeck), drawCard(nextDeck));
  } else {
    nextBoard.push(drawCard(nextDeck));
  }

  return {
    board: nextBoard,
    remainingDeck: nextDeck,
  };
}

function burnCard(deck: Card[]): void {
  const burned = deck.shift();

  if (!burned) {
    throw new Error("Deck exhausted while burning a card.");
  }
}

function drawCard(deck: Card[]): Card {
  const card = deck.shift();

  if (!card) {
    throw new Error("Deck exhausted while dealing community cards.");
  }

  return card;
}

function getNextStreet(street: Street): Exclude<Street, "preflop" | "showdown"> | null {
  switch (street) {
    case "preflop":
      return "flop";
    case "flop":
      return "turn";
    case "turn":
      return "river";
    default:
      return null;
  }
}

function getFirstPostflopActorSeat(players: TablePlayer[], dealerSeat: number): number | null {
  if (players.length === 0) {
    return null;
  }

  return players.find((player) => player.seatIndex > dealerSeat)?.seatIndex ?? players[0]!.seatIndex;
}

function requireTargetContribution(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error("A positive integer target contribution is required.");
  }

  return value;
}

function getAccountIdAtSeat(players: TablePlayer[], seatIndex: number): string {
  const player = players.find((entry) => entry.seatIndex === seatIndex);

  if (!player) {
    throw new Error("Seat is not occupied.");
  }

  return player.accountId;
}

function cloneTable(table: TableState): TableState {
  return {
    ...table,
    players: table.players.map((player) => ({ ...player })),
    currentHand: table.currentHand
      ? {
          ...table.currentHand,
          board: [...table.currentHand.board],
          remainingDeck: [...table.currentHand.remainingDeck],
          holeCards: Object.fromEntries(
            Object.entries(table.currentHand.holeCards).map(([accountId, cards]) => [accountId, [...cards] as [Card, Card]])
          ),
          contributions: { ...table.currentHand.contributions },
          streetContributions: { ...table.currentHand.streetContributions },
          foldedAccountIds: [...table.currentHand.foldedAccountIds],
          playersToAct: [...table.currentHand.playersToAct],
          actions: table.currentHand.actions.map((action) => ({ ...action })),
          runItTwicePrompt: table.currentHand.runItTwicePrompt
            ? {
                ...table.currentHand.runItTwicePrompt,
                eligibleAccountIds: [...table.currentHand.runItTwicePrompt.eligibleAccountIds],
                responsesByAccountId: { ...table.currentHand.runItTwicePrompt.responsesByAccountId },
              }
            : null,
        }
      : null,
    lastCompletedHand: table.lastCompletedHand
      ? {
          ...table.lastCompletedHand,
          board: [...table.lastCompletedHand.board],
          actions: table.lastCompletedHand.actions.map((action) => ({ ...action })),
          winners: table.lastCompletedHand.winners.map((winner) => ({ ...winner })),
          revealedHoleCards: Object.fromEntries(
            Object.entries(table.lastCompletedHand.revealedHoleCards).map(([accountId, cards]) => [accountId, [...cards] as RevealedHoleCards])
          ),
          allInRunout: table.lastCompletedHand.allInRunout
            ? {
                ...table.lastCompletedHand.allInRunout,
                revealedAccountIds: [...table.lastCompletedHand.allInRunout.revealedAccountIds],
              }
            : null,
        }
      : null,
  };
}

function validateSeatIndex(table: TableState, seatIndex: number): void {
  if (!Number.isInteger(seatIndex) || seatIndex < 0 || seatIndex >= table.maxPlayers) {
    throw new Error("Seat index is out of range.");
  }
}

function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}
