"use client";

import emojiData from "@emoji-mart/data";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";

import { HOUSE_RULES_CONFIG } from "../../lib/house-rules-config";
import { buildBrowserHttpUrl, buildBrowserWsUrl, getBrowserGameHttpBaseUrl, getBrowserGameWsBaseUrl } from "../../lib/public-service-urls";
import { compareEvaluatedHands, evaluateHoldemHand, getCurrentHeroHandLabel } from "./hand-evaluator";
import type { MediaParticipantState } from "./media-types";
import { useTableSoundEffects } from "./table-sound-effects";
import { MediaAudioRack, ParticipantCameraSurface, useTableMedia } from "./table-media";
import type { Card, HandActionRecord, HeroActionState, LastHandResult, RevealMode, RoomPlayer, RoomSnapshot, SessionState } from "./room-types";

const STORAGE_KEY = "river-club-session";
const MOBILE_LAYOUT_MEDIA_QUERY = "(max-width: 720px)";
const MOBILE_LAYOUT_RECOMMENDATION_STORAGE_KEY = "river-club-mobile-layout-recommendation-dismissed";
const ACTION_PAD_VIEWPORT_MARGIN = 16;
const ACTION_PAD_TOP_MARGIN = 96;
const QUICK_REACTIONS = ["👏", "🔥", "😂", "😮", "💀"] as const;
const EmojiPicker = dynamic(() => import("@emoji-mart/react"), { ssr: false });
const ENGINE_EXPLAINER_SECTIONS = [
    {
        title: "Deal and board model",
        copy: "This table runs no-limit Texas Hold'em. Each player gets 2 private hole cards, then the engine reveals a 5-card board in flop, turn, and river order with burn cards before each street.",
    },
    {
        title: "How a hand is scored",
        copy: "At showdown, the engine combines each player's 2 hole cards with the 5 board cards and evaluates every 5-card combination available from those 7 cards. That means it checks all 21 possible 5-card hands and keeps the strongest one.",
    },
    {
        title: "Randomness and dealing code",
        copy: "When a hand starts, the server builds a fresh 52-card deck and shuffles it with a Fisher-Yates pass. In live play the domain engine uses its default random source, which is currently Math.random, and the test suite can inject a fixed random callback or a full deck so results stay deterministic while the logic is being verified.",
    },
    {
        title: "How ties are broken",
        copy: "Hands are compared by category first, then by ordered rank tiebreakers. Ace can play high or low for the wheel straight A-2-3-4-5. Suits never break ties except when they matter to make a flush in the first place.",
    },
    {
        title: "Who is authoritative",
        copy: "The server decides blinds, turn order, legal actions, hand resolution, side pots, and winners. The browser only renders the current snapshot and mirrors the same ranking logic for display labels.",
    },
] as const;
const ENGINE_HAND_RANKS = [
    "Straight flush",
    "Four of a kind",
    "Full house",
    "Flush",
    "Straight",
    "Three of a kind",
    "Two pair",
    "One pair",
    "High card",
] as const;
const RUNOUT_EQUITY_TRANSITION_MS = 360;
const RUNOUT_EQUITY_EXACT_COMBINATION_LIMIT = 20_000;
const RUNOUT_EQUITY_SAMPLE_COUNT = 5_000;
const RUNOUT_EQUITY_DECK_RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"] as const;
const RUNOUT_EQUITY_DECK_SUITS: Card["suit"][] = ["clubs", "diamonds", "hearts", "spades"];

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
        { left: 14, top: 52 },
        { left: 28, top: 78 },
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
        { left: 16, top: 62 },
        { left: 30, top: 78 },
        { left: 12, top: 34 },
        { left: 26, top: 14 },
        { left: 50, top: 8 },
        { left: 74, top: 14 },
        { left: 88, top: 34 },
        { left: 84, top: 62 },
        { left: 70, top: 78 },
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

interface RoomClientProps {
    slug: string;
    initialSnapshot: RoomSnapshot | null;
    initialAccountId?: string;
    demoMode?: boolean;
    demoMediaParticipants?: MediaParticipantState[];
}

type ConnectionState = "connecting" | "live" | "disconnected" | "reconnecting" | "demo";
type EquityTrend = "steady" | "up" | "down";

interface AllInRunoutView {
    isActive: boolean;
    visibleBoard: Card[];
    revealedAccountIds: string[];
}

interface RunoutEquitySnapshot {
    percentByAccount: Map<string, number>;
    leaderAccountIds: Set<string>;
}

interface RunoutEquityViewState extends RunoutEquitySnapshot {
    trendByAccount: Map<string, EquityTrend>;
}

interface TableSeatView {
    seatIndex: number;
    style: CSSProperties;
    cardStyle: CSSProperties;
    player: RoomPlayer | null;
    isHero: boolean;
    isOpen: boolean;
    isActive: boolean;
    isFolded: boolean;
    isWinner: boolean;
    name: string;
    stackLabel: string;
    statusLabel: string;
    stateTone: "active" | "ready" | "waiting" | "muted" | "warning" | "winner";
    avatarLabel: string;
    markers: Array<{ label: string; tone: "dealer" | "blind" | "admin" }>;
    actionBubble: string | null;
    contributionLabel: string | null;
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

interface SessionLedgerRow {
    accountId: string;
    displayName: string;
    buyIn: number;
    buyOut: number;
    stack: number;
    wins: number;
    rebuys: number;
    net: number;
}

interface BlindLevelDraft {
    smallBlind: string;
    bigBlind: string;
    ante: string;
    durationMinutes: string;
}

interface BlindLevelDraftValidation {
    smallBlind?: string;
    bigBlind?: string;
    ante?: string;
    durationMinutes?: string;
}

interface SeatRequestPromptState {
    seatIndex: number;
    requestedStack: string;
}

interface RequestNoticeModalState {
    title: string;
    message: string;
}

interface AdminApprovalQueueEntry {
    kind: "seat" | "rebuy";
    requestId: string;
}

interface AdminOptionsDraft {
    useBlindSchedule: boolean;
    smallBlind: string;
    bigBlind: string;
    ante: string;
    blindLevels: BlindLevelDraft[];
    autoStartNextHand: boolean;
    showdownPresentationSeconds: string;
    decisionTimeSeconds: string;
    timeBankSeconds: string;
    timeBankRefillHands: string;
    revealAllShowdownHands: boolean;
}

interface ActionPadOffset {
    x: number;
    y: number;
}

interface ActionPadDragState {
    pointerId: number;
    lastClientX: number;
    lastClientY: number;
}

const DEFAULT_ACTION_PAD_OFFSET: ActionPadOffset = {
    x: 0,
    y: 0,
};

export function RoomClient({
    slug,
    initialSnapshot,
    initialAccountId,
    demoMode = false,
    demoMediaParticipants = [],
}: RoomClientProps) {
    const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(initialSnapshot);
    const [session, setSession] = useState<SessionState | null>(null);
    const [accountId, setAccountId] = useState<string | undefined>(initialAccountId);
    const [displayName, setDisplayName] = useState("");
    const [roomPassword, setRoomPassword] = useState("");
    const [raiseTarget, setRaiseTarget] = useState("");
    const [connectionState, setConnectionState] = useState<ConnectionState>(demoMode ? "demo" : "connecting");
    const [actionError, setActionError] = useState<string | null>(null);
    const [inviteFeedback, setInviteFeedback] = useState<string | null>(null);
    const [isMutating, setIsMutating] = useState(false);
    const [nextHandCountdown, setNextHandCountdown] = useState<string | null>(null);
    const [chatDraft, setChatDraft] = useState("");
    const [openMenuPanel, setOpenMenuPanel] = useState<null | "invite" | "seat" | "media" | "rebuy" | "admin">(null);
    const [isReactionMenuOpen, setIsReactionMenuOpen] = useState(false);
    const [isSessionLedgerOpen, setIsSessionLedgerOpen] = useState(false);
    const [isEngineInfoOpen, setIsEngineInfoOpen] = useState(false);
    const [isHouseRulesOpen, setIsHouseRulesOpen] = useState(false);
    const [isPhoneViewport, setIsPhoneViewport] = useState(false);
    const [isMobileRecommendationOpen, setIsMobileRecommendationOpen] = useState(false);
    const [isMobileActionMenuOpen, setIsMobileActionMenuOpen] = useState(false);
    const [gestureInput, setGestureInput] = useState("");
    const [seatRequestStack, setSeatRequestStack] = useState("");
    const [rebuyAmount, setRebuyAmount] = useState("");
    const [preselectedHeroAction, setPreselectedHeroAction] = useState<null | "check_or_fold">(null);
    const [seatRequestPrompt, setSeatRequestPrompt] = useState<SeatRequestPromptState | null>(null);
    const [requestNoticeModal, setRequestNoticeModal] = useState<RequestNoticeModalState | null>(null);
    const [seatApprovalDrafts, setSeatApprovalDrafts] = useState<Record<string, string>>({});
    const [rebuyApprovalDrafts, setRebuyApprovalDrafts] = useState<Record<string, string>>({});
    const [adminApprovalQueue, setAdminApprovalQueue] = useState<AdminApprovalQueueEntry[]>([]);
    const [adminOptionsDraft, setAdminOptionsDraft] = useState<AdminOptionsDraft>(createEmptyAdminOptionsDraft);
    const [selectedLedgerHandId, setSelectedLedgerHandId] = useState<string | null>(null);
    const [turnClockNow, setTurnClockNow] = useState(() => getSnapshotClockMs(initialSnapshot));
    const [runoutEquityState, setRunoutEquityState] = useState<RunoutEquityViewState>(createEmptyRunoutEquityViewState);
    const [actionPadOffset, setActionPadOffset] = useState<ActionPadOffset>(DEFAULT_ACTION_PAD_OFFSET);
    const [isActionPadDragging, setIsActionPadDragging] = useState(false);
    const reconnectTimerRef = useRef<number | null>(null);
    const socketRef = useRef<WebSocket | null>(null);
    const chatInputRef = useRef<HTMLInputElement | null>(null);
    const actionPadRef = useRef<HTMLElement | null>(null);
    const actionPadDragStateRef = useRef<ActionPadDragState | null>(null);
    const autoActionRef = useRef<string | null>(null);
    const adminApprovalSeenRef = useRef<Set<string>>(new Set());
    const runoutEquitySnapshotRef = useRef<RunoutEquitySnapshot | null>(null);
    const runoutEquityTrendResetTimerRef = useRef<number | null>(null);
    const isAdmin = Boolean(!demoMode && snapshot && accountId === snapshot.adminAccountId);

    function stopActionPadDrag(pointerId?: number) {
        const dragState = actionPadDragStateRef.current;

        if (!dragState || typeof window === "undefined") {
            return;
        }

        if (pointerId !== undefined && dragState.pointerId !== pointerId) {
            return;
        }

        window.removeEventListener("pointermove", handleActionPadPointerMove);
        window.removeEventListener("pointerup", handleActionPadPointerEnd);
        window.removeEventListener("pointercancel", handleActionPadPointerEnd);
        actionPadDragStateRef.current = null;
        setIsActionPadDragging(false);
    }

    function handleActionPadPointerMove(event: PointerEvent) {
        const dragState = actionPadDragStateRef.current;
        const actionPad = actionPadRef.current;

        if (!dragState || dragState.pointerId !== event.pointerId || !actionPad || typeof window === "undefined") {
            return;
        }

        const rect = actionPad.getBoundingClientRect();
        const deltaX = event.clientX - dragState.lastClientX;
        const deltaY = event.clientY - dragState.lastClientY;
        const minLeft = ACTION_PAD_VIEWPORT_MARGIN;
        const maxLeft = Math.max(minLeft, window.innerWidth - rect.width - ACTION_PAD_VIEWPORT_MARGIN);
        const minTop = ACTION_PAD_TOP_MARGIN;
        const maxTop = Math.max(minTop, window.innerHeight - rect.height - ACTION_PAD_VIEWPORT_MARGIN);
        const nextLeft = Math.min(Math.max(rect.left + deltaX, minLeft), maxLeft);
        const nextTop = Math.min(Math.max(rect.top + deltaY, minTop), maxTop);
        const appliedDeltaX = nextLeft - rect.left;
        const appliedDeltaY = nextTop - rect.top;

        if (appliedDeltaX !== 0 || appliedDeltaY !== 0) {
            setActionPadOffset((current) => ({
                x: current.x + appliedDeltaX,
                y: current.y + appliedDeltaY,
            }));
        }

        dragState.lastClientX = event.clientX;
        dragState.lastClientY = event.clientY;
    }

    function handleActionPadPointerEnd(event: PointerEvent) {
        stopActionPadDrag(event.pointerId);
    }

    function handleActionPadPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
        if (isPhoneViewport || typeof window === "undefined") {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        stopActionPadDrag();
        actionPadDragStateRef.current = {
            pointerId: event.pointerId,
            lastClientX: event.clientX,
            lastClientY: event.clientY,
        };
        setIsActionPadDragging(true);
        window.addEventListener("pointermove", handleActionPadPointerMove);
        window.addEventListener("pointerup", handleActionPadPointerEnd);
        window.addEventListener("pointercancel", handleActionPadPointerEnd);
    }

    useEffect(() => {
        const stored = window.localStorage.getItem(STORAGE_KEY);

        if (!stored) {
            return;
        }

        try {
            const nextSession = JSON.parse(stored) as SessionState;
            setSession(nextSession);

            if (!initialAccountId) {
                setAccountId(nextSession.account.id);
            }

            setDisplayName((current) => current || nextSession.account.username);
        } catch {
            window.localStorage.removeItem(STORAGE_KEY);
        }
    }, [initialAccountId]);

    useEffect(() => {
        if (typeof window === "undefined") {
            return;
        }

        const mediaQuery = window.matchMedia(MOBILE_LAYOUT_MEDIA_QUERY);
        const syncViewport = () => {
            setIsPhoneViewport(mediaQuery.matches);
        };

        syncViewport();

        if (typeof mediaQuery.addEventListener === "function") {
            mediaQuery.addEventListener("change", syncViewport);
            return () => mediaQuery.removeEventListener("change", syncViewport);
        }

        mediaQuery.addListener(syncViewport);
        return () => mediaQuery.removeListener(syncViewport);
    }, []);

    useEffect(() => {
        return () => {
            stopActionPadDrag();

            if (runoutEquityTrendResetTimerRef.current !== null) {
                window.clearTimeout(runoutEquityTrendResetTimerRef.current);
            }
        };
    }, []);

    useEffect(() => {
        if (!isPhoneViewport) {
            return;
        }

        stopActionPadDrag();
    }, [isPhoneViewport]);

    useEffect(() => {
        const heroActionState = snapshot?.currentHand?.heroActionState;

        if (!heroActionState) {
            return;
        }

        setRaiseTarget((current) => {
            const nextDefault = getDefaultWagerInputValue(heroActionState);

            if (nextDefault <= 0) {
                return "";
            }

            if (!current) {
                return String(nextDefault);
            }

            const parsedCurrent = parseWholeNumberInput(current);
            const nextConfig = getHeroWagerInputConfig(heroActionState);

            if (!nextConfig || parsedCurrent === null) {
                return String(nextDefault);
            }

            if (parsedCurrent < nextConfig.minInputAmount || parsedCurrent > nextConfig.maxInputAmount) {
                return String(nextDefault);
            }

            return current;
        });
    }, [
        snapshot?.currentHand?.handNumber,
        snapshot?.currentHand?.heroActionState?.minRaiseTo,
        snapshot?.currentHand?.heroActionState?.maxRaiseTo,
        snapshot?.currentHand?.heroActionState?.callAmount,
        snapshot?.currentHand?.heroActionState?.streetContribution,
        snapshot?.currentHand?.heroActionState?.allowedActions,
    ]);

    useEffect(() => {
        if (demoMode) {
            setConnectionState("demo");
            return;
        }

        let disposed = false;
        let reconnectAttempts = 0;

        const clearReconnectTimer = () => {
            if (reconnectTimerRef.current === null) {
                return;
            }

            window.clearTimeout(reconnectTimerRef.current);
            reconnectTimerRef.current = null;
        };

        const connect = () => {
            if (disposed) {
                return;
            }

            clearReconnectTimer();
            setConnectionState(reconnectAttempts === 0 ? "connecting" : "reconnecting");

            const gameWsBaseUrl = getBrowserGameWsBaseUrl();
            const socket = new WebSocket(buildBrowserWsUrl(gameWsBaseUrl, "/ws"));
            socketRef.current = socket;

            socket.addEventListener("open", () => {
                reconnectAttempts = 0;
                setConnectionState("live");
                socket.send(JSON.stringify({
                    type: "subscribe_room",
                    slug,
                    accountId,
                }));
            });

            socket.addEventListener("message", (event) => {
                const payload = safeParse(event.data);

                if (!payload || typeof payload !== "object") {
                    return;
                }

                if (payload.type === "room_snapshot") {
                    setSnapshot(payload.payload as RoomSnapshot);
                    return;
                }

                if (payload.type === "error" && typeof payload.message === "string") {
                    setActionError(payload.message);
                }
            });

            socket.addEventListener("error", () => {
                socket.close();
            });

            socket.addEventListener("close", () => {
                if (disposed || socketRef.current !== socket) {
                    return;
                }

                socketRef.current = null;
                setConnectionState("reconnecting");
                reconnectAttempts += 1;
                const retryDelayMs = Math.min(5000, 500 * 2 ** Math.min(reconnectAttempts - 1, 4));
                reconnectTimerRef.current = window.setTimeout(connect, retryDelayMs);
            });
        };

        connect();

        return () => {
            disposed = true;
            clearReconnectTimer();

            const activeSocket = socketRef.current;
            socketRef.current = null;
            activeSocket?.close();
        };
    }, [slug, accountId, demoMode]);

    useEffect(() => {
        if (!snapshot?.nextHandStartsAt || snapshot.currentHand) {
            setNextHandCountdown(null);
            return;
        }

        const nextHandStartsAt = snapshot.nextHandStartsAt;

        const updateCountdown = () => {
            setNextHandCountdown(formatCountdown(nextHandStartsAt));
        };

        updateCountdown();
        const intervalId = window.setInterval(updateCountdown, 1000);

        return () => {
            window.clearInterval(intervalId);
        };
    }, [snapshot?.currentHand, snapshot?.nextHandStartsAt]);

    useEffect(() => {
        const blindState = snapshot?.blindState ?? null;
        const hasActiveReactions = Boolean(snapshot?.seatReactions.some((reaction) => Date.parse(reaction.expiresAt) > Date.now()));
        const hasBlindCountdown = Boolean(blindState && blindState.nextLevelInMs !== null && !blindState.pausedAt);
        const hasTurnClock = Boolean(snapshot?.currentHand && snapshot.turnState.currentTurnStartedAt);
        const hasAllInRunout = Boolean(snapshot?.lastCompletedHand && isAllInRunoutActive(snapshot.lastCompletedHand, Date.now()));

        if (!hasTurnClock && !hasActiveReactions && !hasBlindCountdown && !hasAllInRunout) {
            return;
        }

        setTurnClockNow(Date.now());
        const intervalId = window.setInterval(() => {
            setTurnClockNow(Date.now());
        }, 250);

        return () => {
            window.clearInterval(intervalId);
        };
    }, [snapshot?.currentHand?.handNumber, snapshot?.currentHand?.actorAccountId, snapshot?.currentHand?.street, snapshot?.turnState.currentTurnStartedAt, snapshot?.seatReactions, snapshot?.blindState.nextLevelInMs, snapshot?.blindState.pausedAt, snapshot?.lastCompletedHand?.handId, snapshot?.lastCompletedHand?.concludedAt]);

    useEffect(() => {
        if (!snapshot) {
            return;
        }

        if (!rebuyAmount) {
            setRebuyAmount(String(defaultRebuyAmount(snapshot)));
        }

        if (!seatRequestStack) {
            setSeatRequestStack(String(snapshot.startingStack));
        }
    }, [rebuyAmount, seatRequestStack, snapshot]);

    useEffect(() => {
        if (openMenuPanel !== "admin" || !snapshot) {
            return;
        }

        setAdminOptionsDraft(buildAdminOptionsDraft(snapshot));
    }, [openMenuPanel, snapshot]);

    useEffect(() => {
        if (!snapshot) {
            setSeatApprovalDrafts({});
            setRebuyApprovalDrafts({});
            return;
        }

        setSeatApprovalDrafts((current) => syncPendingAmountDrafts(current, snapshot.pendingSeatRequests.map((request) => ({
            id: request.id,
            value: request.requestedStack,
        }))));
        setRebuyApprovalDrafts((current) => syncPendingAmountDrafts(current, snapshot.pendingRebuyRequests.map((request) => ({
            id: request.id,
            value: request.amount,
        }))));
    }, [snapshot]);

    useEffect(() => {
        if (!isAdmin || !snapshot) {
            setAdminApprovalQueue([]);
            return;
        }

        const pendingRequests = [
            ...snapshot.pendingSeatRequests.map((request) => ({ kind: "seat" as const, requestId: request.id, createdAt: request.createdAt })),
            ...snapshot.pendingRebuyRequests.map((request) => ({ kind: "rebuy" as const, requestId: request.id, createdAt: request.createdAt })),
        ].sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
        const liveKeys = new Set(pendingRequests.map((entry) => buildAdminApprovalQueueKey(entry.kind, entry.requestId)));

        setAdminApprovalQueue((current) => {
            const filteredCurrent = current.filter((entry) => liveKeys.has(buildAdminApprovalQueueKey(entry.kind, entry.requestId)));
            const currentKeys = new Set(filteredCurrent.map((entry) => buildAdminApprovalQueueKey(entry.kind, entry.requestId)));
            const additions = pendingRequests
                .filter((entry) => {
                    const key = buildAdminApprovalQueueKey(entry.kind, entry.requestId);

                    if (currentKeys.has(key) || adminApprovalSeenRef.current.has(key)) {
                        return false;
                    }

                    adminApprovalSeenRef.current.add(key);
                    return true;
                })
                .map(({ kind, requestId }) => ({ kind, requestId } satisfies AdminApprovalQueueEntry));

            return [...filteredCurrent, ...additions];
        });
    }, [isAdmin, snapshot]);

    useEffect(() => {
        if (!snapshot?.currentHand) {
            setPreselectedHeroAction(null);
            autoActionRef.current = null;
        }
    }, [snapshot?.currentHand?.id]);

    const currentHand = snapshot?.currentHand ?? null;
    const heroPlayer = accountId ? snapshot?.players.find((player) => player.accountId === accountId) ?? null : null;
    const heroActionState = currentHand?.heroActionState ?? null;
    const heroInHand = Boolean(heroPlayer && currentHand?.playerCardCounts[heroPlayer.accountId]);
    const viewerHasRoomAccess = Boolean(snapshot && (!snapshot.passwordProtected || snapshot.viewerHasRoomAccess));
    const isProtectedRoomLocked = Boolean(!demoMode && snapshot?.passwordProtected && !viewerHasRoomAccess);
    const canJoinProtectedRoom = Boolean(snapshot && snapshot.passwordProtected && accountId && !viewerHasRoomAccess);
    const canChat = Boolean(snapshot && accountId && session && viewerHasRoomAccess && !demoMode);
    const canConnectMedia = Boolean(session && snapshot && viewerHasRoomAccess && !demoMode);
    const media = useTableMedia({
        slug,
        session,
        canConnect: canConnectMedia,
        displayName: displayName.trim() || heroPlayer?.displayName || session?.account.username || "",
    });
    const readyPlayerCount = snapshot?.players.filter((player) => player.isReady && player.isConnected && !player.isSittingOut && player.stack > 0).length ?? 0;
    const effectiveMediaParticipants = demoMode ? demoMediaParticipants : media.participants;
    const effectiveRemoteParticipants = demoMode ? demoMediaParticipants.filter((participant) => !participant.isLocal) : media.remoteParticipants;
    const mediaByAccountId = new Map(effectiveMediaParticipants.map((participant) => [participant.identity, participant]));
    const activeSeatReactions = buildActiveReactionMap(snapshot, turnClockNow);
    const seatGesturesByAccountId = buildSeatGestureMap(snapshot);
    const heroContribution = heroPlayer && currentHand ? currentHand.contributions[heroPlayer.accountId] ?? 0 : 0;
    const heroWagerInputConfig = heroActionState ? getHeroWagerInputConfig(heroActionState) : null;
    const rebuyPresets = snapshot ? buildRebuyPresets(snapshot) : [];
    const adminName = snapshot?.players.find((player) => player.accountId === snapshot.adminAccountId)?.displayName ?? snapshot?.adminAccountId ?? "Unknown";
    const canAdminStartHand = Boolean(snapshot && accountId === snapshot.adminAccountId && !currentHand && readyPlayerCount >= 2);
    const mediaNotice = demoMode ? "Sample table uses mocked camera tiles for layout previews." : media.mediaError ?? media.environmentError;
    const turnMetrics = buildTurnMetrics(snapshot, turnClockNow);
    const blindCountdownMs = snapshot?.blindState ? getBlindCountdownMs(snapshot.blindState, turnClockNow) : null;
    const heroPendingSeatRequest = accountId ? snapshot?.pendingSeatRequests.find((request) => request.accountId === accountId) ?? null : null;
    const heroPendingRebuyRequest = accountId ? snapshot?.pendingRebuyRequests.find((request) => request.accountId === accountId) ?? null : null;
    const canShowRebuyMenu = Boolean(heroPlayer && (heroPlayer.stack <= 0 || heroPendingRebuyRequest));
    const isSpectating = heroPlayer === null;
    const showCenterReadyButton = Boolean(heroPlayer && !heroPlayer.isReady && !heroPlayer.isSittingOut);
    const showCenterStartHand = Boolean(canAdminStartHand && snapshot?.status !== "paused");
    const activeAdminApproval = adminApprovalQueue[0] ?? null;
    const activeAdminSeatRequest = activeAdminApproval?.kind === "seat"
        ? snapshot?.pendingSeatRequests.find((request) => request.id === activeAdminApproval.requestId) ?? null
        : null;
    const activeAdminRebuyRequest = activeAdminApproval?.kind === "rebuy"
        ? snapshot?.pendingRebuyRequests.find((request) => request.id === activeAdminApproval.requestId) ?? null
        : null;
    const currentActor = snapshot?.currentHand?.actorAccountId
        ? snapshot.players.find((player) => player.accountId === snapshot.currentHand?.actorAccountId) ?? null
        : null;
    const heroTimeBankMs = heroPlayer && snapshot
        ? snapshot.turnState.timeBankSeconds === null
            ? 0
            : snapshot.turnState.timeBankMsByAccount[heroPlayer.accountId] ?? snapshot.turnState.timeBankSeconds * 1000
        : snapshot?.turnState.timeBankSeconds ? snapshot.turnState.timeBankSeconds * 1000 : 0;
    const heroBuyInTotal = heroPlayer && snapshot
        ? snapshot.buyInState.buyInTotalByAccount[heroPlayer.accountId] ?? snapshot.startingStack
        : snapshot?.startingStack ?? 0;
    const heroHandLabel = getCurrentHeroHandLabel(currentHand?.heroHoleCards ?? null, currentHand?.board ?? []);
    const heroRebuyCount = heroPlayer && snapshot ? snapshot.playerStats.rebuyCountByAccount[heroPlayer.accountId] ?? 0 : 0;
    const heroGesture = accountId ? seatGesturesByAccountId.get(accountId) ?? null : null;
    const lastCompletedHandRevealState = snapshot?.lastCompletedHandRevealState ?? null;
    const latestCompletedHand = snapshot?.lastCompletedHand ?? null;
    const allInRunoutView = buildAllInRunoutView(latestCompletedHand, turnClockNow);
    const isAllInRunoutAnimating = Boolean(allInRunoutView?.isActive);
    const pendingRunoutWinners = buildPendingRunoutWinners(latestCompletedHand, isAllInRunoutAnimating);
    const heroHandsWonCount = heroPlayer && snapshot
        ? getDisplayedHandsWonCount(heroPlayer.accountId, snapshot.playerStats.handsWonByAccount[heroPlayer.accountId] ?? 0, pendingRunoutWinners)
        : 0;
    const runoutRevealedHoleCards = latestCompletedHand && allInRunoutView?.isActive
        ? filterRevealedHoleCards(latestCompletedHand.revealedHoleCards, new Set(allInRunoutView.revealedAccountIds))
        : null;
    const tableSeats = buildTableSeats(snapshot, heroPlayer?.seatIndex, accountId, Boolean(heroPlayer), {
        suppressWinnerHighlights: isAllInRunoutAnimating,
        completedHandReveals: runoutRevealedHoleCards,
        pendingRunoutWinners,
        runoutWinPercentByAccount: runoutEquityState.percentByAccount,
        runoutEquityLeaderAccountIds: runoutEquityState.leaderAccountIds,
        runoutEquityTrendByAccount: runoutEquityState.trendByAccount,
    });
    const displayedBoard = currentHand?.board ?? allInRunoutView?.visibleBoard ?? latestCompletedHand?.board ?? [];
    const displayedPot = currentHand?.pot ?? latestCompletedHand?.totalPot ?? 0;
    const centerStatus = isAllInRunoutAnimating ? "All-in showdown. Running board..." : buildCenterStatus(snapshot, nextHandCountdown);
    const heroDisplayedStack = heroPlayer ? getDisplayedPlayerStack(heroPlayer, pendingRunoutWinners) ?? heroPlayer.stack : 0;
    const heroLastCompletedRevealedCards = heroPlayer && snapshot?.lastCompletedHand
        ? snapshot.lastCompletedHand.revealedHoleCards[heroPlayer.accountId] ?? [null, null]
        : null;
    const blindScheduleValidation = validateBlindScheduleDraft(adminOptionsDraft);
    const runoutEquityBoardKey = buildCardListKey(allInRunoutView?.visibleBoard ?? []);
    const runoutEquityAccountIdsKey = buildAccountListKey(allInRunoutView?.revealedAccountIds ?? latestCompletedHand?.allInRunout?.revealedAccountIds ?? []);

    useTableSoundEffects({
        snapshot,
        accountId,
        isAdmin,
        viewerHasRoomAccess,
        displayedBoardCount: displayedBoard.length,
        isAllInRunoutActive: isAllInRunoutAnimating,
        turnActorAccountId: currentHand?.actorAccountId ?? null,
        turnStartedAt: snapshot?.turnState.currentTurnStartedAt ?? null,
        turnMainSecondsRemaining: turnMetrics?.mainSecondsRemaining ?? null,
        isUsingTimeBank: turnMetrics?.isUsingTimeBank ?? false,
        demoMode,
    });

    useEffect(() => {
        if (runoutEquityTrendResetTimerRef.current !== null) {
            window.clearTimeout(runoutEquityTrendResetTimerRef.current);
            runoutEquityTrendResetTimerRef.current = null;
        }

        const nextSnapshot = buildRunoutEquitySnapshot(latestCompletedHand, allInRunoutView);

        if (!nextSnapshot) {
            runoutEquitySnapshotRef.current = null;
            setRunoutEquityState(createEmptyRunoutEquityViewState());
            return;
        }

        const previousSnapshot = runoutEquitySnapshotRef.current;
        const trendByAccount = new Map<string, EquityTrend>();
        let hasDirectionalChange = false;

        for (const [accountId, percent] of nextSnapshot.percentByAccount) {
            const previousPercent = previousSnapshot?.percentByAccount.get(accountId);
            const trend = previousPercent === undefined || previousPercent === percent
                ? "steady"
                : percent > previousPercent
                    ? "up"
                    : "down";

            if (trend !== "steady") {
                hasDirectionalChange = true;
            }

            trendByAccount.set(accountId, trend);
        }

        runoutEquitySnapshotRef.current = nextSnapshot;
        setRunoutEquityState({
            percentByAccount: nextSnapshot.percentByAccount,
            leaderAccountIds: nextSnapshot.leaderAccountIds,
            trendByAccount,
        });

        if (!hasDirectionalChange) {
            return;
        }

        runoutEquityTrendResetTimerRef.current = window.setTimeout(() => {
            setRunoutEquityState((current) => ({
                ...current,
                trendByAccount: new Map(Array.from(current.percentByAccount.keys(), (accountId) => [accountId, "steady"] satisfies [string, EquityTrend])),
            }));
            runoutEquityTrendResetTimerRef.current = null;
        }, RUNOUT_EQUITY_TRANSITION_MS);
    }, [latestCompletedHand?.handId, latestCompletedHand?.concludedAt, runoutEquityBoardKey, runoutEquityAccountIdsKey]);

    useEffect(() => {
        if (openMenuPanel === "rebuy" && !canShowRebuyMenu) {
            setOpenMenuPanel(null);
        }
    }, [canShowRebuyMenu, openMenuPanel]);

    const recentCompletedHands = snapshot?.recentCompletedHands.length
        ? snapshot.recentCompletedHands
        : snapshot?.lastCompletedHand
            ? [snapshot.lastCompletedHand]
            : [];
    const selectedCompletedHand = recentCompletedHands.find((hand) => hand.handId === selectedLedgerHandId) ?? recentCompletedHands[0] ?? null;
    const selectedCompletedHandRunout = selectedCompletedHand && latestCompletedHand && allInRunoutView && selectedCompletedHand.handId === latestCompletedHand.handId
        ? allInRunoutView
        : null;
    const selectedCompletedHandBoard = selectedCompletedHandRunout ? selectedCompletedHandRunout.visibleBoard : selectedCompletedHand?.board ?? [];
    const selectedCompletedHandReveals = selectedCompletedHand && selectedCompletedHandRunout
        ? runoutRevealedHoleCards ?? selectedCompletedHand.revealedHoleCards
        : selectedCompletedHand?.revealedHoleCards ?? {};
    const selectedCompletedHandRevealEntries = Object.entries(selectedCompletedHandReveals) as Array<[string, [Card | null, Card | null]]>;
    const selectedCompletedHandWinners = selectedCompletedHand && selectedCompletedHandRunout?.isActive
        ? []
        : selectedCompletedHand?.winners ?? [];
    const activeLastCompletedHandRevealState = !isAllInRunoutAnimating ? lastCompletedHandRevealState : null;
    const sessionLedgerRows = buildSessionLedgerRows(snapshot);
    const sessionLedgerTotals = sessionLedgerRows.reduce((totals, row) => ({
        buyIn: totals.buyIn + row.buyIn,
        buyOut: totals.buyOut + row.buyOut,
        stack: totals.stack + row.stack,
        net: totals.net + row.net,
        wins: totals.wins + row.wins,
        rebuys: totals.rebuys + row.rebuys,
    }), { buyIn: 0, buyOut: 0, stack: 0, net: 0, wins: 0, rebuys: 0 });

    useEffect(() => {
        if (!isPhoneViewport) {
            setIsMobileRecommendationOpen(false);
            setIsMobileActionMenuOpen(false);
            return;
        }

        if (!viewerHasRoomAccess || typeof window === "undefined") {
            return;
        }

        try {
            const dismissed = window.sessionStorage.getItem(MOBILE_LAYOUT_RECOMMENDATION_STORAGE_KEY);

            if (!dismissed) {
                setIsMobileRecommendationOpen(true);
            }
        } catch {
            setIsMobileRecommendationOpen(true);
        }
    }, [isPhoneViewport, viewerHasRoomAccess]);

    function dismissMobileRecommendation() {
        setIsMobileRecommendationOpen(false);

        if (typeof window === "undefined") {
            return;
        }

        try {
            window.sessionStorage.setItem(MOBILE_LAYOUT_RECOMMENDATION_STORAGE_KEY, "1");
        } catch {
            // Ignore storage failures and just close the modal for this render.
        }
    }

    function renderActionPanel(variant: "inline" | "dialog") {
        const isInline = variant === "inline";

        return (
            <section
                ref={isInline ? actionPadRef : undefined}
                className={[
                    "table-action-panel",
                    isInline ? "table-action-panel--inline" : "table-action-panel--dialog",
                    isInline && isActionPadDragging ? "table-action-panel--dragging" : "",
                ].filter(Boolean).join(" ")}
                style={isInline ? { transform: `translate(${actionPadOffset.x}px, ${actionPadOffset.y}px)` } : undefined}
            >
                <div className="table-action-panel__topbar">
                    <div className="table-action-panel__header">
                        <span className="table-action-panel__eyebrow">Action pad</span>
                        <strong className="table-action-panel__title">{heroPlayer ? heroPlayer.displayName : "Waiting for seat"}</strong>
                    </div>

                    {isInline && !isPhoneViewport ? (
                        <button
                            className="table-action-panel__drag-handle"
                            type="button"
                            onPointerDown={handleActionPadPointerDown}
                            aria-label="Drag action pad"
                            aria-grabbed={isActionPadDragging}
                        >
                            Move
                        </button>
                    ) : null}
                </div>

                {heroActionState?.canAct ? (
                    <>
                        <div className="table-action-panel__grid">
                            {heroActionState.allowedActions.includes("check") ? (
                                <button className="table-action-panel__button table-action-panel__button--check" type="button" onClick={() => void handlePlayerAction("check")} disabled={isMutating}>
                                    Check
                                </button>
                            ) : heroActionState.allowedActions.includes("call") ? (
                                <button className="table-action-panel__button table-action-panel__button--call" type="button" onClick={() => void handlePlayerAction("call")} disabled={isMutating}>
                                    Call {formatNumber(heroActionState.callAmount)}
                                </button>
                            ) : (
                                <div className="table-action-panel__button table-action-panel__button--ghost">No call</div>
                            )}

                            {heroActionState.allowedActions.includes("fold") ? (
                                <button className="table-action-panel__button table-action-panel__button--fold" type="button" onClick={() => void handlePlayerAction("fold")} disabled={isMutating}>
                                    Fold
                                </button>
                            ) : (
                                <div className="table-action-panel__button table-action-panel__button--ghost">Stay in</div>
                            )}

                            {heroActionState.allowedActions.includes("all_in") ? (
                                <button className="table-action-panel__button table-action-panel__button--allin" type="button" onClick={() => void handlePlayerAction("all_in")} disabled={isMutating}>
                                    All-in {formatNumber(heroPlayer?.stack ?? 0)}
                                </button>
                            ) : (
                                <div className="table-action-panel__button table-action-panel__button--ghost">No shove</div>
                            )}
                        </div>

                        {heroActionState.allowedActions.includes("bet") || heroActionState.allowedActions.includes("raise") ? (
                            <div className="table-action-panel__raise-row">
                                <input
                                    className="control-input"
                                    type="number"
                                    min={heroWagerInputConfig?.minInputAmount}
                                    max={heroWagerInputConfig?.maxInputAmount}
                                    step={1}
                                    value={raiseTarget}
                                    onChange={(event) => setRaiseTarget(event.target.value)}
                                />
                                <button
                                    className="table-action-panel__raise-button"
                                    type="button"
                                    onClick={() => void handlePlayerAction(heroActionState.allowedActions.includes("raise") ? "raise" : "bet")}
                                    disabled={isMutating}
                                >
                                    {heroWagerInputConfig?.buttonLabel ?? (heroActionState.allowedActions.includes("raise") ? "Raise by" : "Bet")}
                                </button>
                            </div>
                        ) : null}

                        {!isPhoneViewport ? <p className="muted-copy table-action-panel__hotkeys">Hotkeys: Q check/fold, C check, F fold, B bet/raise, L ledger, / chat, M mic, V camera{isAdmin ? ", P pause" : ""}.</p> : null}
                    </>
                ) : (
                    <>
                        <p className="muted-copy table-action-panel__waiting-copy">{describeHeroState(heroActionState, heroPlayer)}</p>

                        {heroInHand && !heroActionState?.hasFolded && !heroActionState?.isAllIn ? (
                            <div className="table-action-panel__queue-row">
                                <button
                                    className={[
                                        "button",
                                        preselectedHeroAction === "check_or_fold" ? "button--primary" : "button--secondary",
                                        "table-action-panel__queue-button",
                                    ].join(" ")}
                                    type="button"
                                    onClick={() => setPreselectedHeroAction((current) => current === "check_or_fold" ? null : "check_or_fold")}
                                    disabled={isMutating}
                                >
                                    Check or fold
                                </button>
                                {!isPhoneViewport ? <p className="muted-copy table-action-panel__hotkeys">Hotkeys: Q queue check/fold, L ledger, / chat, M mic, V camera{isAdmin ? ", P pause" : ""}.</p> : null}
                            </div>
                        ) : null}

                        {activeLastCompletedHandRevealState ? (
                            <div className="table-action-panel__reveal-block">
                                <div className="table-action-panel__reveal-header">
                                    <span className="table-action-panel__eyebrow">Show cards</span>
                                    <strong>{activeLastCompletedHandRevealState.forced ? "Auto-shown" : "Reveal options"}</strong>
                                </div>

                                {activeLastCompletedHandRevealState.forced ? (
                                    <p className="muted-copy table-action-panel__reveal-copy">Auto-revealed showdown cards stay visible in the ledger.</p>
                                ) : (
                                    <>
                                        <div className="table-action-panel__reveal-cards">
                                            {([0, 1] as const).map((cardIndex) => (
                                                <button
                                                    key={cardIndex}
                                                    className={[
                                                        "table-action-panel__reveal-card-button",
                                                        heroLastCompletedRevealedCards?.[cardIndex] ? "table-action-panel__reveal-card-button--active" : "",
                                                    ].filter(Boolean).join(" ")}
                                                    type="button"
                                                    onClick={() => void handleRevealCards(toggleRevealMode(activeLastCompletedHandRevealState.currentMode, cardIndex))}
                                                    disabled={isMutating}
                                                >
                                                    <PokerCard
                                                        card={heroLastCompletedRevealedCards?.[cardIndex] ?? null}
                                                        isFaceUp={Boolean(heroLastCompletedRevealedCards?.[cardIndex])}
                                                        size="compact"
                                                        backLabel={cardIndex === 0 ? "Left" : "Right"}
                                                    />
                                                </button>
                                            ))}
                                        </div>

                                        <div className="table-action-panel__reveal-controls">
                                            <button
                                                className={[
                                                    "button",
                                                    activeLastCompletedHandRevealState.currentMode === "both" ? "button--primary" : "button--secondary",
                                                    "table-action-panel__reveal-button",
                                                ].join(" ")}
                                                type="button"
                                                onClick={() => void handleRevealCards("both")}
                                                disabled={isMutating}
                                            >
                                                Show both
                                            </button>
                                            <button
                                                className={[
                                                    "button",
                                                    activeLastCompletedHandRevealState.currentMode === "none" ? "button--primary" : "button--secondary",
                                                    "table-action-panel__reveal-button",
                                                ].join(" ")}
                                                type="button"
                                                onClick={() => void handleRevealCards("none")}
                                                disabled={isMutating}
                                            >
                                                Hide all
                                            </button>
                                        </div>
                                    </>
                                )}
                            </div>
                        ) : null}
                    </>
                )}
            </section>
        );
    }

    async function submitRoomMutation(path: string, body: Record<string, unknown>) {
        if (demoMode) {
            const error = new Error("Sample table is read-only.");
            setActionError(error.message);
            throw error;
        }

        setIsMutating(true);
        setActionError(null);

        try {
            const gameBaseUrl = getBrowserGameHttpBaseUrl();
            const response = await fetch(buildBrowserHttpUrl(gameBaseUrl, path), {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(body),
            });

            const payload = (await response.json()) as RoomSnapshot & { error?: string };

            if (!response.ok) {
                throw new Error(payload.error ?? "Unable to update the room.");
            }

            setSnapshot(payload);
            return payload;
        } catch (error) {
            const message = error instanceof Error ? error.message : "Unable to update the room.";
            setActionError(message);
            throw error;
        } finally {
            setIsMutating(false);
        }
    }

    async function handleJoinRoom() {
        if (!accountId) {
            setActionError("Sign in on the home page before joining a room.");
            return;
        }

        await submitRoomMutation(`/v1/rooms/${slug}/join`, {
            accountId,
            password: roomPassword || undefined,
        });
    }

    function handleSeatClick(seatIndex: number) {
        if (!accountId) {
            setActionError("Sign in on the home page before taking a seat.");
            return;
        }

        if (snapshot?.passwordProtected && !viewerHasRoomAccess) {
            setActionError("Join the room first so the password can be validated.");
            return;
        }

        if (!snapshot) {
            return;
        }

        if (!isAdmin) {
            setActionError(null);
            setSeatRequestPrompt({
                seatIndex,
                requestedStack: heroPendingSeatRequest
                    ? String(heroPendingSeatRequest.requestedStack)
                    : seatRequestStack || String(snapshot.startingStack),
            });
            return;
        }

        void handleSeat(seatIndex, seatRequestStack || String(snapshot.startingStack));
    }

    async function handleSeat(seatIndex: number, requestedStackInput = seatRequestStack, showConfirmation = false) {
        if (!accountId) {
            setActionError("Sign in on the home page before taking a seat.");
            return;
        }

        if (snapshot?.passwordProtected && !viewerHasRoomAccess) {
            setActionError("Join the room first so the password can be validated.");
            return;
        }

        let requestedStack = 0;

        try {
            requestedStack = parseRequiredWholeNumber(requestedStackInput || String(snapshot?.startingStack ?? 0), "Requested stack");
        } catch (error) {
            setActionError(error instanceof Error ? error.message : "Enter a valid requested stack before taking a seat.");
            return;
        }

        try {
            await submitRoomMutation(`/v1/rooms/${slug}/seat`, {
                accountId,
                displayName: displayName.trim() || session?.account.username || "Player",
                seatIndex,
                requestedStack,
            });
            setSeatRequestStack(String(requestedStack));
            setSeatRequestPrompt(null);

            if (showConfirmation) {
                setRequestNoticeModal({
                    title: "Seat request sent",
                    message: `Seat ${seatIndex + 1} was requested for ${formatNumber(requestedStack)} and sent to the game owner for approval.`,
                });
            }
        } catch {
            return;
        }
    }

    async function handleConfirmSeatRequest() {
        if (!seatRequestPrompt) {
            return;
        }

        await handleSeat(seatRequestPrompt.seatIndex, seatRequestPrompt.requestedStack, true);
    }

    async function handleReadyToggle() {
        if (!accountId || !heroPlayer) {
            return;
        }

        await submitRoomMutation(`/v1/rooms/${slug}/ready`, {
            accountId,
            isReady: !heroPlayer.isReady,
        });
    }

    async function handleSitOutToggle() {
        if (!accountId || !heroPlayer) {
            return;
        }

        await submitRoomMutation(`/v1/rooms/${slug}/sit-out`, {
            accountId,
            isSittingOut: !heroPlayer.isSittingOut,
        });
    }

    async function handleLeaveSeat() {
        if (!accountId || !heroPlayer) {
            return;
        }

        await submitRoomMutation(`/v1/rooms/${slug}/leave-seat`, {
            accountId,
        });
    }

    async function handleStartHand() {
        if (!accountId) {
            return;
        }

        await submitRoomMutation(`/v1/rooms/${slug}/start`, {
            accountId,
        });
    }

    async function handlePlayerAction(actionType: HeroActionState["allowedActions"][number]) {
        if (!accountId) {
            return;
        }

        const payload: Record<string, unknown> = {
            accountId,
            actionType,
        };

        if (actionType === "bet" || actionType === "raise") {
            try {
                if (!heroActionState) {
                    throw new Error("This action is not available right now.");
                }

                payload.amount = getWagerTargetContribution(actionType, raiseTarget, heroActionState);
            } catch (error) {
                setActionError(error instanceof Error ? error.message : "Enter a valid wager before acting.");
                return;
            }
        }

        await submitRoomMutation(`/v1/rooms/${slug}/action`, payload);
    }

    async function handleSendChatMessage() {
        if (!accountId || !canChat) {
            setActionError("Join the room and sign in before chatting.");
            return;
        }

        const content = chatDraft.trim();

        if (!content) {
            return;
        }

        await submitRoomMutation(`/v1/rooms/${slug}/chat`, {
            accountId,
            displayName: displayName.trim() || heroPlayer?.displayName || session?.account.username,
            content,
        });
        setChatDraft("");
    }

    async function handleSendReaction(emoji: string) {
        if (!accountId || !heroPlayer) {
            setActionError("Take a seat before sending table reactions.");
            return;
        }

        await submitRoomMutation(`/v1/rooms/${slug}/react`, {
            accountId,
            emoji,
        });
        setIsReactionMenuOpen(false);
    }

    async function handleSetGesture(nextEmoji: string | null) {
        if (!accountId || !heroPlayer) {
            setActionError("Take a seat before setting a gesture.");
            return;
        }

        await submitRoomMutation(`/v1/rooms/${slug}/gesture`, {
            accountId,
            emoji: nextEmoji ?? undefined,
        });
        setGestureInput(nextEmoji ?? "");
        setIsReactionMenuOpen(false);
    }

    async function handleRebuy() {
        if (!accountId || !heroPlayer || !snapshot) {
            setActionError("Take a seat before adjusting your buy-in.");
            return;
        }

        if (heroPlayer.stack > 0) {
            setActionError("Rebuy is only available after you are out of chips.");
            return;
        }

        if (heroInHand) {
            setActionError("Rebuy is only available between hands.");
            return;
        }

        const amount = Number(rebuyAmount);

        if (!Number.isFinite(amount)) {
            setActionError("Enter a valid rebuy amount.");
            return;
        }

        await submitRoomMutation(`/v1/rooms/${slug}/rebuy`, {
            accountId,
            amount,
        });
    }

    async function handleSeatRequestDecision(requestId: string, approved: boolean, requestedStackInput?: string) {
        if (!accountId || !snapshot) {
            return;
        }

        try {
            const body: Record<string, unknown> = {
                accountId,
                requestId,
                approved,
            };

            if (approved) {
                body.requestedStack = parseRequiredWholeNumber(requestedStackInput ?? seatApprovalDrafts[requestId] ?? String(snapshot.startingStack), "Requested stack");
            }

            await submitRoomMutation(`/v1/rooms/${slug}/seat-request/decision`, body);
        } catch (error) {
            setActionError(error instanceof Error ? error.message : "Unable to update the seat request.");
        }
    }

    async function handleRebuyRequestDecision(requestId: string, approved: boolean, amountInput?: string) {
        if (!accountId || !snapshot) {
            return;
        }

        try {
            const body: Record<string, unknown> = {
                accountId,
                requestId,
                approved,
            };

            if (approved) {
                body.amount = parseRequiredWholeNumber(amountInput ?? rebuyApprovalDrafts[requestId] ?? String(snapshot.buyInState.minRebuyAmount), "Rebuy amount");
            }

            await submitRoomMutation(`/v1/rooms/${slug}/rebuy-request/decision`, body);
        } catch (error) {
            setActionError(error instanceof Error ? error.message : "Unable to update the rebuy request.");
        }
    }

    function handleDismissAdminApprovalModal() {
        setAdminApprovalQueue((current) => current.slice(1));
    }

    function updateBlindLevelDraft(index: number, field: keyof BlindLevelDraft, value: string) {
        setAdminOptionsDraft((current) => ({
            ...current,
            blindLevels: current.blindLevels.map((level, levelIndex) => (
                levelIndex === index ? { ...level, [field]: value } : level
            )),
        }));
    }

    function handleAddBlindLevel() {
        setAdminOptionsDraft((current) => ({
            ...current,
            blindLevels: [...current.blindLevels, buildNextBlindLevelDraft(current.blindLevels)],
        }));
    }

    function handleRemoveBlindLevel(index: number) {
        setAdminOptionsDraft((current) => ({
            ...current,
            blindLevels: current.blindLevels.filter((_, levelIndex) => levelIndex !== index),
        }));
    }

    async function handleSaveAdminOptions() {
        if (!accountId || !snapshot) {
            return;
        }

        if (adminOptionsDraft.useBlindSchedule && blindScheduleValidation.errors.length > 0) {
            setActionError(blindScheduleValidation.errors[0] ?? "Fix the blind schedule validation errors before saving.");
            return;
        }

        try {
            const blindSchedule = parseBlindScheduleDraft(adminOptionsDraft);

            await submitRoomMutation(`/v1/rooms/${slug}/admin/options`, {
                accountId,
                blindSchedule,
                autoStartNextHand: adminOptionsDraft.autoStartNextHand,
                autoStartDelaySeconds: parseOptionalWholeNumber(adminOptionsDraft.showdownPresentationSeconds, "Showdown presentation time") ?? 0,
                turnSeconds: parseOptionalWholeNumber(adminOptionsDraft.decisionTimeSeconds, "Decision time limit"),
                timeBankSeconds: parseOptionalWholeNumber(adminOptionsDraft.timeBankSeconds, "Time bank length"),
                timeBankRefillHands: parseOptionalWholeNumber(adminOptionsDraft.timeBankRefillHands, "Time bank refill hands"),
                revealAllShowdownHands: adminOptionsDraft.revealAllShowdownHands,
            });
        } catch (error) {
            setActionError(error instanceof Error ? error.message : "Unable to save table options.");
        }
    }

    async function handlePauseToggle() {
        if (!accountId || !snapshot) {
            return;
        }

        await submitRoomMutation(`/v1/rooms/${slug}/admin/pause`, {
            accountId,
            isPaused: snapshot.status !== "paused",
        });
    }

    async function handleStopTable() {
        if (!accountId) {
            return;
        }

        await submitRoomMutation(`/v1/rooms/${slug}/admin/stop`, {
            accountId,
        });
    }

    async function handleRemovePlayer(targetAccountId: string) {
        if (!accountId) {
            return;
        }

        await submitRoomMutation(`/v1/rooms/${slug}/admin/remove-player`, {
            accountId,
            targetAccountId,
        });
    }

    async function handleRevealCards(revealMode: RevealMode) {
        if (!accountId || !heroPlayer) {
            setActionError("Take a seat before changing card reveal settings.");
            return;
        }

        await submitRoomMutation(`/v1/rooms/${slug}/reveal-cards`, {
            accountId,
            revealMode,
        });
    }

    async function handleCopyInviteLink() {
        if (typeof window === "undefined") {
            return;
        }

        try {
            if (!navigator.clipboard) {
                throw new Error("Clipboard access is not available in this browser.");
            }

            await navigator.clipboard.writeText(window.location.href);
            setInviteFeedback("Invite link copied.");
        } catch (error) {
            setInviteFeedback(error instanceof Error ? error.message : "Unable to copy the invite link.");
        }
    }

    useEffect(() => {
        if (preselectedHeroAction !== "check_or_fold" || !heroActionState?.canAct || isMutating || !currentHand) {
            return;
        }

        const actionType = heroActionState.allowedActions.includes("check")
            ? "check"
            : heroActionState.allowedActions.includes("fold")
                ? "fold"
                : null;

        if (!actionType) {
            return;
        }

        const actionKey = `${currentHand.id}:${currentHand.street}:${actionType}`;

        if (autoActionRef.current === actionKey) {
            return;
        }

        autoActionRef.current = actionKey;
        setPreselectedHeroAction(null);
        void handlePlayerAction(actionType);
    }, [currentHand, heroActionState, isMutating, preselectedHeroAction]);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            const target = event.target as HTMLElement | null;

            if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
                return;
            }

            const key = event.key.toLowerCase();

            if (key === "l") {
                event.preventDefault();
                setIsSessionLedgerOpen((current) => !current);
                return;
            }

            if (key === "/") {
                event.preventDefault();
                chatInputRef.current?.focus();
                return;
            }

            if (key === "m") {
                event.preventDefault();
                if (demoMode) {
                    setOpenMenuPanel("media");
                    return;
                }

                if (media.isConnected) {
                    void media.handleToggleMicrophone();
                } else if (!media.environmentError) {
                    void media.handleConnectMedia();
                }
                return;
            }

            if (key === "v") {
                event.preventDefault();
                if (demoMode) {
                    setOpenMenuPanel("media");
                    return;
                }

                if (media.isConnected) {
                    void media.handleToggleCamera();
                } else if (!media.environmentError) {
                    void media.handleConnectMedia();
                }
                return;
            }

            if (key === "p" && isAdmin) {
                event.preventDefault();
                void handlePauseToggle();
                return;
            }

            if (key === "q" && heroInHand && !heroActionState?.hasFolded && !heroActionState?.isAllIn) {
                event.preventDefault();

                if (heroActionState?.canAct) {
                    const actionType = heroActionState.allowedActions.includes("check")
                        ? "check"
                        : heroActionState.allowedActions.includes("fold")
                            ? "fold"
                            : null;

                    if (actionType) {
                        void handlePlayerAction(actionType);
                    }
                } else {
                    setPreselectedHeroAction((current) => current === "check_or_fold" ? null : "check_or_fold");
                }

                return;
            }

            if (!heroActionState?.canAct) {
                return;
            }

            if (key === "c" && heroActionState.allowedActions.includes("check")) {
                event.preventDefault();
                void handlePlayerAction("check");
                return;
            }

            if (key === "f" && heroActionState.allowedActions.includes("fold")) {
                event.preventDefault();
                void handlePlayerAction("fold");
                return;
            }

            if (key === "b" && (heroActionState.allowedActions.includes("bet") || heroActionState.allowedActions.includes("raise"))) {
                event.preventDefault();
                void handlePlayerAction(heroActionState.allowedActions.includes("raise") ? "raise" : "bet");
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [demoMode, heroActionState, heroInHand, isAdmin, media, preselectedHeroAction, snapshot?.status]);

    if (isProtectedRoomLocked) {
        return (
            <main className="room-shell room-shell--play">
                <div className="table-dialog" role="dialog" aria-modal="true" aria-label="Room password required">
                    <div className="table-dialog__backdrop" aria-hidden="true" />
                    <section className="table-dialog__panel table-dialog__panel--compact">
                        <header className="table-dialog__header">
                            <div>
                                <span className="table-menu-drawer__eyebrow">Password protected room</span>
                                <h2>{snapshot?.name ?? `Room ${slug}`}</h2>
                                <p>Enter the room password to view players, cards, cameras, and table details.</p>
                            </div>
                        </header>

                        <div className="table-dialog__content">
                            {session
                                ? <p className="muted-copy">Signed in as {session.account.username}</p>
                                : <p className="muted-copy">Sign in on the home page before entering this room.</p>}

                            <input
                                className="control-input"
                                type="password"
                                value={roomPassword}
                                onChange={(event) => setRoomPassword(event.target.value)}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter") {
                                        event.preventDefault();
                                        void handleJoinRoom();
                                    }
                                }}
                                placeholder="room password"
                                autoFocus
                            />

                            {actionError ? <p className="form-error table-dialog__error">{actionError}</p> : null}
                        </div>

                        <div className="table-dialog__actions">
                            <Link className="button button--secondary" href="/">
                                Return home
                            </Link>
                            <button className="button button--primary" type="button" onClick={() => void handleJoinRoom()} disabled={isMutating || !accountId}>
                                Unlock room
                            </button>
                        </div>
                    </section>
                </div>
            </main>
        );
    }

    return (
        <main className={["room-shell", "room-shell--play", isPhoneViewport ? "room-shell--phone" : ""].filter(Boolean).join(" ")}>
            <header className="room-toolbar room-toolbar--compact">
                <div>
                    <Link className="room-toolbar__brand" href="/">
                        <img className="room-toolbar__brand-mark" src="/poker.svg" alt="Poker Poker logo" />
                        <span>Poker Poker Table</span>
                    </Link>
                    <h1 className="room-toolbar__title">{snapshot?.name ?? `Room ${slug}`}</h1>
                </div>

                <div className="room-toolbar__meta">
                    <span className="room-toolbar__pill">{currentHand ? `NLHE · ${formatNumber(currentHand.blindLevel.smallBlind)} / ${formatNumber(currentHand.blindLevel.bigBlind)}` : "NLHE · Waiting"}</span>
                    <span className="room-toolbar__pill">Owner {adminName}</span>
                    <span className="room-toolbar__pill">{snapshot?.players.length ?? 0}/{snapshot?.maxPlayers ?? 0} seated</span>
                    <span className="room-toolbar__pill">{demoMode ? "Sample table" : snapshot?.visibility === "club" ? "Club table" : "Private table"}</span>
                    <span className={`connection-pill connection-pill--${connectionState}`}>{connectionState}</span>
                    <button className="room-toolbar__pill room-toolbar__pill-button" type="button" onClick={() => setIsEngineInfoOpen(true)}>
                        Info
                    </button>
                    {HOUSE_RULES_CONFIG.visible ? (
                        <button className="room-toolbar__pill room-toolbar__pill-button" type="button" onClick={() => setIsHouseRulesOpen(true)}>
                            House Rules
                        </button>
                    ) : null}
                </div>
            </header>

            <section className="room-play-stack">
                {actionError ? <p className="form-error room-play-stack__error">{actionError}</p> : null}
                {demoMode ? <p className="muted-copy">Sample table is read-only and uses mocked media tiles for layout sizing.</p> : null}

                <section className="table-arena table-arena--clean">
                    <div className="table-felt">
                        <div className="table-menu-cluster">
                            <button
                                className={[
                                    "table-menu-cluster__button",
                                    isSessionLedgerOpen ? "table-menu-cluster__button--active" : "",
                                ].filter(Boolean).join(" ")}
                                type="button"
                                onClick={() => setIsSessionLedgerOpen(true)}
                            >
                                Ledger
                            </button>

                            {([
                                { id: "seat", label: "Seat" },
                                ...(canShowRebuyMenu ? [{ id: "rebuy", label: "Rebuy" } as const] : []),
                                { id: "invite", label: "Invite" },
                                { id: "media", label: "Media" },
                                ...(isAdmin ? [{ id: "admin", label: "Admin" } as const] : []),
                            ] as const).map((item) => (
                                <button
                                    key={item.id}
                                    className={[
                                        "table-menu-cluster__button",
                                        openMenuPanel === item.id ? "table-menu-cluster__button--active" : "",
                                    ].filter(Boolean).join(" ")}
                                    type="button"
                                    onClick={() => setOpenMenuPanel((current) => current === item.id ? null : item.id)}
                                >
                                    {item.label}
                                </button>
                            ))}

                            {openMenuPanel ? (
                                <div className="table-menu-drawer">
                                    {openMenuPanel === "invite" ? (
                                        <div className="table-menu-drawer__section">
                                            <span className="table-menu-drawer__eyebrow">Invite</span>
                                            <strong className="table-menu-drawer__title">{snapshot?.slug ?? slug}</strong>
                                            <button className="button button--secondary table-menu-drawer__button" type="button" onClick={() => void handleCopyInviteLink()}>
                                                Copy invite link
                                            </button>
                                            {inviteFeedback ? <p className="muted-copy">{inviteFeedback}</p> : null}
                                        </div>
                                    ) : null}

                                    {openMenuPanel === "seat" ? (
                                        <div className="table-menu-drawer__section">
                                            <span className="table-menu-drawer__eyebrow">Seat</span>
                                            {session ? <p className="muted-copy">Signed in as {session.account.username}</p> : <p className="muted-copy">Sign in on the home page to take a seat from this browser.</p>}

                                            {heroPlayer ? (
                                                <div className="table-stat-list">
                                                    <span className="chip-pill">Seat {heroPlayer.seatIndex + 1}</span>
                                                    <span className="chip-pill">Stack {formatNumber(heroDisplayedStack)}</span>
                                                    <span className="chip-pill">Bought {formatNumber(heroBuyInTotal)}</span>
                                                </div>
                                            ) : (
                                                <>
                                                    <input
                                                        className="control-input"
                                                        type="text"
                                                        value={displayName}
                                                        onChange={(event) => setDisplayName(event.target.value)}
                                                        placeholder="display name"
                                                    />

                                                    {isAdmin ? (
                                                        <input
                                                            className="control-input"
                                                            type="number"
                                                            min={100}
                                                            step={100}
                                                            value={seatRequestStack}
                                                            onChange={(event) => setSeatRequestStack(event.target.value)}
                                                            placeholder="requested stack"
                                                        />
                                                    ) : <p className="muted-copy">Pick an open seat and you will be prompted for your intended stack.</p>}
                                                </>
                                            )}

                                            {heroPendingSeatRequest ? (
                                                <p className="muted-copy">Seat request pending for Seat {heroPendingSeatRequest.seatIndex + 1} at {formatNumber(heroPendingSeatRequest.requestedStack)}.</p>
                                            ) : null}

                                            {canJoinProtectedRoom ? (
                                                <>
                                                    <input
                                                        className="control-input"
                                                        type="password"
                                                        value={roomPassword}
                                                        onChange={(event) => setRoomPassword(event.target.value)}
                                                        placeholder="room password"
                                                    />
                                                    <button className="button button--primary table-menu-drawer__button" type="button" onClick={() => void handleJoinRoom()} disabled={isMutating}>
                                                        Join room
                                                    </button>
                                                </>
                                            ) : null}

                                            {heroPlayer ? (
                                                <div className="seat-control-list seat-control-list--stacked">
                                                    <button className="button button--secondary table-menu-drawer__button" type="button" onClick={() => void handleReadyToggle()} disabled={isMutating || heroPlayer.isSittingOut}>
                                                        {heroPlayer.isReady ? "Mark not ready" : "Mark ready"}
                                                    </button>
                                                    <button className="button button--secondary table-menu-drawer__button" type="button" onClick={() => void handleSitOutToggle()} disabled={isMutating}>
                                                        {heroPlayer.isSittingOut ? "Return from sit out" : "Sit out next hand"}
                                                    </button>
                                                    <button className="button button--danger table-menu-drawer__button" type="button" onClick={() => void handleLeaveSeat()} disabled={isMutating || heroInHand}>
                                                        Leave seat
                                                    </button>
                                                </div>
                                            ) : (
                                                <p className="muted-copy">Pick an open seat to enter player mode. Once seated, open chairs disappear from your view.</p>
                                            )}

                                            {heroInHand ? <p className="muted-copy">Leave seat and rebuy unlock once the current hand finishes.</p> : null}

                                            {snapshot && accountId === snapshot.adminAccountId ? (
                                                <button className="button button--primary table-menu-drawer__button" type="button" onClick={() => void handleStartHand()} disabled={isMutating || !canAdminStartHand}>
                                                    {currentHand ? "Hand in progress" : readyPlayerCount >= 2 ? "Start hand" : "Need 2 ready players"}
                                                </button>
                                            ) : null}

                                            {nextHandCountdown ? <p className="muted-copy">{nextHandCountdown}</p> : null}
                                        </div>
                                    ) : null}

                                    {openMenuPanel === "rebuy" ? (
                                        <div className="table-menu-drawer__section">
                                            <span className="table-menu-drawer__eyebrow">Rebuy</span>
                                            {heroPlayer && snapshot ? (
                                                <>
                                                    <div className="table-stat-list">
                                                        <span className="chip-pill">Bought in {formatNumber(heroBuyInTotal)}</span>
                                                        <span className="chip-pill">Rebuys {formatNumber(heroRebuyCount)}</span>
                                                        <span className="chip-pill">Min {formatNumber(snapshot.buyInState.minRebuyAmount)}</span>
                                                        <span className="chip-pill">Max {formatNumber(snapshot.buyInState.maxRebuyAmount)}</span>
                                                    </div>

                                                    <div className="table-utility-dock__rebuy-pills">
                                                        {rebuyPresets.map((preset) => (
                                                            <button
                                                                key={`${preset.label}-${preset.amount}`}
                                                                className="button button--secondary table-utility-dock__rebuy-pill"
                                                                type="button"
                                                                onClick={() => setRebuyAmount(String(preset.amount))}
                                                            >
                                                                {preset.label} {formatNumber(preset.amount)}
                                                            </button>
                                                        ))}
                                                    </div>

                                                    <div className="table-utility-dock__rebuy-row">
                                                        <input
                                                            className="control-input"
                                                            type="number"
                                                            min={snapshot.buyInState.minRebuyAmount}
                                                            max={snapshot.buyInState.maxRebuyAmount}
                                                            step={100}
                                                            value={rebuyAmount}
                                                            onChange={(event) => setRebuyAmount(event.target.value)}
                                                        />
                                                        <button className="button button--primary" type="button" onClick={() => void handleRebuy()} disabled={isMutating || heroInHand}>
                                                            {isAdmin ? "Apply rebuy" : "Request rebuy"}
                                                        </button>
                                                    </div>

                                                    {heroPendingRebuyRequest ? <p className="muted-copy">Rebuy request pending for {formatNumber(heroPendingRebuyRequest.amount)}.</p> : null}

                                                    {heroInHand ? <p className="muted-copy">Rebuy is only available between hands.</p> : null}
                                                </>
                                            ) : (
                                                <p className="muted-copy">Take a seat to adjust your buy-in and rebuy amount.</p>
                                            )}
                                        </div>
                                    ) : null}

                                    {openMenuPanel === "media" ? (
                                        <div className="table-menu-drawer__section">
                                            <span className="table-menu-drawer__eyebrow">Media</span>
                                            {demoMode ? (
                                                <p className="muted-copy">This sample room uses mocked camera tiles so you can size a full 10-player table without connecting LiveKit.</p>
                                            ) : !session ? (
                                                <p className="muted-copy">Sign in to connect voice and video for the table.</p>
                                            ) : !media.isConnected ? (
                                                <button
                                                    className="button button--secondary table-menu-drawer__button"
                                                    type="button"
                                                    onClick={() => void media.handleConnectMedia()}
                                                    disabled={media.mediaStatus === "connecting" || Boolean(media.environmentError)}
                                                >
                                                    {media.mediaStatus === "connecting" ? "Connecting media" : "Connect media"}
                                                </button>
                                            ) : (
                                                <div className="seat-control-list seat-control-list--stacked">
                                                    <button className="button button--secondary table-menu-drawer__button" type="button" onClick={() => void media.handleToggleMicrophone()}>
                                                        {media.microphoneEnabled ? "Mute mic" : "Unmute mic"}
                                                    </button>
                                                    <button className="button button--secondary table-menu-drawer__button" type="button" onClick={() => void media.handleToggleCamera()}>
                                                        {media.cameraEnabled ? "Stop camera" : "Start camera"}
                                                    </button>
                                                    <button className="button button--primary table-menu-drawer__button" type="button" onClick={media.handleDisconnectMedia}>
                                                        Disconnect media
                                                    </button>
                                                </div>
                                            )}

                                            {mediaNotice ? <p className="form-error">{mediaNotice}</p> : null}
                                        </div>
                                    ) : null}

                                    {openMenuPanel === "admin" && isAdmin && snapshot ? (
                                        <div className="table-menu-drawer__section">
                                            <span className="table-menu-drawer__eyebrow">Admin options</span>

                                            <div className="table-admin-grid">
                                                <section className="table-admin-card">
                                                    <strong>Controls</strong>
                                                    <div className="seat-control-list seat-control-list--stacked">
                                                        <button className="button button--secondary table-menu-drawer__button" type="button" onClick={() => void handlePauseToggle()} disabled={isMutating}>
                                                            {snapshot.status === "paused" ? "Resume table" : "Pause table"}
                                                        </button>
                                                        <button className="button button--secondary table-menu-drawer__button" type="button" onClick={() => void handleStartHand()} disabled={isMutating || !canAdminStartHand || snapshot.status === "paused"}>
                                                            {readyPlayerCount >= 2 ? "Start next hand" : "Need 2 ready players"}
                                                        </button>
                                                        <button className="button button--danger table-menu-drawer__button" type="button" onClick={() => void handleStopTable()} disabled={isMutating || Boolean(currentHand)}>
                                                            Stop table
                                                        </button>
                                                    </div>
                                                    {currentHand ? <p className="muted-copy">Stop becomes available once the current hand is finished.</p> : null}
                                                </section>

                                                <section className="table-admin-card table-admin-card--wide">
                                                    <strong>Table options</strong>
                                                    <div className="table-admin-form-grid">
                                                        <label className="table-admin-field">
                                                            <span>Small blind</span>
                                                            <input className="control-input" type="number" min={1} step={1} value={adminOptionsDraft.smallBlind} onChange={(event) => setAdminOptionsDraft((current) => ({ ...current, smallBlind: event.target.value }))} />
                                                        </label>
                                                        <label className="table-admin-field">
                                                            <span>Big blind</span>
                                                            <input className="control-input" type="number" min={1} step={1} value={adminOptionsDraft.bigBlind} onChange={(event) => setAdminOptionsDraft((current) => ({ ...current, bigBlind: event.target.value }))} />
                                                        </label>
                                                        <label className="table-admin-field">
                                                            <span>Ante</span>
                                                            <input className="control-input" type="number" min={0} step={1} value={adminOptionsDraft.ante} onChange={(event) => setAdminOptionsDraft((current) => ({ ...current, ante: event.target.value }))} />
                                                        </label>
                                                        <label className="table-admin-field table-admin-field--toggle">
                                                            <input type="checkbox" checked={adminOptionsDraft.autoStartNextHand} onChange={(event) => setAdminOptionsDraft((current) => ({ ...current, autoStartNextHand: event.target.checked }))} />
                                                            <span>Auto start next hand</span>
                                                        </label>
                                                        <label className="table-admin-field">
                                                            <span>Showdown presentation time</span>
                                                            <input className="control-input" type="number" min={0} step={1} value={adminOptionsDraft.showdownPresentationSeconds} onChange={(event) => setAdminOptionsDraft((current) => ({ ...current, showdownPresentationSeconds: event.target.value }))} />
                                                        </label>
                                                        <label className="table-admin-field">
                                                            <span>Decision time limit</span>
                                                            <input className="control-input" type="number" min={0} step={1} value={adminOptionsDraft.decisionTimeSeconds} onChange={(event) => setAdminOptionsDraft((current) => ({ ...current, decisionTimeSeconds: event.target.value }))} placeholder="blank = no limit" />
                                                        </label>
                                                        <label className="table-admin-field">
                                                            <span>Time bank length</span>
                                                            <input className="control-input" type="number" min={0} step={1} value={adminOptionsDraft.timeBankSeconds} onChange={(event) => setAdminOptionsDraft((current) => ({ ...current, timeBankSeconds: event.target.value }))} placeholder="blank = no time bank" />
                                                        </label>
                                                        <label className="table-admin-field">
                                                            <span>Hands to refill bank</span>
                                                            <input className="control-input" type="number" min={0} step={1} value={adminOptionsDraft.timeBankRefillHands} onChange={(event) => setAdminOptionsDraft((current) => ({ ...current, timeBankRefillHands: event.target.value }))} placeholder="blank = disabled" />
                                                        </label>
                                                        <label className="table-admin-field table-admin-field--toggle">
                                                            <input type="checkbox" checked={adminOptionsDraft.useBlindSchedule} onChange={(event) => setAdminOptionsDraft((current) => ({ ...current, useBlindSchedule: event.target.checked }))} />
                                                            <span>Use blind schedule</span>
                                                        </label>
                                                        <label className="table-admin-field table-admin-field--toggle">
                                                            <input type="checkbox" checked={adminOptionsDraft.revealAllShowdownHands} onChange={(event) => setAdminOptionsDraft((current) => ({ ...current, revealAllShowdownHands: event.target.checked }))} />
                                                            <span>Reveal all hands when no more action is possible</span>
                                                        </label>
                                                    </div>

                                                    {adminOptionsDraft.useBlindSchedule ? (
                                                        <div className="table-admin-field table-admin-field--full table-admin-schedule">
                                                            <div className="table-admin-schedule__header">
                                                                <div>
                                                                    <span>Blind schedule</span>
                                                                    <small>Add one row per blind level. The final level stays in place after the schedule runs out.</small>
                                                                </div>
                                                                <button className="button button--secondary" type="button" onClick={handleAddBlindLevel} disabled={isMutating}>
                                                                    Add level
                                                                </button>
                                                            </div>

                                                            <div className="table-admin-schedule__rows">
                                                                {adminOptionsDraft.blindLevels.map((level, index) => {
                                                                    const rowValidation = blindScheduleValidation.rows[index] ?? {};
                                                                    const rowErrors = Object.values(rowValidation).filter((value): value is string => Boolean(value));
                                                                    const hasRowErrors = rowErrors.length > 0;

                                                                    return (
                                                                        <article key={`blind-level-${index + 1}`} className={["table-admin-schedule__row", hasRowErrors ? "table-admin-schedule__row--invalid" : ""].filter(Boolean).join(" ")}>
                                                                            <div className="table-admin-schedule__row-header">
                                                                                <strong>Level {index + 1}</strong>
                                                                                <button className="button button--secondary table-admin-schedule__remove" type="button" onClick={() => handleRemoveBlindLevel(index)} disabled={isMutating || adminOptionsDraft.blindLevels.length === 1}>
                                                                                    Remove
                                                                                </button>
                                                                            </div>

                                                                            <div className="table-admin-schedule__inputs">
                                                                                <label className="table-admin-field">
                                                                                    <span>Small blind</span>
                                                                                    <input
                                                                                        className={["control-input", rowValidation.smallBlind ? "table-admin-input--invalid" : ""].filter(Boolean).join(" ")}
                                                                                        type="number"
                                                                                        min={1}
                                                                                        step={1}
                                                                                        value={level.smallBlind}
                                                                                        onChange={(event) => updateBlindLevelDraft(index, "smallBlind", event.target.value)}
                                                                                        aria-invalid={rowValidation.smallBlind ? true : undefined}
                                                                                    />
                                                                                </label>
                                                                                <label className="table-admin-field">
                                                                                    <span>Big blind</span>
                                                                                    <input
                                                                                        className={["control-input", rowValidation.bigBlind ? "table-admin-input--invalid" : ""].filter(Boolean).join(" ")}
                                                                                        type="number"
                                                                                        min={1}
                                                                                        step={1}
                                                                                        value={level.bigBlind}
                                                                                        onChange={(event) => updateBlindLevelDraft(index, "bigBlind", event.target.value)}
                                                                                        aria-invalid={rowValidation.bigBlind ? true : undefined}
                                                                                    />
                                                                                </label>
                                                                                <label className="table-admin-field">
                                                                                    <span>Ante</span>
                                                                                    <input
                                                                                        className={["control-input", rowValidation.ante ? "table-admin-input--invalid" : ""].filter(Boolean).join(" ")}
                                                                                        type="number"
                                                                                        min={0}
                                                                                        step={1}
                                                                                        value={level.ante}
                                                                                        onChange={(event) => updateBlindLevelDraft(index, "ante", event.target.value)}
                                                                                        placeholder="0"
                                                                                        aria-invalid={rowValidation.ante ? true : undefined}
                                                                                    />
                                                                                </label>
                                                                                <label className="table-admin-field">
                                                                                    <span>Minutes</span>
                                                                                    <input
                                                                                        className={["control-input", rowValidation.durationMinutes ? "table-admin-input--invalid" : ""].filter(Boolean).join(" ")}
                                                                                        type="number"
                                                                                        min={1}
                                                                                        step={1}
                                                                                        value={level.durationMinutes}
                                                                                        onChange={(event) => updateBlindLevelDraft(index, "durationMinutes", event.target.value)}
                                                                                        aria-invalid={rowValidation.durationMinutes ? true : undefined}
                                                                                    />
                                                                                </label>
                                                                            </div>

                                                                            {hasRowErrors ? (
                                                                                <ul className="table-admin-schedule__errors">
                                                                                    {rowErrors.map((message) => (
                                                                                        <li key={`${index + 1}-${message}`}>{message}</li>
                                                                                    ))}
                                                                                </ul>
                                                                            ) : null}
                                                                        </article>
                                                                    );
                                                                })}
                                                            </div>

                                                            {blindScheduleValidation.errors.length ? (
                                                                <p className="table-admin-schedule__summary">Fix the highlighted blind levels before saving.</p>
                                                            ) : null}
                                                        </div>
                                                    ) : null}

                                                    <button className="button button--primary table-menu-drawer__button" type="button" onClick={() => void handleSaveAdminOptions()} disabled={isMutating || (adminOptionsDraft.useBlindSchedule && blindScheduleValidation.errors.length > 0)}>
                                                        Save table options
                                                    </button>
                                                </section>

                                                <section className="table-admin-card">
                                                    <strong>Seat approvals</strong>
                                                    {snapshot.pendingSeatRequests.length ? (
                                                        <div className="table-admin-list">
                                                            {snapshot.pendingSeatRequests.map((request) => (
                                                                <article key={request.id} className="table-admin-list__item">
                                                                    <div className="table-admin-list__meta">
                                                                        <strong>{request.displayName}</strong>
                                                                        <span>Seat {request.seatIndex + 1} · {formatNumber(request.requestedStack)}</span>
                                                                        <input
                                                                            className="control-input table-admin-list__input"
                                                                            type="number"
                                                                            min={1}
                                                                            step={1}
                                                                            value={seatApprovalDrafts[request.id] ?? String(request.requestedStack)}
                                                                            onChange={(event) => setSeatApprovalDrafts((current) => ({ ...current, [request.id]: event.target.value }))}
                                                                            placeholder="requested stack"
                                                                        />
                                                                    </div>
                                                                    <div className="table-admin-list__actions">
                                                                        <button className="button button--secondary" type="button" onClick={() => void handleSeatRequestDecision(request.id, false)} disabled={isMutating}>No</button>
                                                                        <button className="button button--primary" type="button" onClick={() => void handleSeatRequestDecision(request.id, true, seatApprovalDrafts[request.id])} disabled={isMutating}>Yes</button>
                                                                    </div>
                                                                </article>
                                                            ))}
                                                        </div>
                                                    ) : <p className="muted-copy">No seat approvals are waiting.</p>}
                                                </section>

                                                <section className="table-admin-card">
                                                    <strong>Rebuy approvals</strong>
                                                    {snapshot.pendingRebuyRequests.length ? (
                                                        <div className="table-admin-list">
                                                            {snapshot.pendingRebuyRequests.map((request) => (
                                                                <article key={request.id} className="table-admin-list__item">
                                                                    <div className="table-admin-list__meta">
                                                                        <strong>{request.displayName}</strong>
                                                                        <span>{formatNumber(request.amount)}</span>
                                                                        <input
                                                                            className="control-input table-admin-list__input"
                                                                            type="number"
                                                                            min={snapshot.buyInState.minRebuyAmount}
                                                                            max={snapshot.buyInState.maxRebuyAmount}
                                                                            step={1}
                                                                            value={rebuyApprovalDrafts[request.id] ?? String(request.amount)}
                                                                            onChange={(event) => setRebuyApprovalDrafts((current) => ({ ...current, [request.id]: event.target.value }))}
                                                                            placeholder="rebuy amount"
                                                                        />
                                                                    </div>
                                                                    <div className="table-admin-list__actions">
                                                                        <button className="button button--secondary" type="button" onClick={() => void handleRebuyRequestDecision(request.id, false)} disabled={isMutating}>No</button>
                                                                        <button className="button button--primary" type="button" onClick={() => void handleRebuyRequestDecision(request.id, true, rebuyApprovalDrafts[request.id])} disabled={isMutating}>Yes</button>
                                                                    </div>
                                                                </article>
                                                            ))}
                                                        </div>
                                                    ) : <p className="muted-copy">No rebuy approvals are waiting.</p>}
                                                </section>

                                                <section className="table-admin-card table-admin-card--wide">
                                                    <strong>Players</strong>
                                                    <div className="table-admin-list">
                                                        {snapshot.players.map((player) => (
                                                            <article key={player.accountId} className="table-admin-list__item">
                                                                <div>
                                                                    <strong>{player.displayName}</strong>
                                                                    <span>Seat {player.seatIndex + 1} · Stack {formatNumber(player.stack)}</span>
                                                                </div>
                                                                {player.accountId !== snapshot.adminAccountId ? (
                                                                    <button className="button button--danger" type="button" onClick={() => void handleRemovePlayer(player.accountId)} disabled={isMutating || Boolean(currentHand?.playerCardCounts[player.accountId])}>
                                                                        Remove
                                                                    </button>
                                                                ) : <span className="chip-pill">Admin</span>}
                                                            </article>
                                                        ))}
                                                    </div>
                                                </section>
                                            </div>
                                        </div>
                                    ) : null}
                                </div>
                            ) : null}
                        </div>

                        <div className="table-status-rack">
                            {snapshot?.status === "paused" ? <span className="chip-pill">Paused</span> : null}
                            <span className="chip-pill">Hand {currentHand?.handNumber ?? snapshot?.lastCompletedHand?.handNumber ?? snapshot?.handCount ?? 0}</span>
                            {snapshot?.blindState.nextLevel && blindCountdownMs !== null ? <span className="chip-pill chip-pill--timer">Next {formatBlindLevelCompact(snapshot.blindState.nextLevel)} in {formatClockCountdown(blindCountdownMs)}</span> : null}
                            {turnMetrics ? <span className="chip-pill chip-pill--timer">Turn {formatTurnSeconds(turnMetrics.mainSecondsRemaining)}</span> : null}
                            {turnMetrics && currentActor ? <span className="chip-pill">Action {currentActor.displayName}</span> : null}
                            {isAdmin ? (
                                <>
                                    <button className="table-status-rack__control" type="button" onClick={() => void handlePauseToggle()} disabled={isMutating}>
                                        {snapshot?.status === "paused" ? "Resume" : "Pause"}
                                    </button>
                                    <button className="table-status-rack__control table-status-rack__control--danger" type="button" onClick={() => void handleStopTable()} disabled={isMutating || Boolean(currentHand)}>
                                        Stop
                                    </button>
                                </>
                            ) : null}
                        </div>

                        <div className="table-center">
                            <span className="table-center__label">{currentHand ? `Hand ${currentHand.handNumber} · ${formatStreet(currentHand.street)}` : snapshot?.lastCompletedHand ? "" : "Waiting for players"}</span>
                            <div className="table-center__pot">Pot {formatNumber(displayedPot)}</div>
                            <div className="table-board table-center__board">
                                {buildBoardSlots(displayedBoard).map((slot, index) => (
                                    <PokerCard key={`board-${index}`} card={slot.card} isFaceUp={slot.isFaceUp} size="board" backLabel={slot.backLabel} />
                                ))}
                            </div>
                            {turnMetrics && currentActor ? (
                                <div className={[
                                    "table-center__turn-clock",
                                    turnMetrics.isUsingTimeBank ? "table-center__turn-clock--timebank" : "",
                                ].filter(Boolean).join(" ")}>
                                    <strong>{currentActor.displayName}</strong>
                                    <span>{turnMetrics.isUsingTimeBank ? `Time bank ${formatTurnSeconds(turnMetrics.timeBankSecondsRemaining)}` : `${formatTurnSeconds(turnMetrics.mainSecondsRemaining)} to act`}</span>
                                </div>
                            ) : null}
                            <p className="table-center__status">{centerStatus}</p>
                            {showCenterReadyButton || showCenterStartHand ? (
                                <div className="table-center__actions">
                                    {showCenterReadyButton ? (
                                        <button className="button button--primary table-center__action" type="button" onClick={() => void handleReadyToggle()} disabled={isMutating}>
                                            Ready
                                        </button>
                                    ) : null}
                                    {showCenterStartHand ? (
                                        <button
                                            className={[
                                                "button",
                                                showCenterReadyButton ? "button--secondary" : "button--primary",
                                                "table-center__action",
                                            ].join(" ")}
                                            type="button"
                                            onClick={() => void handleStartHand()}
                                            disabled={isMutating}
                                        >
                                            Start hand
                                        </button>
                                    ) : null}
                                </div>
                            ) : null}
                        </div>

                        {tableSeats.map((seat) => {
                            const mediaParticipant = seat.player
                                ? seat.isHero
                                    ? mediaByAccountId.get(seat.player.accountId) ?? media.localParticipant ?? null
                                    : mediaByAccountId.get(seat.player.accountId) ?? null
                                : null;
                            const seatCards = buildSeatCardSlots(seat);
                            const seatReaction = seat.player ? activeSeatReactions.get(seat.player.accountId) ?? null : null;
                            const seatGesture = seat.player ? seatGesturesByAccountId.get(seat.player.accountId) ?? null : null;
                            const showSeatMediaTile = seat.isHero ? true : Boolean(mediaParticipant) && (!isPhoneViewport || isSpectating);
                            const hasVisibleRevealedCard = Boolean(seat.revealedCards?.some((card) => card !== null));
                            const showHeroNotReadyNotice = Boolean(seat.isHero && heroPlayer && !heroPlayer.isReady && !heroPlayer.isSittingOut);

                            return (
                                <article
                                    key={seat.seatIndex}
                                    className={[
                                        "table-seat",
                                        seat.isHero ? "table-seat--hero" : "",
                                        seat.isHero && isReactionMenuOpen ? "table-seat--emoji-open" : "",
                                        seat.isActive ? "table-seat--active" : "",
                                        seat.isFolded ? "table-seat--folded" : "",
                                        seat.isOpen ? "table-seat--open" : "",
                                        seat.isWinner ? "table-seat--winner" : "",
                                        hasVisibleRevealedCard ? "table-seat--revealed" : "",
                                        showSeatMediaTile ? "table-seat--with-media" : "",
                                        isSpectating && showSeatMediaTile ? "table-seat--spectator-media" : "",
                                        seat.shiftCardsLeftMore ? "table-seat--cards-left-more" : "",
                                        seat.shiftCardsRightMore ? "table-seat--cards-right-more" : "",
                                        `table-seat--media-${seat.mediaPlacement}`,
                                    ].filter(Boolean).join(" ")}
                                    style={seat.style}
                                >
                                    {showHeroNotReadyNotice ? <div className="table-seat__notice table-seat__notice--warning">Not ready</div> : null}
                                    {seat.runoutWinPercent !== null ? (
                                        <div
                                            className={[
                                                "table-seat__equity",
                                                seat.runoutEquityTrend === "up" ? "table-seat__equity--up" : "",
                                                seat.runoutEquityTrend === "down" ? "table-seat__equity--down" : "",
                                                seat.isRunoutEquityLeader ? "table-seat__equity--leader" : "",
                                            ].filter(Boolean).join(" ")}
                                            aria-label={`${seat.name} win chance ${seat.runoutWinPercent}%`}
                                        >
                                            <span className="table-seat__equity-label">Win</span>
                                            <strong className="table-seat__equity-value">{seat.runoutWinPercent}%</strong>
                                        </div>
                                    ) : null}
                                    {seatGesture ? <div className={["table-seat__gesture", `table-seat__gesture--${seat.mediaPlacement}`].join(" ")}>{seatGesture.emoji}</div> : null}
                                    {seatReaction ? <div className="table-seat__reaction">{seatReaction.emoji}</div> : null}
                                    {seat.actionBubble ? <div className="table-seat__bubble">{seat.actionBubble}</div> : null}
                                    {seat.contributionLabel ? <div className="table-seat__chips">{seat.contributionLabel}</div> : null}
                                    {seat.isActive && turnMetrics ? (
                                        <div className={["table-seat__timer", turnMetrics.isUsingTimeBank ? "table-seat__timer--timebank" : ""].filter(Boolean).join(" ")}>
                                            {turnMetrics.isUsingTimeBank ? `TB ${formatTurnSeconds(turnMetrics.timeBankSecondsRemaining)}` : formatTurnSeconds(turnMetrics.mainSecondsRemaining)}
                                        </div>
                                    ) : null}

                                    {seat.isOpen ? (
                                        <>
                                            <div className="table-seat__header">
                                                <div className="table-seat__avatar">{seat.avatarLabel}</div>
                                                <div className="table-seat__identity">
                                                    <strong>{seat.pendingRequest ? "Pending" : seat.name}</strong>
                                                    <span>{seat.pendingRequest ? `${seat.pendingRequest.displayName} · ${formatNumber(seat.pendingRequest.requestedStack)}` : seat.stackLabel}</span>
                                                </div>
                                            </div>

                                            <div className="table-seat__footer">
                                                <span className={`table-seat__state table-seat__state--${seat.stateTone}`}>{seat.statusLabel}</span>
                                                <span className="table-seat__seat-label">Seat {seat.seatIndex + 1}</span>
                                            </div>

                                            {heroPlayer === null ? (
                                                <button
                                                    className="button button--secondary table-seat__button"
                                                    type="button"
                                                    onClick={() => handleSeatClick(seat.seatIndex)}
                                                    disabled={isMutating || !accountId || Boolean(seat.pendingRequest)}
                                                >
                                                    {seat.pendingRequest ? "Pending" : heroPendingSeatRequest ? "Move request" : "Take seat"}
                                                </button>
                                            ) : null}
                                        </>
                                    ) : (
                                        <div className={[
                                            "table-seat__visuals",
                                            showSeatMediaTile ? "table-seat__visuals--with-media" : "table-seat__visuals--cards-only",
                                        ].filter(Boolean).join(" ")}>
                                            {showSeatMediaTile ? (
                                                <div className="table-seat__media-wrap">
                                                    {seat.isHero ? (
                                                        <div className="table-seat__reaction-control">
                                                            <button
                                                                className="table-seat__reaction-toggle"
                                                                type="button"
                                                                onClick={() => {
                                                                    setGestureInput(heroGesture?.emoji ?? "");
                                                                    setIsReactionMenuOpen((current) => !current);
                                                                }}
                                                                disabled={!heroPlayer || isMutating}
                                                            >
                                                                Emoji
                                                            </button>

                                                            {isReactionMenuOpen ? (
                                                                <div className="table-seat__reaction-popover">
                                                                    <div className="table-seat__reaction-group">
                                                                        <span className="table-seat__reaction-heading">Quick reaction</span>
                                                                        <div className="reaction-strip reaction-strip--table">
                                                                            {QUICK_REACTIONS.map((emoji) => (
                                                                                <button
                                                                                    key={emoji}
                                                                                    className="reaction-strip__button table-seat__reaction-button"
                                                                                    type="button"
                                                                                    onClick={() => void handleSendReaction(emoji)}
                                                                                    disabled={isMutating || !heroPlayer}
                                                                                >
                                                                                    {emoji}
                                                                                </button>
                                                                            ))}
                                                                        </div>
                                                                    </div>

                                                                    <div className="table-seat__reaction-group">
                                                                        <span className="table-seat__reaction-heading">Emoji browser</span>
                                                                        <div className="table-seat__emoji-picker">
                                                                            <EmojiPicker
                                                                                data={emojiData}
                                                                                emojiButtonSize={34}
                                                                                emojiSize={20}
                                                                                maxFrequentRows={1}
                                                                                navPosition="bottom"
                                                                                onEmojiSelect={(selection: EmojiPickerSelection) => {
                                                                                    const nextEmoji = getNativeEmoji(selection);

                                                                                    if (nextEmoji) {
                                                                                        setGestureInput(nextEmoji);
                                                                                    }
                                                                                }}
                                                                                perLine={8}
                                                                                previewPosition="none"
                                                                                searchPosition="sticky"
                                                                                set="native"
                                                                                theme="dark"
                                                                            />
                                                                        </div>

                                                                        <div className="table-seat__gesture-preview-row">
                                                                            <div className="table-seat__gesture-preview">
                                                                                <span className="table-seat__gesture-preview-label">Selected</span>
                                                                                <strong>{gestureInput.trim() || heroGesture?.emoji || "None"}</strong>
                                                                            </div>

                                                                            <div className="table-seat__gesture-actions">
                                                                                <button
                                                                                    className="button button--secondary table-seat__gesture-action"
                                                                                    type="button"
                                                                                    onClick={() => void handleSendReaction(gestureInput.trim())}
                                                                                    disabled={isMutating || !heroPlayer || !gestureInput.trim()}
                                                                                >
                                                                                    React
                                                                                </button>
                                                                                <button
                                                                                    className="button button--primary table-seat__gesture-action"
                                                                                    type="button"
                                                                                    onClick={() => void handleSetGesture(gestureInput.trim() || null)}
                                                                                    disabled={isMutating || !heroPlayer || !gestureInput.trim()}
                                                                                >
                                                                                    Set gesture
                                                                                </button>
                                                                                <button
                                                                                    className="button button--secondary table-seat__gesture-action"
                                                                                    type="button"
                                                                                    onClick={() => void handleSetGesture(null)}
                                                                                    disabled={isMutating || !heroPlayer || !heroGesture}
                                                                                >
                                                                                    Clear
                                                                                </button>
                                                                            </div>
                                                                        </div>

                                                                        {heroGesture ? (
                                                                            <p className="muted-copy">Current gesture: {heroGesture.emoji}</p>
                                                                        ) : (
                                                                            <p className="muted-copy">Gestures stay beside your seat until you change or clear them.</p>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            ) : null}
                                                        </div>
                                                    ) : null}

                                                    {mediaParticipant ? (
                                                        <div className={[
                                                            "table-seat__media",
                                                            mediaParticipant.isSpeaking ? "table-seat__media--speaking" : "",
                                                            mediaParticipant.demoSurface ? "table-seat__media--demo" : "",
                                                        ].filter(Boolean).join(" ")}>
                                                            <ParticipantCameraSurface
                                                                participant={mediaParticipant}
                                                                className="table-seat__media-surface"
                                                                emptyLabel={mediaParticipant.isLocal ? "Your camera is off" : `${mediaParticipant.name} camera is off`}
                                                            />
                                                            <span className="table-seat__media-badge">{describeMediaBadge(mediaParticipant)}</span>
                                                        </div>
                                                    ) : (
                                                        <div className="table-seat__media table-seat__media--fallback">
                                                            <span className="table-seat__media-fallback-avatar">{seat.avatarLabel}</span>
                                                            <span className="table-seat__media-badge">Awaiting camera</span>
                                                        </div>
                                                    )}
                                                </div>
                                            ) : null}

                                            <div className="table-seat__content">
                                                {seat.isHero && heroHandLabel ? <div className="table-seat__hero-hand">{heroHandLabel}</div> : null}

                                                <div className="table-seat__identity">
                                                    <strong>{seat.name}</strong>
                                                    <span>{seat.stackLabel}</span>
                                                </div>

                                                {seatGesture ? <span className="table-seat__mobile-gesture">{seatGesture.emoji}</span> : null}

                                                {seat.markers.length ? (
                                                    <div className="table-seat__markers">
                                                        {seat.markers.map((marker) => (
                                                            <span key={`${seat.seatIndex}-${marker.label}`} className={`table-seat__marker table-seat__marker--${marker.tone}`}>
                                                                {marker.label}
                                                            </span>
                                                        ))}
                                                    </div>
                                                ) : null}

                                                <div className="table-seat__stats" aria-label={`${seat.name} stats`}>
                                                    <span className={[
                                                        "table-seat__stat-pill",
                                                        seat.handsWonCount > 0 ? "table-seat__stat-pill--wins" : "table-seat__stat-pill--muted",
                                                    ].join(" ")}>
                                                        <span className="table-seat__stat-pill-label">W</span>
                                                        <span>{seat.handsWonCount}</span>
                                                    </span>
                                                    <span className={[
                                                        "table-seat__stat-pill",
                                                        seat.rebuyCount > 0 ? "table-seat__stat-pill--rebuys" : "table-seat__stat-pill--muted",
                                                    ].join(" ")}>
                                                        <span className="table-seat__stat-pill-label">R</span>
                                                        <span>{seat.rebuyCount}</span>
                                                    </span>
                                                    {hasVisibleRevealedCard ? (
                                                        <span className="table-seat__stat-pill table-seat__stat-pill--revealed">
                                                            <span className="table-seat__stat-pill-label">Show</span>
                                                            <span>On</span>
                                                        </span>
                                                    ) : null}
                                                </div>

                                                <div className="table-seat__footer">
                                                    <span className={`table-seat__state table-seat__state--${seat.stateTone}`}>{seat.statusLabel}</span>
                                                    <span className="table-seat__seat-label">Seat {seat.seatIndex + 1}</span>
                                                </div>
                                            </div>

                                            {seatCards.length > 0 ? (
                                                <div className={[
                                                    "table-seat__cards",
                                                    hasVisibleRevealedCard ? "table-seat__cards--revealed" : "",
                                                ].filter(Boolean).join(" ")} style={seat.cardStyle} aria-hidden="true">
                                                    {seatCards.map((slot, index) => (
                                                        <PokerCard key={`${seat.seatIndex}-${index}`} card={slot.card} isFaceUp={slot.isFaceUp} size="seat" backLabel={slot.backLabel} animationIndex={index} />
                                                    ))}
                                                </div>
                                            ) : null}
                                        </div>
                                    )}
                                </article>
                            );
                        })}

                        <div className="table-command-deck">
                            <div className={[
                                "table-command-deck__action-wrap",
                                isActionPadDragging ? "table-command-deck__action-wrap--dragging" : "",
                            ].filter(Boolean).join(" ")}>
                                {renderActionPanel("inline")}
                                <button className="button button--primary table-mobile-actions__toggle" type="button" onClick={() => setIsMobileActionMenuOpen(true)}>
                                    {heroActionState?.canAct ? "Open actions" : "Table actions"}
                                </button>
                            </div>

                            <section className={["table-hero-stats-bar", heroPlayer ? "" : "table-hero-stats-bar--empty"].filter(Boolean).join(" ")}>
                                {heroPlayer ? (
                                    <>
                                        <div className="table-hero-stats-bar__item"><strong>Stack</strong><span>{formatNumber(heroDisplayedStack)}</span></div>
                                        <div className="table-hero-stats-bar__item"><strong>Committed</strong><span>{formatNumber(heroContribution)}</span></div>
                                        <div className="table-hero-stats-bar__item"><strong>Bank</strong><span>{snapshot?.turnState.timeBankSeconds === null ? "Off" : formatTurnSeconds(Math.ceil(heroTimeBankMs / 1000))}</span></div>
                                        <div className="table-hero-stats-bar__item"><strong>Bought in</strong><span>{formatNumber(heroBuyInTotal)}</span></div>
                                        <div className="table-hero-stats-bar__item"><strong>Won</strong><span>{formatNumber(heroHandsWonCount)}</span></div>
                                        <div className="table-hero-stats-bar__item"><strong>Rebuys</strong><span>{formatNumber(heroRebuyCount)}</span></div>
                                    </>
                                ) : (
                                    <p className="table-hero-stats-bar__empty-copy">Take a seat to track your stack, bank, buy-in, wins, and rebuys.</p>
                                )}
                            </section>
                        </div>
                    </div>
                </section>

                <section className="table-log-panel table-log-panel--below">
                    <div className="table-activity-grid">
                        <section className="table-ledger-panel">
                            <div className="table-log-panel__header">
                                <span className="table-log-panel__eyebrow">Log</span>
                                <strong>{currentHand ? `Hand ${currentHand.handNumber}` : selectedCompletedHand ? `Hand ${selectedCompletedHand.handNumber}` : snapshot?.slug ?? slug}</strong>
                            </div>

                            {currentHand?.actions.length ? (
                                <div className="table-ledger-panel__live">
                                    <span className="table-ledger-panel__section-label">Current hand</span>
                                    <ul className="action-log">
                                        {currentHand.actions.slice(-12).reverse().map((action) => (
                                            <li key={`${action.orderIndex}-${action.createdAt}`} className="action-log__item">
                                                <strong>{snapshot?.players.find((player) => player.accountId === action.actorAccountId)?.displayName ?? action.actorAccountId}</strong>
                                                <span>{formatActionSummary(action)}</span>
                                                <span>{formatStreet(action.street)}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            ) : null}

                            {recentCompletedHands.length ? (
                                <div className="table-ledger-panel__history-strip">
                                    {recentCompletedHands.map((hand) => (
                                        <button
                                            key={hand.handId}
                                            className={[
                                                "table-ledger-panel__history-button",
                                                selectedCompletedHand?.handId === hand.handId ? "table-ledger-panel__history-button--active" : "",
                                            ].filter(Boolean).join(" ")}
                                            type="button"
                                            onClick={() => setSelectedLedgerHandId(hand.handId)}
                                        >
                                            Hand {hand.handNumber}
                                        </button>
                                    ))}
                                </div>
                            ) : null}

                            {selectedCompletedHand ? (
                                <div className="table-ledger-panel__recap">
                                    <div className="table-ledger-panel__recap-header">
                                        <strong>Hand {selectedCompletedHand.handNumber}</strong>
                                        <span>{selectedCompletedHandRunout?.isActive ? "Running board" : selectedCompletedHand.winningReason === "showdown" ? "Showdown" : "Won before showdown"}</span>
                                    </div>

                                    <div className="table-board table-board--compact table-ledger-panel__board">
                                        {buildBoardSlots(selectedCompletedHandBoard).map((slot, index) => (
                                            <PokerCard key={`history-hand-${selectedCompletedHand.handId}-${index}`} card={slot.card} isFaceUp={slot.isFaceUp} size="compact" backLabel={slot.backLabel} />
                                        ))}
                                    </div>

                                    {selectedCompletedHand.actions.length ? (
                                        <ul className="action-log table-ledger-panel__action-log">
                                            {selectedCompletedHand.actions.map((action) => (
                                                <li key={`${selectedCompletedHand.handId}-${action.orderIndex}`} className="action-log__item">
                                                    <strong>{snapshot?.players.find((player) => player.accountId === action.actorAccountId)?.displayName ?? action.actorAccountId}</strong>
                                                    <span>{formatActionSummary(action)}</span>
                                                    <span>{formatStreet(action.street)}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    ) : null}

                                    {selectedCompletedHandRevealEntries.length ? (
                                        <div className="table-ledger-panel__reveals">
                                            {selectedCompletedHandRevealEntries.map(([accountId, cards]) => (
                                                <article key={`${selectedCompletedHand.handId}-${accountId}`} className="table-ledger-panel__reveal">
                                                    <strong>{snapshot?.players.find((player) => player.accountId === accountId)?.displayName ?? accountId}</strong>
                                                    <div className="table-ledger-panel__reveal-cards">
                                                        {cards.filter((card): card is Card => card !== null).map((card, index) => (
                                                            <PokerCard key={`${selectedCompletedHand.handId}-${accountId}-${index}`} card={card} isFaceUp size="compact" backLabel="Reveal" />
                                                        ))}
                                                    </div>
                                                </article>
                                            ))}
                                        </div>
                                    ) : null}

                                    {selectedCompletedHandRunout?.isActive ? (
                                        <p className="muted-copy">Board is still running before the showdown result locks in.</p>
                                    ) : (
                                        <ul className="winner-list">
                                            {selectedCompletedHandWinners.map((winner) => (
                                                <li key={`${selectedCompletedHand.handId}-${winner.accountId}`}>
                                                    🏆 {snapshot?.players.find((player) => player.accountId === winner.accountId)?.displayName ?? winner.accountId} won {formatNumber(winner.amountWon)}
                                                    {winner.handLabel ? ` with ${winner.handLabel}` : ""}
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </div>
                            ) : currentHand?.actions.length ? null : (
                                <p className="muted-copy">Start a hand to populate the action log and hand recap history.</p>
                            )}
                        </section>

                        <section className="table-chat-panel table-chat-panel--surface">
                            <div className="table-log-panel__header">
                                <span className="table-log-panel__eyebrow">Chat</span>
                                <strong>{snapshot?.name ?? slug}</strong>
                            </div>

                            <div className="table-chat-panel__messages">
                                {snapshot?.chatMessages.length ? snapshot.chatMessages.slice(-20).reverse().map((message) => (
                                    <article key={message.id} className="table-chat-panel__message">
                                        <div className="table-chat-panel__meta">
                                            <strong>{message.displayName}</strong>
                                            <span>{formatChatTimestamp(message.createdAt)}</span>
                                        </div>
                                        <p>{message.content}</p>
                                    </article>
                                )) : <p className="muted-copy">Table chat is empty. Say something before the next hand starts.</p>}
                            </div>

                            <div className="table-chat-panel__composer">
                                <input
                                    ref={chatInputRef}
                                    className="control-input"
                                    type="text"
                                    value={chatDraft}
                                    onChange={(event) => setChatDraft(event.target.value)}
                                    placeholder={canChat ? "Type a table message" : "Join the room to chat"}
                                    maxLength={240}
                                    disabled={!canChat || isMutating}
                                    onKeyDown={(event) => {
                                        if (event.key === "Enter") {
                                            event.preventDefault();
                                            void handleSendChatMessage();
                                        }
                                    }}
                                />
                                <button className="button button--primary table-chat-panel__send" type="button" onClick={() => void handleSendChatMessage()} disabled={!canChat || isMutating || chatDraft.trim().length === 0}>
                                    Send
                                </button>
                            </div>
                        </section>
                    </div>
                </section>

                <MediaAudioRack participants={demoMode ? [] : effectiveRemoteParticipants} />
            </section>

            {seatRequestPrompt ? (
                <div className="table-dialog" role="dialog" aria-modal="true" aria-label="Seat request">
                    <button className="table-dialog__backdrop" type="button" aria-label="Close seat request" onClick={() => setSeatRequestPrompt(null)} />
                    <section className="table-dialog__panel table-dialog__panel--compact">
                        <header className="table-dialog__header">
                            <div>
                                <span className="table-menu-drawer__eyebrow">Seat request</span>
                                <h2>Request Seat {seatRequestPrompt.seatIndex + 1}</h2>
                                <p>Choose the stack you want the game owner to approve.</p>
                            </div>
                            <button className="table-dialog__close" type="button" onClick={() => setSeatRequestPrompt(null)} aria-label="Close seat request">
                                ×
                            </button>
                        </header>

                        <label className="table-admin-field">
                            <span>Intended stack</span>
                            <input
                                className="control-input"
                                type="number"
                                min={1}
                                step={1}
                                value={seatRequestPrompt.requestedStack}
                                onChange={(event) => setSeatRequestPrompt((current) => current ? { ...current, requestedStack: event.target.value } : current)}
                            />
                        </label>

                        {actionError ? <p className="form-error table-dialog__error">{actionError}</p> : null}

                        <div className="table-dialog__actions">
                            <button className="button button--secondary" type="button" onClick={() => setSeatRequestPrompt(null)} disabled={isMutating}>
                                Cancel
                            </button>
                            <button className="button button--primary" type="button" onClick={() => void handleConfirmSeatRequest()} disabled={isMutating}>
                                Send request
                            </button>
                        </div>
                    </section>
                </div>
            ) : null}

            {requestNoticeModal ? (
                <div className="table-dialog" role="dialog" aria-modal="true" aria-label="Seat request sent">
                    <button className="table-dialog__backdrop" type="button" aria-label="Close confirmation" onClick={() => setRequestNoticeModal(null)} />
                    <section className="table-dialog__panel table-dialog__panel--compact">
                        <header className="table-dialog__header">
                            <div>
                                <span className="table-menu-drawer__eyebrow">Request sent</span>
                                <h2>{requestNoticeModal.title}</h2>
                                <p>{requestNoticeModal.message}</p>
                            </div>
                            <button className="table-dialog__close" type="button" onClick={() => setRequestNoticeModal(null)} aria-label="Close confirmation">
                                ×
                            </button>
                        </header>

                        <div className="table-dialog__actions">
                            <button className="button button--primary" type="button" onClick={() => setRequestNoticeModal(null)}>
                                OK
                            </button>
                        </div>
                    </section>
                </div>
            ) : null}

            {activeAdminSeatRequest ? (
                <div className="table-dialog" role="dialog" aria-modal="true" aria-label="Seat approval request">
                    <button className="table-dialog__backdrop" type="button" aria-label="Review later" onClick={handleDismissAdminApprovalModal} />
                    <section className="table-dialog__panel table-dialog__panel--compact">
                        <header className="table-dialog__header">
                            <div>
                                <span className="table-menu-drawer__eyebrow">Seat approval</span>
                                <h2>{activeAdminSeatRequest.displayName} wants Seat {activeAdminSeatRequest.seatIndex + 1}</h2>
                                <p>Approve, deny, or leave this request for later review.</p>
                            </div>
                            <button className="table-dialog__close" type="button" onClick={handleDismissAdminApprovalModal} aria-label="Review later">
                                ×
                            </button>
                        </header>

                        <label className="table-admin-field">
                            <span>Requested stack</span>
                            <input
                                className="control-input"
                                type="number"
                                min={1}
                                step={1}
                                value={seatApprovalDrafts[activeAdminSeatRequest.id] ?? String(activeAdminSeatRequest.requestedStack)}
                                onChange={(event) => setSeatApprovalDrafts((current) => ({ ...current, [activeAdminSeatRequest.id]: event.target.value }))}
                            />
                        </label>

                        {actionError ? <p className="form-error table-dialog__error">{actionError}</p> : null}

                        <div className="table-dialog__actions">
                            <button className="button button--secondary" type="button" onClick={handleDismissAdminApprovalModal} disabled={isMutating}>
                                Later
                            </button>
                            <button className="button button--secondary" type="button" onClick={() => void handleSeatRequestDecision(activeAdminSeatRequest.id, false)} disabled={isMutating}>
                                No
                            </button>
                            <button className="button button--primary" type="button" onClick={() => void handleSeatRequestDecision(activeAdminSeatRequest.id, true, seatApprovalDrafts[activeAdminSeatRequest.id])} disabled={isMutating}>
                                Yes
                            </button>
                        </div>
                    </section>
                </div>
            ) : null}

            {activeAdminRebuyRequest ? (
                <div className="table-dialog" role="dialog" aria-modal="true" aria-label="Rebuy approval request">
                    <button className="table-dialog__backdrop" type="button" aria-label="Review later" onClick={handleDismissAdminApprovalModal} />
                    <section className="table-dialog__panel table-dialog__panel--compact">
                        <header className="table-dialog__header">
                            <div>
                                <span className="table-menu-drawer__eyebrow">Rebuy approval</span>
                                <h2>{activeAdminRebuyRequest.displayName} requested a rebuy</h2>
                                <p>Approve, deny, or leave this rebuy waiting.</p>
                            </div>
                            <button className="table-dialog__close" type="button" onClick={handleDismissAdminApprovalModal} aria-label="Review later">
                                ×
                            </button>
                        </header>

                        <label className="table-admin-field">
                            <span>Rebuy amount</span>
                            <input
                                className="control-input"
                                type="number"
                                min={snapshot?.buyInState.minRebuyAmount ?? 1}
                                max={snapshot?.buyInState.maxRebuyAmount}
                                step={1}
                                value={rebuyApprovalDrafts[activeAdminRebuyRequest.id] ?? String(activeAdminRebuyRequest.amount)}
                                onChange={(event) => setRebuyApprovalDrafts((current) => ({ ...current, [activeAdminRebuyRequest.id]: event.target.value }))}
                            />
                        </label>

                        {actionError ? <p className="form-error table-dialog__error">{actionError}</p> : null}

                        <div className="table-dialog__actions">
                            <button className="button button--secondary" type="button" onClick={handleDismissAdminApprovalModal} disabled={isMutating}>
                                Later
                            </button>
                            <button className="button button--secondary" type="button" onClick={() => void handleRebuyRequestDecision(activeAdminRebuyRequest.id, false)} disabled={isMutating}>
                                No
                            </button>
                            <button className="button button--primary" type="button" onClick={() => void handleRebuyRequestDecision(activeAdminRebuyRequest.id, true, rebuyApprovalDrafts[activeAdminRebuyRequest.id])} disabled={isMutating}>
                                Yes
                            </button>
                        </div>
                    </section>
                </div>
            ) : null}

            {isEngineInfoOpen ? (
                <div className="table-dialog" role="dialog" aria-modal="true" aria-label="Poker engine information">
                    <button className="table-dialog__backdrop" type="button" aria-label="Close poker engine information" onClick={() => setIsEngineInfoOpen(false)} />
                    <section className="table-dialog__panel table-dialog__panel--wide table-dialog__panel--scrollable">
                        <header className="table-dialog__header">
                            <div>
                                <span className="table-menu-drawer__eyebrow">Engine info</span>
                                <h2>How this poker engine computes hands</h2>
                                <p>These are the rules the table uses to shuffle, deal, rank hands, and settle the pot at showdown.</p>
                            </div>
                            <button className="table-dialog__close" type="button" onClick={() => setIsEngineInfoOpen(false)} aria-label="Close poker engine information">
                                ×
                            </button>
                        </header>

                        <div className="table-dialog__content table-dialog__content--engine">
                            {ENGINE_EXPLAINER_SECTIONS.map((section) => (
                                <section key={section.title} className="table-dialog__section">
                                    <strong>{section.title}</strong>
                                    <p>{section.copy}</p>
                                </section>
                            ))}

                            <section className="table-dialog__section table-dialog__section--full">
                                <strong>Hand ranking order</strong>
                                <ol className="table-dialog__list">
                                    {ENGINE_HAND_RANKS.map((handRank) => (
                                        <li key={handRank}>{handRank}</li>
                                    ))}
                                </ol>
                            </section>
                        </div>

                        <div className="table-dialog__actions">
                            <button className="button button--primary" type="button" onClick={() => setIsEngineInfoOpen(false)}>
                                Close
                            </button>
                        </div>
                    </section>
                </div>
            ) : null}

            {HOUSE_RULES_CONFIG.visible && isHouseRulesOpen ? (
                <div className="table-dialog" role="dialog" aria-modal="true" aria-label="House rules">
                    <button className="table-dialog__backdrop" type="button" aria-label="Close house rules" onClick={() => setIsHouseRulesOpen(false)} />
                    <section className="table-dialog__panel table-dialog__panel--wide table-dialog__panel--scrollable">
                        <header className="table-dialog__header">
                            <div>
                                <span className="table-menu-drawer__eyebrow">House Rules</span>
                                <h2>{HOUSE_RULES_CONFIG.title}</h2>
                                <p>Last updated: {HOUSE_RULES_CONFIG.lastUpdated}</p>
                            </div>
                            <button className="table-dialog__close" type="button" onClick={() => setIsHouseRulesOpen(false)} aria-label="Close house rules">
                                ×
                            </button>
                        </header>

                        <div className="table-dialog__content table-dialog__content--house-rules">
                            <section className="table-dialog__section table-dialog__section--house-rules-intro">
                                {HOUSE_RULES_CONFIG.overview.map((paragraph, index) => (
                                    <p key={index}>{paragraph}</p>
                                ))}
                            </section>

                            {HOUSE_RULES_CONFIG.sections.map((section) => (
                                <section key={section.title} className="table-dialog__section table-dialog__section--house-rules-card">
                                    <div className="table-dialog__house-rule-heading">
                                        <h3>
                                            <span className="table-dialog__house-rule-icon" aria-hidden="true">{section.icon}</span>
                                            <span>{section.title}</span>
                                            {section.badge ? <span className="table-dialog__house-rule-badge">{section.badge}</span> : null}
                                        </h3>
                                        {section.credit ? <p className="table-dialog__house-rule-credit">({section.credit})</p> : null}
                                    </div>

                                    {section.paragraphs.map((paragraph, index) => (
                                        <p key={index}>{paragraph}</p>
                                    ))}

                                    {section.bullets?.length ? (
                                        <ul className="table-dialog__list table-dialog__list--house-rules">
                                            {section.bullets.map((item, index) => (
                                                <li key={index}>{item}</li>
                                            ))}
                                        </ul>
                                    ) : null}
                                </section>
                            ))}
                        </div>

                        <div className="table-dialog__actions">
                            <button className="button button--primary" type="button" onClick={() => setIsHouseRulesOpen(false)}>
                                Close
                            </button>
                        </div>
                    </section>
                </div>
            ) : null}

            {isSessionLedgerOpen ? (
                <div className="session-ledger-modal" role="dialog" aria-modal="true" aria-label="Session ledger">
                    <button className="session-ledger-modal__backdrop" type="button" aria-label="Close session ledger" onClick={() => setIsSessionLedgerOpen(false)} />
                    <section className="session-ledger-modal__panel">
                        <header className="session-ledger-modal__header">
                            <div>
                                <h2>Session Ledger</h2>
                                <p>Current session ranking by net result.</p>
                            </div>
                            <button className="session-ledger-modal__close" type="button" onClick={() => setIsSessionLedgerOpen(false)} aria-label="Close session ledger">
                                ×
                            </button>
                        </header>

                        <div className="session-ledger-modal__table-wrap">
                            <div className="session-ledger-modal__table">
                                <div className="session-ledger-modal__row session-ledger-modal__row--header">
                                    <span>Player</span>
                                    <span>Buy-in</span>
                                    <span>Buy-out</span>
                                    <span>Stack</span>
                                    <span>Wins</span>
                                    <span>Rebuys</span>
                                    <span>Net</span>
                                </div>

                                {sessionLedgerRows.map((row) => (
                                    <div key={row.accountId} className="session-ledger-modal__row">
                                        <div className="session-ledger-modal__player-cell">
                                            <strong>{row.displayName}</strong>
                                            <span>{formatSessionLedgerHandle(row.accountId)}</span>
                                        </div>
                                        <span>{formatNumber(row.buyIn)}</span>
                                        <span>{formatNumber(row.buyOut)}</span>
                                        <span>{formatNumber(row.stack)}</span>
                                        <span>{formatNumber(row.wins)}</span>
                                        <span>{formatNumber(row.rebuys)}</span>
                                        <span className={row.net >= 0 ? "session-ledger-modal__net session-ledger-modal__net--positive" : "session-ledger-modal__net session-ledger-modal__net--negative"}>
                                            {row.net >= 0 ? "+" : ""}{formatNumber(row.net)}
                                        </span>
                                    </div>
                                ))}

                                <div className="session-ledger-modal__row session-ledger-modal__row--footer">
                                    <span>Table total</span>
                                    <span>{formatNumber(sessionLedgerTotals.buyIn)}</span>
                                    <span>{formatNumber(sessionLedgerTotals.buyOut)}</span>
                                    <span>{formatNumber(sessionLedgerTotals.stack)}</span>
                                    <span>{formatNumber(sessionLedgerTotals.wins)}</span>
                                    <span>{formatNumber(sessionLedgerTotals.rebuys)}</span>
                                    <span className={sessionLedgerTotals.net >= 0 ? "session-ledger-modal__net session-ledger-modal__net--positive" : "session-ledger-modal__net session-ledger-modal__net--negative"}>
                                        {sessionLedgerTotals.net >= 0 ? "+" : ""}{formatNumber(sessionLedgerTotals.net)}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </section>
                </div>
            ) : null}

            {isPhoneViewport && isMobileActionMenuOpen ? (
                <div className="table-dialog" role="dialog" aria-modal="true" aria-label="Action menu">
                    <button className="table-dialog__backdrop" type="button" aria-label="Close action menu" onClick={() => setIsMobileActionMenuOpen(false)} />
                    <section className="table-dialog__panel table-dialog__panel--compact table-dialog__panel--mobile-actions">
                        {renderActionPanel("dialog")}

                        <div className="table-dialog__actions">
                            <button className="button button--secondary" type="button" onClick={() => setIsMobileActionMenuOpen(false)}>
                                Cancel
                            </button>
                        </div>
                    </section>
                </div>
            ) : null}

            {isPhoneViewport && isMobileRecommendationOpen ? (
                <div className="table-dialog" role="dialog" aria-modal="true" aria-label="Phone layout notice">
                    <button className="table-dialog__backdrop" type="button" aria-label="Close phone layout notice" onClick={dismissMobileRecommendation} />
                    <section className="table-dialog__panel table-dialog__panel--compact table-dialog__panel--mobile-advisory">
                        <header className="table-dialog__header">
                            <div>
                                <span className="table-menu-drawer__eyebrow">Phone layout</span>
                                <h2>Best on a tablet or computer</h2>
                                <p>Phone mode keeps the table playable, but it hides other player cameras, compacts the seat grid, and moves the action pad into a modal. Use a tablet or computer to see the full table layout and media experience.</p>
                            </div>
                            <button className="table-dialog__close" type="button" onClick={dismissMobileRecommendation} aria-label="Close phone layout notice">
                                ×
                            </button>
                        </header>

                        <div className="table-dialog__actions">
                            <button className="button button--secondary" type="button" onClick={dismissMobileRecommendation}>
                                Continue on phone
                            </button>
                        </div>
                    </section>
                </div>
            ) : null}
        </main>
    );
}

function buildTableSeats(
    snapshot: RoomSnapshot | null,
    heroSeatIndex?: number,
    accountId?: string,
    hideOpenSeats = false,
    options?: {
        suppressWinnerHighlights?: boolean;
        completedHandReveals?: Record<string, [Card | null, Card | null]> | null;
        pendingRunoutWinners?: ReadonlyMap<string, LastHandResult["winners"][number]>;
        runoutWinPercentByAccount?: ReadonlyMap<string, number>;
        runoutEquityLeaderAccountIds?: ReadonlySet<string>;
        runoutEquityTrendByAccount?: ReadonlyMap<string, EquityTrend>;
    },
): TableSeatView[] {
    const totalSeats = clampSeatCount(snapshot?.maxPlayers ?? 6);
    const layout = TABLE_LAYOUTS[totalSeats]!;
    const anchorSeat = typeof heroSeatIndex === "number" ? heroSeatIndex : 0;
    const seatOrder = Array.from({ length: totalSeats }, (_, index) => (anchorSeat + index) % totalSeats);
    const currentHand = snapshot?.currentHand ?? null;
    const completedHandReveals = options?.completedHandReveals ?? snapshot?.lastCompletedHand?.revealedHoleCards ?? null;
    const suppressWinnerHighlights = options?.suppressWinnerHighlights ?? false;
    const pendingRunoutWinners = options?.pendingRunoutWinners ?? new Map<string, LastHandResult["winners"][number]>();
    const runoutWinPercentByAccount = options?.runoutWinPercentByAccount ?? new Map<string, number>();
    const runoutEquityLeaderAccountIds = options?.runoutEquityLeaderAccountIds ?? new Set<string>();
    const runoutEquityTrendByAccount = options?.runoutEquityTrendByAccount ?? new Map<string, EquityTrend>();

    const seats = seatOrder.map((seatIndex, displayIndex) => {
        const player = snapshot?.players.find((entry) => entry.seatIndex === seatIndex) ?? null;
        const position = layout[displayIndex] ?? layout[layout.length - 1]!;
        const cardAdjustment = getSeatCardAdjustment(position);
        const isHero = Boolean(player && accountId && player.accountId === accountId);
        const isFolded = Boolean(player && currentHand?.foldedAccountIds.includes(player.accountId));
        const isActive = Boolean(player && currentHand?.actorAccountId === player.accountId);
        const pendingSeatRequest = !player && accountId
            ? snapshot?.pendingSeatRequests.find((request) => request.accountId === accountId && request.seatIndex === seatIndex) ?? null
            : null;
        const winningEntry = !currentHand && !suppressWinnerHighlights && player
            ? snapshot?.lastCompletedHand?.winners.find((winner) => winner.accountId === player.accountId) ?? null
            : null;
        const displayedStack = player ? getDisplayedPlayerStack(player, pendingRunoutWinners) : null;
        const totalHandsWon = player ? snapshot?.playerStats.handsWonByAccount[player.accountId] ?? 0 : 0;
        const revealedCards = !currentHand && player
            ? completedHandReveals?.[player.accountId] ?? null
            : null;
        const statusLabel = !player
            ? pendingSeatRequest
                ? "Pending"
                : "Open seat"
            : winningEntry
                ? winningEntry.handLabel ?? "Winner"
                : player.isSittingOut
                    ? "Sitting out"
                    : !player.isConnected
                        ? "Disconnected"
                        : isFolded
                            ? "Folded"
                            : isActive
                                ? "Action"
                                : player.isReady
                                    ? "Ready"
                                    : "Seated";

        return {
            seatIndex,
            style: {
                left: `${position.left}%`,
                top: `${position.top}%`,
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
                        : player.isSittingOut || !player.isConnected || isFolded
                            ? "warning"
                            : player.isReady
                                ? "ready"
                                : "waiting",
            avatarLabel: player ? getAvatarLabel(player.displayName) : pendingSeatRequest ? getAvatarLabel(pendingSeatRequest.displayName) : "+",
            markers: buildSeatMarkers(snapshot, player),
            actionBubble: player && currentHand
                ? formatSeatActionBubble(currentHand.actions, player.accountId, currentHand.street)
                : winningEntry
                    ? `🏆 Won ${formatNumber(winningEntry.amountWon)}`
                    : null,
            contributionLabel: player && currentHand && (currentHand.streetContributions[player.accountId] ?? 0) > 0
                ? formatNumber(currentHand.streetContributions[player.accountId] ?? 0)
                : null,
            cardCount: revealedCards ? 2 : (player && currentHand ? currentHand.playerCardCounts[player.accountId] ?? 0 : 0),
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

function buildPendingRunoutWinners(
    lastCompletedHand: LastHandResult | null,
    isRunoutActive: boolean,
): Map<string, LastHandResult["winners"][number]> {
    if (!isRunoutActive || !lastCompletedHand) {
        return new Map();
    }

    return new Map(lastCompletedHand.winners.map((winner) => [winner.accountId, winner]));
}

function getDisplayedPlayerStack(
    player: RoomPlayer | null,
    pendingRunoutWinners: ReadonlyMap<string, LastHandResult["winners"][number]>,
): number | null {
    if (!player) {
        return null;
    }

    const pendingWinner = pendingRunoutWinners.get(player.accountId);
    return Math.max(0, player.stack - (pendingWinner?.amountWon ?? 0));
}

function getDisplayedHandsWonCount(
    accountId: string,
    handsWonCount: number,
    pendingRunoutWinners: ReadonlyMap<string, LastHandResult["winners"][number]>,
): number {
    return Math.max(0, handsWonCount - (pendingRunoutWinners.has(accountId) ? 1 : 0));
}

function buildSeatMarkers(snapshot: RoomSnapshot | null, player: RoomPlayer | null): Array<{ label: string; tone: "dealer" | "blind" | "admin" }> {
    if (!snapshot?.currentHand || !player) {
        return player?.accountId === snapshot?.adminAccountId ? [{ label: "Admin", tone: "admin" }] : [];
    }

    const markers: Array<{ label: string; tone: "dealer" | "blind" | "admin" }> = [];

    if (snapshot.currentHand.dealerSeat === player.seatIndex) {
        markers.push({ label: "D", tone: "dealer" });
    }

    if (snapshot.currentHand.smallBlindSeat === player.seatIndex) {
        markers.push({ label: "SB", tone: "blind" });
    }

    if (snapshot.currentHand.bigBlindSeat === player.seatIndex) {
        markers.push({ label: "BB", tone: "blind" });
    }

    if (player.accountId === snapshot.adminAccountId) {
        markers.push({ label: "Admin", tone: "admin" });
    }

    return markers;
}

interface CardSlot {
    card: Card | null;
    isFaceUp: boolean;
    backLabel: string;
}

function buildBoardSlots(cards: Card[]): CardSlot[] {
    return Array.from({ length: 5 }, (_, index) => ({
        card: cards[index] ?? null,
        isFaceUp: Boolean(cards[index]),
        backLabel: index < 3 ? "Flop" : index === 3 ? "Turn" : "River",
    }));
}

function buildHeroCardSlots(cards: [Card, Card] | null): CardSlot[] {
    return Array.from({ length: 2 }, (_, index) => ({
        card: cards?.[index] ?? null,
        isFaceUp: Boolean(cards?.[index]),
        backLabel: "Deal",
    }));
}

function buildSeatCardSlots(seat: TableSeatView): CardSlot[] {
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

function buildAllInRunoutView(lastCompletedHand: LastHandResult | null, nowMs: number): AllInRunoutView | null {
    const allInRunout = lastCompletedHand?.allInRunout;

    if (!lastCompletedHand || !allInRunout || allInRunout.startBoardCount >= lastCompletedHand.board.length) {
        return null;
    }

    if (allInRunout.revealIntervalMs <= 0) {
        return {
            isActive: false,
            visibleBoard: lastCompletedHand.board,
            revealedAccountIds: allInRunout.revealedAccountIds,
        };
    }

    const concludedAtMs = Date.parse(lastCompletedHand.concludedAt);

    if (Number.isNaN(concludedAtMs)) {
        return {
            isActive: false,
            visibleBoard: lastCompletedHand.board,
            revealedAccountIds: allInRunout.revealedAccountIds,
        };
    }

    const revealedCount = Math.min(
        lastCompletedHand.board.length,
        allInRunout.startBoardCount + Math.floor(Math.max(0, nowMs - concludedAtMs) / allInRunout.revealIntervalMs),
    );

    return {
        isActive: revealedCount < lastCompletedHand.board.length,
        visibleBoard: lastCompletedHand.board.slice(0, revealedCount),
        revealedAccountIds: allInRunout.revealedAccountIds,
    };
}

function isAllInRunoutActive(lastCompletedHand: LastHandResult | null, nowMs: number): boolean {
    return Boolean(buildAllInRunoutView(lastCompletedHand, nowMs)?.isActive);
}

function filterRevealedHoleCards(
    revealedHoleCards: LastHandResult["revealedHoleCards"],
    visibleAccountIds: Set<string>,
): LastHandResult["revealedHoleCards"] {
    return Object.fromEntries(
        Object.entries(revealedHoleCards).filter(([accountId]) => visibleAccountIds.has(accountId))
    );
}

function createEmptyRunoutEquityViewState(): RunoutEquityViewState {
    return {
        percentByAccount: new Map(),
        leaderAccountIds: new Set(),
        trendByAccount: new Map(),
    };
}

function buildRunoutEquitySnapshot(
    lastCompletedHand: LastHandResult | null,
    allInRunoutView: AllInRunoutView | null,
): RunoutEquitySnapshot | null {
    if (!lastCompletedHand?.allInRunout || !allInRunoutView) {
        return null;
    }

    const participants = allInRunoutView.revealedAccountIds
        .map((accountId) => {
            const holeCards = lastCompletedHand.revealedHoleCards[accountId];

            return hasCompleteHoleCards(holeCards)
                ? { accountId, holeCards }
                : null;
        })
        .filter((entry): entry is { accountId: string; holeCards: [Card, Card] } => entry !== null);

    if (participants.length < 2) {
        return null;
    }

    const cardsToDraw = 5 - allInRunoutView.visibleBoard.length;

    if (cardsToDraw < 0) {
        return null;
    }

    const knownCardKeys = new Set<string>();

    for (const card of allInRunoutView.visibleBoard) {
        const cardKey = buildCardIdentity(card);

        if (knownCardKeys.has(cardKey)) {
            return null;
        }

        knownCardKeys.add(cardKey);
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

    const remainingDeck = buildRunoutEquityDeck(knownCardKeys);
    const boardCompletions = buildRunoutBoardCompletions(
        remainingDeck,
        cardsToDraw,
        [
            lastCompletedHand.handId,
            buildCardListKey(allInRunoutView.visibleBoard),
            buildAccountListKey(participants.map((participant) => participant.accountId)),
        ].join(":"),
    );

    if (!boardCompletions.length) {
        return null;
    }

    const totalShares = new Map(participants.map((participant) => [participant.accountId, 0]));

    for (const completion of boardCompletions) {
        const fullBoard = [...allInRunoutView.visibleBoard, ...completion];
        let bestHand = evaluateHoldemHand([...participants[0]!.holeCards, ...fullBoard]);
        let winningAccountIds = [participants[0]!.accountId];

        for (let index = 1; index < participants.length; index += 1) {
            const participant = participants[index]!;
            const evaluatedHand = evaluateHoldemHand([...participant.holeCards, ...fullBoard]);
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

        const share = 1 / winningAccountIds.length;

        for (const accountId of winningAccountIds) {
            totalShares.set(accountId, (totalShares.get(accountId) ?? 0) + share);
        }
    }

    const percentByAccount = new Map(
        participants.map((participant) => [
            participant.accountId,
            Math.round(((totalShares.get(participant.accountId) ?? 0) / boardCompletions.length) * 100),
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

function hasCompleteHoleCards(cards: [Card | null, Card | null] | undefined): cards is [Card, Card] {
    return Boolean(cards?.[0] && cards?.[1]);
}

function buildRunoutBoardCompletions(cards: Card[], count: number, seed: string): Card[][] {
    if (count === 0) {
        return [[]];
    }

    const combinationCount = calculateCombinationCount(cards.length, count);

    if (combinationCount <= RUNOUT_EQUITY_EXACT_COMBINATION_LIMIT) {
        return enumerateCardCombinations(cards, count);
    }

    return sampleCardCombinations(cards, count, Math.min(RUNOUT_EQUITY_SAMPLE_COUNT, combinationCount), seed);
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

function sampleCardCombinations(cards: Card[], count: number, sampleCount: number, seed: string): Card[][] {
    const random = createSeededRandom(seed);
    const combinations: Card[][] = [];
    const seen = new Set<string>();
    const maxAttempts = sampleCount * 6;
    let attempts = 0;

    while (combinations.length < sampleCount && attempts < maxAttempts) {
        attempts += 1;
        const remainingCards = [...cards];
        const combination: Card[] = [];

        for (let drawIndex = 0; drawIndex < count; drawIndex += 1) {
            const nextIndex = Math.floor(random() * remainingCards.length);
            const [nextCard] = remainingCards.splice(nextIndex, 1);

            if (!nextCard) {
                return combinations;
            }

            combination.push(nextCard);
        }

        const combinationKey = combination.map((card) => buildCardIdentity(card)).sort().join("|");

        if (seen.has(combinationKey)) {
            continue;
        }

        seen.add(combinationKey);
        combinations.push(combination);
    }

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

function buildAccountListKey(accountIds: string[]): string {
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

function toggleRevealMode(currentMode: RevealMode, cardIndex: 0 | 1): RevealMode {
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

function createEmptyAdminOptionsDraft(): AdminOptionsDraft {
    return {
        useBlindSchedule: false,
        smallBlind: "",
        bigBlind: "",
        ante: "0",
        blindLevels: [createBlindLevelDraft()],
        autoStartNextHand: true,
        showdownPresentationSeconds: "8",
        decisionTimeSeconds: "",
        timeBankSeconds: "",
        timeBankRefillHands: "",
        revealAllShowdownHands: false,
    };
}

function buildAdminOptionsDraft(snapshot: RoomSnapshot): AdminOptionsDraft {
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
        showdownPresentationSeconds: String(snapshot.autoStartDelaySeconds),
        decisionTimeSeconds: snapshot.adminOptions.decisionTimeSeconds === null ? "" : String(snapshot.adminOptions.decisionTimeSeconds),
        timeBankSeconds: snapshot.adminOptions.timeBankSeconds === null ? "" : String(snapshot.adminOptions.timeBankSeconds),
        timeBankRefillHands: snapshot.adminOptions.timeBankRefillHands === null ? "" : String(snapshot.adminOptions.timeBankRefillHands),
        revealAllShowdownHands: snapshot.adminOptions.revealAllShowdownHands,
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

function buildNextBlindLevelDraft(levels: BlindLevelDraft[]): BlindLevelDraft {
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

function syncPendingAmountDrafts(current: Record<string, string>, entries: Array<{ id: string; value: number }>): Record<string, string> {
    return entries.reduce<Record<string, string>>((next, entry) => {
        next[entry.id] = current[entry.id] ?? String(entry.value);
        return next;
    }, {});
}

function buildAdminApprovalQueueKey(kind: AdminApprovalQueueEntry["kind"], requestId: string): string {
    return `${kind}:${requestId}`;
}

function validateBlindScheduleDraft(draft: AdminOptionsDraft): { rows: BlindLevelDraftValidation[]; errors: string[] } {
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

function parseWholeNumberInput(value: string): number | null {
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

function parseBlindScheduleDraft(draft: AdminOptionsDraft): RoomSnapshot["blindState"]["schedule"] {
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

function getBlindCountdownMs(blindState: RoomSnapshot["blindState"], nowMs: number): number | null {
    if (blindState.nextLevelInMs === null) {
        return null;
    }

    const snapshotAtMs = Date.parse(blindState.snapshotAt);
    const elapsedMs = blindState.pausedAt || Number.isNaN(snapshotAtMs)
        ? 0
        : Math.max(0, nowMs - snapshotAtMs);

    return Math.max(0, blindState.nextLevelInMs - elapsedMs);
}

function formatBlindLevelCompact(level: NonNullable<RoomSnapshot["blindState"]["nextLevel"] | RoomSnapshot["blindState"]["currentLevel"]>): string {
    return level.ante && level.ante > 0
        ? `${formatNumber(level.smallBlind)}/${formatNumber(level.bigBlind)}/${formatNumber(level.ante)}`
        : `${formatNumber(level.smallBlind)}/${formatNumber(level.bigBlind)}`;
}

function formatClockCountdown(valueMs: number): string {
    const totalSeconds = Math.max(0, Math.ceil(valueMs / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function buildSessionLedgerRows(snapshot: RoomSnapshot | null): SessionLedgerRow[] {
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

function getSnapshotClockMs(snapshot: RoomSnapshot | null): number {
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

function formatSessionLedgerHandle(accountId: string): string {
    return `@${accountId.slice(0, 12)}`;
}

function buildTurnMetrics(snapshot: RoomSnapshot | null, nowMs: number) {
    if (!snapshot?.currentHand?.actorAccountId || !snapshot.turnState.currentTurnStartedAt || snapshot.turnState.turnSeconds === null) {
        return null;
    }

    const startedAtMs = Date.parse(snapshot.turnState.currentTurnStartedAt);

    if (Number.isNaN(startedAtMs)) {
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

    return {
        actorAccountId: snapshot.currentHand.actorAccountId,
        isUsingTimeBank: mainRemainingMs === 0 && timeBankRemainingMs < actorTimeBankMs,
        mainSecondsRemaining: Math.max(0, Math.ceil(mainRemainingMs / 1000)),
        timeBankSecondsRemaining: Math.max(0, Math.ceil(timeBankRemainingMs / 1000)),
    };
}

function buildActiveReactionMap(snapshot: RoomSnapshot | null, nowMs: number): Map<string, RoomSnapshot["seatReactions"][number]> {
    const reactions = snapshot?.seatReactions ?? [];

    return reactions.reduce((map, reaction) => {
        if (Date.parse(reaction.expiresAt) <= nowMs) {
            return map;
        }

        map.set(reaction.accountId, reaction);
        return map;
    }, new Map<string, RoomSnapshot["seatReactions"][number]>());
}

function buildSeatGestureMap(snapshot: RoomSnapshot | null): Map<string, RoomSnapshot["seatGestures"][number]> {
    const gestures = snapshot?.seatGestures ?? [];

    return gestures.reduce((map, gesture) => {
        map.set(gesture.accountId, gesture);
        return map;
    }, new Map<string, RoomSnapshot["seatGestures"][number]>());
}

interface EmojiPickerSelection {
    native?: string;
    skins?: Array<{ native?: string }>;
}

function getNativeEmoji(selection: EmojiPickerSelection | null | undefined): string | null {
    if (!selection) {
        return null;
    }

    if (typeof selection.native === "string" && selection.native.trim()) {
        return selection.native.trim();
    }

    const fallbackNative = selection.skins?.[0]?.native;
    return typeof fallbackNative === "string" && fallbackNative.trim() ? fallbackNative.trim() : null;
}

function defaultRebuyAmount(snapshot: RoomSnapshot): number {
    const { minRebuyAmount, maxRebuyAmount } = snapshot.buyInState;
    return Math.max(minRebuyAmount, Math.min(maxRebuyAmount, snapshot.startingStack));
}

function buildRebuyPresets(snapshot: RoomSnapshot): Array<{ label: string; amount: number }> {
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

function getSeatMediaPlacement(position: { left: number; top: number }): "above" | "below" | "left" | "right" {
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

function getSeatCardAdjustment(position: { left: number; top: number }): SeatCardAdjustment {
    return SEAT_CARD_ADJUSTMENTS[`${position.left}:${position.top}`] ?? DEFAULT_SEAT_CARD_ADJUSTMENT;
}

function getHeroWagerInputConfig(heroActionState: HeroActionState): {
    buttonLabel: string;
    minInputAmount: number;
    maxInputAmount: number;
} | null {
    if (heroActionState.allowedActions.includes("raise")) {
        if (heroActionState.minRaiseTo === null) {
            return null;
        }

        const currentBet = heroActionState.streetContribution + heroActionState.callAmount;

        return {
            buttonLabel: "Raise by",
            minInputAmount: Math.max(1, heroActionState.minRaiseTo - currentBet),
            maxInputAmount: Math.max(1, heroActionState.maxRaiseTo - currentBet),
        };
    }

    if (heroActionState.allowedActions.includes("bet")) {
        return {
            buttonLabel: "Bet",
            minInputAmount: Math.max(1, heroActionState.minRaiseTo ?? 1),
            maxInputAmount: Math.max(1, heroActionState.maxRaiseTo),
        };
    }

    return null;
}

function getDefaultWagerInputValue(heroActionState: HeroActionState): number {
    return getHeroWagerInputConfig(heroActionState)?.minInputAmount ?? 0;
}

function getWagerTargetContribution(
    actionType: Extract<HeroActionState["allowedActions"][number], "bet" | "raise">,
    inputValue: string,
    heroActionState: HeroActionState,
): number {
    const inputAmount = parseRequiredWholeNumber(inputValue, actionType === "raise" ? "Raise amount" : "Bet amount");
    const wagerConfig = getHeroWagerInputConfig(heroActionState);

    if (!wagerConfig) {
        throw new Error("This wager is not available right now.");
    }

    if (inputAmount < wagerConfig.minInputAmount) {
        throw new Error(`${wagerConfig.buttonLabel} must be at least ${formatNumber(wagerConfig.minInputAmount)}.`);
    }

    if (inputAmount > wagerConfig.maxInputAmount) {
        throw new Error(`${wagerConfig.buttonLabel} cannot exceed ${formatNumber(wagerConfig.maxInputAmount)}.`);
    }

    if (actionType === "raise") {
        const currentBet = heroActionState.streetContribution + heroActionState.callAmount;
        return currentBet + inputAmount;
    }

    return inputAmount;
}

function describeMediaBadge(participant: MediaParticipantState): string {
    const cameraOn = participant.cameraEnabled;
    const microphoneOn = participant.microphoneEnabled;

    if (cameraOn && microphoneOn) {
        return participant.isLocal ? "You live" : "Live";
    }

    if (cameraOn) {
        return "Camera on";
    }

    if (microphoneOn) {
        return "Mic on";
    }

    return "Joined";
}

function PokerCard({
    card,
    isFaceUp,
    size,
    backLabel,
    animationIndex = 0,
}: {
    card: Card | null;
    isFaceUp: boolean;
    size: "board" | "seat" | "hero" | "compact";
    backLabel: string;
    animationIndex?: number;
}) {
    const suitTone = card && isRedSuit(card.suit) ? "playing-card__face--red" : "playing-card__face--black";

    return (
        <div
            className={["playing-card", `playing-card--${size}`, isFaceUp ? "playing-card--face-up" : "playing-card--face-down"].join(" ")}
            style={{ "--card-delay": `${animationIndex * 70}ms` } as CSSProperties}
        >
            <div className="playing-card__motion">
                <div className="playing-card__inner">
                    <div className="playing-card__face playing-card__face--back">
                        <span className="playing-card__back-pattern" />
                        {backLabel ? <span className="playing-card__back-label">{backLabel}</span> : null}
                    </div>
                    <div className={["playing-card__face", "playing-card__face--front", suitTone].filter(Boolean).join(" ")}>
                        {card ? (
                            <>
                                <span className="playing-card__corner">
                                    <span className="playing-card__rank">{card.rank}</span>
                                </span>
                                <span className="playing-card__pip">{getSuitSymbol(card.suit)}</span>
                            </>
                        ) : (
                            <span className="playing-card__back-label">{backLabel}</span>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

function getSuitSymbol(suit: Card["suit"]): string {
    return {
        clubs: "♣",
        diamonds: "♦",
        hearts: "♥",
        spades: "♠",
    }[suit];
}

function isRedSuit(suit: Card["suit"]): boolean {
    return suit === "diamonds" || suit === "hearts";
}

function describeHeroState(heroActionState: HeroActionState | null, heroPlayer: RoomPlayer | null): string {
    if (!heroPlayer) {
        return "Take an open seat to join the next hand.";
    }

    if (heroPlayer.isSittingOut) {
        return "You are sitting out. Return from sit out when you want back into the rotation.";
    }

    if (!heroPlayer.isReady) {
        return "Mark yourself ready and wait for the next deal window.";
    }

    if (!heroActionState) {
        return "Waiting for the next action window.";
    }

    if (heroActionState.hasFolded) {
        return "You are folded for this hand.";
    }

    if (heroActionState.isAllIn) {
        return "You are all-in and waiting for the board to run out.";
    }

    return "Waiting on another player to act.";
}

function buildCenterStatus(snapshot: RoomSnapshot | null, nextHandCountdown: string | null): string {
    if (!snapshot) {
        return "Loading table state.";
    }

    if (snapshot.status === "paused") {
        return "Table paused by admin.";
    }

    if (snapshot.currentHand?.actorAccountId) {
        const actorName = snapshot.players.find((player) => player.accountId === snapshot.currentHand?.actorAccountId)?.displayName ?? snapshot.currentHand.actorAccountId;
        return `Action on ${actorName}.`;
    }

    if (nextHandCountdown) {
        return nextHandCountdown;
    }

    if (snapshot.lastCompletedHand) {
        const winnerNames = snapshot.lastCompletedHand.winners
            .map((winner) => snapshot.players.find((player) => player.accountId === winner.accountId)?.displayName ?? winner.accountId)
            .join(", ");

        return winnerNames ? `${winnerNames} won the last pot.` : `Last hand ended by ${snapshot.lastCompletedHand.winningReason}.`;
    }

    return "Mark ready and start a hand when the table is set.";
}

function formatSeatActionBubble(actions: HandActionRecord[], accountId: string, currentStreet: string): string | null {
    const action = [...actions].reverse().find((entry) => {
        if (entry.actorAccountId !== accountId) {
            return false;
        }

        if (entry.street === currentStreet) {
            return true;
        }

        return currentStreet === "preflop" && (entry.type === "post_ante" || entry.type === "post_small_blind" || entry.type === "post_big_blind");
    });

    if (!action) {
        return null;
    }

    switch (action.type) {
        case "post_ante":
            return `Ante ${formatNumber(action.amount)}`;
        case "post_small_blind":
            return `SB ${formatNumber(action.amount)}`;
        case "post_big_blind":
            return `BB ${formatNumber(action.amount)}`;
        case "fold":
            return "Fold";
        case "check":
            return "Check";
        case "call":
            return `Call ${formatNumber(action.amount)}`;
        case "bet":
            return `Bet ${formatNumber(action.betTo)}`;
        case "raise":
            return `Raise ${formatNumber(action.betTo)}`;
        case "all_in":
            return `All-in ${formatNumber(action.betTo)}`;
        default:
            return action.type;
    }
}

function safeParse(value: string): { type?: string; message?: string; payload?: unknown } | null {
    try {
        return JSON.parse(value) as { type?: string; message?: string; payload?: unknown };
    } catch {
        return null;
    }
}

function formatActionSummary(action: HandActionRecord): string {
    switch (action.type) {
        case "post_ante":
            return `posted ante ${formatNumber(action.amount)}`;
        case "post_small_blind":
            return `posted small blind ${formatNumber(action.amount)}`;
        case "post_big_blind":
            return `posted big blind ${formatNumber(action.amount)}`;
        case "check":
            return "checked";
        case "fold":
            return "folded";
        case "call":
            return `called ${formatNumber(action.amount)}`;
        case "bet":
            return `bet ${formatNumber(action.betTo)}`;
        case "raise":
            return `raised to ${formatNumber(action.betTo)}`;
        case "all_in":
            return `moved all-in to ${formatNumber(action.betTo)}`;
        default:
            return action.type;
    }
}

function formatStreet(value: string): string {
    return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatCard(card: { rank: string; suit: string }): string {
    return `${card.rank}${getSuitSymbol(card.suit as Card["suit"])}`;
}

function formatTurnSeconds(value: number): string {
    return `${Math.max(0, value)}s`;
}

function parseRequiredWholeNumber(value: string, label: string): number {
    const normalized = Number(value);

    if (!Number.isFinite(normalized) || !Number.isInteger(normalized) || normalized <= 0) {
        throw new Error(`${label} must be a positive integer.`);
    }

    return normalized;
}

function parseOptionalWholeNumber(value: string, label: string): number | null {
    const trimmed = value.trim();

    if (!trimmed) {
        return null;
    }

    const normalized = Number(trimmed);

    if (!Number.isFinite(normalized) || !Number.isInteger(normalized) || normalized < 0) {
        throw new Error(`${label} must be blank or a non-negative integer.`);
    }

    return normalized;
}

function formatChatTimestamp(value: string): string {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return "Now";
    }

    return new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        minute: "2-digit",
    }).format(date);
}

function formatNumber(value: number): string {
    return new Intl.NumberFormat("en-US").format(value);
}

function formatCountdown(nextHandStartsAt: string): string {
    const remainingSeconds = Math.max(0, Math.ceil((Date.parse(nextHandStartsAt) - Date.now()) / 1000));

    if (remainingSeconds === 0) {
        return "Auto-starting the next hand now.";
    }

    return `Next hand auto-starts in ${remainingSeconds}s.`;
}

function getAvatarLabel(name: string): string {
    const tokens = name.trim().split(/\s+/).filter(Boolean);

    if (tokens.length === 0) {
        return "?";
    }

    if (tokens.length === 1) {
        return tokens[0]!.slice(0, 2).toUpperCase();
    }

    return `${tokens[0]![0] ?? ""}${tokens[tokens.length - 1]![0] ?? ""}`.toUpperCase();
}

function clampSeatCount(value: number): number {
    return Math.max(2, Math.min(10, value));
}