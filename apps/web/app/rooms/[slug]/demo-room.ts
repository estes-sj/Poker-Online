import type { Card, HandActionRecord, LastHandResult, RoomSnapshot } from "./room-types";
import type { MediaParticipantState } from "./media-types";

const DEMO_ROOM_SLUGS = new Set(["sample-table", "sample-room", "demo-table"]);
const DEMO_HERO_ACCOUNT_ID = "sample-seat-1";

interface DemoSeatProfile {
    accountId: string;
    displayName: string;
    seatIndex: number;
    stack: number;
    buyInTotal: number;
    handsWon: number;
    rebuys: number;
    gesture: string;
    reaction: string | null;
    cards: [Card, Card];
    microphoneEnabled: boolean;
    isSpeaking: boolean;
    palette: [string, string];
    accent: string;
    surfaceLabel: string;
    surfaceMood: string;
}

interface DemoRoomPreset {
    snapshot: RoomSnapshot;
    initialAccountId: string;
    demoMediaParticipants: MediaParticipantState[];
}

const DEMO_SEAT_PROFILES: DemoSeatProfile[] = [
    {
        accountId: "sample-seat-1",
        displayName: "Sam",
        seatIndex: 0,
        stack: 12300,
        buyInTotal: 10000,
        handsWon: 7,
        rebuys: 1,
        gesture: "😎",
        reaction: "👏",
        cards: [card("A", "spades"), card("Q", "spades")],
        microphoneEnabled: true,
        isSpeaking: false,
        palette: ["#124d67", "#07151f"],
        accent: "#7fd8ff",
        surfaceLabel: "Owner cam",
        surfaceMood: "Monitoring the table",
    },
    {
        accountId: "sample-seat-2",
        displayName: "Jules",
        seatIndex: 1,
        stack: 8400,
        buyInTotal: 10000,
        handsWon: 4,
        rebuys: 2,
        gesture: "🍀",
        reaction: null,
        cards: [card("K", "clubs"), card("J", "clubs")],
        microphoneEnabled: true,
        isSpeaking: true,
        palette: ["#6a3221", "#1d0a08"],
        accent: "#ffb36a",
        surfaceLabel: "Table talk",
        surfaceMood: "Lobby energy on",
    },
    {
        accountId: "sample-seat-3",
        displayName: "Nina",
        seatIndex: 2,
        stack: 5100,
        buyInTotal: 7000,
        handsWon: 3,
        rebuys: 1,
        gesture: "🫡",
        reaction: "🔥",
        cards: [card("10", "diamonds"), card("10", "clubs")],
        microphoneEnabled: false,
        isSpeaking: false,
        palette: ["#5a2358", "#180614"],
        accent: "#f199ff",
        surfaceLabel: "Locked in",
        surfaceMood: "Mic muted, camera on",
    },
    {
        accountId: "sample-seat-4",
        displayName: "Omar",
        seatIndex: 3,
        stack: 16750,
        buyInTotal: 12000,
        handsWon: 8,
        rebuys: 1,
        gesture: "🧠",
        reaction: "😮",
        cards: [card("A", "hearts"), card("9", "hearts")],
        microphoneEnabled: true,
        isSpeaking: true,
        palette: ["#1e5c48", "#071611"],
        accent: "#87f2c1",
        surfaceLabel: "Big stack",
        surfaceMood: "Talking through ranges",
    },
    {
        accountId: "sample-seat-5",
        displayName: "Priya",
        seatIndex: 4,
        stack: 21100,
        buyInTotal: 15000,
        handsWon: 9,
        rebuys: 2,
        gesture: "👑",
        reaction: "💀",
        cards: [card("K", "hearts"), card("8", "hearts")],
        microphoneEnabled: true,
        isSpeaking: false,
        palette: ["#6d4e14", "#1d1204"],
        accent: "#ffd166",
        surfaceLabel: "Winner cam",
        surfaceMood: "Still stacking chips",
    },
    {
        accountId: "sample-seat-6",
        displayName: "Rex",
        seatIndex: 5,
        stack: 3900,
        buyInTotal: 9000,
        handsWon: 2,
        rebuys: 3,
        gesture: "🤠",
        reaction: null,
        cards: [card("7", "spades"), card("7", "diamonds")],
        microphoneEnabled: false,
        isSpeaking: false,
        palette: ["#32527b", "#09111c"],
        accent: "#8db8ff",
        surfaceLabel: "Short stack",
        surfaceMood: "Hunting a double",
    },
    {
        accountId: "sample-seat-7",
        displayName: "Talia",
        seatIndex: 6,
        stack: 9800,
        buyInTotal: 10000,
        handsWon: 5,
        rebuys: 0,
        gesture: "🎯",
        reaction: "😂",
        cards: [card("Q", "diamonds"), card("J", "diamonds")],
        microphoneEnabled: true,
        isSpeaking: false,
        palette: ["#7b283d", "#1c070d"],
        accent: "#ff8eaa",
        surfaceLabel: "Dialed in",
        surfaceMood: "Rail-chatting between hands",
    },
    {
        accountId: "sample-seat-8",
        displayName: "Wes",
        seatIndex: 7,
        stack: 6200,
        buyInTotal: 8000,
        handsWon: 3,
        rebuys: 1,
        gesture: "🦈",
        reaction: null,
        cards: [card("A", "clubs"), card("5", "clubs")],
        microphoneEnabled: true,
        isSpeaking: true,
        palette: ["#225668", "#06141b"],
        accent: "#6ae2ff",
        surfaceLabel: "Side chat",
        surfaceMood: "Debating the river",
    },
    {
        accountId: "sample-seat-9",
        displayName: "Mira",
        seatIndex: 8,
        stack: 14400,
        buyInTotal: 11000,
        handsWon: 6,
        rebuys: 1,
        gesture: "🌙",
        reaction: "👏",
        cards: [card("9", "clubs"), card("9", "spades")],
        microphoneEnabled: false,
        isSpeaking: false,
        palette: ["#4b396e", "#110c1a"],
        accent: "#b69cff",
        surfaceLabel: "Night grind",
        surfaceMood: "Watching every showdown",
    },
    {
        accountId: "sample-seat-10",
        displayName: "Leo",
        seatIndex: 9,
        stack: 7600,
        buyInTotal: 10000,
        handsWon: 4,
        rebuys: 2,
        gesture: "🐉",
        reaction: "🔥",
        cards: [card("A", "diamonds"), card("4", "diamonds")],
        microphoneEnabled: true,
        isSpeaking: false,
        palette: ["#7a3b24", "#1c0906"],
        accent: "#ff9a6a",
        surfaceLabel: "Late position",
        surfaceMood: "Still talking after the river",
    },
];

export function buildDemoRoomPreset(slug: string): DemoRoomPreset | null {
    if (!DEMO_ROOM_SLUGS.has(slug)) {
        return null;
    }

    const nowMs = Date.now();
    const snapshotAt = timestamp(nowMs);
    const lastCompletedHand = buildLatestHand(nowMs);

    return {
        initialAccountId: DEMO_HERO_ACCOUNT_ID,
        demoMediaParticipants: DEMO_SEAT_PROFILES.map((profile) => ({
            identity: profile.accountId,
            name: profile.displayName,
            isLocal: profile.accountId === DEMO_HERO_ACCOUNT_ID,
            isSpeaking: profile.isSpeaking,
            videoPublication: null,
            audioPublication: null,
            cameraEnabled: true,
            microphoneEnabled: profile.microphoneEnabled,
            demoSurface: {
                palette: profile.palette,
                accent: profile.accent,
                label: profile.surfaceLabel,
                mood: profile.surfaceMood,
            },
        })),
        snapshot: {
            roomId: `demo-${slug}`,
            slug,
            name: "Busy Sample Table",
            adminAccountId: DEMO_HERO_ACCOUNT_ID,
            visibility: "private",
            status: "active",
            passwordProtected: false,
            viewerHasRoomAccess: true,
            maxPlayers: 10,
            startingStack: 5000,
            autoStartNextHand: true,
            autoStartDelaySeconds: 10,
            blindState: {
                schedule: [
                    { level: 1, smallBlind: 50, bigBlind: 100, ante: 0, durationMinutes: 20 },
                    { level: 2, smallBlind: 100, bigBlind: 200, ante: 25, durationMinutes: 20 },
                    { level: 3, smallBlind: 150, bigBlind: 300, ante: 50, durationMinutes: 20 },
                    { level: 4, smallBlind: 200, bigBlind: 400, ante: 50, durationMinutes: 20 },
                    { level: 5, smallBlind: 300, bigBlind: 600, ante: 75, durationMinutes: 20 },
                ],
                sessionStartedAt: timestamp(nowMs - 2 * 60 * 60_000),
                currentLevel: { level: 4, smallBlind: 200, bigBlind: 400, ante: 50, durationMinutes: 20 },
                nextLevel: { level: 5, smallBlind: 300, bigBlind: 600, ante: 75, durationMinutes: 20 },
                nextLevelInMs: 8 * 60_000,
                snapshotAt,
                pausedAt: null,
            },
            adminOptions: {
                decisionTimeSeconds: 25,
                timeBankSeconds: 90,
                timeBankRefillHands: 8,
                revealAllShowdownHands: true,
            },
            nextHandStartsAt: null,
            handCount: 48,
            players: DEMO_SEAT_PROFILES.map((profile) => ({
                accountId: profile.accountId,
                displayName: profile.displayName,
                seatIndex: profile.seatIndex,
                stack: profile.stack,
                isReady: true,
                isConnected: true,
                isSittingOut: false,
            })),
            chatMessages: [
                {
                    id: "sample-chat-1",
                    accountId: "sample-seat-7",
                    displayName: "Talia",
                    content: "That river got loud fast.",
                    createdAt: timestamp(nowMs - 95_000),
                },
                {
                    id: "sample-chat-2",
                    accountId: "sample-seat-4",
                    displayName: "Omar",
                    content: "Omar had the ace of hearts the whole way.",
                    createdAt: timestamp(nowMs - 70_000),
                },
                {
                    id: "sample-chat-3",
                    accountId: "sample-seat-1",
                    displayName: "Sam",
                    content: "Next hand in ten if everyone is good.",
                    createdAt: timestamp(nowMs - 42_000),
                },
                {
                    id: "sample-chat-4",
                    accountId: "sample-seat-2",
                    displayName: "Jules",
                    content: "Clip that showdown.",
                    createdAt: timestamp(nowMs - 18_000),
                },
            ],
            seatReactions: DEMO_SEAT_PROFILES.filter((profile) => profile.reaction !== null).map((profile, index) => ({
                id: `sample-reaction-${index + 1}`,
                accountId: profile.accountId,
                emoji: profile.reaction ?? "",
                createdAt: timestamp(nowMs - (index + 1) * 3_000),
                expiresAt: timestamp(nowMs + 90_000 - index * 4_000),
            })),
            seatGestures: DEMO_SEAT_PROFILES.map((profile) => ({
                accountId: profile.accountId,
                emoji: profile.gesture,
                updatedAt: timestamp(nowMs - (profile.seatIndex + 2) * 60_000),
            })),
            buyInState: {
                minRebuyAmount: 1000,
                maxRebuyAmount: 15000,
                buyInTotalByAccount: Object.fromEntries(DEMO_SEAT_PROFILES.map((profile) => [profile.accountId, profile.buyInTotal])),
            },
            ledgerState: {
                displayNameByAccount: Object.fromEntries(DEMO_SEAT_PROFILES.map((profile) => [profile.accountId, profile.displayName])),
                buyOutByAccount: {},
            },
            playerStats: {
                handsWonByAccount: Object.fromEntries(DEMO_SEAT_PROFILES.map((profile) => [profile.accountId, profile.handsWon])),
                rebuyCountByAccount: Object.fromEntries(DEMO_SEAT_PROFILES.map((profile) => [profile.accountId, profile.rebuys])),
            },
            turnState: {
                turnSeconds: 25,
                timeBankSeconds: 90,
                currentTurnStartedAt: null,
                timeBankMsByAccount: Object.fromEntries(DEMO_SEAT_PROFILES.map((profile) => [profile.accountId, Math.max(20_000, 90_000 - profile.seatIndex * 5_500)])),
            },
            pendingSeatRequests: [],
            pendingRebuyRequests: [],
            currentHand: null,
            lastCompletedHand,
            recentCompletedHands: [
                lastCompletedHand,
                buildPreviousFoldHand(nowMs - 4 * 60_000),
                buildPreviousShowdownHand(nowMs - 10 * 60_000),
            ],
            lastCompletedHandRevealState: null,
        },
    };
}

function buildLatestHand(nowMs: number): LastHandResult {
    const concludedAtMs = nowMs - 1_200;

    return {
        handId: "sample-hand-48",
        handNumber: 48,
        board: [
            card("2", "hearts"),
            card("J", "hearts"),
            card("Q", "clubs"),
            card("4", "hearts"),
            card("9", "hearts"),
        ],
        totalPot: 7800,
        winningReason: "showdown",
        concludedAt: timestamp(concludedAtMs),
        actions: [
            makeAction(1, "sample-seat-1", 0, "post_ante", "preflop", 50, 50, concludedAtMs - 60_000),
            makeAction(2, "sample-seat-2", 1, "post_ante", "preflop", 50, 50, concludedAtMs - 59_000),
            makeAction(3, "sample-seat-3", 2, "post_ante", "preflop", 50, 50, concludedAtMs - 58_000),
            makeAction(4, "sample-seat-4", 3, "post_ante", "preflop", 50, 50, concludedAtMs - 57_000),
            makeAction(5, "sample-seat-5", 4, "post_ante", "preflop", 50, 50, concludedAtMs - 56_000),
            makeAction(6, "sample-seat-6", 5, "post_ante", "preflop", 50, 50, concludedAtMs - 55_000),
            makeAction(7, "sample-seat-7", 6, "post_ante", "preflop", 50, 50, concludedAtMs - 54_000),
            makeAction(8, "sample-seat-8", 7, "post_ante", "preflop", 50, 50, concludedAtMs - 53_000),
            makeAction(9, "sample-seat-9", 8, "post_ante", "preflop", 50, 50, concludedAtMs - 52_000),
            makeAction(10, "sample-seat-10", 9, "post_ante", "preflop", 50, 50, concludedAtMs - 51_000),
            makeAction(11, "sample-seat-1", 0, "post_small_blind", "preflop", 200, 200, concludedAtMs - 47_000),
            makeAction(12, "sample-seat-2", 1, "post_big_blind", "preflop", 400, 400, concludedAtMs - 45_000),
            makeAction(13, "sample-seat-3", 2, "call", "preflop", 400, 400, concludedAtMs - 42_000),
            makeAction(14, "sample-seat-4", 3, "call", "preflop", 400, 400, concludedAtMs - 39_000),
            makeAction(15, "sample-seat-5", 4, "raise", "preflop", 1200, 1200, concludedAtMs - 35_000),
            makeAction(16, "sample-seat-6", 5, "fold", "preflop", 0, 0, concludedAtMs - 33_000),
            makeAction(17, "sample-seat-7", 6, "fold", "preflop", 0, 0, concludedAtMs - 31_000),
            makeAction(18, "sample-seat-8", 7, "call", "preflop", 1200, 1200, concludedAtMs - 29_000),
            makeAction(19, "sample-seat-9", 8, "fold", "preflop", 0, 0, concludedAtMs - 27_000),
            makeAction(20, "sample-seat-10", 9, "call", "preflop", 1200, 1200, concludedAtMs - 25_000),
            makeAction(21, "sample-seat-1", 0, "fold", "preflop", 0, 0, concludedAtMs - 23_000),
            makeAction(22, "sample-seat-2", 1, "fold", "preflop", 0, 0, concludedAtMs - 21_000),
            makeAction(23, "sample-seat-3", 2, "call", "preflop", 800, 1200, concludedAtMs - 19_000),
            makeAction(24, "sample-seat-4", 3, "call", "preflop", 800, 1200, concludedAtMs - 17_000),
            makeAction(25, "sample-seat-3", 2, "check", "flop", 0, 1200, concludedAtMs - 14_000),
            makeAction(26, "sample-seat-4", 3, "all_in", "flop", 1800, 1800, concludedAtMs - 12_000),
            makeAction(27, "sample-seat-5", 4, "call", "flop", 1800, 1800, concludedAtMs - 10_000),
            makeAction(28, "sample-seat-8", 7, "fold", "flop", 0, 0, concludedAtMs - 8_000),
            makeAction(29, "sample-seat-10", 9, "fold", "flop", 0, 0, concludedAtMs - 7_000),
            makeAction(30, "sample-seat-3", 2, "fold", "flop", 0, 0, concludedAtMs - 4_000),
        ],
        winners: [
            {
                accountId: "sample-seat-4",
                seatIndex: 3,
                amountWon: 7800,
                netChips: 3200,
                finalStack: 16750,
                handLabel: "Ace-high flush",
            },
        ],
        revealedHoleCards: {
            "sample-seat-4": [card("A", "hearts"), card("9", "hearts")],
            "sample-seat-5": [card("K", "hearts"), card("8", "hearts")],
        },
        allInRunout: {
            startBoardCount: 3,
            revealIntervalMs: 2000,
            revealedAccountIds: ["sample-seat-4", "sample-seat-5"],
        },
    };
}

function buildPreviousFoldHand(nowMs: number): LastHandResult {
    return {
        handId: "sample-hand-47",
        handNumber: 47,
        board: [card("K", "spades"), card("9", "diamonds"), card("4", "clubs")],
        totalPot: 2100,
        winningReason: "fold",
        concludedAt: timestamp(nowMs),
        actions: [
            makeAction(1, "sample-seat-8", 7, "post_small_blind", "preflop", 200, 200, nowMs - 18_000),
            makeAction(2, "sample-seat-9", 8, "post_big_blind", "preflop", 400, 400, nowMs - 17_000),
            makeAction(3, "sample-seat-1", 0, "raise", "preflop", 1100, 1100, nowMs - 13_000),
            makeAction(4, "sample-seat-8", 7, "fold", "preflop", 0, 0, nowMs - 11_000),
            makeAction(5, "sample-seat-9", 8, "fold", "preflop", 0, 0, nowMs - 10_000),
        ],
        winners: [
            {
                accountId: "sample-seat-1",
                seatIndex: 0,
                amountWon: 2100,
                netChips: 900,
                finalStack: 12300,
                handLabel: "Won preflop",
            },
        ],
        revealedHoleCards: {
            "sample-seat-1": [card("A", "clubs"), card("K", "spades")],
        },
        allInRunout: null,
    };
}

function buildPreviousShowdownHand(nowMs: number): LastHandResult {
    return {
        handId: "sample-hand-46",
        handNumber: 46,
        board: [card("Q", "hearts"), card("Q", "spades"), card("8", "clubs"), card("8", "diamonds"), card("2", "clubs")],
        totalPot: 5600,
        winningReason: "showdown",
        concludedAt: timestamp(nowMs),
        actions: [
            makeAction(1, "sample-seat-4", 3, "post_small_blind", "preflop", 200, 200, nowMs - 16_000),
            makeAction(2, "sample-seat-5", 4, "post_big_blind", "preflop", 400, 400, nowMs - 15_000),
            makeAction(3, "sample-seat-6", 5, "call", "preflop", 400, 400, nowMs - 13_000),
            makeAction(4, "sample-seat-4", 3, "call", "preflop", 200, 400, nowMs - 11_000),
            makeAction(5, "sample-seat-5", 4, "check", "flop", 0, 400, nowMs - 9_000),
            makeAction(6, "sample-seat-6", 5, "bet", "turn", 1200, 1200, nowMs - 6_000),
            makeAction(7, "sample-seat-4", 3, "call", "turn", 1200, 1200, nowMs - 4_000),
            makeAction(8, "sample-seat-5", 4, "fold", "turn", 0, 0, nowMs - 3_000),
        ],
        winners: [
            {
                accountId: "sample-seat-6",
                seatIndex: 5,
                amountWon: 5600,
                netChips: 1400,
                finalStack: 3900,
                handLabel: "Queens and eights",
            },
        ],
        revealedHoleCards: {
            "sample-seat-4": [card("Q", "diamonds"), card("10", "hearts")],
            "sample-seat-6": [card("8", "spades"), card("6", "spades")],
        },
        allInRunout: null,
    };
}

function makeAction(
    orderIndex: number,
    actorAccountId: string,
    actorSeat: number,
    type: HandActionRecord["type"],
    street: HandActionRecord["street"],
    amount: number,
    betTo: number,
    createdAtMs: number,
): HandActionRecord {
    return {
        orderIndex,
        actorAccountId,
        actorSeat,
        type,
        street,
        amount,
        betTo,
        createdAt: timestamp(createdAtMs),
    };
}

function card(rank: string, suit: Card["suit"]): Card {
    return { rank, suit };
}

function timestamp(valueMs: number): string {
    return new Date(valueMs).toISOString();
}