import { compareEvaluatedHands, evaluateHoldemHand } from "./hand-evaluator";
import { formatNumber, parseOptionalWholeNumber, parseRequiredWholeNumber } from "./room-client-helpers";
import type { ArchivedHandRecord, Card, HandActionRecord, LastHandResult, RevealMode, RoomPlayer, RoomSnapshot } from "./room-types";

const BIG_RAISE_SUGGESTED_EMOJIS = ["😮", "🤨", "😤", "🔥"] as const;
const TANKING_SUGGESTED_EMOJIS = ["⏳", "👀", "😴", "🤨"] as const;
const BIG_WIN_SUGGESTED_EMOJIS = ["👏", "🔥", "💸", "😮"] as const;
const BIG_RAISE_MIN_CALL_BIG_BLIND_MULTIPLE = 6;
const BIG_RAISE_MIN_CALL_POT_RATIO = 0.42;
const TANKING_TRIGGER_MIN_ELAPSED_MS = 12_000;
const BIG_WIN_SUGGESTED_MAX_AGE_MS = 9_000;
const BIG_WIN_MIN_POT_BIG_BLIND_MULTIPLE_PER_PLAYER = 18;
const RUNOUT_EQUITY_EXACT_COMBINATION_LIMIT = 20_000;
const RUNOUT_EQUITY_SAMPLE_COUNT = 5_000;
const RUNOUT_EQUITY_DECK_RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"] as const;
const RUNOUT_EQUITY_DECK_SUITS: Card["suit"][] = ["clubs", "diamonds", "hearts", "spades"];
const ARCHIVED_REPLAY_ACTION_INTERVAL_MS = 750;

export type EquityTrend = "steady" | "up" | "down";
export type SuggestedGestureReason = "big_raise" | "tanking" | "big_win";
export type TurnMetrics = null | {
    actorAccountId: string | null;
    kind: "turn" | "run-it-twice";
    isUsingTimeBank: boolean;
    mainSecondsRemaining: number;
    timeBankSecondsRemaining: number;
    mainPercentRemaining: number;
    timeBankPercentRemaining: number;
    isMainLow: boolean;
    isTimeBankLow: boolean;
};

export interface AllInRunoutView {
    isActive: boolean;
    visibleBoards: Card[][];
    revealedAccountIds: string[];
}

interface ArchivedReplayActionState {
    isComplete: boolean;
    street: NonNullable<RoomSnapshot["currentHand"]>["street"];
    board: Card[];
    pot: number;
    currentBet: number;
    contributions: Record<string, number>;
    streetContributions: Record<string, number>;
    foldedAccountIds: string[];
    actions: HandActionRecord[];
}

export interface RunoutEquitySnapshot {
    percentByAccount: Map<string, number>;
    leaderAccountIds: Set<string>;
}

export interface RunoutEquityViewState extends RunoutEquitySnapshot {
    trendByAccount: Map<string, EquityTrend>;
}

export interface SessionLedgerRow {
    accountId: string;
    displayName: string;
    buyIn: number;
    buyOut: number;
    stack: number;
    wins: number;
    rebuys: number;
    net: number;
}

export interface BlindLevelDraft {
    smallBlind: string;
    bigBlind: string;
    ante: string;
    durationMinutes: string;
}

export interface BlindLevelDraftValidation {
    smallBlind?: string;
    bigBlind?: string;
    ante?: string;
    durationMinutes?: string;
}

export interface AdminOptionsDraft {
    useBlindSchedule: boolean;
    smallBlind: string;
    bigBlind: string;
    ante: string;
    blindLevels: BlindLevelDraft[];
    autoStartNextHand: boolean;
    autoStartDelaySeconds: string;
    decisionTimeSeconds: string;
    timeBankSeconds: string;
    timeBankRefillHands: string;
    isPubliclyListed: boolean;
    allowGuests: boolean;
    minBuyInAmount: string;
    maxBuyInRuleKind: "fixed_amount" | "chip_lead_percentage";
    maxBuyInRuleValue: string;
    revealAllShowdownHands: boolean;
    runItTwiceEnabled: boolean;
    suggestedGesturesEnabled: boolean;
    suggestedGesturePromptProbability: string;
    botSuggestedGestureReactionProbability: string;
}

export interface SuggestedGesturePromptState {
    eventKey: string;
    reason: SuggestedGestureReason;
    targetAccountId: string;
    targetDisplayName: string;
    headline: string;
    bodyCopy: string;
    emojis: readonly string[];
    expiresAtMs: number;
}

export function getSnapshotClockMs(snapshot: RoomSnapshot | null): number {
    const snapshotAtMs = snapshot ? Date.parse(snapshot.blindState.snapshotAt) : Number.NaN;

    if (!Number.isNaN(snapshotAtMs)) {
        return snapshotAtMs;
    }

    const concludedAtMs = snapshot?.lastCompletedHand ? Date.parse(snapshot.lastCompletedHand.concludedAt) : Number.NaN;

    if (!Number.isNaN(concludedAtMs)) {
        return concludedAtMs;
    }

    return 0;
}

export function formatSessionLedgerHandle(accountId: string): string {
    return `@${accountId.slice(0, 12)}`;
}

export function buildAllInRunoutView(lastCompletedHand: LastHandResult | null, nowMs: number): AllInRunoutView | null {
    const allInRunout = lastCompletedHand?.allInRunout;
    const finalBoards = getCompletedHandBoards(lastCompletedHand);

    if (!lastCompletedHand || !allInRunout || finalBoards.length === 0) {
        return null;
    }

    const totalRevealSteps = finalBoards.reduce((totalCards, board) => totalCards + Math.max(0, board.length - Math.min(allInRunout.startBoardCount, board.length)), 0);

    if (totalRevealSteps === 0) {
        return null;
    }

    if (allInRunout.revealIntervalMs <= 0) {
        return {
            isActive: false,
            visibleBoards: finalBoards,
            revealedAccountIds: allInRunout.revealedAccountIds,
        };
    }

    const concludedAtMs = Date.parse(lastCompletedHand.concludedAt);

    if (Number.isNaN(concludedAtMs)) {
        return {
            isActive: false,
            visibleBoards: finalBoards,
            revealedAccountIds: allInRunout.revealedAccountIds,
        };
    }

    const revealedSteps = Math.floor(Math.max(0, nowMs - concludedAtMs) / allInRunout.revealIntervalMs);
    let remainingSteps = revealedSteps;
    const visibleBoards = finalBoards.map((board) => {
        const startingCount = Math.min(allInRunout.startBoardCount, board.length);
        const missingCount = Math.max(0, board.length - startingCount);
        const revealedForBoard = Math.min(missingCount, remainingSteps);
        remainingSteps = Math.max(0, remainingSteps - missingCount);

        return board.slice(0, startingCount + revealedForBoard);
    });

    return {
        isActive: revealedSteps < totalRevealSteps,
        visibleBoards,
        revealedAccountIds: allInRunout.revealedAccountIds,
    };
}

export function buildAllInRunoutViewFromStep(lastCompletedHand: LastHandResult | null, revealedSteps: number): AllInRunoutView | null {
    const allInRunout = lastCompletedHand?.allInRunout;
    const finalBoards = getCompletedHandBoards(lastCompletedHand);

    if (!lastCompletedHand || !allInRunout || finalBoards.length === 0) {
        return null;
    }

    const totalRevealSteps = finalBoards.reduce(
        (total, board) => total + Math.max(0, board.length - Math.min(allInRunout.startBoardCount, board.length)),
        0,
    );

    if (totalRevealSteps === 0) {
        return null;
    }

    let remainingSteps = revealedSteps;
    const visibleBoards = finalBoards.map((board) => {
        const startingCount = Math.min(allInRunout.startBoardCount, board.length);
        const missingCount = Math.max(0, board.length - startingCount);
        const revealedForBoard = Math.min(missingCount, remainingSteps);
        remainingSteps = Math.max(0, remainingSteps - missingCount);
        return board.slice(0, startingCount + revealedForBoard);
    });

    return {
        isActive: revealedSteps < totalRevealSteps,
        visibleBoards,
        revealedAccountIds: allInRunout.revealedAccountIds,
    };
}

export function isAllInRunoutActive(lastCompletedHand: LastHandResult | null, nowMs: number): boolean {
    return Boolean(buildAllInRunoutView(lastCompletedHand, nowMs)?.isActive);
}

export function filterRevealedHoleCards(
    revealedHoleCards: LastHandResult["revealedHoleCards"],
    visibleAccountIds: Set<string>,
): LastHandResult["revealedHoleCards"] {
    return Object.fromEntries(
        Object.entries(revealedHoleCards).filter(([accountId]) => visibleAccountIds.has(accountId))
    );
}

export function createEmptyRunoutEquityViewState(): RunoutEquityViewState {
    return {
        percentByAccount: new Map(),
        leaderAccountIds: new Set(),
        trendByAccount: new Map(),
    };
}

export function buildRunoutHandLabelByAccount(
    lastCompletedHand: LastHandResult | null,
    allInRunoutView: AllInRunoutView | null,
): Map<string, string> {
    if (!lastCompletedHand?.allInRunout || !allInRunoutView) {
        return new Map();
    }

    const labelsByAccount = new Map<string, string>();

    for (const participant of buildRunoutVisibleParticipants(lastCompletedHand, allInRunoutView)) {
        const labels: string[] = [];
        const seenLabels = new Set<string>();

        for (const board of allInRunoutView.visibleBoards) {
            if (board.length === 0) {
                continue;
            }

            const label = evaluateVisibleHoldemHandLabel([...participant.holeCards, ...board]);

            if (!seenLabels.has(label)) {
                seenLabels.add(label);
                labels.push(label);
            }
        }

        if (labels.length > 0) {
            labelsByAccount.set(participant.accountId, labels.join(" / "));
        }
    }

    return labelsByAccount;
}

export function buildRunoutEquitySnapshot(
    lastCompletedHand: LastHandResult | null,
    allInRunoutView: AllInRunoutView | null,
): RunoutEquitySnapshot | null {
    if (!lastCompletedHand?.allInRunout || !allInRunoutView) {
        return null;
    }

    const participants = buildRunoutVisibleParticipants(lastCompletedHand, allInRunoutView);

    if (participants.length < 2) {
        return null;
    }

    const knownCardKeys = buildRunoutKnownCardKeys(lastCompletedHand, allInRunoutView, participants);

    if (!knownCardKeys) {
        return null;
    }

    const remainingDeck = buildRunoutEquityDeck(knownCardKeys);
    const boardScenarios = buildRunoutBoardScenarios(
        allInRunoutView.visibleBoards,
        remainingDeck,
        [
            lastCompletedHand.handId,
            String(lastCompletedHand.allInRunout.startBoardCount),
            buildBoardCollectionKey(allInRunoutView.visibleBoards),
            buildAccountListKey(participants.map((participant) => participant.accountId)),
        ].join(":"),
    );

    if (!boardScenarios.length) {
        return null;
    }

    const totalShares = new Map(participants.map((participant) => [participant.accountId, 0]));

    for (const boards of boardScenarios) {
        for (const board of boards) {
            let bestHand = evaluateHoldemHand([...participants[0]!.holeCards, ...board]);
            let winningAccountIds = [participants[0]!.accountId];

            for (let index = 1; index < participants.length; index += 1) {
                const participant = participants[index]!;
                const evaluatedHand = evaluateHoldemHand([...participant.holeCards, ...board]);
                const comparison = compareEvaluatedHands(evaluatedHand, bestHand);

                if (comparison > 0) {
                    bestHand = evaluatedHand;
                    winningAccountIds = [participant.accountId];
                    continue;
                }

                if (comparison === 0) {
                    winningAccountIds.push(participant.accountId);
                }
            }

            const share = 1 / (boards.length * winningAccountIds.length);

            for (const accountId of winningAccountIds) {
                totalShares.set(accountId, (totalShares.get(accountId) ?? 0) + share);
            }
        }
    }

    const percentByAccount = new Map(
        participants.map((participant) => [
            participant.accountId,
            Math.round(((totalShares.get(participant.accountId) ?? 0) / boardScenarios.length) * 100),
        ]),
    );
    const highestPercent = Math.max(...Array.from(percentByAccount.values()));

    return {
        percentByAccount,
        leaderAccountIds: new Set(
            Array.from(percentByAccount.entries())
                .filter(([, percent]) => percent === highestPercent)
                .map(([accountId]) => accountId),
        ),
    };
}

function buildRunoutVisibleParticipants(
    lastCompletedHand: LastHandResult,
    allInRunoutView: AllInRunoutView,
): Array<{ accountId: string; holeCards: [Card, Card] }> {
    return allInRunoutView.revealedAccountIds
        .map((accountId) => {
            const holeCards = lastCompletedHand.revealedHoleCards[accountId];

            return hasCompleteHoleCards(holeCards)
                ? { accountId, holeCards }
                : null;
        })
        .filter((entry): entry is { accountId: string; holeCards: [Card, Card] } => entry !== null);
}

function buildRunoutKnownCardKeys(
    lastCompletedHand: LastHandResult,
    allInRunoutView: AllInRunoutView,
    participants: Array<{ accountId: string; holeCards: [Card, Card] }>,
): Set<string> | null {
    const knownCardKeys = new Set<string>();
    const startBoardCount = lastCompletedHand.allInRunout?.startBoardCount ?? 0;
    const sharedBoard = (allInRunoutView.visibleBoards[0] ?? []).slice(0, startBoardCount);

    for (const card of sharedBoard) {
        const cardKey = buildCardIdentity(card);

        if (knownCardKeys.has(cardKey)) {
            return null;
        }

        knownCardKeys.add(cardKey);
    }

    for (const board of allInRunoutView.visibleBoards) {
        for (const card of board.slice(startBoardCount)) {
            const cardKey = buildCardIdentity(card);

            if (knownCardKeys.has(cardKey)) {
                return null;
            }

            knownCardKeys.add(cardKey);
        }
    }

    for (const participant of participants) {
        for (const card of participant.holeCards) {
            const cardKey = buildCardIdentity(card);

            if (knownCardKeys.has(cardKey)) {
                return null;
            }

            knownCardKeys.add(cardKey);
        }
    }

    return knownCardKeys;
}

function buildRunoutBoardScenarios(visibleBoards: Card[][], remainingDeck: Card[], seed: string): Card[][][] {
    const missingCounts = visibleBoards.map((board) => Math.max(0, 5 - board.length));

    if (missingCounts.every((count) => count === 0)) {
        return [visibleBoards.map((board) => [...board])];
    }

    const scenarioCount = calculateRunoutScenarioCount(remainingDeck.length, missingCounts);

    if (scenarioCount <= RUNOUT_EQUITY_EXACT_COMBINATION_LIMIT) {
        return enumerateRunoutBoardScenarios(visibleBoards, remainingDeck, missingCounts);
    }

    return sampleRunoutBoardScenarios(visibleBoards, remainingDeck, missingCounts, Math.min(RUNOUT_EQUITY_SAMPLE_COUNT, scenarioCount), seed);
}

function calculateRunoutScenarioCount(totalCards: number, missingCounts: number[]): number {
    let remainingCards = totalCards;
    let scenarioCount = 1;

    for (const missingCount of missingCounts) {
        scenarioCount *= calculateCombinationCount(remainingCards, missingCount);
        remainingCards -= missingCount;

        if (scenarioCount > RUNOUT_EQUITY_EXACT_COMBINATION_LIMIT) {
            return scenarioCount;
        }
    }

    return scenarioCount;
}

function enumerateRunoutBoardScenarios(visibleBoards: Card[][], remainingDeck: Card[], missingCounts: number[]): Card[][][] {
    const scenarios: Card[][][] = [];

    function visit(boardIndex: number, nextDeck: Card[], nextBoards: Card[][]) {
        if (boardIndex >= visibleBoards.length) {
            scenarios.push(nextBoards.map((board) => [...board]));
            return;
        }

        const baseBoard = visibleBoards[boardIndex] ?? [];
        const missingCount = missingCounts[boardIndex] ?? 0;

        if (missingCount <= 0) {
            visit(boardIndex + 1, nextDeck, [...nextBoards, [...baseBoard]]);
            return;
        }

        for (const completion of enumerateCardCombinations(nextDeck, missingCount)) {
            visit(
                boardIndex + 1,
                removeCardsFromDeck(nextDeck, completion),
                [...nextBoards, [...baseBoard, ...completion]],
            );
        }
    }

    visit(0, remainingDeck, []);
    return scenarios;
}

function sampleRunoutBoardScenarios(
    visibleBoards: Card[][],
    remainingDeck: Card[],
    missingCounts: number[],
    sampleCount: number,
    seed: string,
): Card[][][] {
    const random = createSeededRandom(seed);
    const scenarios: Card[][][] = [];
    const seen = new Set<string>();
    const maxAttempts = sampleCount * 6;
    let attempts = 0;

    while (scenarios.length < sampleCount && attempts < maxAttempts) {
        attempts += 1;
        const nextDeck = [...remainingDeck];
        const boards: Card[][] = [];

        for (let boardIndex = 0; boardIndex < visibleBoards.length; boardIndex += 1) {
            const baseBoard = visibleBoards[boardIndex] ?? [];
            const missingCount = missingCounts[boardIndex] ?? 0;
            const completion: Card[] = [];

            for (let drawIndex = 0; drawIndex < missingCount; drawIndex += 1) {
                const nextIndex = Math.floor(random() * nextDeck.length);
                const [nextCard] = nextDeck.splice(nextIndex, 1);

                if (!nextCard) {
                    return scenarios;
                }

                completion.push(nextCard);
            }

            boards.push([...baseBoard, ...completion]);
        }

        const scenarioKey = boards.map((board) => buildNormalizedBoardKey(board)).join("/");

        if (seen.has(scenarioKey)) {
            continue;
        }

        seen.add(scenarioKey);
        scenarios.push(boards);
    }

    return scenarios;
}

function removeCardsFromDeck(deck: Card[], cardsToRemove: Card[]): Card[] {
    const cardsToRemoveByKey = new Set(cardsToRemove.map((card) => buildCardIdentity(card)));
    return deck.filter((card) => !cardsToRemoveByKey.has(buildCardIdentity(card)));
}

function buildNormalizedBoardKey(board: Card[]): string {
    return board.map((card) => buildCardIdentity(card)).sort().join("|");
}

function evaluateVisibleHoldemHandLabel(cards: Card[]): string {
    if (cards.length >= 5) {
        return evaluateHoldemHand(cards).label;
    }

    const rankCounts = Array.from(cards.reduce((counts, card) => {
        const rank = normalizeCardRank(card.rank);
        counts.set(rank, (counts.get(rank) ?? 0) + 1);
        return counts;
    }, new Map<string, number>()).values()).sort((left, right) => right - left);

    if (rankCounts[0] === 4) {
        return "Four of a kind";
    }

    if (rankCounts[0] === 3) {
        return "Three of a kind";
    }

    if (rankCounts[0] === 2 && rankCounts[1] === 2) {
        return "Two pair";
    }

    if (rankCounts[0] === 2) {
        return "Pair";
    }

    return "High card";
}

export function getCompletedHandBoards(lastCompletedHand: LastHandResult | null): Card[][] {
    if (!lastCompletedHand) {
        return [];
    }

    const runoutBoards = lastCompletedHand.allInRunout?.runouts?.map((runout) => runout.board) ?? [];
    return runoutBoards.length ? runoutBoards : [lastCompletedHand.board];
}

export function getCompletedHandRunoutResults(lastCompletedHand: LastHandResult | null): NonNullable<NonNullable<LastHandResult["allInRunout"]>["runouts"]> {
    return lastCompletedHand?.allInRunout?.runouts ?? [];
}

export function escapeCsvValue(value: string): string {
    if (/[",\n]/.test(value)) {
        return `"${value.replace(/"/g, '""')}"`;
    }

    return value;
}

export function buildArchivedReplayRoomSnapshot(
    baseSnapshot: RoomSnapshot,
    archivedHand: ArchivedHandRecord,
    accountId: string | undefined,
    nowMs: number,
    replayStartedAtMs: number,
): RoomSnapshot {
    const replayState = buildArchivedReplayActionState(archivedHand, nowMs, replayStartedAtMs);
    const players: RoomPlayer[] = archivedHand.participants.map((participant) => ({
        accountId: participant.accountId,
        displayName: participant.displayName,
        seatIndex: participant.seatIndex,
        stack: participant.finalStack,
        isReady: false,
        isConnected: false,
        isSittingOut: false,
    }));
    const blindLevel = archivedHand.blindLevel ?? baseSnapshot.blindState.currentLevel ?? {
        level: 1,
        smallBlind: 100,
        bigBlind: 200,
        durationMinutes: 20,
    };
    const heroCards = accountId ? archivedHand.revealedHoleCards[accountId] : undefined;
    const currentHand = replayState.isComplete
        ? null
        : {
            id: archivedHand.handId,
            handNumber: archivedHand.handNumber,
            blindLevel,
            dealerSeat: archivedHand.dealerSeat ?? archivedHand.smallBlindSeat ?? archivedHand.bigBlindSeat ?? players[0]?.seatIndex ?? 0,
            smallBlindSeat: archivedHand.smallBlindSeat ?? players[0]?.seatIndex ?? 0,
            bigBlindSeat: archivedHand.bigBlindSeat ?? players[0]?.seatIndex ?? 0,
            actorSeat: archivedHand.dealerSeat ?? archivedHand.smallBlindSeat ?? archivedHand.bigBlindSeat ?? players[0]?.seatIndex ?? 0,
            actorAccountId: null,
            street: replayState.street,
            board: replayState.board,
            pot: replayState.pot,
            currentBet: replayState.currentBet,
            contributions: replayState.contributions,
            streetContributions: replayState.streetContributions,
            foldedAccountIds: replayState.foldedAccountIds,
            playersToAct: [],
            startedAt: archivedHand.startedAt ?? archivedHand.concludedAt,
            actions: replayState.actions,
            heroHoleCards: hasCompleteHoleCards(heroCards) ? heroCards : null,
            heroActionState: null,
            runItTwicePrompt: null,
            playerCardCounts: Object.fromEntries(
                archivedHand.participants
                    .filter((participant) => participant.wasDealtIn)
                    .map((participant) => [participant.accountId, 2]),
            ),
            remainingDeckCount: Math.max(0, 52 - replayState.board.length - archivedHand.participants.filter((participant) => participant.wasDealtIn).length * 2),
        };

    return {
        ...baseSnapshot,
        status: "archived",
        players,
        chatMessages: [],
        seatReactions: [],
        seatGestures: [],
        nextHandStartsAt: null,
        pendingSeatRequests: [],
        pendingRebuyRequests: [],
        turnState: {
            turnSeconds: null,
            timeBankSeconds: null,
            currentTurnStartedAt: null,
            timeBankMsByAccount: {},
        },
        currentHand,
        lastCompletedHand: replayState.isComplete ? archivedHandToCompletedHand(archivedHand) : null,
        lastCompletedHandRevealState: null,
    };
}

function buildArchivedReplayActionState(
    archivedHand: ArchivedHandRecord,
    nowMs: number,
    replayStartedAtMs: number,
): ArchivedReplayActionState {
    const elapsedMs = Math.max(0, nowMs - replayStartedAtMs);
    const visibleActionCount = Math.min(archivedHand.actions.length, Math.floor(elapsedMs / ARCHIVED_REPLAY_ACTION_INTERVAL_MS));
    const actions = archivedHand.actions.slice(0, visibleActionCount);
    let street: ArchivedReplayActionState["street"] = "preflop";
    let currentBet = 0;
    let streetContributions: Record<string, number> = {};
    const contributions: Record<string, number> = {};
    const foldedAccountIds = new Set<string>();

    for (const action of actions) {
        if (action.street !== street) {
            street = action.street;
            currentBet = 0;
            streetContributions = {};
        }

        if (action.type === "fold") {
            foldedAccountIds.add(action.actorAccountId);
        }

        if (action.amount > 0) {
            contributions[action.actorAccountId] = (contributions[action.actorAccountId] ?? 0) + action.amount;
            streetContributions[action.actorAccountId] = (streetContributions[action.actorAccountId] ?? 0) + action.amount;
        }

        currentBet = Math.max(currentBet, action.betTo);
    }

    return {
        isComplete: visibleActionCount >= archivedHand.actions.length,
        street,
        board: buildArchivedReplayBoard(archivedHand, street, visibleActionCount >= archivedHand.actions.length),
        pot: Object.values(contributions).reduce((total, amount) => total + amount, 0),
        currentBet,
        contributions,
        streetContributions,
        foldedAccountIds: Array.from(foldedAccountIds),
        actions,
    };
}

function buildArchivedReplayBoard(
    archivedHand: ArchivedHandRecord,
    street: ArchivedReplayActionState["street"],
    isComplete: boolean,
): Card[] {
    if (isComplete) {
        return archivedHand.board;
    }

    switch (street) {
        case "flop":
            return archivedHand.board.slice(0, 3);
        case "turn":
            return archivedHand.board.slice(0, 4);
        case "river":
        case "showdown":
            return archivedHand.board.slice(0, 5);
        default:
            return [];
    }
}

function archivedHandToCompletedHand(archivedHand: ArchivedHandRecord): LastHandResult {
    return {
        handId: archivedHand.handId,
        handNumber: archivedHand.handNumber,
        board: archivedHand.board,
        totalPot: archivedHand.totalPot,
        winningReason: archivedHand.winningReason,
        concludedAt: archivedHand.concludedAt,
        actions: archivedHand.actions,
        winners: archivedHand.winners,
        revealedHoleCards: archivedHand.revealedHoleCards,
        allInRunout: archivedHand.allInRunout,
    };
}

export function buildArchivedCenterStatus(
    archivedHand: ArchivedHandRecord | null,
    currentHand: RoomSnapshot["currentHand"],
): string {
    if (!archivedHand) {
        return "Archived table replay unavailable.";
    }

    if (currentHand) {
        return `Replaying archived hand ${archivedHand.handNumber}.`;
    }

    const winnerNames = archivedHand.winners
        .map((winner) => archivedHand.participants.find((participant) => participant.accountId === winner.accountId)?.displayName ?? winner.accountId)
        .join(", ");

    return winnerNames
        ? `${winnerNames} won the archived pot.`
        : `Archived hand ${archivedHand.handNumber} replay complete.`;
}

export function buildBoardCollectionKey(boards: Card[][]): string {
    return boards.map((board) => buildCardListKey(board)).join("/");
}

function hasCompleteHoleCards(cards: [Card | null, Card | null] | undefined): cards is [Card, Card] {
    return Boolean(cards?.[0] && cards?.[1]);
}

function enumerateCardCombinations(cards: Card[], count: number): Card[][] {
    if (count <= 0) {
        return [[]];
    }

    if (count > cards.length) {
        return [];
    }

    const combinations: Card[][] = [];

    function visit(startIndex: number, current: Card[]) {
        if (current.length === count) {
            combinations.push([...current]);
            return;
        }

        for (let index = startIndex; index <= cards.length - (count - current.length); index += 1) {
            current.push(cards[index]!);
            visit(index + 1, current);
            current.pop();
        }
    }

    visit(0, []);
    return combinations;
}

function calculateCombinationCount(totalCards: number, picks: number): number {
    if (picks < 0 || picks > totalCards) {
        return 0;
    }

    const reducedPicks = Math.min(picks, totalCards - picks);
    let result = 1;

    for (let step = 1; step <= reducedPicks; step += 1) {
        result = (result * (totalCards - reducedPicks + step)) / step;
    }

    return Math.round(result);
}

function buildRunoutEquityDeck(knownCardKeys: Set<string>): Card[] {
    const deck: Card[] = [];

    for (const rank of RUNOUT_EQUITY_DECK_RANKS) {
        for (const suit of RUNOUT_EQUITY_DECK_SUITS) {
            const card = { rank, suit } satisfies Card;

            if (!knownCardKeys.has(buildCardIdentity(card))) {
                deck.push(card);
            }
        }
    }

    return deck;
}

function buildCardListKey(cards: Card[]): string {
    return cards.map((card) => buildCardIdentity(card)).join("|");
}

export function buildAccountListKey(accountIds: string[]): string {
    return [...accountIds].sort().join("|");
}

function buildCardIdentity(card: Card): string {
    return `${normalizeCardRank(card.rank)}:${card.suit}`;
}

function normalizeCardRank(rank: string): string {
    return rank === "10" ? "T" : rank.toUpperCase();
}

function createSeededRandom(seed: string): () => number {
    let state = 1779033703 ^ seed.length;

    for (let index = 0; index < seed.length; index += 1) {
        state = Math.imul(state ^ seed.charCodeAt(index), 3432918353);
        state = (state << 13) | (state >>> 19);
    }

    return () => {
        state += 0x6d2b79f5;
        let next = state;
        next = Math.imul(next ^ (next >>> 15), next | 1);
        next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
        return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
    };
}

export function toggleRevealMode(currentMode: RevealMode, cardIndex: 0 | 1): RevealMode {
    const leftVisible = currentMode === "first" || currentMode === "both";
    const rightVisible = currentMode === "second" || currentMode === "both";
    const nextLeftVisible = cardIndex === 0 ? !leftVisible : leftVisible;
    const nextRightVisible = cardIndex === 1 ? !rightVisible : rightVisible;

    if (nextLeftVisible && nextRightVisible) {
        return "both";
    }

    if (nextLeftVisible) {
        return "first";
    }

    if (nextRightVisible) {
        return "second";
    }

    return "none";
}

export function createEmptyAdminOptionsDraft(): AdminOptionsDraft {
    return {
        useBlindSchedule: false,
        smallBlind: "",
        bigBlind: "",
        ante: "0",
        blindLevels: [createBlindLevelDraft()],
        autoStartNextHand: true,
        autoStartDelaySeconds: "8",
        decisionTimeSeconds: "",
        timeBankSeconds: "",
        timeBankRefillHands: "",
        isPubliclyListed: true,
        allowGuests: false,
        minBuyInAmount: "1000",
        maxBuyInRuleKind: "chip_lead_percentage",
        maxBuyInRuleValue: "50",
        revealAllShowdownHands: false,
        runItTwiceEnabled: false,
        suggestedGesturesEnabled: true,
        suggestedGesturePromptProbability: "0.5",
        botSuggestedGestureReactionProbability: "0.5",
    };
}

export function buildAdminOptionsDraft(snapshot: RoomSnapshot): AdminOptionsDraft {
    const schedule = snapshot.blindState.schedule.length
        ? snapshot.blindState.schedule
        : [{ level: 1, smallBlind: snapshot.currentHand?.blindLevel.smallBlind ?? 100, bigBlind: snapshot.currentHand?.blindLevel.bigBlind ?? 200, ante: snapshot.currentHand?.blindLevel.ante ?? 0, durationMinutes: 20 }];
    const firstLevel = schedule[0]!;

    return {
        useBlindSchedule: schedule.length > 1,
        smallBlind: String(firstLevel.smallBlind),
        bigBlind: String(firstLevel.bigBlind),
        ante: String(firstLevel.ante ?? 0),
        blindLevels: buildBlindLevelDrafts(schedule),
        autoStartNextHand: snapshot.autoStartNextHand,
        autoStartDelaySeconds: String(snapshot.autoStartDelaySeconds),
        decisionTimeSeconds: snapshot.adminOptions.decisionTimeSeconds === null ? "" : String(snapshot.adminOptions.decisionTimeSeconds),
        timeBankSeconds: snapshot.adminOptions.timeBankSeconds === null ? "" : String(snapshot.adminOptions.timeBankSeconds),
        timeBankRefillHands: snapshot.adminOptions.timeBankRefillHands === null ? "" : String(snapshot.adminOptions.timeBankRefillHands),
        isPubliclyListed: snapshot.adminOptions.isPubliclyListed,
        allowGuests: snapshot.adminOptions.allowGuests === true,
        minBuyInAmount: String(snapshot.adminOptions.minBuyInAmount),
        maxBuyInRuleKind: snapshot.adminOptions.maxBuyInRule.kind,
        maxBuyInRuleValue: String(snapshot.adminOptions.maxBuyInRule.value),
        revealAllShowdownHands: snapshot.adminOptions.revealAllShowdownHands,
        runItTwiceEnabled: snapshot.adminOptions.runItTwiceEnabled,
        suggestedGesturesEnabled: snapshot.adminOptions.suggestedGesturesEnabled,
        suggestedGesturePromptProbability: String(snapshot.adminOptions.suggestedGesturePromptProbability),
        botSuggestedGestureReactionProbability: String(snapshot.adminOptions.botSuggestedGestureReactionProbability),
    };
}

function createBlindLevelDraft(level?: Partial<BlindLevelDraft>): BlindLevelDraft {
    return {
        smallBlind: level?.smallBlind ?? "",
        bigBlind: level?.bigBlind ?? "",
        ante: level?.ante ?? "0",
        durationMinutes: level?.durationMinutes ?? "20",
    };
}

function buildBlindLevelDrafts(schedule: RoomSnapshot["blindState"]["schedule"]): BlindLevelDraft[] {
    if (!schedule.length) {
        return [createBlindLevelDraft()];
    }

    return schedule.map((level) => createBlindLevelDraft({
        smallBlind: String(level.smallBlind),
        bigBlind: String(level.bigBlind),
        ante: String(level.ante ?? 0),
        durationMinutes: String(level.durationMinutes),
    }));
}

export function buildNextBlindLevelDraft(levels: BlindLevelDraft[]): BlindLevelDraft {
    const lastLevel = levels.at(-1);
    const lastSmallBlind = parseWholeNumberInput(lastLevel?.smallBlind ?? "");
    const lastBigBlind = parseWholeNumberInput(lastLevel?.bigBlind ?? "");
    const lastAnte = parseWholeNumberInput(lastLevel?.ante ?? "0");
    const lastDuration = parseWholeNumberInput(lastLevel?.durationMinutes ?? "20");

    return createBlindLevelDraft({
        smallBlind: lastSmallBlind !== null && lastSmallBlind > 0 ? String(lastSmallBlind * 2) : "",
        bigBlind: lastBigBlind !== null && lastBigBlind > 0 ? String(lastBigBlind * 2) : "",
        ante: lastAnte !== null && lastAnte >= 0 ? String(lastAnte) : "0",
        durationMinutes: lastDuration !== null && lastDuration > 0 ? String(lastDuration) : "20",
    });
}

export function syncPendingAmountDrafts(current: Record<string, string>, entries: Array<{ id: string; value: number }>): Record<string, string> {
    return entries.reduce<Record<string, string>>((next, entry) => {
        next[entry.id] = current[entry.id] ?? String(entry.value);
        return next;
    }, {});
}

export function buildAdminApprovalQueueKey(kind: "seat" | "rebuy", requestId: string): string {
    return `${kind}:${requestId}`;
}

export function validateBlindScheduleDraft(draft: AdminOptionsDraft): { rows: BlindLevelDraftValidation[]; errors: string[] } {
    const rows = draft.blindLevels.map(() => ({} as BlindLevelDraftValidation));
    const errors: string[] = [];

    if (!draft.useBlindSchedule) {
        return { rows, errors };
    }

    if (draft.blindLevels.length === 0) {
        return {
            rows,
            errors: ["Add at least one blind level."],
        };
    }

    draft.blindLevels.forEach((level, index) => {
        const row = rows[index]!;
        const rowLabel = `Level ${index + 1}`;
        const smallBlind = parseWholeNumberInput(level.smallBlind);
        const bigBlind = parseWholeNumberInput(level.bigBlind);
        const ante = parseWholeNumberInput(level.ante);
        const durationMinutes = parseWholeNumberInput(level.durationMinutes);

        if (smallBlind === null || smallBlind <= 0) {
            row.smallBlind = "Enter a positive whole-number small blind.";
            errors.push(`${rowLabel}: small blind must be a positive integer.`);
        }

        if (bigBlind === null || bigBlind <= 0) {
            row.bigBlind = "Enter a positive whole-number big blind.";
            errors.push(`${rowLabel}: big blind must be a positive integer.`);
        }

        if (smallBlind !== null && bigBlind !== null && smallBlind > 0 && bigBlind > 0 && bigBlind <= smallBlind) {
            row.bigBlind = "Big blind must be greater than the small blind.";
            errors.push(`${rowLabel}: big blind must be greater than the small blind.`);
        }

        if (level.ante.trim() && (ante === null || ante < 0)) {
            row.ante = "Ante must be blank or a non-negative whole number.";
            errors.push(`${rowLabel}: ante must be blank or a non-negative integer.`);
        }

        if (durationMinutes === null || durationMinutes <= 0) {
            row.durationMinutes = "Enter a duration above zero minutes.";
            errors.push(`${rowLabel}: duration must be a positive integer.`);
        }
    });

    return { rows, errors };
}

export function parseWholeNumberInput(value: string): number | null {
    const trimmed = value.trim();

    if (!trimmed) {
        return null;
    }

    const normalized = Number(trimmed);

    if (!Number.isFinite(normalized) || !Number.isInteger(normalized)) {
        return null;
    }

    return normalized;
}

export function parseBlindScheduleDraft(draft: AdminOptionsDraft): RoomSnapshot["blindState"]["schedule"] {
    if (!draft.useBlindSchedule) {
        return [{
            level: 1,
            smallBlind: parseRequiredWholeNumber(draft.smallBlind, "Small blind"),
            bigBlind: parseRequiredWholeNumber(draft.bigBlind, "Big blind"),
            ante: parseOptionalWholeNumber(draft.ante, "Ante") ?? 0,
            durationMinutes: 20,
        }];
    }

    const validation = validateBlindScheduleDraft(draft);

    if (validation.errors.length > 0) {
        throw new Error(validation.errors[0] ?? "Fix the blind schedule validation errors before saving.");
    }

    return draft.blindLevels.map((level, index) => {
        const nextLevel = {
            level: index + 1,
            smallBlind: parseRequiredWholeNumber(level.smallBlind, `Blind level ${index + 1} small blind`),
            bigBlind: parseRequiredWholeNumber(level.bigBlind, `Blind level ${index + 1} big blind`),
            ante: parseOptionalWholeNumber(level.ante, `Blind level ${index + 1} ante`) ?? 0,
            durationMinutes: parseRequiredWholeNumber(level.durationMinutes, `Blind level ${index + 1} duration`),
        };

        if (nextLevel.bigBlind <= nextLevel.smallBlind) {
            throw new Error(`Blind level ${index + 1} big blind must be greater than the small blind.`);
        }

        return nextLevel;
    });
}

export function getBlindCountdownMs(blindState: RoomSnapshot["blindState"], nowMs: number): number | null {
    if (blindState.nextLevelInMs === null) {
        return null;
    }

    const snapshotAtMs = Date.parse(blindState.snapshotAt);
    const elapsedMs = blindState.pausedAt || Number.isNaN(snapshotAtMs)
        ? 0
        : Math.max(0, nowMs - snapshotAtMs);

    return Math.max(0, blindState.nextLevelInMs - elapsedMs);
}

export function formatBlindLevelCompact(level: NonNullable<RoomSnapshot["blindState"]["nextLevel"] | RoomSnapshot["blindState"]["currentLevel"]>): string {
    return level.ante && level.ante > 0
        ? `${formatNumber(level.smallBlind)}/${formatNumber(level.bigBlind)}/${formatNumber(level.ante)}`
        : `${formatNumber(level.smallBlind)}/${formatNumber(level.bigBlind)}`;
}

export function formatClockCountdown(valueMs: number): string {
    const totalSeconds = Math.max(0, Math.ceil(valueMs / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function buildSessionLedgerRows(snapshot: RoomSnapshot | null): SessionLedgerRow[] {
    if (!snapshot) {
        return [];
    }

    const accountIds = new Set<string>();
    snapshot.players.forEach((player) => accountIds.add(player.accountId));
    Object.keys(snapshot.buyInState.buyInTotalByAccount).forEach((accountId) => accountIds.add(accountId));
    Object.keys(snapshot.ledgerState.buyOutByAccount).forEach((accountId) => accountIds.add(accountId));
    Object.keys(snapshot.ledgerState.displayNameByAccount).forEach((accountId) => accountIds.add(accountId));
    Object.keys(snapshot.playerStats.handsWonByAccount).forEach((accountId) => accountIds.add(accountId));
    Object.keys(snapshot.playerStats.rebuyCountByAccount).forEach((accountId) => accountIds.add(accountId));

    return Array.from(accountIds).map((accountId) => {
        const player = snapshot.players.find((entry) => entry.accountId === accountId) ?? null;
        const buyIn = snapshot.buyInState.buyInTotalByAccount[accountId] ?? (player ? snapshot.startingStack : 0);
        const buyOut = snapshot.ledgerState.buyOutByAccount[accountId] ?? 0;
        const stack = player?.stack ?? 0;
        const wins = snapshot.playerStats.handsWonByAccount[accountId] ?? 0;
        const rebuys = snapshot.playerStats.rebuyCountByAccount[accountId] ?? 0;
        const net = stack + buyOut - buyIn;

        return {
            accountId,
            displayName: player?.displayName ?? snapshot.ledgerState.displayNameByAccount[accountId] ?? accountId,
            buyIn,
            buyOut,
            stack,
            wins,
            rebuys,
            net,
        } satisfies SessionLedgerRow;
    }).filter((row) => row.buyIn > 0 || row.buyOut > 0 || row.stack > 0 || row.wins > 0 || row.rebuys > 0)
        .sort((left, right) => right.net - left.net || right.wins - left.wins || right.stack - left.stack || left.displayName.localeCompare(right.displayName));
}

export function buildTurnMetrics(snapshot: RoomSnapshot | null, nowMs: number): TurnMetrics {
    if (!snapshot?.currentHand || !snapshot.turnState.currentTurnStartedAt || snapshot.turnState.turnSeconds === null) {
        return null;
    }

    const startedAtMs = Date.parse(snapshot.turnState.currentTurnStartedAt);

    if (Number.isNaN(startedAtMs)) {
        return null;
    }

    if (snapshot.currentHand.runItTwicePrompt) {
        const mainRemainingMs = Math.max(0, (snapshot.turnState.turnSeconds * 1000) - Math.max(0, nowMs - startedAtMs));

        return {
            actorAccountId: null,
            kind: "run-it-twice",
            isUsingTimeBank: false,
            mainSecondsRemaining: Math.max(0, Math.ceil(mainRemainingMs / 1000)),
            timeBankSecondsRemaining: 0,
            mainPercentRemaining: 100,
            timeBankPercentRemaining: 0,
            isMainLow: false,
            isTimeBankLow: false,
        };
    }

    if (!snapshot.currentHand.actorAccountId) {
        return null;
    }

    const elapsedMs = Math.max(0, nowMs - startedAtMs);
    const mainBudgetMs = snapshot.turnState.turnSeconds * 1000;
    const actorTimeBankMs = snapshot.turnState.timeBankSeconds === null
        ? 0
        : snapshot.turnState.timeBankMsByAccount[snapshot.currentHand.actorAccountId] ?? snapshot.turnState.timeBankSeconds * 1000;
    const mainRemainingMs = Math.max(0, mainBudgetMs - elapsedMs);
    const overflowMs = Math.max(0, elapsedMs - mainBudgetMs);
    const timeBankRemainingMs = Math.max(0, actorTimeBankMs - overflowMs);
    const timeBankBudgetMs = actorTimeBankMs + overflowMs;
    const totalBudgetMs = Math.max(1, mainBudgetMs + timeBankBudgetMs);

    return {
        actorAccountId: snapshot.currentHand.actorAccountId,
        kind: "turn",
        isUsingTimeBank: mainRemainingMs === 0 && timeBankBudgetMs > 0 && timeBankRemainingMs < timeBankBudgetMs,
        mainSecondsRemaining: Math.max(0, Math.ceil(mainRemainingMs / 1000)),
        timeBankSecondsRemaining: Math.max(0, Math.ceil(timeBankRemainingMs / 1000)),
        mainPercentRemaining: Math.max(0, Math.min(100, (mainRemainingMs / totalBudgetMs) * 100)),
        timeBankPercentRemaining: Math.max(0, Math.min(100, (timeBankRemainingMs / totalBudgetMs) * 100)),
        isMainLow: mainBudgetMs > 0 && mainRemainingMs / mainBudgetMs <= 0.3,
        isTimeBankLow: timeBankBudgetMs > 0 && timeBankRemainingMs / timeBankBudgetMs <= 0.3,
    };
}

export function buildActiveReactionMap(
    snapshot: RoomSnapshot | null,
    nowMs: number,
    useTargetSeat = true,
): Map<string, RoomSnapshot["seatReactions"][number]> {
    const reactions = snapshot?.seatReactions ?? [];

    return reactions.reduce((map, reaction) => {
        if (Date.parse(reaction.expiresAt) <= nowMs) {
            return map;
        }

        map.set(useTargetSeat ? (reaction.targetAccountId ?? reaction.accountId) : reaction.accountId, reaction);
        return map;
    }, new Map<string, RoomSnapshot["seatReactions"][number]>());
}

export function buildSeatGestureMap(snapshot: RoomSnapshot | null): Map<string, RoomSnapshot["seatGestures"][number]> {
    const gestures = snapshot?.seatGestures ?? [];

    return gestures.reduce((map, gesture) => {
        map.set(gesture.accountId, gesture);
        return map;
    }, new Map<string, RoomSnapshot["seatGestures"][number]>());
}

export function buildSuggestedGestureTrigger(
    snapshot: RoomSnapshot | null,
    heroAccountId?: string,
    nowMs = Date.now(),
    turnMetrics: TurnMetrics = null,
    promptProbability = 0.5,
): Omit<SuggestedGesturePromptState, "expiresAtMs"> | null {
    if (!snapshot || !heroAccountId) {
        return null;
    }

    const candidate = buildBigRaiseSuggestedGestureTrigger(snapshot, heroAccountId)
        ?? buildTankingSuggestedGestureTrigger(snapshot, heroAccountId, nowMs, turnMetrics)
        ?? buildBigWinSuggestedGestureTrigger(snapshot, heroAccountId, nowMs);

    if (!candidate) {
        return null;
    }

    return shouldShowSuggestedGesturePrompt(candidate.eventKey, heroAccountId, promptProbability) ? candidate : null;
}

function shouldShowSuggestedGesturePrompt(eventKey: string, heroAccountId: string, probability: number): boolean {
    if (probability <= 0) {
        return false;
    }

    if (probability >= 1) {
        return true;
    }

    return createSeededRandom(`${heroAccountId}:${eventKey}`)() < probability;
}

function buildBigRaiseSuggestedGestureTrigger(
    snapshot: RoomSnapshot,
    heroAccountId: string,
): Omit<SuggestedGesturePromptState, "expiresAtMs"> | null {
    if (!snapshot.currentHand) {
        return null;
    }

    const { currentHand } = snapshot;
    const heroActionState = currentHand.heroActionState;

    if (!heroActionState || !heroActionState.canAct || heroActionState.hasFolded || heroActionState.isAllIn || heroActionState.callAmount <= 0) {
        return null;
    }

    if (currentHand.actorAccountId !== heroAccountId) {
        return null;
    }

    const latestAction = currentHand.actions.at(-1);

    if (!latestAction || latestAction.actorAccountId === heroAccountId || latestAction.street !== currentHand.street) {
        return null;
    }

    if (latestAction.type !== "raise" && latestAction.type !== "all_in") {
        return null;
    }

    const bigBlind = Math.max(1, currentHand.blindLevel.bigBlind);
    const potBeforeAction = Math.max(0, currentHand.pot - latestAction.amount);
    const callAmount = heroActionState.callAmount;
    const qualifiesByBlind = callAmount >= bigBlind * BIG_RAISE_MIN_CALL_BIG_BLIND_MULTIPLE;
    const qualifiesByPot = potBeforeAction > 0 && (callAmount / potBeforeAction) >= BIG_RAISE_MIN_CALL_POT_RATIO;

    if (!qualifiesByBlind && !qualifiesByPot) {
        return null;
    }

    const aggressor = snapshot.players.find((player) => player.accountId === latestAction.actorAccountId) ?? null;

    if (!latestAction.actorAccountId) {
        return null;
    }

    return {
        eventKey: `${currentHand.id}:${latestAction.orderIndex}:${latestAction.actorAccountId}`,
        reason: "big_raise",
        targetAccountId: latestAction.actorAccountId,
        targetDisplayName: aggressor?.displayName ?? "Opponent",
        headline: `Big raise from ${aggressor?.displayName ?? "Opponent"}`,
        bodyCopy: "Fire back a quick reaction.",
        emojis: BIG_RAISE_SUGGESTED_EMOJIS,
    };
}

function buildTankingSuggestedGestureTrigger(
    snapshot: RoomSnapshot,
    heroAccountId: string,
    nowMs: number,
    turnMetrics: TurnMetrics,
): Omit<SuggestedGesturePromptState, "expiresAtMs"> | null {
    if (!snapshot.currentHand || !snapshot.turnState.currentTurnStartedAt || !turnMetrics || turnMetrics.kind !== "turn") {
        return null;
    }

    const heroPlayer = snapshot.players.find((player) => player.accountId === heroAccountId) ?? null;

    if (!heroPlayer || !turnMetrics.actorAccountId || turnMetrics.actorAccountId === heroAccountId) {
        return null;
    }

    const startedAtMs = Date.parse(snapshot.turnState.currentTurnStartedAt);

    if (Number.isNaN(startedAtMs)) {
        return null;
    }

    const qualifies = turnMetrics.isUsingTimeBank || (turnMetrics.isMainLow && (nowMs - startedAtMs) >= TANKING_TRIGGER_MIN_ELAPSED_MS);

    if (!qualifies) {
        return null;
    }

    const tankingPlayer = snapshot.players.find((player) => player.accountId === turnMetrics.actorAccountId) ?? null;

    if (!tankingPlayer) {
        return null;
    }

    return {
        eventKey: `${snapshot.currentHand.id}:tank:${snapshot.turnState.currentTurnStartedAt}:${tankingPlayer.accountId}`,
        reason: "tanking",
        targetAccountId: tankingPlayer.accountId,
        targetDisplayName: tankingPlayer.displayName,
        headline: `${tankingPlayer.displayName} is in the tank`,
        bodyCopy: turnMetrics.isUsingTimeBank ? "The clock is in the red. Send a quick poke." : "They are taking a beat. Nudge the spot.",
        emojis: TANKING_SUGGESTED_EMOJIS,
    };
}

function buildBigWinSuggestedGestureTrigger(
    snapshot: RoomSnapshot,
    heroAccountId: string,
    nowMs: number,
): Omit<SuggestedGesturePromptState, "expiresAtMs"> | null {
    if (snapshot.currentHand || !snapshot.lastCompletedHand || isAllInRunoutActive(snapshot.lastCompletedHand, nowMs)) {
        return null;
    }

    const heroPlayer = snapshot.players.find((player) => player.accountId === heroAccountId) ?? null;

    if (!heroPlayer) {
        return null;
    }

    const concludedAtMs = Date.parse(snapshot.lastCompletedHand.concludedAt);

    if (Number.isNaN(concludedAtMs) || (nowMs - concludedAtMs) > BIG_WIN_SUGGESTED_MAX_AGE_MS) {
        return null;
    }

    const topWinner = snapshot.lastCompletedHand.winners.reduce<LastHandResult["winners"][number] | null>((currentTopWinner, winner) => {
        if (!currentTopWinner || winner.amountWon > currentTopWinner.amountWon) {
            return winner;
        }

        return currentTopWinner;
    }, null);

    if (!topWinner || topWinner.accountId === heroAccountId) {
        return null;
    }

    const currentBigBlind = Math.max(1, snapshot.blindState.currentLevel?.bigBlind ?? 1);
    const livePlayerCount = Math.max(2, snapshot.players.filter((player) => player.stack > 0 && !player.isSittingOut).length);
    const bigWinThreshold = currentBigBlind * livePlayerCount * BIG_WIN_MIN_POT_BIG_BLIND_MULTIPLE_PER_PLAYER;

    if (topWinner.amountWon < bigWinThreshold) {
        return null;
    }

    const winner = snapshot.players.find((player) => player.accountId === topWinner.accountId) ?? null;

    if (!winner) {
        return null;
    }

    return {
        eventKey: `${snapshot.lastCompletedHand.handId}:big_win:${winner.accountId}`,
        reason: "big_win",
        targetAccountId: winner.accountId,
        targetDisplayName: winner.displayName,
        headline: `${winner.displayName} scooped a big one`,
        bodyCopy: snapshot.lastCompletedHand.winningReason === "showdown"
            ? "Mark the pot before the next deal starts."
            : "They dragged a chunky pot. Send a quick reaction.",
        emojis: BIG_WIN_SUGGESTED_EMOJIS,
    };
}

export function defaultBuyInAmount(snapshot: RoomSnapshot): number {
    const { minRebuyAmount, maxRebuyAmount } = snapshot.buyInState;
    return Math.max(minRebuyAmount, Math.min(maxRebuyAmount, snapshot.startingStack));
}

export function defaultRebuyAmount(snapshot: RoomSnapshot): number {
    return defaultBuyInAmount(snapshot);
}

export function buildRebuyPresets(snapshot: RoomSnapshot): Array<{ label: string; amount: number }> {
    const { minRebuyAmount, maxRebuyAmount } = snapshot.buyInState;
    const midpoint = Math.round((minRebuyAmount + maxRebuyAmount) / 2 / 100) * 100;
    const candidates = [
        { label: "Min", amount: minRebuyAmount },
        { label: "Base", amount: defaultRebuyAmount(snapshot) },
        { label: "Mid", amount: Math.max(minRebuyAmount, Math.min(maxRebuyAmount, midpoint)) },
        { label: "Max", amount: maxRebuyAmount },
    ];
    const seen = new Set<number>();

    return candidates.filter((candidate) => {
        if (seen.has(candidate.amount)) {
            return false;
        }

        seen.add(candidate.amount);
        return true;
    });
}

export function getSeatMediaPlacement(position: { left: number; top: number }): "above" | "below" | "left" | "right" {
    if (position.top <= 22) {
        return "below";
    }

    if (position.top >= 72) {
        return "above";
    }

    if (position.left <= 26) {
        return "right";
    }

    if (position.left >= 74) {
        return "left";
    }

    return position.left < 50 ? "right" : "left";
}
