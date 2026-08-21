import type { CSSProperties } from "react";

import {
    clampSeatCount,
    formatNumber,
    formatSeatActionBubble,
    getAvatarLabel,
} from "./room-client-helpers";
import { getSeatMediaPlacement, type EquityTrend } from "./room-client-state";
import type { MediaParticipantState } from "./media-types";
import type { Card, LastHandResult, RoomPlayer, RoomSnapshot } from "./room-types";

const BOT_ACCOUNT_ID_PREFIX = "bot_";

export type HandMarkerSeats = {
    dealerSeat: number | null;
    smallBlindSeat: number | null;
    bigBlindSeat: number | null;
};

const TABLE_LAYOUTS: Record<number, ReadonlyArray<{ left: number; top: number }>> = {
    2: [
        { left: 50, top: 84 },
        { left: 50, top: 10 },
    ],
    3: [
        { left: 50, top: 84 },
        { left: 25, top: 16 },
        { left: 75, top: 16 },
    ],
    4: [
        { left: 50, top: 84 },
        { left: 16, top: 48 },
        { left: 50, top: 10 },
        { left: 84, top: 48 },
    ],
    5: [
        { left: 50, top: 84 },
        { left: 22, top: 66 },
        { left: 28, top: 16 },
        { left: 72, top: 16 },
        { left: 78, top: 66 },
    ],
    6: [
        { left: 50, top: 84 },
        { left: 26, top: 76 },
        { left: 16, top: 34 },
        { left: 50, top: 10 },
        { left: 84, top: 34 },
        { left: 74, top: 76 },
    ],
    7: [
        { left: 50, top: 84 },
        { left: 14, top: 52 },
        { left: 26, top: 16 },
        { left: 50, top: 8 },
        { left: 74, top: 16 },
        { left: 86, top: 52 },
        { left: 72, top: 78 },
    ],
    8: [
        { left: 50, top: 84 },
        { left: 28, top: 78 },
        { left: 14, top: 52 },
        { left: 24, top: 16 },
        { left: 50, top: 8 },
        { left: 76, top: 16 },
        { left: 86, top: 52 },
        { left: 72, top: 78 },
    ],
    9: [
        { left: 50, top: 84 },
        { left: 16, top: 62 },
        { left: 12, top: 34 },
        { left: 26, top: 14 },
        { left: 50, top: 8 },
        { left: 74, top: 14 },
        { left: 88, top: 34 },
        { left: 84, top: 62 },
        { left: 70, top: 78 },
    ],
    10: [
        { left: 50, top: 84 },
        { left: 30, top: 78 },
        { left: 16, top: 62 },
        { left: 12, top: 34 },
        { left: 26, top: 14 },
        { left: 50, top: 8 },
        { left: 74, top: 14 },
        { left: 88, top: 34 },
        { left: 84, top: 62 },
        { left: 70, top: 78 },
    ],
};

const PHONE_TABLE_LAYOUTS: Record<number, ReadonlyArray<{ left: number; top: number }>> = {
    2: [
        { left: 50, top: 88 },
        { left: 50, top: 12 },
    ],
    3: [
        { left: 50, top: 88 },
        { left: 28, top: 18 },
        { left: 72, top: 18 },
    ],
    4: [
        { left: 50, top: 88 },
        { left: 21, top: 51 },
        { left: 50, top: 14 },
        { left: 79, top: 51 },
    ],
    5: [
        { left: 50, top: 88 },
        { left: 20, top: 66 },
        { left: 33, top: 20 },
        { left: 67, top: 20 },
        { left: 80, top: 66 },
    ],
    6: [
        { left: 50, top: 88 },
        { left: 20, top: 68 },
        { left: 19, top: 34 },
        { left: 50, top: 14 },
        { left: 81, top: 34 },
        { left: 80, top: 68 },
    ],
    7: [
        { left: 50, top: 88 },
        { left: 21, top: 70 },
        { left: 20, top: 38 },
        { left: 35, top: 18 },
        { left: 65, top: 18 },
        { left: 80, top: 38 },
        { left: 79, top: 70 },
    ],
    8: [
        { left: 50, top: 88 },
        { left: 22, top: 73 },
        { left: 17, top: 50 },
        { left: 33, top: 20 },
        { left: 50, top: 13 },
        { left: 67, top: 20 },
        { left: 83, top: 50 },
        { left: 78, top: 73 },
    ],
    9: [
        { left: 50, top: 88 },
        { left: 22, top: 73 },
        { left: 16, top: 55 },
        { left: 20, top: 34 },
        { left: 34, top: 18 },
        { left: 66, top: 18 },
        { left: 80, top: 34 },
        { left: 84, top: 55 },
        { left: 78, top: 73 },
    ],
    10: [
        { left: 50, top: 88 },
        { left: 24, top: 75 },
        { left: 16, top: 62 },
        { left: 16, top: 42 },
        { left: 24, top: 26 },
        { left: 50, top: 12 },
        { left: 76, top: 26 },
        { left: 84, top: 42 },
        { left: 84, top: 62 },
        { left: 76, top: 75 },
    ],
};

interface SeatCardAdjustment {
    desktopX: number;
    desktopY: number;
    mobileX: number;
    mobileY: number;
}

const DEFAULT_SEAT_CARD_ADJUSTMENT: SeatCardAdjustment = {
    desktopX: 0,
    desktopY: 0,
    mobileX: 0,
    mobileY: 0,
};

const SEAT_CARD_ADJUSTMENTS: Record<string, SeatCardAdjustment> = {
    "12:34": { desktopX: 0, desktopY: 34, mobileX: 0, mobileY: 22 },
    "26:14": { desktopX: 56, desktopY: -26, mobileX: 36, mobileY: -18 },
    "30:78": { desktopX: 48, desktopY: 0, mobileX: 32, mobileY: 0 },
    "50:8": { desktopX: 0, desktopY: -34, mobileX: 0, mobileY: -22 },
    "74:14": { desktopX: -48, desktopY: -34, mobileX: -32, mobileY: -22 },
    "88:34": { desktopX: 0, desktopY: 26, mobileX: 0, mobileY: 18 },
};

export interface TableSeatView {
    seatIndex: number;
    style: CSSProperties;
    cardStyle: CSSProperties;
    player: RoomPlayer | null;
    isHero: boolean;
    isOpen: boolean;
    isActive: boolean;
    isFolded: boolean;
    isInactive: boolean;
    isWinner: boolean;
    name: string;
    stackLabel: string;
    statusLabel: string;
    stateTone: "active" | "ready" | "waiting" | "muted" | "warning" | "winner";
    avatarLabel: string;
    markers: Array<{ label: string; tone: "dealer" | "blind" | "admin" }>;
    actionBubble: string | null;
    contributionLabel: string | null;
    runItTwiceResponse: "yes" | "no" | null;
    cardCount: number;
    revealedCards: [Card | null, Card | null] | null;
    liveHoleCards: [Card, Card] | null;
    pendingRequest: { displayName: string; requestedStack: number } | null;
    handsWonCount: number;
    rebuyCount: number;
    runoutWinPercent: number | null;
    runoutEquityTrend: EquityTrend;
    isRunoutEquityLeader: boolean;
    mediaPlacement: "above" | "below" | "left" | "right";
    shiftCardsLeftMore: boolean;
    shiftCardsRightMore: boolean;
}

export interface CardSlot {
    card: Card | null;
    isFaceUp: boolean;
    backLabel: string;
}

export function buildTableSeats(
    snapshot: RoomSnapshot | null,
    heroSeatIndex?: number,
    accountId?: string,
    hideOpenSeats = false,
    options?: {
        suppressWinnerHighlights?: boolean;
        completedHandReveals?: Record<string, [Card | null, Card | null]> | null;
        markerSeats?: HandMarkerSeats;
        pendingRunoutWinners?: ReadonlyMap<string, LastHandResult["winners"][number]>;
        runoutHandLabelByAccount?: ReadonlyMap<string, string>;
        runoutWinPercentByAccount?: ReadonlyMap<string, number>;
        runoutEquityLeaderAccountIds?: ReadonlySet<string>;
        runoutEquityTrendByAccount?: ReadonlyMap<string, EquityTrend>;
    },
    usePhoneLayout = false,
): TableSeatView[] {
    const totalSeats = clampSeatCount(snapshot?.maxPlayers ?? 6);
    const layout = (usePhoneLayout ? PHONE_TABLE_LAYOUTS : TABLE_LAYOUTS)[totalSeats] ?? TABLE_LAYOUTS[totalSeats]!;
    const anchorSeat = typeof heroSeatIndex === "number" ? heroSeatIndex : 0;
    const seatOrder = Array.from({ length: totalSeats }, (_, index) => (anchorSeat + index) % totalSeats);
    const isArchivedSnapshot = snapshot?.status === "archived";
    const currentHand = snapshot?.currentHand ?? null;
    const completedHandParticipantAccountIds = currentHand || !snapshot?.lastCompletedHand
        ? new Set<string>()
        : new Set([
            ...snapshot.lastCompletedHand.actions.map((action) => action.actorAccountId),
            ...snapshot.lastCompletedHand.winners.map((winner) => winner.accountId),
            ...Object.keys(snapshot.lastCompletedHand.revealedHoleCards),
        ]);
    const completedHandReveals = options?.completedHandReveals ?? snapshot?.lastCompletedHand?.revealedHoleCards ?? null;
    const suppressWinnerHighlights = options?.suppressWinnerHighlights ?? false;
    const pendingRunoutWinners = options?.pendingRunoutWinners ?? new Map<string, LastHandResult["winners"][number]>();
    const runoutHandLabelByAccount = options?.runoutHandLabelByAccount ?? new Map<string, string>();
    const runoutWinPercentByAccount = options?.runoutWinPercentByAccount ?? new Map<string, number>();
    const runoutEquityLeaderAccountIds = options?.runoutEquityLeaderAccountIds ?? new Set<string>();
    const runoutEquityTrendByAccount = options?.runoutEquityTrendByAccount ?? new Map<string, EquityTrend>();

    const seats = seatOrder.map((seatIndex, displayIndex) => {
        const player = snapshot?.players.find((entry) => entry.seatIndex === seatIndex) ?? null;
        const position = layout[displayIndex] ?? layout[layout.length - 1]!;
        const cardAdjustment = getSeatCardAdjustment(position);
        const isHero = Boolean(player && accountId && player.accountId === accountId);
        const isFolded = Boolean(player && currentHand?.foldedAccountIds.includes(player.accountId));
        const isInHand = Boolean(player && currentHand?.playerCardCounts[player.accountId]);
        const isActive = Boolean(player && currentHand?.actorAccountId === player.accountId && !currentHand?.runItTwicePrompt);
        const pendingSeatRequest = !player && accountId
            ? snapshot?.pendingSeatRequests.find((request) => request.accountId === accountId && request.seatIndex === seatIndex) ?? null
            : null;
        const winningEntry = !currentHand && !suppressWinnerHighlights && player
            ? snapshot?.lastCompletedHand?.winners.find((winner) => winner.accountId === player.accountId) ?? null
            : null;
        const liveRunoutHandLabel = player ? runoutHandLabelByAccount.get(player.accountId) ?? null : null;
        const displayedStack = player ? getDisplayedPlayerStack(player, pendingRunoutWinners) : null;
        const totalHandsWon = player ? snapshot?.playerStats.handsWonByAccount[player.accountId] ?? 0 : 0;
        const revealedCards = player && (isArchivedSnapshot || !currentHand)
            ? completedHandReveals?.[player.accountId] ?? null
            : null;
        const isInactive = Boolean(player && (isArchivedSnapshot
            ? (currentHand ? (isFolded || !isInHand) : false)
            : (
                isFolded
                || player.isSittingOut
                || !player.isConnected
                || (currentHand ? !isInHand : !player.isReady)
            )));
        const statusLabel = !player
            ? pendingSeatRequest
                ? "Pending"
                : "Open seat"
            : liveRunoutHandLabel
                ? liveRunoutHandLabel
                : winningEntry
                    ? winningEntry.handLabel ?? "Winner"
                    : isFolded
                        ? "Folded"
                        : isActive
                            ? "Action"
                            : isArchivedSnapshot
                                ? ""
                                : player.isSittingOut
                                    ? "Sitting out"
                                    : !player.isConnected
                                        ? "Disconnected"
                                        : player.isReady
                                            ? "Ready"
                                            : "Seated";

        return {
            seatIndex,
            style: {
                left: `${position.left}%`,
                top: `${position.top}%`,
                zIndex: isActive ? 10 : isInHand ? 9 : isHero ? 8 : 3,
            },
            cardStyle: {
                ["--seat-card-adjust-x" as string]: `${cardAdjustment.desktopX}px`,
                ["--seat-card-adjust-y" as string]: `${cardAdjustment.desktopY}px`,
                ["--seat-card-adjust-x-mobile" as string]: `${cardAdjustment.mobileX}px`,
                ["--seat-card-adjust-y-mobile" as string]: `${cardAdjustment.mobileY}px`,
            },
            player,
            isHero,
            isOpen: player === null,
            isActive,
            isFolded,
            isInactive,
            isWinner: Boolean(winningEntry),
            name: player?.displayName ?? "Open",
            stackLabel: player ? formatNumber(displayedStack ?? player.stack) : "Waiting",
            statusLabel,
            stateTone: !player
                ? pendingSeatRequest
                    ? "warning"
                    : "muted"
                : winningEntry
                    ? "winner"
                    : isActive
                        ? "active"
                        : isFolded || (!isArchivedSnapshot && (player.isSittingOut || !player.isConnected))
                            ? "warning"
                            : !isArchivedSnapshot && player.isReady
                                ? "ready"
                                : "waiting",
            avatarLabel: player ? getAvatarLabel(player.displayName) : pendingSeatRequest ? getAvatarLabel(pendingSeatRequest.displayName) : "+",
            markers: buildSeatMarkers(snapshot, player, options?.markerSeats),
            actionBubble: player && currentHand
                ? formatSeatActionBubble(currentHand.actions, player.accountId, currentHand.street)
                : winningEntry
                    ? `🏆 Won ${formatNumber(winningEntry.amountWon)}`
                    : null,
            contributionLabel: player && currentHand && (currentHand.streetContributions[player.accountId] ?? 0) > 0
                ? formatNumber(currentHand.streetContributions[player.accountId] ?? 0)
                : null,
            runItTwiceResponse: player && currentHand?.runItTwicePrompt
                ? currentHand.runItTwicePrompt.responsesByAccountId[player.accountId] ?? null
                : null,
            cardCount: revealedCards
                ? 2
                : player && currentHand
                    ? currentHand.playerCardCounts[player.accountId] ?? 0
                    : player && !usePhoneLayout && completedHandParticipantAccountIds.has(player.accountId)
                        ? 2
                        : 0,
            revealedCards,
            liveHoleCards: isHero ? snapshot?.currentHand?.heroHoleCards ?? null : null,
            pendingRequest: pendingSeatRequest ? {
                displayName: pendingSeatRequest.displayName,
                requestedStack: pendingSeatRequest.requestedStack,
            } : null,
            handsWonCount: player ? getDisplayedHandsWonCount(player.accountId, totalHandsWon, pendingRunoutWinners) : 0,
            rebuyCount: player ? snapshot?.playerStats.rebuyCountByAccount[player.accountId] ?? 0 : 0,
            runoutWinPercent: player ? runoutWinPercentByAccount.get(player.accountId) ?? null : null,
            runoutEquityTrend: player ? runoutEquityTrendByAccount.get(player.accountId) ?? "steady" : "steady",
            isRunoutEquityLeader: Boolean(player && runoutEquityLeaderAccountIds.has(player.accountId)),
            mediaPlacement: getSeatMediaPlacement(position),
            shiftCardsLeftMore: false,
            shiftCardsRightMore: false,
        } satisfies TableSeatView;
    });

    const occupiedRightSeats = seats.filter((seat, displayIndex) => seat.player && (layout[displayIndex]?.left ?? 0) > 50);
    const firstCrowdedRightSeatIndex = occupiedRightSeats.length >= 2 ? occupiedRightSeats[0]?.seatIndex ?? null : null;
    const occupiedLeftSeats = seats.filter((seat, displayIndex) => seat.player && (layout[displayIndex]?.left ?? 0) < 50);
    const firstCrowdedLeftSeatIndex = occupiedLeftSeats.length >= 2 ? occupiedLeftSeats[occupiedLeftSeats.length - 1]?.seatIndex ?? null : null;

    const adjustedSeats = seats.map((seat) => ({
        ...seat,
        shiftCardsLeftMore: seat.seatIndex === firstCrowdedRightSeatIndex,
        shiftCardsRightMore: seat.seatIndex === firstCrowdedLeftSeatIndex,
    }));

    return hideOpenSeats ? adjustedSeats.filter((seat) => !seat.isOpen) : adjustedSeats;
}

export function buildPendingRunoutWinners(
    lastCompletedHand: LastHandResult | null,
    isRunoutActive: boolean,
): Map<string, LastHandResult["winners"][number]> {
    if (!isRunoutActive || !lastCompletedHand) {
        return new Map();
    }

    return new Map(lastCompletedHand.winners.map((winner) => [winner.accountId, winner]));
}

export function getDisplayedPlayerStack(
    player: RoomPlayer | null,
    pendingRunoutWinners: ReadonlyMap<string, LastHandResult["winners"][number]>,
): number | null {
    if (!player) {
        return null;
    }

    const pendingWinner = pendingRunoutWinners.get(player.accountId);
    return Math.max(0, player.stack - (pendingWinner?.amountWon ?? 0));
}

export function getDisplayedHandsWonCount(
    accountId: string,
    handsWonCount: number,
    pendingRunoutWinners: ReadonlyMap<string, LastHandResult["winners"][number]>,
): number {
    return Math.max(0, handsWonCount - (pendingRunoutWinners.has(accountId) ? 1 : 0));
}

function buildSeatMarkers(
    snapshot: RoomSnapshot | null,
    player: RoomPlayer | null,
    markerSeats?: HandMarkerSeats,
): Array<{ label: string; tone: "dealer" | "blind" | "admin" }> {
    if (!player) {
        return [];
    }

    const dealerSeat = snapshot?.currentHand?.dealerSeat ?? markerSeats?.dealerSeat ?? null;
    const smallBlindSeat = snapshot?.currentHand?.smallBlindSeat ?? markerSeats?.smallBlindSeat ?? null;
    const bigBlindSeat = snapshot?.currentHand?.bigBlindSeat ?? markerSeats?.bigBlindSeat ?? null;
    const markers: Array<{ label: string; tone: "dealer" | "blind" | "admin" }> = [];

    if (dealerSeat === player.seatIndex) {
        markers.push({ label: "D", tone: "dealer" });
    }

    if (smallBlindSeat === player.seatIndex) {
        markers.push({ label: "SB", tone: "blind" });
    }

    if (bigBlindSeat === player.seatIndex) {
        markers.push({ label: "BB", tone: "blind" });
    }

    if (isBotAccountId(player.accountId)) {
        markers.push({ label: "Bot", tone: "admin" });
    }

    if (player.accountId === snapshot?.adminAccountId) {
        markers.push({ label: "Admin", tone: "admin" });
    }

    return markers;
}

export function isBotAccountId(accountId: string): boolean {
    return accountId.startsWith(BOT_ACCOUNT_ID_PREFIX);
}

export function getAvailableBotSeatIndices(snapshot: RoomSnapshot): number[] {
    const occupiedSeats = new Set(snapshot.players.map((player) => player.seatIndex));
    const pendingSeats = new Set(snapshot.pendingSeatRequests.map((request) => request.seatIndex));

    return Array.from({ length: snapshot.maxPlayers }, (_, seatIndex) => seatIndex)
        .filter((seatIndex) => !occupiedSeats.has(seatIndex) && !pendingSeats.has(seatIndex));
}

export function getNextBotDisplayName(snapshot: RoomSnapshot): string {
    return `Bot ${snapshot.players.filter((player) => isBotAccountId(player.accountId)).length + 1}`;
}

export function buildBoardSlots(cards: Card[]): CardSlot[] {
    return Array.from({ length: 5 }, (_, index) => ({
        card: cards[index] ?? null,
        isFaceUp: Boolean(cards[index]),
        backLabel: index < 3 ? "Flop" : index === 3 ? "Turn" : "River",
    }));
}

export function buildSeatCardSlots(seat: TableSeatView): CardSlot[] {
    if (seat.liveHoleCards) {
        return seat.liveHoleCards.map((card) => ({
            card,
            isFaceUp: true,
            backLabel: "Deal",
        }));
    }

    if (seat.revealedCards) {
        return seat.revealedCards.map((card) => ({
            card,
            isFaceUp: Boolean(card),
            backLabel: "Reveal",
        }));
    }

    return Array.from({ length: Math.min(2, seat.cardCount) }, () => ({
        card: null,
        isFaceUp: false,
        backLabel: "",
    }));
}

export function buildMediaParticipantsByAccountId(participants: MediaParticipantState[]): Map<string, MediaParticipantState[]> {
    return participants.reduce((map, participant) => {
        if (!participant.accountId) {
            return map;
        }

        const existing = map.get(participant.accountId) ?? [];
        existing.push(participant);
        map.set(participant.accountId, existing);
        return map;
    }, new Map<string, MediaParticipantState[]>());
}

export function pickSeatMediaParticipant(participants: MediaParticipantState[], preferLocal: boolean): MediaParticipantState | null {
    if (participants.length === 0) {
        return null;
    }

    if (preferLocal) {
        return participants.find((participant) => participant.isLocal && participant.cameraEnabled)
            ?? participants.find((participant) => !participant.isLocal && participant.cameraEnabled)
            ?? participants.find((participant) => participant.isLocal)
            ?? participants.find((participant) => !participant.isLocal)
            ?? null;
    }

    return participants.find((participant) => !participant.isLocal && participant.cameraEnabled)
        ?? participants.find((participant) => !participant.isLocal)
        ?? participants.find((participant) => participant.isLocal && participant.cameraEnabled)
        ?? participants.find((participant) => participant.isLocal)
        ?? null;
}

function getSeatCardAdjustment(position: { left: number; top: number }): SeatCardAdjustment {
    return SEAT_CARD_ADJUSTMENTS[`${position.left}:${position.top}`] ?? DEFAULT_SEAT_CARD_ADJUSTMENT;
}
