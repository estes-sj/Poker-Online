"use client";

import emojiData from "@emoji-mart/data";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";

import { getSessionDisplayName, readStoredBrowserSession, SESSION_STORAGE_EVENT, writeStoredBrowserSession } from "../../lib/browser-session";
import { createGuestSession } from "../../lib/guest-auth";
import { roomAllowsGuests, type GuestMode } from "../../lib/guest-policy";
import { RecoveryCodeNotice } from "../../components/account-card";
import { DeviceLinkDialog } from "../../components/device-link-dialog";
import type { HouseRulesConfig } from "../../lib/house-rules-config";
import { buildBrowserHttpUrl, buildBrowserWsUrl, getBrowserApiBaseUrl, getBrowserGameHttpBaseUrl, getBrowserGameWsBaseUrl } from "../../lib/public-service-urls";
import { evaluateHoldemHand, getCurrentHeroHandLabel } from "./hand-evaluator";
import {
    areQueuedHeroActionsEqual,
    buildCenterStatus,
    clampSeatCount,
    describeHeroState,
    describeMediaBadge,
    describeRunItTwiceVoteState,
    formatActionSummary,
    formatArchivePreviewTimestamp,
    formatCard,
    formatChatTimestamp,
    formatCountdown,
    formatNumber,
    formatSeatActionBubble,
    formatStreet,
    formatTurnSeconds,
    getAvatarLabel,
    getDefaultWagerInputValue,
    getHeroWagerInputConfig,
    getWagerTargetContribution,
    parseOptionalWholeNumber,
    parseProbabilityInput,
    parseRequiredWholeNumber,
    PokerCard,
    resolveQueuedHeroAction,
    safeParse,
    VictoryConfettiCanvas,
    type QueuedHeroAction,
} from "./room-client-helpers";
import {
    buildAccountListKey,
    buildActiveReactionMap,
    buildAdminApprovalQueueKey,
    buildAdminOptionsDraft,
    buildAllInRunoutView,
    buildAllInRunoutViewFromStep,
    buildArchivedCenterStatus,
    buildArchivedReplayRoomSnapshot,
    buildBoardCollectionKey,
    buildNextBlindLevelDraft,
    buildRebuyPresets,
    buildRunoutEquitySnapshot,
    buildRunoutHandLabelByAccount,
    buildSeatGestureMap,
    buildSessionLedgerRows,
    buildSuggestedGestureTrigger,
    buildTurnMetrics,
    createEmptyAdminOptionsDraft,
    createEmptyRunoutEquityViewState,
    defaultBuyInAmount,
    defaultRebuyAmount,
    escapeCsvValue,
    filterRevealedHoleCards,
    formatBlindLevelCompact,
    formatClockCountdown,
    formatSessionLedgerHandle,
    getBlindCountdownMs,
    getCompletedHandBoards,
    getCompletedHandRunoutResults,
    isAllInRunoutActive,
    getSeatMediaPlacement,
    getSnapshotClockMs,
    parseBlindScheduleDraft,
    parseWholeNumberInput,
    syncPendingAmountDrafts,
    toggleRevealMode,
    validateBlindScheduleDraft,
    type AdminOptionsDraft,
    type BlindLevelDraft,
    type EquityTrend,
    type RunoutEquitySnapshot,
    type RunoutEquityViewState,
    type SuggestedGesturePromptState,
} from "./room-client-state";
import {
    buildBoardSlots,
    buildMediaParticipantsByAccountId,
    buildPendingRunoutWinners,
    buildSeatCardSlots,
    buildTableSeats,
    getAvailableBotSeatIndices,
    getDisplayedHandsWonCount,
    getDisplayedPlayerStack,
    getNextBotDisplayName,
    isBotAccountId,
    pickSeatMediaParticipant,
    type HandMarkerSeats,
    type TableSeatView,
} from "./room-client-table";
import type { MediaParticipantState } from "./media-types";
import { useTableSoundEffects } from "./table-sound-effects";
import { MediaAudioRack, ParticipantCameraSurface, useTableMedia } from "./table-media";
import type { ArchivedHandRecord, Card, HandActionRecord, HeroActionState, LastHandResult, RevealMode, RoomPlayer, RoomSnapshot, SessionState } from "./room-types";

const MOBILE_LAYOUT_MEDIA_QUERY = "(max-width: 900px)";
const MOBILE_LAYOUT_RECOMMENDATION_STORAGE_KEY = "river-club-mobile-layout-recommendation-dismissed";
const ACTION_PAD_IDLE_DIM_STORAGE_KEY = "river-club-action-pad-idle-dim";
const ROOM_PASSWORD_PROMPT_QUERY_PARAM = "roomPrompt";
const ROOM_PASSWORD_PROMPT_QUERY_VALUE = "unlock";
const ACTION_PAD_VIEWPORT_MARGIN = 16;
const ACTION_PAD_TOP_MARGIN = 96;
const QUICK_REACTIONS = ["👏", "🔥", "😂", "😮", "💀"] as const;
const SUGGESTED_GESTURE_POPOVER_DURATION_MS = 4_800;
const SUGGESTED_GESTURE_FLIGHT_DURATION_MS = 1_650;
const SUGGESTED_GESTURE_MAX_CATCH_UP_MS = 500;
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
const VICTORY_CONFETTI_DURATION_MS = 6_000;

interface RoomClientProps {
    slug: string;
    initialSnapshot: RoomSnapshot | null;
    initialAccountId?: string;
    demoMode?: boolean;
    demoMediaParticipants?: MediaParticipantState[];
    houseRulesConfig: HouseRulesConfig;
    brandName: string;
    guestMode: GuestMode;
}

type ConnectionState = "connecting" | "live" | "disconnected" | "reconnecting" | "demo" | "archived";

interface RoomArchiveUserOption {
    accountId: string;
    username: string;
    isClubMember: boolean;
}

interface RoomArchiveLedgerRow {
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

interface RoomArchivePreview {
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

function resolveRoomDisplayName(snapshot: RoomSnapshot | null | undefined, accountId: string): string {
    return snapshot?.ledgerState.displayNameByAccount[accountId]
        ?? snapshot?.players.find((player) => player.accountId === accountId)?.displayName
        ?? accountId;
}

interface SeatRequestPromptState {
    seatIndex: number;
    requestedStack: string;
}

type PendingAuthAction =
    | {
        kind: "join-room";
        password: string;
    }
    | {
        kind: "take-seat";
        seatIndex: number;
    };

interface RequestNoticeModalState {
    title: string;
    message: string;
}

interface AdminApprovalQueueEntry {
    kind: "seat" | "rebuy";
    requestId: string;
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

interface HeroChatToast {
    id: string;
    content: string;
}

interface SuggestedGestureFlightState {
    id: string;
    emoji: string;
    startX: number;
    startY: number;
    midX: number;
    midY: number;
    endX: number;
    endY: number;
    animationDelayMs: number;
    expiresAtMs: number;
}

type ChatMediaActionState = "idle" | "connecting" | "microphone" | "camera";

const DEFAULT_ACTION_PAD_OFFSET: ActionPadOffset = {
    x: 0,
    y: 0,
};

// The server pings every 20 s, so this much silence means the socket died without a close event.
const SOCKET_SILENCE_TIMEOUT_MS = 45_000;

export function RoomClient({
    slug,
    initialSnapshot,
    initialAccountId,
    demoMode = false,
    demoMediaParticipants = [],
    houseRulesConfig,
    brandName,
    guestMode,
}: RoomClientProps) {
    const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(initialSnapshot);
    const [session, setSession] = useState<SessionState | null>(null);
    // Read by request helpers so a fresh sign-in is used before React re-renders.
    const sessionTokenRef = useRef<string | undefined>(undefined);
    const [accountId, setAccountId] = useState<string | undefined>(initialAccountId);
    const [displayName, setDisplayName] = useState("");
    const [roomPassword, setRoomPassword] = useState("");
    const [raiseTarget, setRaiseTarget] = useState("");
    const [connectionState, setConnectionState] = useState<ConnectionState>(() => {
        if (demoMode) {
            return "demo";
        }

        return initialSnapshot?.status === "archived" ? "archived" : "connecting";
    });
    const [actionError, setActionError] = useState<string | null>(null);
    const [inviteFeedback, setInviteFeedback] = useState<string | null>(null);
    const [isMutating, setIsMutating] = useState(false);
    const [nextHandCountdown, setNextHandCountdown] = useState<string | null>(null);
    const [chatDraft, setChatDraft] = useState("");
    const [isChatExpanded, setIsChatExpanded] = useState(false);
    const [isChatComposerOpen, setIsChatComposerOpen] = useState(false);
    const [openMenuPanel, setOpenMenuPanel] = useState<null | "invite" | "seat" | "media" | "rebuy" | "admin">(null);
    const [isReactionMenuOpen, setIsReactionMenuOpen] = useState(false);
    const [isSessionLedgerOpen, setIsSessionLedgerOpen] = useState(false);
    const [sessionLogView, setSessionLogView] = useState<"log" | "ledger">("ledger");
    const [isEngineInfoOpen, setIsEngineInfoOpen] = useState(false);
    const [isHouseRulesOpen, setIsHouseRulesOpen] = useState(false);
    const [isPhoneViewport, setIsPhoneViewport] = useState(false);
    const [isMobileRecommendationOpen, setIsMobileRecommendationOpen] = useState(false);
    const [hasUnreadMobileChat, setHasUnreadMobileChat] = useState(false);
    const [lastSeenChatMessageId, setLastSeenChatMessageId] = useState<string | null>(null);
    const [gestureInput, setGestureInput] = useState("");
    const [seatRequestStack, setSeatRequestStack] = useState("");
    const [botDisplayName, setBotDisplayName] = useState("");
    const [rebuyAmount, setRebuyAmount] = useState("");
    const [preselectedHeroAction, setPreselectedHeroAction] = useState<QueuedHeroAction | null>(null);
    const [seatRequestPrompt, setSeatRequestPrompt] = useState<SeatRequestPromptState | null>(null);
    const [requestNoticeModal, setRequestNoticeModal] = useState<RequestNoticeModalState | null>(null);
    const [pendingAuthAction, setPendingAuthAction] = useState<PendingAuthAction | null>(null);
    const [authRegisterError, setAuthRegisterError] = useState<string | null>(null);
    const [authLoginError, setAuthLoginError] = useState<string | null>(null);
    const [isRegisteringInRoom, setIsRegisteringInRoom] = useState(false);
    const [isLoggingInRoom, setIsLoggingInRoom] = useState(false);
    const [isCreatingGuestInRoom, setIsCreatingGuestInRoom] = useState(false);
    const [authGuestError, setAuthGuestError] = useState<string | null>(null);
    const [guestRecoveryCode, setGuestRecoveryCode] = useState<string | null>(null);
    const [isDeviceLinkOpen, setIsDeviceLinkOpen] = useState(false);
    const [isCompletingAuthAction, setIsCompletingAuthAction] = useState(false);
    const [archivePreview, setArchivePreview] = useState<RoomArchivePreview | null>(null);
    const [archiveMatchDrafts, setArchiveMatchDrafts] = useState<Record<string, string>>({});
    const [seatApprovalDrafts, setSeatApprovalDrafts] = useState<Record<string, string>>({});
    const [rebuyApprovalDrafts, setRebuyApprovalDrafts] = useState<Record<string, string>>({});
    const [adminApprovalQueue, setAdminApprovalQueue] = useState<AdminApprovalQueueEntry[]>([]);
    const [adminOptionsDraft, setAdminOptionsDraft] = useState<AdminOptionsDraft>(createEmptyAdminOptionsDraft);
    const [isStopTableConfirmOpen, setIsStopTableConfirmOpen] = useState(false);
    const [selectedLedgerHandId, setSelectedLedgerHandId] = useState<string | null>(null);
    const [tablePovSeatIndex, setTablePovSeatIndex] = useState<number | null>(() => initialSnapshot?.players.find((player) => player.accountId === initialAccountId)?.seatIndex ?? null);
    const [turnClockNow, setTurnClockNow] = useState(() => getSnapshotClockMs(initialSnapshot));
    const [archivedReplayStartedAt, setArchivedReplayStartedAt] = useState<number | null>(null);
    const [lastKnownHandMarkerSeats, setLastKnownHandMarkerSeats] = useState<HandMarkerSeats>(() => ({
        dealerSeat: initialSnapshot?.currentHand?.dealerSeat ?? null,
        smallBlindSeat: initialSnapshot?.currentHand?.smallBlindSeat ?? null,
        bigBlindSeat: initialSnapshot?.currentHand?.bigBlindSeat ?? null,
    }));
    const [heroChatToast, setHeroChatToast] = useState<HeroChatToast | null>(null);
    const [chatMediaActionState, setChatMediaActionState] = useState<ChatMediaActionState>("idle");
    const [runoutEquityState, setRunoutEquityState] = useState<RunoutEquityViewState>(createEmptyRunoutEquityViewState);
    const [actionPadOffset, setActionPadOffset] = useState<ActionPadOffset>(DEFAULT_ACTION_PAD_OFFSET);
    const [dimActionPadWhenIdle, setDimActionPadWhenIdle] = useState(true);
    const [isActionPadDragging, setIsActionPadDragging] = useState(false);
    const [actionPanelScreen, setActionPanelScreen] = useState<"buttons" | "betControl">("buttons");
    const [runoutRevealStep, setRunoutRevealStep] = useState(0);
    const [suggestedGesturePrompt, setSuggestedGesturePrompt] = useState<SuggestedGesturePromptState | null>(null);
    const [suggestedGestureFlights, setSuggestedGestureFlights] = useState<SuggestedGestureFlightState[]>([]);
    const reconnectTimerRef = useRef<number | null>(null);
    const socketRef = useRef<WebSocket | null>(null);
    const chatInputRef = useRef<HTMLInputElement | null>(null);
    const tableChatOverlayRef = useRef<HTMLElement | null>(null);
    const tableChatDockRef = useRef<HTMLDivElement | null>(null);
    const tableMenuShellRef = useRef<HTMLDivElement | null>(null);
    const actionPadRef = useRef<HTMLElement | null>(null);
    const actionPadDragStateRef = useRef<ActionPadDragState | null>(null);
    const autoActionRef = useRef<string | null>(null);
    const adminApprovalSeenRef = useRef<Set<string>>(new Set());
    const runoutEquitySnapshotRef = useRef<RunoutEquitySnapshot | null>(null);
    const runoutEquityTrendResetTimerRef = useRef<number | null>(null);
    const runoutTotalStepsRef = useRef(0);
    const reactionMenuRef = useRef<HTMLDivElement | null>(null);
    const seatElementRefs = useRef<Map<number, HTMLElement>>(new Map());
    const handledSuggestedGestureEventKeysRef = useRef<Set<string>>(new Set());
    const handledSuggestedReactionIdsRef = useRef<Set<string>>(new Set());
    const archivedHands = snapshot?.archive?.hands ?? [];
    const isArchivedRoom = Boolean(snapshot?.status === "archived" && snapshot?.archive);
    const canJoinAsGuest = !demoMode && !isArchivedRoom && roomAllowsGuests(guestMode, snapshot?.adminOptions?.allowGuests);
    const selectedArchivedHand = archivedHands.find((hand) => hand.handId === selectedLedgerHandId) ?? archivedHands[0] ?? null;
    const archivedReplaySnapshot = isArchivedRoom && snapshot && selectedArchivedHand && archivedReplayStartedAt !== null
        ? buildArchivedReplayRoomSnapshot(snapshot, selectedArchivedHand, accountId, turnClockNow, archivedReplayStartedAt)
        : null;
    const tableSnapshot = archivedReplaySnapshot ?? snapshot;
    const isAdmin = Boolean(!demoMode && !isArchivedRoom && snapshot && accountId === snapshot.adminAccountId);

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

    function setSeatElementRef(seatIndex: number, element: HTMLElement | null) {
        if (element) {
            seatElementRefs.current.set(seatIndex, element);
            return;
        }

        seatElementRefs.current.delete(seatIndex);
    }

    function getElementCenter(element: HTMLElement | null): { x: number; y: number } | null {
        if (!element) {
            return null;
        }

        const rect = element.getBoundingClientRect();

        if (rect.width === 0 && rect.height === 0) {
            return null;
        }

        return {
            x: rect.left + (rect.width / 2),
            y: rect.top + (rect.height / 2),
        };
    }

    function getSuggestedGestureSeatAnchor(
        element: HTMLElement | null,
        mediaPlacement: "above" | "below" | "left" | "right",
        role: "sender" | "receiver",
    ): { x: number; y: number } | null {
        if (!element) {
            return null;
        }

        const rect = element.getBoundingClientRect();

        if (rect.width === 0 && rect.height === 0) {
            return null;
        }

        const laneIsLeft = mediaPlacement !== "left";
        const seatInsetX = Math.min(52, Math.max(28, rect.width * 0.18));
        const senderX = laneIsLeft ? rect.left + seatInsetX : rect.right - seatInsetX;
        const receiverX = laneIsLeft ? rect.left - 28 : rect.right + 28;

        return {
            x: role === "sender" ? senderX : receiverX,
            y: rect.top + (rect.height * (role === "sender" ? 0.38 : 0.3)),
        };
    }

    function resolveSuggestedGesturePrompt(eventKey: string | null) {
        if (!eventKey) {
            setSuggestedGesturePrompt(null);
            return;
        }

        handledSuggestedGestureEventKeysRef.current.add(eventKey);
        setSuggestedGesturePrompt((current) => (current?.eventKey === eventKey ? null : current));
    }

    function queueSuggestedGestureFlight(reaction: RoomSnapshot["seatReactions"][number]): boolean {
        if (!snapshot || !reaction.targetAccountId) {
            return true;
        }

        const senderSeat = tableSeats.find((seat) => seat.player?.accountId === reaction.accountId) ?? null;
        const targetSeat = tableSeats.find((seat) => seat.player?.accountId === reaction.targetAccountId) ?? null;
        const startCenter = senderSeat
            ? getSuggestedGestureSeatAnchor(seatElementRefs.current.get(senderSeat.seatIndex) ?? null, senderSeat.mediaPlacement, "sender")
            : null;
        const targetCenter = targetSeat
            ? getSuggestedGestureSeatAnchor(seatElementRefs.current.get(targetSeat.seatIndex) ?? null, targetSeat.mediaPlacement, "receiver")
            : null;
        const createdAtMs = Date.parse(reaction.createdAt);

        if (Number.isNaN(createdAtMs)) {
            return true;
        }

        if (!startCenter || !targetCenter) {
            return true;
        }

        const animationDelayMs = Math.min(
            Math.max(0, Date.now() - createdAtMs),
            SUGGESTED_GESTURE_MAX_CATCH_UP_MS,
        );

        if (animationDelayMs >= SUGGESTED_GESTURE_FLIGHT_DURATION_MS) {
            return true;
        }

        const arcLift = Math.min(120, Math.max(56, Math.abs(targetCenter.x - startCenter.x) * 0.18));

        setSuggestedGestureFlights((currentFlights) => ([
            ...currentFlights.filter((flight) => flight.id !== reaction.id),
            {
                id: reaction.id,
                emoji: reaction.emoji,
                startX: startCenter.x,
                startY: startCenter.y,
                midX: startCenter.x + ((targetCenter.x - startCenter.x) * 0.5),
                midY: Math.min(startCenter.y, targetCenter.y) - arcLift,
                endX: targetCenter.x,
                endY: targetCenter.y,
                animationDelayMs,
                expiresAtMs: Date.now() + (SUGGESTED_GESTURE_FLIGHT_DURATION_MS - animationDelayMs),
            },
        ]));

        return true;
    }

    useEffect(() => {
        if (!isReactionMenuOpen) return;
        function handleClickAway(event: MouseEvent) {
            if (reactionMenuRef.current && !reactionMenuRef.current.contains(event.target as Node)) {
                setIsReactionMenuOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickAway);
        return () => { document.removeEventListener("mousedown", handleClickAway); };
    }, [isReactionMenuOpen]);

    useEffect(() => {
        const syncSessionFromStorage = () => {
            const nextSession = readStoredBrowserSession() as SessionState | null;

            sessionTokenRef.current = nextSession?.token;
            setSession(nextSession);

            if (!initialAccountId) {
                setAccountId(nextSession?.account.id);
            }

            if (nextSession) {
                setDisplayName((current) => current || getSessionDisplayName(nextSession));
            }
        };

        syncSessionFromStorage();
        window.addEventListener("storage", syncSessionFromStorage);
        window.addEventListener(SESSION_STORAGE_EVENT, syncSessionFromStorage);

        return () => {
            window.removeEventListener("storage", syncSessionFromStorage);
            window.removeEventListener(SESSION_STORAGE_EVENT, syncSessionFromStorage);
        };
    }, [initialAccountId]);

    useEffect(() => {
        if (typeof window === "undefined") {
            return;
        }

        try {
            const storedPreference = window.localStorage.getItem(ACTION_PAD_IDLE_DIM_STORAGE_KEY);

            if (storedPreference === "0") {
                setDimActionPadWhenIdle(false);
            }
        } catch {
            // Ignore storage failures and keep the default dimming behavior.
        }
    }, []);

    useEffect(() => {
        if (typeof window === "undefined") {
            return;
        }

        try {
            window.localStorage.setItem(ACTION_PAD_IDLE_DIM_STORAGE_KEY, dimActionPadWhenIdle ? "1" : "0");
        } catch {
            // Ignore storage failures and just keep the in-memory preference.
        }
    }, [dimActionPadWhenIdle]);

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
        setIsChatExpanded(false);
        setIsChatComposerOpen(false);
    }, [isPhoneViewport]);

    useEffect(() => {
        if (!isPhoneViewport || !isChatExpanded) {
            return;
        }

        if (!snapshot?.currentHand?.heroActionState?.canAct) {
            return;
        }

        setIsChatExpanded(false);
        setIsChatComposerOpen(false);
    }, [isPhoneViewport, isChatExpanded, snapshot?.currentHand?.heroActionState?.canAct, snapshot?.currentHand?.id]);

    useEffect(() => {
        const latestMessage = snapshot?.chatMessages.at(-1);

        if (!latestMessage) {
            setHasUnreadMobileChat(false);
            setLastSeenChatMessageId(null);
            return;
        }

        if (lastSeenChatMessageId === null) {
            setLastSeenChatMessageId(latestMessage.id);
            return;
        }

        if (isPhoneViewport && isChatExpanded && latestMessage.id !== lastSeenChatMessageId) {
            setLastSeenChatMessageId(latestMessage.id);
            setHasUnreadMobileChat(false);
            return;
        }

        if (isPhoneViewport && !isChatExpanded && latestMessage.id !== lastSeenChatMessageId) {
            setHasUnreadMobileChat(true);
        }
    }, [snapshot?.chatMessages, lastSeenChatMessageId, isPhoneViewport, isChatExpanded]);

    useEffect(() => {
        if (!isPhoneViewport || !isChatExpanded) {
            return;
        }

        const handlePointerDown = (event: PointerEvent) => {
            const target = event.target;

            if (!(target instanceof Node)) {
                return;
            }

            if (tableChatOverlayRef.current?.contains(target) || tableChatDockRef.current?.contains(target)) {
                return;
            }

            setIsChatExpanded(false);
            setIsChatComposerOpen(false);
        };

        window.addEventListener("pointerdown", handlePointerDown);
        return () => window.removeEventListener("pointerdown", handlePointerDown);
    }, [isPhoneViewport, isChatExpanded]);

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
        if (!isArchivedRoom || !selectedArchivedHand) {
            return;
        }

        restartArchivedReplay();
    }, [isArchivedRoom, selectedArchivedHand?.handId]);

    useEffect(() => {
        if (demoMode) {
            setConnectionState("demo");
            return;
        }

        if (isArchivedRoom) {
            setConnectionState("archived");
            return;
        }

        let disposed = false;
        let reconnectAttempts = 0;
        let lastMessageAt = Date.now();

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
                lastMessageAt = Date.now();
                setConnectionState("live");
                socket.send(JSON.stringify({
                    type: "subscribe_room",
                    slug,
                    sessionToken: sessionTokenRef.current,
                }));
            });

            socket.addEventListener("message", (event) => {
                lastMessageAt = Date.now();
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
                reconnectAttempts += 1;

                // Keep retrying: phones regularly lose the socket when switching networks or sleeping.
                setConnectionState("reconnecting");
                const retryDelayMs = Math.min(5000, 500 * 2 ** Math.min(reconnectAttempts - 1, 4));
                reconnectTimerRef.current = window.setTimeout(connect, retryDelayMs);
            });
        };

        // Reconnect right away when the network or the tab comes back instead of waiting out the backoff.
        // Replacing the socket ref first makes the old socket's close handler a no-op, so a dead
        // connection that takes a long time to report its close cannot delay the new one.
        const replaceSocket = () => {
            const activeSocket = socketRef.current;
            socketRef.current = null;
            activeSocket?.close();
            reconnectAttempts = Math.max(reconnectAttempts, 1);
            connect();
        };
        const reconnectIfIdle = () => {
            const activeSocket = socketRef.current;

            if (disposed || (activeSocket && (activeSocket.readyState === WebSocket.OPEN || activeSocket.readyState === WebSocket.CONNECTING))) {
                return;
            }

            replaceSocket();
        };
        // A network change leaves the old TCP connection dead even if the browser still reports it open.
        const handleOnline = () => {
            if (!disposed) {
                replaceSocket();
            }
        };
        const handleVisibilityChange = () => {
            if (document.visibilityState === "visible") {
                reconnectIfIdle();
            }
        };
        const silenceCheckInterval = window.setInterval(() => {
            if (socketRef.current?.readyState === WebSocket.OPEN && Date.now() - lastMessageAt > SOCKET_SILENCE_TIMEOUT_MS) {
                replaceSocket();
            }
        }, 10_000);

        window.addEventListener("online", handleOnline);
        document.addEventListener("visibilitychange", handleVisibilityChange);

        connect();

        return () => {
            disposed = true;
            clearReconnectTimer();
            window.clearInterval(silenceCheckInterval);
            window.removeEventListener("online", handleOnline);
            document.removeEventListener("visibilitychange", handleVisibilityChange);

            const activeSocket = socketRef.current;
            socketRef.current = null;
            activeSocket?.close();
        };
    }, [slug, accountId, demoMode, isArchivedRoom]);

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
        const hasArchivedReplay = Boolean(isArchivedRoom && selectedArchivedHand && archivedReplaySnapshot?.currentHand);

        if (!hasTurnClock && !hasActiveReactions && !hasBlindCountdown && !hasAllInRunout && !hasArchivedReplay) {
            return;
        }

        setTurnClockNow(Date.now());
        const intervalId = window.setInterval(() => {
            setTurnClockNow(Date.now());
        }, 250);

        return () => {
            window.clearInterval(intervalId);
        };
    }, [snapshot?.currentHand?.handNumber, snapshot?.currentHand?.actorAccountId, snapshot?.currentHand?.street, snapshot?.turnState.currentTurnStartedAt, snapshot?.seatReactions, snapshot?.blindState.nextLevelInMs, snapshot?.blindState.pausedAt, snapshot?.lastCompletedHand?.handId, snapshot?.lastCompletedHand?.concludedAt, isArchivedRoom, selectedArchivedHand?.handId, archivedReplaySnapshot?.currentHand?.id]);

    // Drive the all-in runout board reveal one step at a time, keyed on the hand id
    // so each card always appears after exactly revealIntervalMs regardless of
    // when the snapshot arrived or whether the tab was backgrounded.
    useEffect(() => {
        const handId = snapshot?.lastCompletedHand?.allInRunout
            ? snapshot.lastCompletedHand.handId
            : null;

        setRunoutRevealStep(0);

        if (!handId || !snapshot?.lastCompletedHand?.allInRunout) {
            return;
        }

        const intervalMs = snapshot.lastCompletedHand.allInRunout.revealIntervalMs;

        const id = window.setInterval(() => {
            setRunoutRevealStep((prev) => Math.min(prev + 1, runoutTotalStepsRef.current));
        }, intervalMs);

        return () => window.clearInterval(id);
    }, [snapshot?.lastCompletedHand?.handId]);

    useEffect(() => {
        if (!snapshot) {
            return;
        }

        if (!rebuyAmount) {
            setRebuyAmount(String(defaultRebuyAmount(snapshot)));
        }

        if (!seatRequestStack) {
            setSeatRequestStack(String(defaultBuyInAmount(snapshot)));
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

    const currentHand = tableSnapshot?.currentHand ?? null;
    const heroPlayer = accountId ? tableSnapshot?.players.find((player) => player.accountId === accountId) ?? null : null;
    const heroActionState = currentHand?.heroActionState ?? null;
    const runItTwicePrompt = currentHand?.runItTwicePrompt ?? null;
    const heroInHand = Boolean(heroPlayer && currentHand?.playerCardCounts[heroPlayer.accountId]);
    const heroRunItTwiceResponse = heroPlayer && runItTwicePrompt
        ? runItTwicePrompt.responsesByAccountId[heroPlayer.accountId] ?? null
        : null;
    const heroCanRespondToRunItTwice = Boolean(
        heroPlayer
        && runItTwicePrompt?.eligibleAccountIds.includes(heroPlayer.accountId)
        && !heroRunItTwiceResponse,
    );
    const suggestedGesturesEnabled = snapshot?.adminOptions.suggestedGesturesEnabled ?? true;
    const suggestedGesturePromptProbability = snapshot?.adminOptions.suggestedGesturePromptProbability ?? 0.5;
    const turnMetrics = buildTurnMetrics(snapshot, turnClockNow);
    const suggestedGestureTrigger = suggestedGesturesEnabled
        ? buildSuggestedGestureTrigger(snapshot, accountId, turnClockNow, turnMetrics, suggestedGesturePromptProbability)
        : null;

    useEffect(() => {
        handledSuggestedGestureEventKeysRef.current.clear();
        setSuggestedGesturePrompt(null);
        setSuggestedGestureFlights([]);
    }, [snapshot?.currentHand?.id, snapshot?.lastCompletedHand?.handId, suggestedGesturesEnabled]);

    useEffect(() => {
        setSuggestedGestureFlights((currentFlights) => (
            currentFlights.some((flight) => flight.expiresAtMs <= turnClockNow)
                ? currentFlights.filter((flight) => flight.expiresAtMs > turnClockNow)
                : currentFlights
        ));

        if (suggestedGesturePrompt && suggestedGesturePrompt.expiresAtMs <= turnClockNow) {
            resolveSuggestedGesturePrompt(suggestedGesturePrompt.eventKey);
        }
    }, [turnClockNow, suggestedGesturePrompt]);

    useEffect(() => {
        if (!suggestedGestureTrigger) {
            return;
        }

        if (handledSuggestedGestureEventKeysRef.current.has(suggestedGestureTrigger.eventKey)) {
            return;
        }

        setSuggestedGesturePrompt((currentPrompt) => {
            if (currentPrompt?.eventKey === suggestedGestureTrigger.eventKey) {
                return currentPrompt;
            }

            return {
                ...suggestedGestureTrigger,
                expiresAtMs: Date.now() + SUGGESTED_GESTURE_POPOVER_DURATION_MS,
            };
        });
    }, [
        suggestedGestureTrigger?.eventKey,
        suggestedGestureTrigger?.targetAccountId,
        suggestedGestureTrigger?.targetDisplayName,
    ]);

    useEffect(() => {
        if (!suggestedGesturePrompt) {
            return;
        }

        if (!suggestedGestureTrigger || suggestedGestureTrigger.eventKey !== suggestedGesturePrompt.eventKey) {
            resolveSuggestedGesturePrompt(suggestedGesturePrompt.eventKey);
        }
    }, [suggestedGesturePrompt, suggestedGestureTrigger?.eventKey]);

    useEffect(() => {
        if (!currentHand) {
            return;
        }

        setLastKnownHandMarkerSeats({
            dealerSeat: currentHand.dealerSeat,
            smallBlindSeat: currentHand.smallBlindSeat,
            bigBlindSeat: currentHand.bigBlindSeat,
        });
    }, [currentHand?.dealerSeat, currentHand?.smallBlindSeat, currentHand?.bigBlindSeat, currentHand?.id]);

    useEffect(() => {
        if (!preselectedHeroAction) {
            return;
        }

        if (!currentHand || !heroInHand || heroCanRespondToRunItTwice || !heroActionState || heroActionState.hasFolded || heroActionState.isAllIn) {
            setPreselectedHeroAction(null);
            autoActionRef.current = null;
            return;
        }

        if (!heroActionState.canAct) {
            const canKeepQueuedAction = preselectedHeroAction.type === "check_or_fold"
                || preselectedHeroAction.type === "fold"
                || (preselectedHeroAction.type === "check" && heroActionState.callAmount === 0)
                || (preselectedHeroAction.type === "call"
                    && heroActionState.allowedActions.includes("call")
                    && heroActionState.callAmount === preselectedHeroAction.amount);

            if (canKeepQueuedAction) {
                return;
            }
        }

        if (resolveQueuedHeroAction(preselectedHeroAction, heroActionState)) {
            return;
        }

        setPreselectedHeroAction(null);
        autoActionRef.current = null;
    }, [currentHand, heroActionState, heroCanRespondToRunItTwice, heroInHand, preselectedHeroAction]);

    const viewerHasRoomAccess = Boolean(snapshot && (!snapshot.passwordProtected || snapshot.viewerHasRoomAccess));
    const isProtectedRoomLocked = Boolean(!demoMode && snapshot?.passwordProtected && !viewerHasRoomAccess);
    const canJoinProtectedRoom = Boolean(snapshot && snapshot.passwordProtected && !viewerHasRoomAccess);
    const canChat = Boolean(snapshot && accountId && session && viewerHasRoomAccess && !demoMode && !isArchivedRoom);
    const isMobileChatTemporarilyBlocked = Boolean(isPhoneViewport && heroActionState?.canAct);
    const canConnectMedia = Boolean(session && snapshot && viewerHasRoomAccess && !demoMode && !isArchivedRoom);
    const media = useTableMedia({
        slug,
        session,
        canConnect: canConnectMedia,
        displayName: displayName.trim() || heroPlayer?.displayName || getSessionDisplayName(session),
    });
    const readyPlayerCount = snapshot?.players.filter((player) => player.isReady && player.isConnected && !player.isSittingOut && player.stack > 0).length ?? 0;
    const effectiveMediaParticipants = demoMode ? demoMediaParticipants : media.participants;
    const effectiveRemoteParticipants = demoMode ? demoMediaParticipants.filter((participant) => !participant.isLocal) : media.remoteParticipants;
    const mediaParticipantsByAccountId = buildMediaParticipantsByAccountId(effectiveMediaParticipants);
    const activeSeatReactions = buildActiveReactionMap(snapshot, turnClockNow, suggestedGesturesEnabled);
    const seatGesturesByAccountId = buildSeatGestureMap(snapshot);
    const heroContribution = heroPlayer && currentHand ? currentHand.contributions[heroPlayer.accountId] ?? 0 : 0;
    const heroWagerInputConfig = heroActionState ? getHeroWagerInputConfig(heroActionState) : null;
    const rebuyPresets = snapshot ? buildRebuyPresets(snapshot) : [];
    const adminName = snapshot?.players.find((player) => player.accountId === snapshot.adminAccountId)?.displayName ?? snapshot?.adminAccountId ?? "Unknown";
    const canAdminStartHand = Boolean(snapshot && accountId === snapshot.adminAccountId && !currentHand && readyPlayerCount >= 2);
    const mediaNotice = demoMode ? "Sample table uses mocked camera tiles for layout previews." : media.mediaError ?? media.environmentError;
    const blindCountdownMs = snapshot?.blindState ? getBlindCountdownMs(snapshot.blindState, turnClockNow) : null;

    useEffect(() => {
        if (demoMode || typeof window === "undefined") {
            return;
        }

        const currentUrl = new URL(window.location.href);
        const currentPrompt = currentUrl.searchParams.get(ROOM_PASSWORD_PROMPT_QUERY_PARAM);

        if (isProtectedRoomLocked) {
            if (currentPrompt === ROOM_PASSWORD_PROMPT_QUERY_VALUE) {
                return;
            }

            currentUrl.searchParams.set(ROOM_PASSWORD_PROMPT_QUERY_PARAM, ROOM_PASSWORD_PROMPT_QUERY_VALUE);
            window.history.replaceState(window.history.state, "", currentUrl);
            return;
        }

        if (currentPrompt !== ROOM_PASSWORD_PROMPT_QUERY_VALUE) {
            return;
        }

        currentUrl.searchParams.delete(ROOM_PASSWORD_PROMPT_QUERY_PARAM);
        window.history.replaceState(window.history.state, "", currentUrl);
    }, [demoMode, isProtectedRoomLocked]);

    useEffect(() => {
        if (!suggestedGesturesEnabled) {
            handledSuggestedReactionIdsRef.current.clear();
            setSuggestedGestureFlights([]);
            return;
        }

        if (!snapshot?.seatReactions.length) {
            handledSuggestedReactionIdsRef.current.clear();
            return;
        }

        const liveReactionIds = new Set(snapshot.seatReactions.map((reaction) => reaction.id));

        handledSuggestedReactionIdsRef.current.forEach((reactionId) => {
            if (!liveReactionIds.has(reactionId)) {
                handledSuggestedReactionIdsRef.current.delete(reactionId);
            }
        });

        snapshot.seatReactions.forEach((reaction) => {
            if (!reaction.targetAccountId || handledSuggestedReactionIdsRef.current.has(reaction.id)) {
                return;
            }

            if (queueSuggestedGestureFlight(reaction)) {
                handledSuggestedReactionIdsRef.current.add(reaction.id);
            }
        });
    }, [snapshot, suggestedGesturesEnabled]);

    const heroPendingSeatRequest = accountId ? snapshot?.pendingSeatRequests.find((request) => request.accountId === accountId) ?? null : null;
    const heroPendingRebuyRequest = accountId ? snapshot?.pendingRebuyRequests.find((request) => request.accountId === accountId) ?? null : null;
    const canShowRebuyMenu = Boolean(heroPlayer && (heroPlayer.stack <= 0 || heroPendingRebuyRequest));
    const isSpectating = heroPlayer === null;
    const showCenterReadyButton = Boolean(!isArchivedRoom && heroPlayer && !heroPlayer.isReady && !heroPlayer.isSittingOut);
    const showCenterStartHand = Boolean(canAdminStartHand && snapshot?.status !== "paused");
    const canArchiveStoppedTable = Boolean(
        isAdmin
        && !currentHand
        && snapshot?.status === "waiting"
        && (snapshot?.handCount ?? 0) > 0,
    );
    const activeAdminApproval = adminApprovalQueue[0] ?? null;
    const activeAdminSeatRequest = activeAdminApproval?.kind === "seat"
        ? snapshot?.pendingSeatRequests.find((request) => request.id === activeAdminApproval.requestId) ?? null
        : null;
    const activeAdminRebuyRequest = activeAdminApproval?.kind === "rebuy"
        ? snapshot?.pendingRebuyRequests.find((request) => request.id === activeAdminApproval.requestId) ?? null
        : null;
    const availableBotSeatIndices = snapshot ? getAvailableBotSeatIndices(snapshot) : [];
    const defaultBotDisplayName = snapshot ? getNextBotDisplayName(snapshot) : "Bot 1";
    const currentActor = tableSnapshot?.currentHand?.actorAccountId
        ? tableSnapshot.players.find((player) => player.accountId === tableSnapshot.currentHand?.actorAccountId) ?? null
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
    const lastCompletedHandRevealState = isArchivedRoom ? null : snapshot?.lastCompletedHandRevealState ?? null;
    const latestCompletedHand = tableSnapshot?.lastCompletedHand ?? null;
    const runoutHandId = latestCompletedHand?.allInRunout ? latestCompletedHand.handId : null;
    runoutTotalStepsRef.current = (() => {
        const allInRunout = latestCompletedHand?.allInRunout;
        if (!allInRunout || !latestCompletedHand) return 0;
        return getCompletedHandBoards(latestCompletedHand).reduce(
            (total, board) => total + Math.max(0, board.length - allInRunout.startBoardCount),
            0,
        );
    })();
    const allInRunoutView = runoutHandId
        ? buildAllInRunoutViewFromStep(latestCompletedHand, runoutRevealStep)
        : buildAllInRunoutView(latestCompletedHand, turnClockNow);
    const isAllInRunoutAnimating = Boolean(allInRunoutView?.isActive);
    const pendingRunoutWinners = buildPendingRunoutWinners(latestCompletedHand, isAllInRunoutAnimating);
    const archivedReplayRevealedCards = isArchivedRoom && archivedReplayStartedAt !== null
        ? selectedArchivedHand?.revealedHoleCards ?? null
        : null;
    const heroHandsWonCount = heroPlayer && snapshot
        ? getDisplayedHandsWonCount(heroPlayer.accountId, snapshot.playerStats.handsWonByAccount[heroPlayer.accountId] ?? 0, pendingRunoutWinners)
        : 0;
    const runoutRevealedHoleCards = latestCompletedHand && allInRunoutView?.isActive
        ? filterRevealedHoleCards(latestCompletedHand.revealedHoleCards, new Set(allInRunoutView.revealedAccountIds))
        : null;
    const runoutHandLabelByAccount = buildRunoutHandLabelByAccount(latestCompletedHand, allInRunoutView);
    const tableSeats = buildTableSeats(tableSnapshot, tablePovSeatIndex ?? heroPlayer?.seatIndex, accountId, Boolean(heroPlayer), {
        suppressWinnerHighlights: isAllInRunoutAnimating,
        completedHandReveals: archivedReplayRevealedCards ?? runoutRevealedHoleCards,
        markerSeats: lastKnownHandMarkerSeats,
        pendingRunoutWinners,
        runoutHandLabelByAccount,
        runoutWinPercentByAccount: runoutEquityState.percentByAccount,
        runoutEquityLeaderAccountIds: runoutEquityState.leaderAccountIds,
        runoutEquityTrendByAccount: runoutEquityState.trendByAccount,
    }, isPhoneViewport);
    const displayedBoards = currentHand
        ? [currentHand.board]
        : allInRunoutView?.visibleBoards ?? getCompletedHandBoards(latestCompletedHand);
    const displayedBoard = displayedBoards[0] ?? [];
    const displayedAdditionalBoards = displayedBoards.slice(1);
    const displayedBoardCount = displayedBoards.reduce((totalCards, board) => totalCards + board.length, 0);
    const displayedPot = currentHand?.pot ?? latestCompletedHand?.totalPot ?? 0;
    const latestCompletedHandConcludedAtMs = latestCompletedHand ? Date.parse(latestCompletedHand.concludedAt) : Number.NaN;
    const showVictoryConfetti = Boolean(
        !isArchivedRoom
        && !currentHand
        && !isAllInRunoutAnimating
        && accountId
        && latestCompletedHand
        && latestCompletedHand.winners.some((winner) => winner.accountId === accountId)
        && Number.isFinite(latestCompletedHandConcludedAtMs)
        && turnClockNow - latestCompletedHandConcludedAtMs <= VICTORY_CONFETTI_DURATION_MS,
    );
    const centerStatus = isArchivedRoom
        ? buildArchivedCenterStatus(selectedArchivedHand, currentHand)
        : isAllInRunoutAnimating
            ? displayedAdditionalBoards.length > 0
                ? "All-in showdown. Running it twice..."
                : "All-in showdown. Running board..."
            : buildCenterStatus(snapshot, nextHandCountdown);
    const heroDisplayedStack = heroPlayer ? getDisplayedPlayerStack(heroPlayer, pendingRunoutWinners) ?? heroPlayer.stack : 0;
    const heroLastCompletedRevealedCards = heroPlayer && snapshot?.lastCompletedHand
        ? snapshot.lastCompletedHand.revealedHoleCards[heroPlayer.accountId] ?? [null, null]
        : null;
    const blindScheduleValidation = validateBlindScheduleDraft(adminOptionsDraft);
    const runoutEquityBoardKey = buildBoardCollectionKey(allInRunoutView?.visibleBoards ?? []);
    const runoutEquityAccountIdsKey = buildAccountListKey(allInRunoutView?.revealedAccountIds ?? latestCompletedHand?.allInRunout?.revealedAccountIds ?? []);
    const tableMenuItems = [
        { id: "seat", label: "Seat" },
        ...(canShowRebuyMenu ? [{ id: "rebuy", label: "Rebuy" } as const] : []),
        ...(isAdmin ? [{ id: "admin", label: "Admin" } as const] : []),
    ] as const;

    useEffect(() => {
        const canOpenWagerControl = Boolean(
            heroActionState?.canAct
            && (heroActionState.allowedActions.includes("bet") || heroActionState.allowedActions.includes("raise")),
        );

        if (!canOpenWagerControl || heroCanRespondToRunItTwice) {
            setActionPanelScreen("buttons");
        }
    }, [
        actionPanelScreen,
        heroActionState?.canAct,
        heroActionState?.allowedActions,
        heroActionState?.minRaiseTo,
        heroActionState?.maxRaiseTo,
        heroCanRespondToRunItTwice,
        snapshot?.currentHand?.handNumber,
    ]);

    function renderRoomMetaPills() {
        return (
            <>
                <span className="room-toolbar__pill">{currentHand ? `NLHE · ${formatNumber(currentHand.blindLevel.smallBlind)} / ${formatNumber(currentHand.blindLevel.bigBlind)}` : "NLHE · Waiting"}</span>
                <span className="room-toolbar__pill">Owner {adminName}</span>
                <span className="room-toolbar__pill">{tableSnapshot?.players.length ?? 0}/{snapshot?.maxPlayers ?? 0} seated</span>
                <span className="room-toolbar__pill">{demoMode ? "Sample table" : snapshot?.visibility === "club" ? "Club table" : "Private table"}</span>
                {isArchivedRoom ? <span className="room-toolbar__pill">Archived</span> : null}
                <span className={`connection-pill connection-pill--${connectionState}`}>{connectionState}</span>
                <button className="room-toolbar__pill room-toolbar__pill-button" type="button" onClick={() => setIsEngineInfoOpen(true)}>
                    Info
                </button>
                {houseRulesConfig.visible ? (
                    <button className="room-toolbar__pill room-toolbar__pill-button" type="button" onClick={() => setIsHouseRulesOpen(true)}>
                        House Rules
                    </button>
                ) : null}
            </>
        );
    }

    function openSessionActivityModal(nextView: "log" | "ledger" = "ledger") {
        setSessionLogView(nextView);
        setIsSessionLedgerOpen(true);
        setOpenMenuPanel(null);
    }

    function renderTableMenuButtons() {
        return (
            <>
                {!isArchivedRoom ? (
                    <>
                        {tableMenuItems.map((item) => (
                            <button
                                key={item.id}
                                className={[
                                    "table-menu-cluster__button",
                                    `table-menu-cluster__button--${item.id}`,
                                    openMenuPanel === item.id ? "table-menu-cluster__button--active" : "",
                                ].filter(Boolean).join(" ")}
                                type="button"
                                onClick={() => setOpenMenuPanel((current) => current === item.id ? null : item.id)}
                            >
                                {item.label}
                            </button>
                        ))}
                    </>
                ) : null}

                <button
                    className="table-menu-cluster__button table-menu-cluster__button--info"
                    type="button"
                    onClick={() => {
                        setOpenMenuPanel(null);
                        setIsEngineInfoOpen(true);
                    }}
                >
                    Info
                </button>

                {houseRulesConfig.visible ? (
                    <button
                        className="table-menu-cluster__button table-menu-cluster__button--rules"
                        type="button"
                        onClick={() => {
                            setOpenMenuPanel(null);
                            setIsHouseRulesOpen(true);
                        }}
                    >
                        Rules
                    </button>
                ) : null}
            </>
        );
    }

    function renderTableStatusRackContent() {
        const currentBlindLevel = currentHand?.blindLevel ?? snapshot?.blindState.currentLevel ?? null;
        const currentBlindLabel = currentBlindLevel ? formatBlindLevelCompact(currentBlindLevel) : "Waiting";
        const nextBlindSummary = !isArchivedRoom && snapshot?.blindState.nextLevel && blindCountdownMs !== null
            ? `Next ${formatBlindLevelCompact(snapshot.blindState.nextLevel)} in ${formatClockCountdown(blindCountdownMs)}`
            : null;

        return (
            <>
                <div className="table-status-rack__summary">
                    <span className="table-status-rack__eyebrow">{snapshot?.name ?? `Room ${slug}`}</span>
                    <div className="table-status-rack__blind-line">
                        <span className="table-status-rack__current-blind">{currentBlindLabel}</span>
                        {nextBlindSummary ? <span className="table-status-rack__next-blind">{nextBlindSummary}</span> : null}
                    </div>
                </div>

                <div className="table-status-rack__badges">
                    {snapshot?.status === "paused" ? <span className="chip-pill">Paused</span> : null}
                    {isArchivedRoom ? <span className="chip-pill">Archived replay</span> : null}
                    <span className="chip-pill">Hand {currentHand?.handNumber ?? latestCompletedHand?.handNumber ?? snapshot?.handCount ?? 0}</span>
                    {turnMetrics ? <span className="chip-pill chip-pill--timer chip-pill--turn-timer">{turnMetrics.kind === "run-it-twice" ? "Vote" : "Turn"} {formatTurnSeconds(turnMetrics.mainSecondsRemaining)}</span> : null}
                    {turnMetrics && currentActor ? <span className="chip-pill">Action {currentActor.displayName}</span> : null}
                    {turnMetrics?.kind === "run-it-twice" ? <span className="chip-pill">Run it twice vote</span> : null}
                </div>

                {isAdmin ? (
                    <div className="table-status-rack__controls">
                        <button className="table-status-rack__control" type="button" onClick={() => void handlePauseToggle()} disabled={isMutating}>
                            {snapshot?.status === "paused" ? "Resume" : "Pause"}
                        </button>
                        <button className="table-status-rack__control table-status-rack__control--danger" type="button" onClick={() => void handleStopTable()} disabled={isMutating || Boolean(currentHand)}>
                            Stop
                        </button>
                        {canArchiveStoppedTable ? (
                            <button className="table-status-rack__control" type="button" onClick={() => void handleArchiveTable()} disabled={isMutating}>
                                Archive
                            </button>
                        ) : null}
                    </div>
                ) : null}
            </>
        );
    }

    const tableMenuDrawer = !isArchivedRoom && openMenuPanel ? (
        <div className={["table-menu-drawer", openMenuPanel === "admin" ? "table-menu-drawer--admin" : ""].filter(Boolean).join(" ")}>
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
                    {session ? (
                        <>
                            <p className="muted-copy">Signed in as {getSessionDisplayName(session)}{session.account.isGuest ? " (guest)" : ""}</p>
                            <button className="button button--secondary table-menu-drawer__button" type="button" onClick={() => setIsDeviceLinkOpen(true)}>
                                Use on another device
                            </button>
                        </>
                    ) : <p className="muted-copy">Pick a seat and you will be asked to sign in or create an account from this page.</p>}

                    {heroPlayer ? (
                        <div className="table-stat-list">
                            <span className="chip-pill">Seat {heroPlayer.seatIndex + 1}</span>
                            <span className="chip-pill">Stack {formatNumber(heroDisplayedStack)}</span>
                            <span className="chip-pill">Bought {formatNumber(heroBuyInTotal)}</span>
                        </div>
                    ) : (
                        <>
                            {snapshot ? (
                                <div className="table-stat-list">
                                    <span className="chip-pill">Min {formatNumber(snapshot.buyInState.minRebuyAmount)}</span>
                                    <span className="chip-pill">Max {formatNumber(snapshot.buyInState.maxRebuyAmount)}</span>
                                </div>
                            ) : null}
                            <p className="muted-copy">Pick an open seat to set an optional display name and choose your buy-in.</p>
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
                    ) : (
                        // Mic and camera connect to the table's media on first use, so there is no separate connect step.
                        <div className="seat-control-list seat-control-list--stacked">
                            <button
                                className="button button--secondary table-menu-drawer__button"
                                type="button"
                                onClick={() => void handleChatMediaToggle("microphone")}
                                disabled={chatMediaActionState !== "idle" || Boolean(media.environmentError)}
                            >
                                {chatMediaActionState === "connecting" || chatMediaActionState === "microphone"
                                    ? "Connecting…"
                                    : media.isConnected && media.microphoneEnabled ? "Mute mic" : "Turn on mic"}
                            </button>
                            <button
                                className="button button--secondary table-menu-drawer__button"
                                type="button"
                                onClick={() => void handleChatMediaToggle("camera")}
                                disabled={chatMediaActionState !== "idle" || Boolean(media.environmentError)}
                            >
                                {chatMediaActionState === "connecting" || chatMediaActionState === "camera"
                                    ? "Connecting…"
                                    : media.isConnected && media.cameraEnabled ? "Stop camera" : "Turn on camera"}
                            </button>
                            {media.isConnected ? (
                                <button className="button button--primary table-menu-drawer__button" type="button" onClick={media.handleDisconnectMedia}>
                                    Disconnect media
                                </button>
                            ) : null}
                        </div>
                    )}

                    {mediaNotice ? <p className="form-error">{mediaNotice}</p> : null}
                </div>
            ) : null}

            {openMenuPanel === "admin" && isAdmin && snapshot ? (
                <div className="table-menu-drawer__section table-menu-drawer__section--admin">
                    <span className="table-menu-drawer__eyebrow">Admin options</span>

                    <div className="table-admin-grid">
                        <section className="table-admin-card">
                            <div className="table-admin-card__header">
                                <div>
                                    <strong>Controls</strong>
                                    <p className="table-admin-card__copy">Pause the table, start the next hand, or close the session once play is idle.</p>
                                </div>
                            </div>
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
                                <button className="button button--primary table-menu-drawer__button" type="button" onClick={() => void handleArchiveTable()} disabled={isMutating || Boolean(currentHand) || (snapshot?.handCount ?? 0) < 1}>
                                    Archive table
                                </button>
                            </div>
                            {currentHand ? <p className="muted-copy">Stop and archive become available once the current hand is finished.</p> : null}
                        </section>

                        <section className="table-admin-card">
                            <div className="table-admin-card__header">
                                <div>
                                    <strong>Bots</strong>
                                    <p className="table-admin-card__copy">Fill open seats with ready bots so the table can start before you seat yourself.</p>
                                </div>
                            </div>
                            <input
                                className="control-input"
                                type="text"
                                value={botDisplayName}
                                onChange={(event) => setBotDisplayName(event.target.value)}
                                placeholder={defaultBotDisplayName}
                            />
                            <input
                                className="control-input"
                                type="number"
                                min={1}
                                step={1}
                                value={seatRequestStack}
                                onChange={(event) => setSeatRequestStack(event.target.value)}
                                placeholder="bot stack"
                            />

                            {availableBotSeatIndices.length ? (
                                <div className="table-admin-list">
                                    {availableBotSeatIndices.map((seatIndex) => (
                                        <article key={`bot-seat-${seatIndex}`} className="table-admin-list__item">
                                            <div>
                                                <strong>Seat {seatIndex + 1}</strong>
                                                <span>{botDisplayName.trim() || defaultBotDisplayName} joins ready</span>
                                            </div>
                                            <button className="button button--primary" type="button" onClick={() => void handleSeatBot(seatIndex)} disabled={isMutating}>
                                                Add bot
                                            </button>
                                        </article>
                                    ))}
                                </div>
                            ) : snapshot.pendingSeatRequests.length ? (
                                <p className="muted-copy">No open bot seats are available while seat requests are pending.</p>
                            ) : (
                                <p className="muted-copy">No open seats are available for bots right now.</p>
                            )}
                        </section>

                        <section className="table-admin-card table-admin-card--wide">
                            <div className="table-admin-card__header">
                                <div>
                                    <strong>Table settings</strong>
                                    <p className="table-admin-card__copy">Organize blinds, buy-ins, visibility, and reaction behavior in one consistent panel.</p>
                                </div>
                                <span className="table-admin-card__meta">Buy-in window {formatNumber(snapshot.buyInState.minRebuyAmount)} to {formatNumber(snapshot.buyInState.maxRebuyAmount)}</span>
                            </div>

                            <div className="table-admin-sections">
                                <section className="table-admin-section">
                                    <div className="table-admin-section__header">
                                        <h4 className="table-admin-section__title">Blinds & pace</h4>
                                        <p className="table-admin-section__copy">Set the opening level, hand cadence, and whether the table should roll forward automatically.</p>
                                    </div>
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
                                            <span>Time before next hand</span>
                                            <input className="control-input" type="number" min={0} step={1} value={adminOptionsDraft.autoStartDelaySeconds} onChange={(event) => setAdminOptionsDraft((current) => ({ ...current, autoStartDelaySeconds: event.target.value }))} disabled={!adminOptionsDraft.autoStartNextHand} placeholder="seconds" />
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
                                        <label className="table-admin-field table-admin-field--toggle table-admin-field--full">
                                            <input type="checkbox" checked={adminOptionsDraft.useBlindSchedule} onChange={(event) => setAdminOptionsDraft((current) => ({ ...current, useBlindSchedule: event.target.checked }))} />
                                            <span>Use blind schedule</span>
                                        </label>
                                    </div>
                                </section>

                                <section className="table-admin-section">
                                    <div className="table-admin-section__header">
                                        <h4 className="table-admin-section__title">Buy-ins & listing</h4>
                                        <p className="table-admin-section__copy">Control discoverability and keep the buy-in rules aligned with the live table.</p>
                                    </div>
                                    <div className="table-admin-form-grid">
                                        <label className="table-admin-field table-admin-field--toggle table-admin-field--full">
                                            <input type="checkbox" checked={adminOptionsDraft.isPubliclyListed} onChange={(event) => setAdminOptionsDraft((current) => ({ ...current, isPubliclyListed: event.target.checked }))} />
                                            <span>Show this room on the public rooms page</span>
                                        </label>
                                        {guestMode === "per-room" ? (
                                            <label className="table-admin-field table-admin-field--toggle table-admin-field--full">
                                                <input type="checkbox" checked={adminOptionsDraft.allowGuests} onChange={(event) => setAdminOptionsDraft((current) => ({ ...current, allowGuests: event.target.checked }))} />
                                                <span>Allow guests to join without an account</span>
                                            </label>
                                        ) : null}
                                        <label className="table-admin-field">
                                            <span>Minimum buy-in</span>
                                            <input className="control-input" type="number" min={1} step={1} value={adminOptionsDraft.minBuyInAmount} onChange={(event) => setAdminOptionsDraft((current) => ({ ...current, minBuyInAmount: event.target.value }))} />
                                        </label>
                                        <label className="table-admin-field">
                                            <span>Maximum buy-in rule</span>
                                            <select className="control-input" value={adminOptionsDraft.maxBuyInRuleKind} onChange={(event) => setAdminOptionsDraft((current) => ({ ...current, maxBuyInRuleKind: event.target.value as AdminOptionsDraft["maxBuyInRuleKind"] }))}>
                                                <option value="chip_lead_percentage">Percent of chip leader</option>
                                                <option value="fixed_amount">Fixed amount</option>
                                            </select>
                                        </label>
                                        <label className="table-admin-field table-admin-field--full">
                                            <span>{adminOptionsDraft.maxBuyInRuleKind === "fixed_amount" ? "Maximum buy-in" : "Chip leader percentage"}</span>
                                            <input className="control-input" type="number" min={1} step={1} value={adminOptionsDraft.maxBuyInRuleValue} onChange={(event) => setAdminOptionsDraft((current) => ({ ...current, maxBuyInRuleValue: event.target.value }))} />
                                        </label>
                                    </div>
                                </section>

                                <section className="table-admin-section">
                                    <div className="table-admin-section__header">
                                        <h4 className="table-admin-section__title">Gameplay & suggestions</h4>
                                        <p className="table-admin-section__copy">Keep showdown rules and reaction prompts aligned with the tone of the table.</p>
                                    </div>
                                    <div className="table-admin-form-grid">
                                        <label className="table-admin-field table-admin-field--toggle table-admin-field--full">
                                            <input type="checkbox" checked={adminOptionsDraft.revealAllShowdownHands} onChange={(event) => setAdminOptionsDraft((current) => ({ ...current, revealAllShowdownHands: event.target.checked }))} />
                                            <span>Reveal all hands when no more action is possible</span>
                                        </label>
                                        <label className="table-admin-field table-admin-field--toggle table-admin-field--full">
                                            <input type="checkbox" checked={adminOptionsDraft.runItTwiceEnabled} onChange={(event) => setAdminOptionsDraft((current) => ({ ...current, runItTwiceEnabled: event.target.checked }))} />
                                            <span>Run it twice on all-in showdowns before the river</span>
                                        </label>
                                        <label className="table-admin-field table-admin-field--toggle table-admin-field--full">
                                            <input type="checkbox" checked={adminOptionsDraft.suggestedGesturesEnabled} onChange={(event) => setAdminOptionsDraft((current) => ({ ...current, suggestedGesturesEnabled: event.target.checked }))} />
                                            <span>Enable suggested gesture prompts and flyover reactions</span>
                                        </label>
                                        <label className="table-admin-field table-admin-field--full">
                                            <span>Suggestion prompt probability</span>
                                            <input className="control-input" type="number" min={0} max={1} step={0.05} value={adminOptionsDraft.suggestedGesturePromptProbability} onChange={(event) => setAdminOptionsDraft((current) => ({ ...current, suggestedGesturePromptProbability: event.target.value }))} />
                                        </label>
                                        <label className="table-admin-field table-admin-field--full">
                                            <span>Bot flyover reaction probability</span>
                                            <input className="control-input" type="number" min={0} max={1} step={0.05} value={adminOptionsDraft.botSuggestedGestureReactionProbability} onChange={(event) => setAdminOptionsDraft((current) => ({ ...current, botSuggestedGestureReactionProbability: event.target.value }))} />
                                        </label>
                                    </div>
                                </section>

                                {adminOptionsDraft.useBlindSchedule ? (
                                    <div className="table-admin-section table-admin-section--full">
                                        <div className="table-admin-section__header">
                                            <h4 className="table-admin-section__title">Blind schedule</h4>
                                            <p className="table-admin-section__copy">Add one row per level. The final row stays active after the schedule runs out.</p>
                                        </div>

                                        <div className="table-admin-field table-admin-field--full table-admin-schedule">
                                            <div className="table-admin-schedule__header">
                                                <div>
                                                    <span>Blind level rows</span>
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
                                    </div>
                                ) : null}
                            </div>

                            <div className="table-admin-actions">
                                <button className="button button--primary table-menu-drawer__button" type="button" onClick={() => void handleSaveAdminOptions()} disabled={isMutating || (adminOptionsDraft.useBlindSchedule && blindScheduleValidation.errors.length > 0)}>
                                    Save table options
                                </button>
                            </div>
                        </section>

                        <section className="table-admin-card">
                            <div className="table-admin-card__header">
                                <div>
                                    <strong>Seat approvals</strong>
                                    <p className="table-admin-card__copy">Review pending seats and adjust the requested stack before approving entry.</p>
                                </div>
                                <span className="table-admin-card__meta">{snapshot.pendingSeatRequests.length} waiting</span>
                            </div>
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
                            <div className="table-admin-card__header">
                                <div>
                                    <strong>Rebuy approvals</strong>
                                    <p className="table-admin-card__copy">Approve or deny add-ons while keeping each rebuy inside the current window.</p>
                                </div>
                                <span className="table-admin-card__meta">{snapshot.pendingRebuyRequests.length} waiting</span>
                            </div>
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
                            <div className="table-admin-card__header">
                                <div>
                                    <strong>Players</strong>
                                    <p className="table-admin-card__copy">Track the live table lineup and remove players or bots when a seat needs to open up.</p>
                                </div>
                                <span className="table-admin-card__meta">{snapshot.players.length} seated</span>
                            </div>
                            <div className="table-admin-list">
                                {snapshot.players.map((player) => {
                                    const isBotPlayer = isBotAccountId(player.accountId);

                                    return (
                                        <article key={player.accountId} className="table-admin-list__item">
                                            <div>
                                                <strong>{player.displayName}</strong>
                                                <span>Seat {player.seatIndex + 1} · Stack {formatNumber(player.stack)}{isBotPlayer ? " · Bot" : ""}</span>
                                            </div>
                                            {player.accountId !== snapshot.adminAccountId ? (
                                                <button className="button button--danger" type="button" onClick={() => void handleRemovePlayer(player.accountId)} disabled={isMutating || Boolean(currentHand?.playerCardCounts[player.accountId])}>
                                                    {isBotPlayer ? "Remove bot" : "Remove"}
                                                </button>
                                            ) : <span className="chip-pill">Admin</span>}
                                        </article>
                                    );
                                })}
                            </div>
                        </section>
                    </div>
                </div>
            ) : null}
        </div>
    ) : null;

    useTableSoundEffects({
        snapshot,
        accountId,
        isAdmin,
        viewerHasRoomAccess,
        displayedBoardCount,
        isAllInRunoutActive: isAllInRunoutAnimating,
        turnActorAccountId: currentHand?.actorAccountId ?? null,
        turnStartedAt: snapshot?.turnState.currentTurnStartedAt ?? null,
        turnMainSecondsRemaining: turnMetrics?.mainSecondsRemaining ?? null,
        isUsingTimeBank: turnMetrics?.isUsingTimeBank ?? false,
        demoMode: demoMode || isArchivedRoom,
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

    useEffect(() => {
        if (typeof window === "undefined" || (!openMenuPanel && !isChatComposerOpen && !isChatExpanded)) {
            return;
        }

        const handlePointerDown = (event: PointerEvent) => {
            const target = event.target;

            if (!(target instanceof Node)) {
                return;
            }

            if (openMenuPanel && tableMenuShellRef.current && !tableMenuShellRef.current.contains(target)) {
                setOpenMenuPanel(null);
            }

            if ((isChatComposerOpen || isChatExpanded) && tableChatOverlayRef.current && !tableChatOverlayRef.current.contains(target)) {
                setIsChatComposerOpen(false);
                setIsChatExpanded(false);
            }
        };

        window.addEventListener("pointerdown", handlePointerDown);
        return () => window.removeEventListener("pointerdown", handlePointerDown);
    }, [isChatComposerOpen, isChatExpanded, openMenuPanel]);

    useEffect(() => {
        if (typeof window === "undefined" || (!openMenuPanel && !isChatComposerOpen && !isSessionLedgerOpen)) {
            return;
        }

        const handleEscape = (event: KeyboardEvent) => {
            if (event.key !== "Escape") {
                return;
            }

            setOpenMenuPanel(null);
            setIsChatComposerOpen(false);
            setIsSessionLedgerOpen(false);
        };

        window.addEventListener("keydown", handleEscape);
        return () => window.removeEventListener("keydown", handleEscape);
    }, [isChatComposerOpen, isSessionLedgerOpen, openMenuPanel]);

    useEffect(() => {
        if (!isChatComposerOpen) {
            return;
        }

        chatInputRef.current?.focus();
    }, [isChatComposerOpen]);

    useEffect(() => {
        if (!heroChatToast || typeof window === "undefined") {
            return;
        }

        const timerId = window.setTimeout(() => {
            setHeroChatToast((current) => current?.id === heroChatToast.id ? null : current);
        }, 4200);

        return () => window.clearTimeout(timerId);
    }, [heroChatToast]);

    const recentCompletedHands = isArchivedRoom
        ? archivedHands
        : snapshot?.recentCompletedHands.length
            ? snapshot.recentCompletedHands
            : snapshot?.lastCompletedHand
                ? [snapshot.lastCompletedHand]
                : [];
    const selectedCompletedHand = isArchivedRoom
        ? selectedArchivedHand
        : recentCompletedHands.find((hand) => hand.handId === selectedLedgerHandId) ?? recentCompletedHands[0] ?? null;
    const selectedCompletedHandRunout = selectedCompletedHand && latestCompletedHand && allInRunoutView && selectedCompletedHand.handId === latestCompletedHand.handId
        ? allInRunoutView
        : null;
    const selectedCompletedHandBoards = selectedCompletedHandRunout ? selectedCompletedHandRunout.visibleBoards : getCompletedHandBoards(selectedCompletedHand);
    const selectedCompletedHandAdditionalBoards = selectedCompletedHandBoards.slice(1);
    const selectedCompletedHandRunoutResults = getCompletedHandRunoutResults(selectedCompletedHand);
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
    const archivePreviewTotals = archivePreview?.ledger.reduce((totals, row) => ({
        buyIn: totals.buyIn + row.totalBuyIn,
        buyOut: totals.buyOut + row.buyOut,
        stack: totals.stack + row.stack,
        net: totals.net + row.netResult,
        wins: totals.wins + row.wins,
        rebuys: totals.rebuys + row.rebuys,
    }), { buyIn: 0, buyOut: 0, stack: 0, net: 0, wins: 0, rebuys: 0 }) ?? { buyIn: 0, buyOut: 0, stack: 0, net: 0, wins: 0, rebuys: 0 };
    const archiveMatchedCount = archivePreview?.ledger.filter((row) => Boolean(archiveMatchDrafts[row.sourceAccountId])).length ?? 0;

    useEffect(() => {
        if (!isPhoneViewport) {
            setIsMobileRecommendationOpen(false);
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

    function toggleQueuedHeroAction(nextQueuedAction: QueuedHeroAction) {
        setPreselectedHeroAction((current) => areQueuedHeroActionsEqual(current, nextQueuedAction) ? null : nextQueuedAction);
    }

    function handleQueuedOrImmediateCall() {
        if (!heroActionState?.allowedActions.includes("call")) {
            return;
        }

        if (heroActionState.canAct) {
            void handlePlayerAction("call");
            return;
        }

        toggleQueuedHeroAction({ type: "call", amount: heroActionState.callAmount });
    }

    function handleQueuedOrImmediateCheck() {
        if (!heroActionState) {
            return;
        }

        if (heroActionState.canAct) {
            if (!heroActionState.allowedActions.includes("check")) {
                return;
            }

            void handlePlayerAction("check");
            return;
        }

        if (!heroInHand || heroActionState.hasFolded || heroActionState.isAllIn || heroActionState.callAmount > 0) {
            return;
        }

        toggleQueuedHeroAction({ type: "check" });
    }

    function handleQueuedOrImmediateFold() {
        if (!heroActionState) {
            return;
        }

        if (heroActionState.canAct) {
            if (!heroActionState.allowedActions.includes("fold")) {
                return;
            }

            void handlePlayerAction("fold");
            return;
        }

        if (!heroInHand || heroActionState.hasFolded || heroActionState.isAllIn) {
            return;
        }

        toggleQueuedHeroAction({ type: "fold" });
    }

    function handleChatPanelActivate(event?: ReactMouseEvent<HTMLElement>) {
        const target = event?.target;

        if (target instanceof HTMLElement && target.closest("button, input, textarea, a, label")) {
            return;
        }

        setIsChatExpanded(true);

        if (canChat) {
            setIsChatComposerOpen(true);
            return;
        }

        setIsChatComposerOpen(false);
    }

    function markMobileChatSeen() {
        const latestMessage = snapshot?.chatMessages.at(-1);

        if (latestMessage) {
            setLastSeenChatMessageId(latestMessage.id);
        }

        setHasUnreadMobileChat(false);
    }

    function handleMobileChatToggle() {
        setIsChatExpanded((current) => {
            const nextOpen = !current;

            if (nextOpen) {
                markMobileChatSeen();
                if (canChat) {
                    setIsChatComposerOpen(true);
                }
            } else {
                setIsChatComposerOpen(false);
            }

            return nextOpen;
        });
    }

    function handleQueuedOrImmediateCheckOrFold() {
        if (heroActionState?.canAct) {
            const immediateAction = heroActionState ? resolveQueuedHeroAction({ type: "check_or_fold" }, heroActionState) : null;

            if (immediateAction) {
                void handlePlayerAction(immediateAction);
            }

            return;
        }

        if (!heroInHand || heroActionState?.hasFolded || heroActionState?.isAllIn) {
            return;
        }

        toggleQueuedHeroAction({ type: "check_or_fold" });
    }

    const shouldForceOpaqueActionPad = Boolean(isActionPadDragging || heroActionState?.canAct || heroCanRespondToRunItTwice);

    function renderActionPanel(variant: "inline" | "dialog") {
        const isInline = variant === "inline";
        const isIdleDimmable = isInline && dimActionPadWhenIdle && !shouldForceOpaqueActionPad;
        const hasWagerControl = Boolean(
            heroActionState
            && heroWagerInputConfig
            && (heroActionState.allowedActions.includes("bet") || heroActionState.allowedActions.includes("raise")),
        );
        const canOpenWagerControl = Boolean(heroActionState?.canAct && hasWagerControl);
        const wagerActionType = heroActionState?.allowedActions.includes("raise") ? "raise" : "bet";
        const parsedRaiseAmount = heroActionState && heroWagerInputConfig
            ? parseWholeNumberInput(raiseTarget)
            : null;
        const currentRaiseAmount = heroActionState && heroWagerInputConfig
            ? Math.max(
                heroWagerInputConfig.minInputAmount,
                Math.min(
                    heroWagerInputConfig.maxInputAmount,
                    parsedRaiseAmount ?? getDefaultWagerInputValue(heroActionState),
                ),
            )
            : null;
        const targetContribution = heroActionState && heroWagerInputConfig && currentRaiseAmount !== null
            ? getWagerTargetContribution(wagerActionType, String(currentRaiseAmount), heroActionState)
            : null;
        const minimumWagerTarget = heroActionState && heroWagerInputConfig
            ? getWagerTargetContribution(wagerActionType, String(heroWagerInputConfig.minInputAmount), heroActionState)
            : null;
        const midpointRaiseAmount = heroWagerInputConfig
            ? Math.max(
                heroWagerInputConfig.minInputAmount,
                Math.min(
                    heroWagerInputConfig.maxInputAmount,
                    Math.round((heroWagerInputConfig.minInputAmount + heroWagerInputConfig.maxInputAmount) / 2),
                ),
            )
            : null;
        const showStandaloneAllIn = Boolean(heroActionState?.canAct && heroActionState.allowedActions.includes("all_in") && !canOpenWagerControl);
        const hasQuickCallButton = Boolean(heroActionState?.allowedActions.includes("call"));
        const hasQuickBetButton = Boolean(!hasQuickCallButton && heroActionState?.allowedActions.includes("bet") && minimumWagerTarget !== null);
        const canQueueCheck = Boolean(heroActionState && !heroActionState.canAct && heroActionState.callAmount === 0 && !heroActionState.hasFolded && !heroActionState.isAllIn);
        const queuedCheckOrFold = preselectedHeroAction?.type === "check_or_fold";
        const queuedCall = Boolean(
            preselectedHeroAction?.type === "call"
            && heroActionState?.allowedActions.includes("call")
            && preselectedHeroAction.amount === heroActionState.callAmount,
        );
        const queuedCheck = preselectedHeroAction?.type === "check";
        const queuedFold = preselectedHeroAction?.type === "fold";
        const canQueueFold = Boolean(heroActionState && !heroActionState.canAct && heroInHand && !heroActionState.hasFolded && !heroActionState.isAllIn);

        const setClampedRaiseAmount = (nextValue: number) => {
            if (!heroActionState || !heroWagerInputConfig) {
                return;
            }

            const clampedValue = Math.max(
                heroWagerInputConfig.minInputAmount,
                Math.min(heroWagerInputConfig.maxInputAmount, Math.round(nextValue)),
            );

            setRaiseTarget(String(clampedValue));
        };

        return (
            <section
                ref={isInline ? actionPadRef : undefined}
                className={[
                    "table-action-panel",
                    isInline ? "table-action-panel--inline" : "table-action-panel--dialog",
                    isIdleDimmable ? "table-action-panel--idle-dimmable" : "table-action-panel--force-opaque",
                    isInline && isActionPadDragging ? "table-action-panel--dragging" : "",
                ].filter(Boolean).join(" ")}
                style={isInline ? { transform: `translate(${actionPadOffset.x}px, ${actionPadOffset.y}px)` } : undefined}
            >
                <div className={["game-decisions-ctn", shouldForceOpaqueActionPad ? "" : "low"].filter(Boolean).join(" ")}>
                    {heroCanRespondToRunItTwice ? (
                        <>
                            <div className="table-action-panel__status-copy">
                                <strong>Run it twice?</strong>
                                <span>Everyone in the showdown has to agree.</span>
                            </div>

                            <div className="action-buttons">
                                <button className="table-action-panel__button button-1 action-button green highlighted" type="button" onClick={() => void handleRunItTwiceDecision(true)} disabled={isMutating}>
                                    Yes
                                </button>
                                <button className="table-action-panel__button button-1 action-button red highlighted" type="button" onClick={() => void handleRunItTwiceDecision(false)} disabled={isMutating}>
                                    No
                                </button>
                            </div>
                        </>
                    ) : heroActionState?.canAct ? (
                        canOpenWagerControl && actionPanelScreen === "betControl" && heroWagerInputConfig && currentRaiseAmount !== null && targetContribution !== null ? (
                            <form
                                className="raise-controller-form"
                                noValidate
                                onSubmit={(event) => {
                                    event.preventDefault();
                                    void handlePlayerAction(wagerActionType);
                                }}
                            >
                                <div className="raise-bet-value">
                                    <p className="label">{wagerActionType === "raise" ? "Raise by" : "Your bet"}</p>
                                    <div className="value-input-ctn">
                                        <strong className="value">{formatNumber(currentRaiseAmount)}</strong>
                                        <span className="table-action-panel__raise-target-copy">
                                            {wagerActionType === "raise" ? `To ${formatNumber(targetContribution)}` : `${formatNumber(targetContribution)} total`}
                                        </span>
                                    </div>
                                    <input
                                        className="control-input value-input"
                                        type="number"
                                        min={heroWagerInputConfig.minInputAmount}
                                        max={heroWagerInputConfig.maxInputAmount}
                                        step={1}
                                        value={raiseTarget}
                                        onChange={(event) => setRaiseTarget(event.target.value)}
                                        disabled={isMutating}
                                    />
                                </div>

                                <div className="raise-controller">
                                    <div className="default-bet-buttons">
                                        <button className="table-action-panel__preset-button" type="button" onClick={() => setClampedRaiseAmount(heroWagerInputConfig.minInputAmount)} disabled={isMutating}>
                                            Min
                                        </button>
                                        {midpointRaiseAmount !== null ? (
                                            <button className="table-action-panel__preset-button" type="button" onClick={() => setClampedRaiseAmount(midpointRaiseAmount)} disabled={isMutating}>
                                                Mid
                                            </button>
                                        ) : null}
                                        <button className="table-action-panel__preset-button" type="button" onClick={() => setClampedRaiseAmount(heroWagerInputConfig.maxInputAmount)} disabled={isMutating}>
                                            Max
                                        </button>
                                    </div>

                                    <div className="slider" aria-hidden="true" />

                                    <div className="table-action-panel__slider-controls">
                                        <button className="control-button decrease" type="button" onClick={() => setClampedRaiseAmount(currentRaiseAmount - 1)} disabled={isMutating || currentRaiseAmount <= heroWagerInputConfig.minInputAmount}>
                                            -
                                        </button>
                                        <input
                                            className="slider-control"
                                            type="range"
                                            min={heroWagerInputConfig.minInputAmount}
                                            max={heroWagerInputConfig.maxInputAmount}
                                            step={1}
                                            value={currentRaiseAmount}
                                            onChange={(event) => setRaiseTarget(event.target.value)}
                                            disabled={isMutating}
                                        />
                                        <button className="control-button increase" type="button" onClick={() => setClampedRaiseAmount(currentRaiseAmount + 1)} disabled={isMutating || currentRaiseAmount >= heroWagerInputConfig.maxInputAmount}>
                                            +
                                        </button>
                                    </div>
                                </div>

                                <div className="action-buttons">
                                    <input
                                        type="submit"
                                        className={[
                                            "table-action-panel__button",
                                            "button-1",
                                            "action-button",
                                            "green",
                                            "highlighted",
                                            "bet",
                                            !isPhoneViewport ? "with-tip" : "",
                                        ].filter(Boolean).join(" ")}
                                        data-hotkey={!isPhoneViewport ? "enter" : undefined}
                                        value={wagerActionType === "raise" ? "Raise" : "Bet"}
                                        disabled={isMutating}
                                    />
                                    <button
                                        className={[
                                            "table-action-panel__button",
                                            "button-1",
                                            "action-button",
                                            "gray",
                                            "highlighted",
                                            !isPhoneViewport ? "with-tip" : "",
                                            "back",
                                        ].filter(Boolean).join(" ")}
                                        data-hotkey={!isPhoneViewport ? "esc" : undefined}
                                        type="button"
                                        onClick={() => setActionPanelScreen("buttons")}
                                        disabled={isMutating}
                                    >
                                        Back
                                    </button>
                                </div>
                            </form>
                        ) : (
                            <div className="action-buttons">
                                {hasQuickCallButton ? (
                                    <button
                                        className={[
                                            "table-action-panel__button",
                                            "button-1",
                                            "action-button",
                                            "call",
                                            "green",
                                            !isPhoneViewport ? "with-tip" : "",
                                        ].filter(Boolean).join(" ")}
                                        data-hotkey={!isPhoneViewport ? "c" : undefined}
                                        type="button"
                                        onClick={handleQueuedOrImmediateCall}
                                        disabled={isMutating}
                                    >
                                        Call {formatNumber(heroActionState.callAmount)}
                                    </button>
                                ) : null}

                                {hasQuickBetButton ? (
                                    <button
                                        className={[
                                            "table-action-panel__button",
                                            "button-1",
                                            "action-button",
                                            "bet",
                                            "green",
                                            !isPhoneViewport ? "with-tip" : "",
                                        ].filter(Boolean).join(" ")}
                                        data-hotkey={!isPhoneViewport ? "b" : undefined}
                                        type="button"
                                        onClick={() => void handlePlayerAction("bet")}
                                        disabled={isMutating}
                                    >
                                        Bet {formatNumber(minimumWagerTarget ?? 0)}
                                    </button>
                                ) : null}

                                {hasWagerControl ? (
                                    <button
                                        className={[
                                            "table-action-panel__button",
                                            "button-1",
                                            "action-button",
                                            "raise",
                                            "green",
                                            !isPhoneViewport ? "with-tip" : "",
                                        ].filter(Boolean).join(" ")}
                                        data-hotkey={!isPhoneViewport ? "r" : undefined}
                                        type="button"
                                        onClick={() => setActionPanelScreen("betControl")}
                                        disabled={isMutating || !heroActionState.canAct}
                                    >
                                        Raise
                                    </button>
                                ) : null}

                                {heroActionState.allowedActions.includes("check") ? (
                                    <button
                                        className={[
                                            "table-action-panel__button",
                                            "button-1",
                                            "action-button",
                                            "check",
                                            "green",
                                            !isPhoneViewport ? "with-tip" : "",
                                        ].filter(Boolean).join(" ")}
                                        data-hotkey={!isPhoneViewport ? "k" : undefined}
                                        type="button"
                                        onClick={handleQueuedOrImmediateCheck}
                                        disabled={isMutating}
                                    >
                                        Check
                                    </button>
                                ) : null}

                                {showStandaloneAllIn ? (
                                    <button
                                        className="table-action-panel__button button-1 action-button raise green"
                                        type="button"
                                        onClick={() => void handlePlayerAction("all_in")}
                                        disabled={isMutating}
                                    >
                                        All-in {formatNumber(heroPlayer?.stack ?? 0)}
                                    </button>
                                ) : null}

                                {heroActionState.allowedActions.includes("fold") ? (
                                    <button
                                        className={[
                                            "table-action-panel__button",
                                            "button-1",
                                            "action-button",
                                            "fold",
                                            "red",
                                            !isPhoneViewport ? "with-tip" : "",
                                        ].filter(Boolean).join(" ")}
                                        data-hotkey={!isPhoneViewport ? "f" : undefined}
                                        type="button"
                                        onClick={handleQueuedOrImmediateFold}
                                        disabled={isMutating}
                                    >
                                        Fold
                                    </button>
                                ) : null}
                            </div>
                        )
                    ) : (
                        <div className="table-action-panel__idle-stack">
                            {runItTwicePrompt ? (
                                <div className="table-action-panel__status-copy table-action-panel__status-copy--waiting">
                                    <strong>Run it twice vote</strong>
                                    <span>{describeRunItTwiceVoteState(runItTwicePrompt, heroPlayer)}</span>
                                </div>
                            ) : null}

                            {!runItTwicePrompt && heroInHand && !heroActionState?.hasFolded && !heroActionState?.isAllIn ? (
                                <>
                                    <div className="table-action-panel__queue-row">
                                        <button
                                            className={[
                                                "table-action-panel__button",
                                                "button-1",
                                                "action-button",
                                                "gray",
                                                !isPhoneViewport ? "with-tip" : "",
                                                "check-fold",
                                                queuedCheckOrFold ? "highlighted" : "",
                                                queuedCheckOrFold ? "table-action-panel__button--queued" : "",
                                            ].filter(Boolean).join(" ")}
                                            data-hotkey={!isPhoneViewport ? "i" : undefined}
                                            type="button"
                                            onClick={handleQueuedOrImmediateCheckOrFold}
                                            disabled={isMutating}
                                            aria-pressed={queuedCheckOrFold}
                                        >
                                            Check or Fold
                                        </button>
                                    </div>

                                    <div className="action-buttons">
                                        {hasQuickCallButton ? (
                                            <button
                                                className={[
                                                    "table-action-panel__button",
                                                    "button-1",
                                                    "action-button",
                                                    "call",
                                                    "green",
                                                    !isPhoneViewport ? "with-tip" : "",
                                                    queuedCall ? "highlighted" : "",
                                                    queuedCall ? "table-action-panel__button--queued" : "",
                                                ].filter(Boolean).join(" ")}
                                                data-hotkey={!isPhoneViewport ? "c" : undefined}
                                                type="button"
                                                onClick={handleQueuedOrImmediateCall}
                                                disabled={isMutating}
                                                aria-pressed={queuedCall}
                                            >
                                                Call {formatNumber(heroActionState?.callAmount ?? 0)}
                                            </button>
                                        ) : null}

                                        {hasQuickBetButton ? (
                                            <button
                                                className={[
                                                    "table-action-panel__button",
                                                    "button-1",
                                                    "action-button",
                                                    "bet",
                                                    "green",
                                                    !isPhoneViewport ? "with-tip" : "",
                                                ].filter(Boolean).join(" ")}
                                                data-hotkey={!isPhoneViewport ? "b" : undefined}
                                                type="button"
                                                disabled
                                            >
                                                Bet {formatNumber(minimumWagerTarget ?? 0)}
                                            </button>
                                        ) : null}

                                        {hasWagerControl ? (
                                            <button
                                                className={[
                                                    "table-action-panel__button",
                                                    "button-1",
                                                    "action-button",
                                                    "raise",
                                                    "green",
                                                    !isPhoneViewport ? "with-tip" : "",
                                                ].filter(Boolean).join(" ")}
                                                data-hotkey={!isPhoneViewport ? "r" : undefined}
                                                type="button"
                                                disabled
                                            >
                                                Raise
                                            </button>
                                        ) : null}

                                        <button
                                            className={[
                                                "table-action-panel__button",
                                                "button-1",
                                                "action-button",
                                                canQueueCheck ? "green" : "gray",
                                                "check",
                                                !isPhoneViewport ? "with-tip" : "",
                                                queuedCheck ? "highlighted" : "",
                                                queuedCheck ? "table-action-panel__button--queued" : "",
                                            ].filter(Boolean).join(" ")}
                                            data-hotkey={!isPhoneViewport ? "k" : undefined}
                                            type="button"
                                            onClick={handleQueuedOrImmediateCheck}
                                            disabled={isMutating || !canQueueCheck}
                                            aria-pressed={queuedCheck}
                                        >
                                            Check
                                        </button>

                                        <button
                                            className={[
                                                "table-action-panel__button",
                                                "button-1",
                                                "action-button",
                                                canQueueFold ? "red" : "gray",
                                                "fold",
                                                !isPhoneViewport ? "with-tip" : "",
                                                queuedFold ? "highlighted" : "",
                                                queuedFold ? "table-action-panel__button--queued" : "",
                                            ].filter(Boolean).join(" ")}
                                            data-hotkey={!isPhoneViewport ? "f" : undefined}
                                            type="button"
                                            onClick={handleQueuedOrImmediateFold}
                                            disabled={isMutating || !canQueueFold}
                                            aria-pressed={queuedFold}
                                        >
                                            Fold
                                        </button>
                                    </div>
                                </>
                            ) : null}

                            {!runItTwicePrompt && activeLastCompletedHandRevealState && !activeLastCompletedHandRevealState.forced ? (
                                <div className="table-action-panel__reveal-block">
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
                                                "table-action-panel__button",
                                                "button-1",
                                                "action-button",
                                                activeLastCompletedHandRevealState.currentMode === "both" ? "green highlighted" : "gray",
                                                "table-action-panel__reveal-button",
                                            ].join(" ")}
                                            type="button"
                                            onClick={() => void handleRevealCards("both")}
                                            disabled={isMutating}
                                        >
                                            Show all
                                        </button>
                                        <button
                                            className={[
                                                "table-action-panel__button",
                                                "button-1",
                                                "action-button",
                                                activeLastCompletedHandRevealState.currentMode === "none" ? "green highlighted" : "gray",
                                                "table-action-panel__reveal-button",
                                            ].join(" ")}
                                            type="button"
                                            onClick={() => void handleRevealCards("none")}
                                            disabled={isMutating}
                                        >
                                            Hide all
                                        </button>
                                    </div>
                                </div>
                            ) : null}
                        </div>
                    )}
                </div>
            </section>
        );
    }

    async function handleChatMediaToggle(kind: "microphone" | "camera") {
        if (demoMode) {
            return;
        }

        if (!canConnectMedia) {
            setActionError("Sign in to connect voice and video for this table.");
            return;
        }

        if (!media.isConnected) {
            setChatMediaActionState("connecting");

            try {
                await media.handleConnectMedia(kind);
            } finally {
                setChatMediaActionState("idle");
            }

            return;
        }

        if (kind === "microphone") {
            setChatMediaActionState("microphone");

            try {
                await media.handleToggleMicrophone();
            } finally {
                setChatMediaActionState("idle");
            }

            return;
        }

        setChatMediaActionState("camera");

        try {
            await media.handleToggleCamera();
        } finally {
            setChatMediaActionState("idle");
        }
    }

    function renderTableChatPanel(variant: "overlay" | "surface") {
        const isOverlay = variant === "overlay";
        const showComposer = !isOverlay || isChatComposerOpen;
        const canControlMediaFromChat = demoMode || canConnectMedia;
        const isMicActionPending = chatMediaActionState === "connecting" || chatMediaActionState === "microphone";
        const isCamActionPending = chatMediaActionState === "connecting" || chatMediaActionState === "camera";

        return (
            <section className={[
                "table-chat-panel",
                variant === "overlay" ? "table-chat-panel--overlay" : "table-chat-panel--surface",
                isOverlay && isChatExpanded ? "table-chat-panel--expanded" : "",
                showComposer ? "table-chat-panel--composer-open" : "",
            ].join(" ")}
                ref={isOverlay ? tableChatOverlayRef : undefined}
                onClick={isOverlay ? handleChatPanelActivate : undefined}
            >
                <div className="table-chat-panel__toolbar">
                    <div className="table-chat-panel__title-block">
                        <span className="table-log-panel__eyebrow">Chat</span>
                        <strong>{snapshot?.name ?? slug}</strong>
                    </div>

                    <div className="table-chat-panel__action-buttons" aria-label="Chat and media controls">
                        <button
                            className={[
                                "table-chat-panel__action-button",
                                isChatComposerOpen ? "table-chat-panel__action-button--active" : "",
                            ].filter(Boolean).join(" ")}
                            type="button"
                            onClick={() => {
                                if (!canChat) {
                                    setActionError("Join the room and sign in before chatting.");
                                    return;
                                }

                                if (isOverlay) {
                                    setIsChatComposerOpen((current) => !current);
                                    setIsChatExpanded(true);
                                    return;
                                }

                                chatInputRef.current?.focus();
                            }}
                            title={canChat ? "Open the message composer" : "Join the room to chat"}
                        >
                            Chat
                        </button>
                        <button
                            className={[
                                "table-chat-panel__action-button",
                                isMicActionPending ? "table-chat-panel__action-button--loading" : "",
                                media.isConnected && media.microphoneEnabled ? "table-chat-panel__action-button--active" : "",
                            ].filter(Boolean).join(" ")}
                            type="button"
                            onClick={() => void handleChatMediaToggle("microphone")}
                            disabled={!canControlMediaFromChat || chatMediaActionState !== "idle"}
                            title={media.isConnected
                                ? media.microphoneEnabled
                                    ? "Mute microphone"
                                    : "Unmute microphone"
                                : "Connect table audio"}
                            aria-busy={isMicActionPending}
                        >
                            Mic
                        </button>
                        <button
                            className={[
                                "table-chat-panel__action-button",
                                isCamActionPending ? "table-chat-panel__action-button--loading" : "",
                                media.isConnected && media.cameraEnabled ? "table-chat-panel__action-button--active" : "",
                            ].filter(Boolean).join(" ")}
                            type="button"
                            onClick={() => void handleChatMediaToggle("camera")}
                            disabled={!canControlMediaFromChat || chatMediaActionState !== "idle"}
                            title={media.isConnected
                                ? media.cameraEnabled
                                    ? "Stop camera"
                                    : "Start camera"
                                : "Connect table video"}
                            aria-busy={isCamActionPending}
                        >
                            Cam
                        </button>
                        {isOverlay ? (
                            <button
                                className={[
                                    "table-chat-panel__action-button",
                                    isChatExpanded ? "table-chat-panel__action-button--active" : "",
                                ].filter(Boolean).join(" ")}
                                type="button"
                                onClick={() => {
                                    setIsChatExpanded((current) => {
                                        if (current) {
                                            setIsChatComposerOpen(false);
                                        }

                                        return !current;
                                    });
                                }}
                                title={isChatExpanded ? "Collapse chat" : "Expand chat"}
                            >
                                {isChatExpanded ? "Less" : "More"}
                            </button>
                        ) : null}
                    </div>
                </div>

                <div className="table-chat-panel__messages">
                    {snapshot?.chatMessages.length ? snapshot.chatMessages.slice(-20).reverse().map((message) => (
                        <article key={message.id} className="table-chat-panel__message">
                            <strong className="table-chat-panel__author">{message.displayName}</strong>
                            <p className="table-chat-panel__message-copy">{message.content}</p>
                            <span className="table-chat-panel__timestamp">{formatChatTimestamp(message.createdAt)}</span>
                        </article>
                    )) : <p className="muted-copy">Chat is quiet.</p>}
                </div>

                {showComposer ? (
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
                ) : null}
            </section>
        );
    }

    function renderTableLogContent() {
        return (
            <section className="table-ledger-panel table-ledger-panel--modal">
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
                                    <strong>{resolveRoomDisplayName(snapshot, action.actorAccountId)}</strong>
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
                                onClick={() => handleSelectHistoryHand(hand.handId)}
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
                            <span>{selectedCompletedHandRunout?.isActive ? selectedCompletedHandAdditionalBoards.length > 0 ? "Running it twice" : "Running board" : selectedCompletedHand.winningReason === "showdown" ? "Showdown" : "Won before showdown"}</span>
                        </div>

                        {selectedCompletedHandBoards.map((board, boardIndex) => (
                            <div key={`history-hand-${selectedCompletedHand.handId}-board-${boardIndex}`} className="table-ledger-panel__runout-block">
                                {selectedCompletedHandBoards.length > 1 ? <span className="table-ledger-panel__section-label">Run {boardIndex + 1}</span> : null}
                                <div className="table-board table-board--compact table-ledger-panel__board">
                                    {buildBoardSlots(board).map((slot, index) => (
                                        <PokerCard key={`history-hand-${selectedCompletedHand.handId}-${boardIndex}-${index}`} card={slot.card} isFaceUp={slot.isFaceUp} size="compact" backLabel={slot.backLabel} />
                                    ))}
                                </div>

                                {!selectedCompletedHandRunout?.isActive && selectedCompletedHandRunoutResults.length > 1 && selectedCompletedHandRunoutResults[boardIndex]?.winners.length ? (
                                    <ul className="winner-list table-ledger-panel__runout-winners">
                                        {selectedCompletedHandRunoutResults[boardIndex]!.winners.map((winner) => (
                                            <li key={`${selectedCompletedHand.handId}-${boardIndex}-${winner.accountId}`}>
                                                🏆 {resolveRoomDisplayName(snapshot, winner.accountId)} won {formatNumber(winner.amountWon)}
                                                {winner.handLabel ? ` with ${winner.handLabel}` : ""}
                                            </li>
                                        ))}
                                    </ul>
                                ) : null}
                            </div>
                        ))}

                        {selectedCompletedHand.actions.length ? (
                            <ul className="action-log table-ledger-panel__action-log">
                                {selectedCompletedHand.actions.map((action) => (
                                    <li key={`${selectedCompletedHand.handId}-${action.orderIndex}`} className="action-log__item">
                                        <strong>{resolveRoomDisplayName(snapshot, action.actorAccountId)}</strong>
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
                                        <strong>{resolveRoomDisplayName(snapshot, accountId)}</strong>
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
                            <>
                                {selectedCompletedHandRunoutResults.length > 1 ? <span className="table-ledger-panel__section-label">Overall payout</span> : null}
                                <ul className="winner-list">
                                    {selectedCompletedHandWinners.map((winner) => (
                                        <li key={`${selectedCompletedHand.handId}-${winner.accountId}`}>
                                            🏆 {resolveRoomDisplayName(snapshot, winner.accountId)} won {formatNumber(winner.amountWon)}
                                            {winner.handLabel ? ` with ${winner.handLabel}` : ""}
                                        </li>
                                    ))}
                                </ul>
                            </>
                        )}
                    </div>
                ) : currentHand?.actions.length ? null : (
                    <p className="muted-copy">Start a hand to populate the action log and hand recap history.</p>
                )}
            </section>
        );
    }

    async function submitJson<T>(
        path: string,
        body: Record<string, unknown>,
        options: {
            applySnapshot?: boolean;
            fallbackError: string;
        },
    ): Promise<T> {
        if (demoMode) {
            const error = new Error("Sample table is read-only.");
            setActionError(error.message);
            throw error;
        }

        if (isArchivedRoom && !path.endsWith("/join")) {
            const error = new Error("Archived rooms are read-only.");
            setActionError(error.message);
            throw error;
        }

        setIsMutating(true);
        setActionError(null);

        try {
            const gameBaseUrl = getBrowserGameHttpBaseUrl();
            const sessionToken = sessionTokenRef.current;
            const response = await fetch(buildBrowserHttpUrl(gameBaseUrl, path), {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
                },
                body: JSON.stringify(body),
            });

            const payload = (await response.json()) as T & { error?: string };

            if (!response.ok) {
                throw new Error(payload.error ?? options.fallbackError);
            }

            if (options.applySnapshot) {
                setSnapshot(payload as unknown as RoomSnapshot);
            }

            return payload;
        } catch (error) {
            const message = error instanceof Error ? error.message : options.fallbackError;
            setActionError(message);
            throw error;
        } finally {
            setIsMutating(false);
        }
    }

    async function submitRoomMutation(path: string, body: Record<string, unknown>) {
        return submitJson<RoomSnapshot>(path, body, {
            applySnapshot: true,
            fallbackError: "Unable to update the room.",
        });
    }

    function openAuthDialog(nextAction: PendingAuthAction) {
        setPendingAuthAction(nextAction);
        setAuthRegisterError(null);
        setAuthLoginError(null);
        setActionError(null);
    }

    function closeAuthDialog() {
        if (isRegisteringInRoom || isLoggingInRoom || isCompletingAuthAction) {
            return;
        }

        setPendingAuthAction(null);
        setAuthRegisterError(null);
        setAuthLoginError(null);
    }

    function persistSession(nextSession: SessionState) {
        sessionTokenRef.current = nextSession.token;
        setSession(nextSession);
        setAccountId(nextSession.account.id);
        setDisplayName((current) => current || getSessionDisplayName(nextSession));
        writeStoredBrowserSession(nextSession);
    }

    function openSeatRequestDialog(seatIndex: number) {
        if (!snapshot) {
            return;
        }

        setActionError(null);
        setDisplayName((current) => current || getSessionDisplayName(session));
        setSeatRequestPrompt({
            seatIndex,
            requestedStack: heroPendingSeatRequest
                ? String(heroPendingSeatRequest.requestedStack)
                : seatRequestStack || String(defaultBuyInAmount(snapshot)),
        });
    }

    async function continuePendingAuthAction(nextSession: SessionState, nextAction: PendingAuthAction | null) {
        if (!nextAction) {
            return;
        }

        setIsCompletingAuthAction(true);

        try {
            if (nextAction.kind === "join-room") {
                await submitRoomMutation(`/v1/rooms/${slug}/join`, {
                    accountId: nextSession.account.id,
                    password: nextAction.password || undefined,
                });
            }

            if (nextAction.kind === "take-seat") {
                openSeatRequestDialog(nextAction.seatIndex);
            }

            setPendingAuthAction(null);
        } finally {
            setIsCompletingAuthAction(false);
        }
    }

    async function handleRegisterInRoom(formData: FormData) {
        setIsRegisteringInRoom(true);
        setAuthRegisterError(null);

        try {
            const apiBaseUrl = getBrowserApiBaseUrl();
            const response = await fetch(buildBrowserHttpUrl(apiBaseUrl, "/v1/auth/register"), {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    email: formData.get("email"),
                    username: formData.get("username"),
                    password: formData.get("password"),
                }),
            });

            const payload = (await response.json()) as Partial<SessionState> & { error?: string };

            if (!response.ok || !payload.account || !payload.token) {
                throw new Error(payload.error ?? "Unable to register account.");
            }

            const nextSession = {
                account: payload.account,
                token: payload.token,
            } satisfies SessionState;

            persistSession(nextSession);
            await continuePendingAuthAction(nextSession, pendingAuthAction);
        } catch (error) {
            setAuthRegisterError(error instanceof Error ? error.message : "Unable to register account.");
        } finally {
            setIsRegisteringInRoom(false);
        }
    }

    async function handleGuestInRoom(formData: FormData) {
        setIsCreatingGuestInRoom(true);
        setAuthGuestError(null);

        try {
            const result = await createGuestSession(String(formData.get("displayName") ?? ""), slug);
            const nextSession = result.session as SessionState;

            persistSession(nextSession);
            setGuestRecoveryCode(result.recoveryCode);
            await continuePendingAuthAction(nextSession, pendingAuthAction);
        } catch (error) {
            setAuthGuestError(error instanceof Error ? error.message : "Unable to continue as a guest.");
        } finally {
            setIsCreatingGuestInRoom(false);
        }
    }

    async function handleLoginInRoom(formData: FormData) {
        setIsLoggingInRoom(true);
        setAuthLoginError(null);

        try {
            const apiBaseUrl = getBrowserApiBaseUrl();
            const response = await fetch(buildBrowserHttpUrl(apiBaseUrl, "/v1/auth/login"), {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    identifier: formData.get("identifier"),
                    password: formData.get("password"),
                }),
            });

            const payload = (await response.json()) as Partial<SessionState> & { error?: string };

            if (!response.ok || !payload.account || !payload.token) {
                throw new Error(payload.error ?? "Unable to sign in.");
            }

            const nextSession = {
                account: payload.account,
                token: payload.token,
            } satisfies SessionState;

            persistSession(nextSession);
            await continuePendingAuthAction(nextSession, pendingAuthAction);
        } catch (error) {
            setAuthLoginError(error instanceof Error ? error.message : "Unable to sign in.");
        } finally {
            setIsLoggingInRoom(false);
        }
    }

    async function handleJoinRoom() {
        try {
            await submitRoomMutation(`/v1/rooms/${slug}/join`, {
                accountId,
                password: roomPassword || undefined,
            });

            if (!accountId) {
                openAuthDialog({
                    kind: "join-room",
                    password: roomPassword,
                });
            }
        } catch {
            return;
        }
    }

    function handleSeatClick(seatIndex: number) {
        if (!accountId) {
            openAuthDialog({
                kind: "take-seat",
                seatIndex,
            });
            return;
        }

        if (snapshot?.passwordProtected && !viewerHasRoomAccess) {
            setActionError("Join the room first so the password can be validated.");
            return;
        }

        if (!snapshot) {
            return;
        }

        openSeatRequestDialog(seatIndex);
    }

    async function handleSeat(seatIndex: number, requestedStackInput = seatRequestStack, showConfirmation = false) {
        if (!accountId) {
            setSeatRequestPrompt(null);
            openAuthDialog({
                kind: "take-seat",
                seatIndex,
            });
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
                displayName: displayName.trim() || getSessionDisplayName(session) || "Player",
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

        await handleSeat(seatRequestPrompt.seatIndex, seatRequestPrompt.requestedStack, !isAdmin);
    }

    async function handleSeatBot(seatIndex: number) {
        if (!accountId || !snapshot || !isAdmin) {
            setActionError("Only the room admin can seat bots.");
            return;
        }

        let requestedStack = 0;

        try {
            requestedStack = parseRequiredWholeNumber(seatRequestStack || String(snapshot.startingStack), "Bot stack");
        } catch (error) {
            setActionError(error instanceof Error ? error.message : "Enter a valid bot stack before seating a bot.");
            return;
        }

        try {
            await submitRoomMutation(`/v1/rooms/${slug}/admin/seat-bot`, {
                accountId,
                displayName: botDisplayName.trim() || getNextBotDisplayName(snapshot),
                seatIndex,
                requestedStack,
            });
            setSeatRequestStack(String(requestedStack));
            setBotDisplayName("");
        } catch {
            return;
        }
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
        setActionPanelScreen("buttons");
    }

    async function handleRunItTwiceDecision(willing: boolean) {
        if (!accountId) {
            return;
        }

        await submitRoomMutation(`/v1/rooms/${slug}/run-it-twice`, {
            accountId,
            willing,
        });
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
            displayName: displayName.trim() || heroPlayer?.displayName || getSessionDisplayName(session) || undefined,
            content,
        });
        setHeroChatToast({
            id: `${accountId}:${Date.now()}`,
            content,
        });
        setChatDraft("");
        setIsChatComposerOpen(false);
    }

    function handleDownloadSessionLedgerCsv() {
        if (typeof window === "undefined" || sessionLedgerRows.length === 0) {
            return;
        }

        const fileSlug = slug.replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "") || "table";
        const csvRows = [
            ["Player", "Handle", "Buy-in", "Buy-out", "Stack", "Wins", "Rebuys", "Net"],
            ...sessionLedgerRows.map((row) => [
                row.displayName,
                formatSessionLedgerHandle(row.accountId),
                String(row.buyIn),
                String(row.buyOut),
                String(row.stack),
                String(row.wins),
                String(row.rebuys),
                String(row.net),
            ]),
        ];
        const csvContent = csvRows.map((row) => row.map(escapeCsvValue).join(",")).join("\n");
        const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
        const objectUrl = window.URL.createObjectURL(blob);
        const downloadLink = document.createElement("a");

        downloadLink.href = objectUrl;
        downloadLink.download = `${fileSlug}-ledger.csv`;
        document.body.append(downloadLink);
        downloadLink.click();
        downloadLink.remove();
        window.setTimeout(() => {
            window.URL.revokeObjectURL(objectUrl);
        }, 0);
    }

    async function handleSendReaction(emoji: string, targetAccountId?: string) {
        if (!accountId || !heroPlayer) {
            setActionError("Take a seat before sending table reactions.");
            return;
        }

        await submitRoomMutation(`/v1/rooms/${slug}/react`, {
            accountId,
            emoji,
            targetAccountId,
        });
        setIsReactionMenuOpen(false);
    }

    async function handleSendSuggestedReaction(emoji: string, targetAccountId: string, eventKey: string) {
        resolveSuggestedGesturePrompt(eventKey);
        await handleSendReaction(emoji, targetAccountId);
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

    const reactionPopover = (
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
                        dynamicWidth={isPhoneViewport}
                        emojiButtonSize={isPhoneViewport ? 24 : 34}
                        emojiSize={isPhoneViewport ? 14 : 20}
                        maxFrequentRows={1}
                        navPosition="bottom"
                        onEmojiSelect={(selection: EmojiPickerSelection) => {
                            const nextEmoji = getNativeEmoji(selection);

                            if (nextEmoji) {
                                setGestureInput(nextEmoji);
                            }
                        }}
                        perLine={isPhoneViewport ? undefined : 8}
                        previewPosition="none"
                        searchPosition="sticky"
                        set="native"
                        style={isPhoneViewport ? { width: "100%", minWidth: "100%" } : undefined}
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
    );

    const suggestedGesturePopover = suggestedGesturePrompt ? (
        <div className="table-seat__suggested-gesture-popover">
            <div className="table-seat__suggested-gesture-header">
                <span className="table-seat__reaction-heading">Suggested</span>
                <button
                    className="table-seat__suggested-gesture-dismiss"
                    type="button"
                    onClick={() => resolveSuggestedGesturePrompt(suggestedGesturePrompt.eventKey)}
                    aria-label="Dismiss suggested gesture"
                >
                    ×
                </button>
            </div>

            <div className="table-seat__suggested-gesture-copy">
                <strong>{suggestedGesturePrompt.headline}</strong>
                <span>{suggestedGesturePrompt.bodyCopy}</span>
            </div>

            <div className="table-seat__suggested-gesture-actions">
                {suggestedGesturePrompt.emojis.map((emoji) => (
                    <button
                        key={`${suggestedGesturePrompt.eventKey}-${emoji}`}
                        className="table-seat__suggested-gesture-chip"
                        type="button"
                        onClick={() => void handleSendSuggestedReaction(emoji, suggestedGesturePrompt.targetAccountId, suggestedGesturePrompt.eventKey)}
                        disabled={isMutating || !heroPlayer}
                    >
                        {emoji}
                    </button>
                ))}
            </div>
        </div>
    ) : null;

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
                autoStartDelaySeconds: parseOptionalWholeNumber(adminOptionsDraft.autoStartDelaySeconds, "Time before next hand") ?? 0,
                turnSeconds: parseOptionalWholeNumber(adminOptionsDraft.decisionTimeSeconds, "Decision time limit"),
                timeBankSeconds: parseOptionalWholeNumber(adminOptionsDraft.timeBankSeconds, "Time bank length"),
                timeBankRefillHands: parseOptionalWholeNumber(adminOptionsDraft.timeBankRefillHands, "Time bank refill hands"),
                isPubliclyListed: adminOptionsDraft.isPubliclyListed,
                allowGuests: adminOptionsDraft.allowGuests,
                minBuyInAmount: parseRequiredWholeNumber(adminOptionsDraft.minBuyInAmount, "Minimum buy-in"),
                maxBuyInRule: {
                    kind: adminOptionsDraft.maxBuyInRuleKind,
                    value: parseRequiredWholeNumber(
                        adminOptionsDraft.maxBuyInRuleValue,
                        adminOptionsDraft.maxBuyInRuleKind === "fixed_amount" ? "Maximum buy-in" : "Chip leader percentage",
                    ),
                },
                revealAllShowdownHands: adminOptionsDraft.revealAllShowdownHands,
                runItTwiceEnabled: adminOptionsDraft.runItTwiceEnabled,
                suggestedGesturesEnabled: adminOptionsDraft.suggestedGesturesEnabled,
                suggestedGesturePromptProbability: parseProbabilityInput(adminOptionsDraft.suggestedGesturePromptProbability, "Suggestion prompt probability"),
                botSuggestedGestureReactionProbability: parseProbabilityInput(adminOptionsDraft.botSuggestedGestureReactionProbability, "Bot flyover reaction probability"),
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

        setIsStopTableConfirmOpen(true);
    }

    async function handleConfirmStopTable() {
        if (!accountId) {
            return;
        }

        await submitRoomMutation(`/v1/rooms/${slug}/admin/stop`, {
            accountId,
        });

        setIsStopTableConfirmOpen(false);
    }

    function closeArchivePreview() {
        setArchivePreview(null);
        setArchiveMatchDrafts({});
    }

    async function handleArchiveTable() {
        if (!accountId) {
            return;
        }

        if (snapshot?.visibility === "club" && snapshot.clubId) {
            try {
                const preview = await submitJson<RoomArchivePreview>(`/v1/rooms/${slug}/admin/archive-preview`, {
                    accountId,
                }, {
                    fallbackError: "Unable to prepare the archive preview.",
                });

                setArchivePreview(preview);
                setArchiveMatchDrafts(Object.fromEntries(preview.ledger.map((row) => [row.sourceAccountId, ""])));
                setOpenMenuPanel(null);
            } catch {
                return;
            }

            return;
        }

        await submitRoomMutation(`/v1/rooms/${slug}/admin/archive`, {
            accountId,
        });
    }

    async function handleConfirmArchiveTable() {
        if (!accountId || !archivePreview) {
            return;
        }

        try {
            await submitRoomMutation(`/v1/rooms/${slug}/admin/archive`, {
                accountId,
                matchedLedgerAccounts: archivePreview.ledger
                    .map((row) => {
                        const matchedAccountId = archiveMatchDrafts[row.sourceAccountId];

                        if (!matchedAccountId) {
                            return null;
                        }

                        return {
                            sourceAccountId: row.sourceAccountId,
                            matchedAccountId,
                        };
                    })
                    .filter((value): value is { sourceAccountId: string; matchedAccountId: string } => Boolean(value)),
            });

            closeArchivePreview();
        } catch {
            return;
        }
    }

    function restartArchivedReplay() {
        const now = Date.now();

        setTurnClockNow(now);
        setArchivedReplayStartedAt(now);
    }

    function handleSeatPerspectiveClick(event: ReactMouseEvent<HTMLElement>, seat: TableSeatView) {
        if (!seat.player) {
            return;
        }

        const target = event.target as HTMLElement | null;

        if (target?.closest("button, a, input, textarea, select, label")) {
            return;
        }

        setTablePovSeatIndex(seat.seatIndex);
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

    function handleSelectHistoryHand(handId: string) {
        setSelectedLedgerHandId(handId);

        if (isArchivedRoom) {
            restartArchivedReplay();
        }
    }

    useEffect(() => {
        if (!preselectedHeroAction || !heroActionState?.canAct || isMutating || !currentHand) {
            return;
        }

        const actionType = resolveQueuedHeroAction(preselectedHeroAction, heroActionState);

        if (!actionType) {
            return;
        }

        const actionKey = `${currentHand.id}:${currentHand.street}:${actionType}:${preselectedHeroAction.type === "call" ? heroActionState.callAmount : ""}`;

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
                    void media.handleConnectMedia("microphone");
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
                    void media.handleConnectMedia("camera");
                }
                return;
            }

            if (key === "p" && isAdmin) {
                event.preventDefault();
                void handlePauseToggle();
                return;
            }

            if (currentHand?.runItTwicePrompt) {
                return;
            }

            if ((key === "i" || key === "q") && heroInHand && !heroActionState?.hasFolded && !heroActionState?.isAllIn) {
                event.preventDefault();
                handleQueuedOrImmediateCheckOrFold();
                return;
            }

            if (!heroActionState) {
                return;
            }

            const canOpenWagerControl = heroActionState.allowedActions.includes("bet") || heroActionState.allowedActions.includes("raise");

            if (!heroActionState.canAct) {
                if (key === "c" && heroActionState.allowedActions.includes("call")) {
                    event.preventDefault();
                    handleQueuedOrImmediateCall();
                    return;
                }

                if (key === "k" && heroActionState.callAmount === 0) {
                    event.preventDefault();
                    handleQueuedOrImmediateCheck();
                    return;
                }

                if (key === "f" && !heroActionState.hasFolded && !heroActionState.isAllIn) {
                    event.preventDefault();
                    handleQueuedOrImmediateFold();
                }

                return;
            }

            if (key === "escape" && actionPanelScreen === "betControl") {
                event.preventDefault();
                setActionPanelScreen("buttons");
                return;
            }

            if (key === "enter" && actionPanelScreen === "betControl" && canOpenWagerControl) {
                event.preventDefault();
                void handlePlayerAction(heroActionState.allowedActions.includes("raise") ? "raise" : "bet");
                return;
            }

            if (key === "c") {
                event.preventDefault();

                if (heroActionState.allowedActions.includes("call")) {
                    handleQueuedOrImmediateCall();
                    return;
                }

                if (heroActionState.allowedActions.includes("check")) {
                    handleQueuedOrImmediateCheck();
                }

                return;
            }

            if (key === "k" && heroActionState.allowedActions.includes("check")) {
                event.preventDefault();
                handleQueuedOrImmediateCheck();
                return;
            }

            if (key === "f" && heroActionState.allowedActions.includes("fold")) {
                event.preventDefault();
                handleQueuedOrImmediateFold();
                return;
            }

            if ((key === "r" || key === "b") && canOpenWagerControl) {
                event.preventDefault();
                setActionPanelScreen("betControl");
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [actionPanelScreen, currentHand?.runItTwicePrompt?.createdAt, demoMode, heroActionState, heroInHand, isAdmin, media, preselectedHeroAction, snapshot?.status]);

    const heroStatsBar = (
        <section className={["table-hero-stats-bar", heroPlayer ? "" : "table-hero-stats-bar--empty"].filter(Boolean).join(" ")}>
            {heroPlayer ? (
                <>
                    <div className="table-hero-stats-bar__item table-hero-stats-bar__item--stack"><strong>Stack</strong><span>{formatNumber(heroDisplayedStack)}</span></div>
                    <div className="table-hero-stats-bar__item table-hero-stats-bar__item--committed"><strong>Committed</strong><span>{formatNumber(heroContribution)}</span></div>
                    <div className="table-hero-stats-bar__item table-hero-stats-bar__item--bank"><strong>Bank</strong><span>{tableSnapshot?.turnState.timeBankSeconds === null ? "Off" : formatTurnSeconds(Math.ceil(heroTimeBankMs / 1000))}</span></div>
                    <div className="table-hero-stats-bar__item table-hero-stats-bar__item--bought-in"><strong>Bought in</strong><span>{formatNumber(heroBuyInTotal)}</span></div>
                    <div className="table-hero-stats-bar__item table-hero-stats-bar__item--won"><strong>Won</strong><span>{formatNumber(heroHandsWonCount)}</span></div>
                    <div className="table-hero-stats-bar__item table-hero-stats-bar__item--rebuys"><strong>Rebuys</strong><span>{formatNumber(heroRebuyCount)}</span></div>
                </>
            ) : (
                <p className="table-hero-stats-bar__empty-copy">Take a seat to track your stack, bank, buy-in, wins, and rebuys.</p>
            )}
        </section>
    );

    const showConnectionRefreshModal = connectionState === "disconnected";
    const accountDialogs = (
        <>
            {guestRecoveryCode ? (
                <div className="site site--overlay">
                    <div className="dialog-backdrop">
                        <section className="dialog card" role="dialog" aria-modal="true" aria-label="Save your recovery code">
                            <RecoveryCodeNotice code={guestRecoveryCode} onDone={() => setGuestRecoveryCode(null)} />
                        </section>
                    </div>
                </div>
            ) : null}
            {isDeviceLinkOpen && session ? (
                <DeviceLinkDialog token={session.token} nextPath={`/rooms/${slug}`} onClose={() => setIsDeviceLinkOpen(false)} />
            ) : null}
        </>
    );

    const connectionRefreshModal = showConnectionRefreshModal ? (
        <div className="table-dialog table-dialog--connection-alert" role="alertdialog" aria-modal="true" aria-label="Connection lost">
            <div className="table-dialog__backdrop" aria-hidden="true" />
            <section className="table-dialog__panel table-dialog__panel--connection-alert">
                <header className="table-dialog__header">
                    <div>
                        <span className="table-menu-drawer__eyebrow">Connection error</span>
                        <h2>Connection lost</h2>
                        <p>You have been disconnected from the table. Refresh the page to reconnect.</p>
                    </div>
                </header>
                <div className="table-dialog__actions">
                    <button className="button button--primary" type="button" onClick={() => window.location.reload()}>
                        Refresh page
                    </button>
                </div>
            </section>
        </div>
    ) : null;

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
                                ? <p className="muted-copy">Signed in as {getSessionDisplayName(session)}</p>
                                : <p className="muted-copy"></p>}

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
                            <button className="button button--primary" type="button" onClick={() => void handleJoinRoom()} disabled={isMutating}>
                                Unlock room
                            </button>
                        </div>
                    </section>
                </div>

                {pendingAuthAction ? (
                    <div className="table-dialog" role="dialog" aria-modal="true" aria-label="Sign in or register to continue">
                        <button className="table-dialog__backdrop" type="button" aria-label="Close sign-in dialog" onClick={closeAuthDialog} />
                        <section className="table-dialog__panel table-dialog__panel--wide table-dialog__panel--scrollable">
                            <header className="table-dialog__header">
                                <div>
                                    <span className="table-menu-drawer__eyebrow">Account required</span>
                                    <h2>{pendingAuthAction.kind === "join-room" ? "Sign in to join this room" : "Sign in to take a seat"}</h2>
                                    <p>{pendingAuthAction.kind === "join-room" ? "The room password looks good. Sign in or create an account and the room will unlock automatically." : "Sign in or create an account and your seat setup will continue automatically."}</p>
                                </div>
                                <button className="table-dialog__close" type="button" onClick={closeAuthDialog} aria-label="Close sign-in dialog">
                                    ×
                                </button>
                            </header>

                            <div className="control-desk__auth-stack">
                            {canJoinAsGuest ? (
                                <section className="control-desk__form-block">
                                    <div className="control-desk__form-copy">
                                        <strong>Play as guest</strong>
                                        <p>No email or password. You can move to another device with a code later.</p>
                                    </div>
                                    <form className="control-form" action={handleGuestInRoom}>
                                        <input className="control-input" type="text" name="displayName" placeholder="display name" autoComplete="nickname" required minLength={2} maxLength={24} />
                                        <button className="button button--primary" type="submit" disabled={isCreatingGuestInRoom || isCompletingAuthAction}>
                                            {isCreatingGuestInRoom ? "Starting..." : isCompletingAuthAction ? "Finishing..." : "Continue as guest"}
                                        </button>
                                        {authGuestError ? <p className="form-error">{authGuestError}</p> : null}
                                    </form>
                                </section>
                            ) : null}
                                <section className="control-desk__form-block">
                                    <div className="control-desk__form-copy">
                                        <strong>New account</strong>
                                        <p>Create an account to save your stats and jump into this table.</p>
                                    </div>
                                    <form className="control-form" action={handleRegisterInRoom}>
                                        <input className="control-input" type="email" name="email" placeholder="email" required />
                                        <input className="control-input" type="text" name="username" placeholder="username" required />
                                        <input className="control-input" type="password" name="password" placeholder="password" required minLength={8} />
                                        <button className="button button--primary" type="submit" disabled={isRegisteringInRoom || isCompletingAuthAction}>
                                            {isRegisteringInRoom ? "Creating account..." : isCompletingAuthAction ? "Finishing..." : "Create account"}
                                        </button>
                                        {authRegisterError ? <p className="form-error">{authRegisterError}</p> : null}
                                    </form>
                                </section>

                                <section className="control-desk__form-block">
                                    <div className="control-desk__form-copy">
                                        <strong>Sign in</strong>
                                        <p>Use your existing account and the room will keep going from there.</p>
                                    </div>
                                    <form className="control-form" action={handleLoginInRoom}>
                                        <input className="control-input" type="text" name="identifier" placeholder="email or username" required />
                                        <input className="control-input" type="password" name="password" placeholder="password" required />
                                        <button className="button button--secondary" type="submit" disabled={isLoggingInRoom || isCompletingAuthAction}>
                                            {isLoggingInRoom ? "Signing in..." : isCompletingAuthAction ? "Finishing..." : "Sign in"}
                                        </button>
                                        {authLoginError ? <p className="form-error">{authLoginError}</p> : null}
                                    </form>
                                </section>
                            </div>
                        </section>
                    </div>
                ) : null}

                {connectionRefreshModal}
                {accountDialogs}
            </main>
        );
    }

    return (
        <main className={["room-shell", "room-shell--play", isPhoneViewport ? "room-shell--phone" : ""].filter(Boolean).join(" ")}>
            {!isPhoneViewport ? (
                <header className="room-toolbar room-toolbar--compact">
                    <div>
                        <Link className="room-toolbar__brand" href="/">
                            <img className="room-toolbar__brand-mark" src="/poker.svg" alt={`${brandName} logo`} />
                            <span>{brandName} Table</span>
                        </Link>
                        <h1 className="room-toolbar__title">{snapshot?.name ?? `Room ${slug}`}</h1>
                    </div>

                    <div className="room-toolbar__meta">{renderRoomMetaPills()}</div>
                </header>
            ) : null}

            <section className="room-play-stack">
                {actionError ? <p className="form-error room-play-stack__error">{actionError}</p> : null}
                {demoMode ? <p className="muted-copy">Sample table is read-only and uses mocked media tiles for layout sizing.</p> : null}

                <section className="table-arena table-arena--clean">
                    <div className="table-felt">
                        <div className="table-menu-cluster" ref={tableMenuShellRef}>
                            {renderTableMenuButtons()}
                            {tableMenuDrawer}
                        </div>

                        <VictoryConfettiCanvas active={showVictoryConfetti} />
                        {suggestedGestureFlights.length ? (
                            <div className="table-suggested-gesture-flights" aria-hidden="true">
                                {suggestedGestureFlights.map((flight) => (
                                    <span
                                        key={flight.id}
                                        className="table-suggested-gesture-flight"
                                        style={{
                                            ["--flight-start-x" as string]: `${flight.startX}px`,
                                            ["--flight-start-y" as string]: `${flight.startY}px`,
                                            ["--flight-mid-x" as string]: `${flight.midX}px`,
                                            ["--flight-mid-y" as string]: `${flight.midY}px`,
                                            ["--flight-end-x" as string]: `${flight.endX}px`,
                                            ["--flight-end-y" as string]: `${flight.endY}px`,
                                            ["--flight-duration" as string]: `${SUGGESTED_GESTURE_FLIGHT_DURATION_MS}ms`,
                                            animationDelay: `-${flight.animationDelayMs}ms`,
                                        } as CSSProperties}
                                    >
                                        {flight.emoji}
                                    </span>
                                ))}
                            </div>
                        ) : null}

                        <div className="table-status-rack">{renderTableStatusRackContent()}</div>
                        <div className={["table-chat-floater", isPhoneViewport ? "table-chat-floater--mobile" : ""].filter(Boolean).join(" ")}>
                            {isPhoneViewport ? (
                                <>
                                    <div className="table-chat-mobile-dock" ref={tableChatDockRef}>
                                        <button
                                            className={[
                                                "table-chat-mobile-dock__button",
                                                "table-chat-mobile-dock__button--log",
                                                isSessionLedgerOpen ? "table-chat-mobile-dock__button--active" : "",
                                            ].filter(Boolean).join(" ")}
                                            type="button"
                                            onClick={() => openSessionActivityModal("ledger")}
                                        >
                                            Log
                                        </button>
                                        <button
                                            className={[
                                                "table-chat-mobile-dock__button",
                                                "table-chat-mobile-dock__button--chat",
                                                isChatExpanded ? "table-chat-mobile-dock__button--active" : "",
                                                hasUnreadMobileChat ? "table-chat-mobile-dock__button--unread" : "",
                                                isMobileChatTemporarilyBlocked ? "table-chat-mobile-dock__button--disabled-turn" : "",
                                            ].filter(Boolean).join(" ")}
                                            type="button"
                                            onClick={handleMobileChatToggle}
                                            disabled={isMobileChatTemporarilyBlocked}
                                        >
                                            Chat
                                        </button>
                                        <button
                                            className={[
                                                "table-chat-mobile-dock__button",
                                                "table-chat-mobile-dock__button--mic",
                                                chatMediaActionState === "connecting" || chatMediaActionState === "microphone" ? "table-chat-mobile-dock__button--loading" : "",
                                                media.isConnected && media.microphoneEnabled ? "table-chat-mobile-dock__button--active" : "",
                                            ].filter(Boolean).join(" ")}
                                            type="button"
                                            onClick={() => void handleChatMediaToggle("microphone")}
                                            disabled={!(demoMode || canConnectMedia) || chatMediaActionState !== "idle"}
                                            aria-busy={chatMediaActionState === "connecting" || chatMediaActionState === "microphone"}
                                        >
                                            Mic
                                        </button>
                                        <button
                                            className={[
                                                "table-chat-mobile-dock__button",
                                                "table-chat-mobile-dock__button--cam",
                                                chatMediaActionState === "connecting" || chatMediaActionState === "camera" ? "table-chat-mobile-dock__button--loading" : "",
                                                media.isConnected && media.cameraEnabled ? "table-chat-mobile-dock__button--active" : "",
                                            ].filter(Boolean).join(" ")}
                                            type="button"
                                            onClick={() => void handleChatMediaToggle("camera")}
                                            disabled={!(demoMode || canConnectMedia) || chatMediaActionState !== "idle"}
                                            aria-busy={chatMediaActionState === "connecting" || chatMediaActionState === "camera"}
                                        >
                                            Cam
                                        </button>
                                    </div>

                                    {isChatExpanded ? renderTableChatPanel("overlay") : null}
                                </>
                            ) : (
                                <>
                                    <button
                                        className={[
                                            "table-menu-cluster__button",
                                            "table-menu-cluster__button--solo",
                                            "table-menu-cluster__button--log",
                                            isSessionLedgerOpen ? "table-menu-cluster__button--active" : "",
                                        ].filter(Boolean).join(" ")}
                                        type="button"
                                        onClick={() => openSessionActivityModal("ledger")}
                                    >
                                        Log / Ledger
                                    </button>
                                    {renderTableChatPanel("overlay")}
                                </>
                            )}
                        </div>

                        <div className="table-center">
                            <span className="table-center__label">{currentHand ? `Hand ${currentHand.handNumber} · ${formatStreet(currentHand.street)}` : latestCompletedHand ? "" : isArchivedRoom ? "Archived table" : "Waiting for players"}</span>
                            <div className="table-center__pot">Pot {formatNumber(displayedPot)}</div>
                            <div className="table-board table-center__board">
                                {buildBoardSlots(displayedBoard).map((slot, index) => (
                                    <PokerCard key={`board-${index}`} card={slot.card} isFaceUp={slot.isFaceUp} size="board" backLabel={slot.backLabel} />
                                ))}
                            </div>
                            {displayedAdditionalBoards.length ? (
                                <div className="table-center__runout-boards">
                                    {displayedAdditionalBoards.map((board, boardIndex) => (
                                        <div key={`table-center-runout-${boardIndex + 2}`} className="table-center__runout-board">
                                            <span className="table-center__runout-label">Run {boardIndex + 2}</span>
                                            <div className="table-board table-board--compact table-center__runout-cards">
                                                {buildBoardSlots(board).map((slot, index) => (
                                                    <PokerCard key={`table-center-runout-${boardIndex + 2}-${index}`} card={slot.card} isFaceUp={slot.isFaceUp} size="compact" backLabel={slot.backLabel} />
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : null}
                            {turnMetrics && (currentActor || turnMetrics.kind === "run-it-twice") ? (
                                <div className={[
                                    "table-center__turn-clock",
                                    turnMetrics.isUsingTimeBank ? "table-center__turn-clock--timebank" : "",
                                ].filter(Boolean).join(" ")}>
                                    <strong>{turnMetrics.kind === "run-it-twice" ? "Run it twice" : currentActor?.displayName}</strong>
                                    <span>{turnMetrics.kind === "run-it-twice"
                                        ? `${formatTurnSeconds(turnMetrics.mainSecondsRemaining)} to vote`
                                        : turnMetrics.isUsingTimeBank
                                            ? `Time bank ${formatTurnSeconds(turnMetrics.timeBankSecondsRemaining)}`
                                            : `${formatTurnSeconds(turnMetrics.mainSecondsRemaining)} to act`}
                                    </span>
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
                            const mediaParticipantsForSeat = seat.player
                                ? mediaParticipantsByAccountId.get(seat.player.accountId) ?? []
                                : [];
                            const mediaParticipant = seat.player
                                ? pickSeatMediaParticipant(mediaParticipantsForSeat, seat.isHero)
                                : null;
                            const mediaBadge = mediaParticipant ? describeMediaBadge(mediaParticipant, seat.isHero) : null;
                            const seatCards = buildSeatCardSlots(seat);
                            const seatReaction = seat.player ? activeSeatReactions.get(seat.player.accountId) ?? null : null;
                            const seatGesture = seat.player ? seatGesturesByAccountId.get(seat.player.accountId) ?? null : null;
                            const heroGestureEmoji = seat.isHero ? heroGesture?.emoji ?? "" : "";
                            const showSeatMediaTile = Boolean(seat.player);
                            const dealerMarker = seat.markers.find((marker) => marker.tone === "dealer") ?? null;
                            const blindMarkers = seat.markers.filter((marker) => marker.tone === "blind");
                            const inlineMarkers = seat.markers.filter((marker) => marker.tone === "admin");
                            const hasVisibleRevealedCard = Boolean(seat.revealedCards?.some((card) => card !== null));
                            const shouldRenderSeatCards = seatCards.length > 0;
                            const showHeroNotReadyNotice = Boolean(!isArchivedRoom && seat.isHero && heroPlayer && !heroPlayer.isReady && !heroPlayer.isSittingOut);
                            const showWinnerStrip = Boolean(seat.actionBubble && seat.isWinner && !currentHand);
                            const showLiveActionBubble = Boolean(
                                seat.actionBubble
                                && !showWinnerStrip
                                && (isPhoneViewport || !seat.contributionLabel)
                            );
                            const showHeroChatToast = Boolean(seat.isHero && heroChatToast?.content);
                            const showPinnedHandLabel = Boolean(!isPhoneViewport && seat.statusLabel && (seat.runoutWinPercent !== null || seat.isWinner));
                            const actionBubbleTone = seat.actionBubble === "Fold"
                                ? "fold"
                                : seat.actionBubble === "Check"
                                    ? "check"
                                    : "default";
                            const activeSeatTurnMetrics = seat.isActive
                                && turnMetrics?.kind === "turn"
                                && turnMetrics.actorAccountId === seat.player?.accountId
                                ? turnMetrics
                                : null;
                            const useCompactMobileMediaFallback = Boolean(
                                isPhoneViewport
                                && (
                                    !mediaParticipant
                                    || (
                                        !mediaParticipant.demoSurface
                                        && (!mediaParticipant.cameraEnabled || !mediaParticipant.videoPublication)
                                    )
                                )
                            );
                            const openSeatTitle = seat.pendingRequest ? "Seat requested" : "Open seat";
                            const openSeatSubtitle = seat.pendingRequest
                                ? `${seat.pendingRequest.displayName} · ${formatNumber(seat.pendingRequest.requestedStack)}`
                                : "Available";
                            const openSeatStatus = seat.pendingRequest ? "Pending" : "Open";
                            const openSeatActionLabel = seat.pendingRequest ? "Pending" : heroPendingSeatRequest ? "Move" : "Join";

                            return (
                                <article
                                    key={seat.seatIndex}
                                    ref={(element) => setSeatElementRef(seat.seatIndex, element)}
                                    className={[
                                        "table-seat",
                                        seat.player ? "table-seat--focusable" : "",
                                        seat.isHero ? "table-seat--hero" : "",
                                        seat.isHero && isReactionMenuOpen ? "table-seat--emoji-open" : "",
                                        seat.isActive ? "table-seat--active" : "",
                                        seat.isFolded ? "table-seat--folded" : "",
                                        seat.isInactive ? "table-seat--inactive" : "",
                                        seat.isOpen ? "table-seat--open" : "",
                                        seat.isWinner ? "table-seat--winner" : "",
                                        seat.actionBubble && seat.contributionLabel ? "table-seat--dual-pills" : "",
                                        hasVisibleRevealedCard ? "table-seat--revealed" : "",
                                        showSeatMediaTile ? "table-seat--with-media" : "",
                                        isSpectating && showSeatMediaTile ? "table-seat--spectator-media" : "",
                                        seat.shiftCardsLeftMore ? "table-seat--cards-left-more" : "",
                                        seat.shiftCardsRightMore ? "table-seat--cards-right-more" : "",
                                        `table-seat--media-${seat.mediaPlacement}`,
                                    ].filter(Boolean).join(" ")}
                                    style={seat.isHero && isReactionMenuOpen ? { ...seat.style, zIndex: 60 } : seat.style}
                                    onClick={seat.player ? (event) => handleSeatPerspectiveClick(event, seat) : undefined}
                                >
                                    {showHeroNotReadyNotice ? <div className="table-seat__notice table-seat__notice--warning">Not ready</div> : null}
                                    {dealerMarker ? (
                                        <div className={["table-seat__dealer-button", `table-seat__dealer-button--${seat.mediaPlacement}`].join(" ")} aria-hidden="true">
                                            <span className="table-seat__dealer-button-chip">{dealerMarker.label}</span>
                                        </div>
                                    ) : null}
                                    {blindMarkers.length ? (
                                        <div className={["table-seat__blind-badges", `table-seat__blind-badges--${seat.mediaPlacement}`].join(" ")} aria-hidden="true">
                                            {blindMarkers.map((marker) => (
                                                <span key={`${seat.seatIndex}-${marker.label}`} className={["table-seat__blind-badge", `table-seat__blind-badge--${marker.label.toLowerCase()}`].join(" ")}>
                                                    {marker.label}
                                                </span>
                                            ))}
                                        </div>
                                    ) : null}
                                    {showPinnedHandLabel ? (
                                        <div className={["table-seat__showdown-label", `table-seat__showdown-label--${seat.stateTone}`].join(" ")}>{seat.statusLabel}</div>
                                    ) : null}
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
                                    {!seat.isHero && seatGesture ? <div className={["table-seat__gesture", `table-seat__gesture--${seat.mediaPlacement}`].join(" ")}>{seatGesture.emoji}</div> : null}
                                    {seatReaction ? (
                                        <div className={[
                                            "table-seat__reaction",
                                            suggestedGesturesEnabled && seatReaction.targetAccountId ? "table-seat__reaction--suggested" : "",
                                        ].filter(Boolean).join(" ")}>{seatReaction.emoji}</div>
                                    ) : null}
                                    {showHeroChatToast ? (
                                        <div className={[
                                            "table-seat__bubble",
                                            "table-seat__bubble--chat",
                                        ].join(" ")}>{heroChatToast?.content}</div>
                                    ) : null}
                                    {showWinnerStrip ? <div className="table-seat__bubble table-seat__bubble--winner">{seat.actionBubble}</div> : null}
                                    {showLiveActionBubble ? (
                                        <div className={[
                                            "table-seat__bubble",
                                            "table-seat__bubble--live",
                                            `table-seat__bubble--${seat.mediaPlacement}`,
                                            `table-seat__bubble--${actionBubbleTone}`,
                                        ].join(" ")}>{seat.actionBubble}</div>
                                    ) : null}
                                    {seat.contributionLabel ? <div className={["table-seat__chips", `table-seat__chips--${seat.mediaPlacement}`].join(" ")}>{seat.contributionLabel}</div> : null}
                                    {seat.isOpen ? (
                                        <div className="table-seat__visuals table-seat__visuals--with-media table-seat__visuals--open">
                                            <div className="table-seat__media-wrap">
                                                <div className="table-seat__media table-seat__media--fallback table-seat__media--open">
                                                    {heroPlayer === null ? (
                                                        <button
                                                            className="table-seat__media-fallback-avatar table-seat__media-fallback-avatar--button"
                                                            type="button"
                                                            onClick={() => handleSeatClick(seat.seatIndex)}
                                                            disabled={isMutating || Boolean(seat.pendingRequest)}
                                                        >
                                                            {seat.avatarLabel}
                                                        </button>
                                                    ) : (
                                                        <div className="table-seat__media-fallback-avatar">{seat.avatarLabel}</div>
                                                    )}
                                                    {seat.pendingRequest ? (
                                                        <span className="table-seat__media-badge table-seat__media-badge--awaiting">
                                                            Pending
                                                        </span>
                                                    ) : null}
                                                </div>
                                            </div>

                                            <div className="table-seat__content table-seat__content--open">
                                                <div className="table-seat__open-header">
                                                    <div className="table-seat__identity table-seat__open-copy">
                                                        <strong>{openSeatTitle}</strong>
                                                        <span>{openSeatSubtitle}</span>
                                                    </div>

                                                    <div className="table-seat__stats table-seat__stats--open">
                                                        <span className="table-seat__stat-pill table-seat__stat-pill--open-label">Seat {seat.seatIndex + 1}</span>
                                                        <span className="table-seat__stat-pill table-seat__stat-pill--open-state">{openSeatStatus}</span>
                                                    </div>
                                                </div>

                                                {heroPlayer === null ? (
                                                    <button
                                                        className="button button--secondary table-seat__button table-seat__button--open"
                                                        type="button"
                                                        onClick={() => handleSeatClick(seat.seatIndex)}
                                                        disabled={isMutating || Boolean(seat.pendingRequest)}
                                                    >
                                                        {openSeatActionLabel}
                                                    </button>
                                                ) : null}
                                            </div>
                                        </div>
                                    ) : (
                                        <div className={[
                                            "table-seat__visuals",
                                            showSeatMediaTile ? "table-seat__visuals--with-media" : "table-seat__visuals--cards-only",
                                        ].filter(Boolean).join(" ")}>
                                            {seat.isHero && heroHandLabel ? <div className="table-seat__hero-hand">{heroHandLabel}</div> : null}
                                            {showSeatMediaTile ? (
                                                <div className="table-seat__media-wrap">
                                                    {seat.isHero ? (
                                                        <div className="table-seat__reaction-control" ref={seat.isHero ? reactionMenuRef : undefined}>
                                                            {suggestedGesturePopover && !isReactionMenuOpen ? suggestedGesturePopover : null}
                                                            <button
                                                                className={[
                                                                    "table-seat__reaction-toggle",
                                                                    heroGestureEmoji ? "table-seat__reaction-toggle--set" : "table-seat__reaction-toggle--empty",
                                                                ].join(" ")}
                                                                type="button"
                                                                onClick={(event) => {
                                                                    event.stopPropagation();
                                                                    setGestureInput(heroGesture?.emoji ?? "");
                                                                    setIsReactionMenuOpen((current) => !current);
                                                                }}
                                                                disabled={!heroPlayer || isMutating}
                                                                aria-label={heroGestureEmoji ? "Edit your seat gesture" : "Choose your seat gesture"}
                                                                title={heroGestureEmoji ? "Edit your seat gesture" : "Choose your seat gesture"}
                                                            >
                                                                {heroGestureEmoji ? (
                                                                    <span className="table-seat__reaction-toggle-emoji" aria-hidden="true">{heroGestureEmoji}</span>
                                                                ) : (
                                                                    <span className="table-seat__reaction-toggle-placeholder" aria-hidden="true">+</span>
                                                                )}
                                                            </button>

                                                            {isReactionMenuOpen && !isPhoneViewport ? reactionPopover : null}
                                                        </div>
                                                    ) : null}

                                                    {mediaParticipant && !useCompactMobileMediaFallback ? (
                                                        <>
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
                                                            </div>
                                                            <span className={[
                                                                "table-seat__media-badge",
                                                                `table-seat__media-badge--${mediaBadge?.tone ?? "joined"}`,
                                                                mediaBadge?.tone === "mic" || mediaBadge?.tone === "muted-mic"
                                                                    ? "table-seat__media-badge--icon-only"
                                                                    : "",
                                                            ].filter(Boolean).join(" ")}>{mediaBadge?.label ?? "Joined"}</span>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <div className="table-seat__media table-seat__media--fallback">
                                                                <span className="table-seat__media-fallback-avatar">{seat.avatarLabel}</span>
                                                            </div>
                                                            {!isPhoneViewport && seat.isHero ? <span className="table-seat__media-badge table-seat__media-badge--awaiting">Awaiting camera</span> : null}
                                                        </>
                                                    )}
                                                </div>
                                            ) : null}

                                            <div className="table-seat__content">
                                                <div className="table-seat__identity">
                                                    <strong>{seat.name}</strong>
                                                    <span>{seat.stackLabel}</span>
                                                </div>

                                                {!seat.isHero && seatGesture ? <span className="table-seat__mobile-gesture">{seatGesture.emoji}</span> : null}

                                                {inlineMarkers.length ? (
                                                    <div className="table-seat__markers">
                                                        {inlineMarkers.map((marker) => (
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
                                                        {isPhoneViewport ? (
                                                            <span className="table-seat__stat-pill-label">{seat.handsWonCount}</span>
                                                        ) : (
                                                            <>
                                                                <span className="table-seat__stat-pill-label">W</span>
                                                                <span>{seat.handsWonCount}</span>
                                                            </>
                                                        )}
                                                    </span>
                                                    <span className={[
                                                        "table-seat__stat-pill",
                                                        seat.rebuyCount > 0 ? "table-seat__stat-pill--rebuys" : "table-seat__stat-pill--muted",
                                                    ].join(" ")}>
                                                        {isPhoneViewport ? (
                                                            <span className="table-seat__stat-pill-label">{seat.rebuyCount}</span>
                                                        ) : (
                                                            <>
                                                                <span className="table-seat__stat-pill-label">R</span>
                                                                <span>{seat.rebuyCount}</span>
                                                            </>
                                                        )}
                                                    </span>
                                                </div>

                                                <div className="table-seat__footer">
                                                    {seat.statusLabel && !showPinnedHandLabel ? <span className={`table-seat__state table-seat__state--${seat.stateTone}`}>{seat.statusLabel}</span> : null}
                                                    <span className="table-seat__seat-label">Seat {seat.seatIndex + 1}</span>
                                                </div>
                                            </div>

                                            {activeSeatTurnMetrics ? (
                                                <div className="table-seat__turn-bar" aria-hidden="true">
                                                    <span
                                                        className={[
                                                            "table-seat__turn-bar-fill",
                                                            "table-seat__turn-bar-fill--timebank",
                                                            activeSeatTurnMetrics.isTimeBankLow ? "table-seat__turn-bar-fill--low" : "",
                                                        ].filter(Boolean).join(" ")}
                                                        style={{ width: `${activeSeatTurnMetrics.timeBankPercentRemaining}%` }}
                                                    />
                                                    <span
                                                        className={[
                                                            "table-seat__turn-bar-fill",
                                                            "table-seat__turn-bar-fill--main",
                                                            activeSeatTurnMetrics.isMainLow ? "table-seat__turn-bar-fill--low" : "",
                                                        ].filter(Boolean).join(" ")}
                                                        style={{ width: `${activeSeatTurnMetrics.mainPercentRemaining}%` }}
                                                    />
                                                </div>
                                            ) : null}

                                            {shouldRenderSeatCards ? (
                                                <div className={[
                                                    "table-seat__cards",
                                                    hasVisibleRevealedCard ? "table-seat__cards--revealed" : "",
                                                ].filter(Boolean).join(" ")} style={seat.cardStyle} aria-hidden="true">
                                                    {seatCards.map((slot, index) => (
                                                        <PokerCard key={`${seat.seatIndex}-${index}`} card={slot.card} isFaceUp={slot.isFaceUp} size="seat" backLabel={slot.backLabel} animationIndex={index} />
                                                    ))}
                                                </div>
                                            ) : null}

                                            {seat.runItTwiceResponse ? (
                                                <div
                                                    className={[
                                                        "table-seat__run-it-twice-vote",
                                                        `table-seat__run-it-twice-vote--${seat.runItTwiceResponse}`,
                                                    ].join(" ")}
                                                    aria-label={seat.runItTwiceResponse === "yes"
                                                        ? `${seat.name} voted yes to run it twice`
                                                        : `${seat.name} voted no to run it twice`}
                                                >
                                                    {seat.runItTwiceResponse === "yes" ? "✓" : "×"}
                                                </div>
                                            ) : null}
                                        </div>
                                    )}
                                </article>
                            );
                        })}

                        {isPhoneViewport && isReactionMenuOpen ? (
                            <div className="table-seat__reaction-popover-mobile-shell" ref={reactionMenuRef}>
                                {reactionPopover}
                            </div>
                        ) : null}

                        <div className="table-command-deck">
                            {isArchivedRoom ? (
                                <div className="table-command-deck__action-wrap table-command-deck__action-wrap--archive">
                                    <button className="button button--primary" type="button" onClick={restartArchivedReplay} disabled={!selectedArchivedHand}>
                                        Replay selected hand
                                    </button>
                                    <Link className="button button--secondary" href="/rooms">
                                        Rooms
                                    </Link>
                                </div>
                            ) : (
                                <div className={[
                                    "table-command-deck__action-wrap",
                                    isActionPadDragging ? "table-command-deck__action-wrap--dragging" : "",
                                ].filter(Boolean).join(" ")}>
                                    {renderActionPanel("inline")}
                                </div>
                            )}

                            {heroStatsBar}
                        </div>
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
                                <h2>{isAdmin ? `Sit in Seat ${seatRequestPrompt.seatIndex + 1}` : `Request Seat ${seatRequestPrompt.seatIndex + 1}`}</h2>
                                <p>{isAdmin ? "Set an optional display name and your buy-in before sitting down." : "Set an optional display name and the buy-in you want the game owner to approve."}</p>
                            </div>
                            <button className="table-dialog__close" type="button" onClick={() => setSeatRequestPrompt(null)} aria-label="Close seat request">
                                ×
                            </button>
                        </header>

                        <label className="table-admin-field">
                            <span>Display name</span>
                            <input
                                className="control-input"
                                type="text"
                                value={displayName}
                                onChange={(event) => setDisplayName(event.target.value)}
                                placeholder={getSessionDisplayName(session) || "optional display name"}
                            />
                        </label>

                        {snapshot ? (
                            <div className="table-stat-list">
                                <span className="chip-pill">Min buy-in {formatNumber(snapshot.buyInState.minRebuyAmount)}</span>
                                <span className="chip-pill">Max buy-in {formatNumber(snapshot.buyInState.maxRebuyAmount)}</span>
                            </div>
                        ) : null}

                        <label className="table-admin-field">
                            <span>Intended stack</span>
                            <input
                                className="control-input"
                                type="number"
                                min={snapshot?.buyInState.minRebuyAmount ?? 1}
                                max={snapshot?.buyInState.maxRebuyAmount}
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
                                {isAdmin ? "Sit down" : "Send request"}
                            </button>
                        </div>
                    </section>
                </div>
            ) : null}

            {pendingAuthAction ? (
                <div className="table-dialog" role="dialog" aria-modal="true" aria-label="Sign in or register to continue">
                    <button className="table-dialog__backdrop" type="button" aria-label="Close sign-in dialog" onClick={closeAuthDialog} />
                    <section className="table-dialog__panel table-dialog__panel--wide table-dialog__panel--scrollable">
                        <header className="table-dialog__header">
                            <div>
                                <span className="table-menu-drawer__eyebrow">Account required</span>
                                <h2>{pendingAuthAction.kind === "join-room" ? "Sign in to join this room" : "Sign in to take a seat"}</h2>
                                <p>{pendingAuthAction.kind === "join-room" ? "The room password looks good. Sign in or create an account and the room will unlock automatically." : "Sign in or create an account and your seat setup will continue automatically."}</p>
                            </div>
                            <button className="table-dialog__close" type="button" onClick={closeAuthDialog} aria-label="Close sign-in dialog">
                                ×
                            </button>
                        </header>

                        <div className="control-desk__auth-stack">
                            {canJoinAsGuest ? (
                                <section className="control-desk__form-block">
                                    <div className="control-desk__form-copy">
                                        <strong>Play as guest</strong>
                                        <p>No email or password. You can move to another device with a code later.</p>
                                    </div>
                                    <form className="control-form" action={handleGuestInRoom}>
                                        <input className="control-input" type="text" name="displayName" placeholder="display name" autoComplete="nickname" required minLength={2} maxLength={24} />
                                        <button className="button button--primary" type="submit" disabled={isCreatingGuestInRoom || isCompletingAuthAction}>
                                            {isCreatingGuestInRoom ? "Starting..." : isCompletingAuthAction ? "Finishing..." : "Continue as guest"}
                                        </button>
                                        {authGuestError ? <p className="form-error">{authGuestError}</p> : null}
                                    </form>
                                </section>
                            ) : null}
                            <section className="control-desk__form-block">
                                <div className="control-desk__form-copy">
                                    <strong>New account</strong>
                                    <p>Create an account to save your stats and jump into this table.</p>
                                </div>
                                <form className="control-form" action={handleRegisterInRoom}>
                                    <input className="control-input" type="email" name="email" placeholder="email" required />
                                    <input className="control-input" type="text" name="username" placeholder="username" required />
                                    <input className="control-input" type="password" name="password" placeholder="password" required minLength={8} />
                                    <button className="button button--primary" type="submit" disabled={isRegisteringInRoom || isCompletingAuthAction}>
                                        {isRegisteringInRoom ? "Creating account..." : isCompletingAuthAction ? "Finishing..." : "Create account"}
                                    </button>
                                    {authRegisterError ? <p className="form-error">{authRegisterError}</p> : null}
                                </form>
                            </section>

                            <section className="control-desk__form-block">
                                <div className="control-desk__form-copy">
                                    <strong>Sign in</strong>
                                    <p>Use your existing account and the room will keep going from there.</p>
                                </div>
                                <form className="control-form" action={handleLoginInRoom}>
                                    <input className="control-input" type="text" name="identifier" placeholder="email or username" required />
                                    <input className="control-input" type="password" name="password" placeholder="password" required />
                                    <button className="button button--secondary" type="submit" disabled={isLoggingInRoom || isCompletingAuthAction}>
                                        {isLoggingInRoom ? "Signing in..." : isCompletingAuthAction ? "Finishing..." : "Sign in"}
                                    </button>
                                    {authLoginError ? <p className="form-error">{authLoginError}</p> : null}
                                </form>
                            </section>
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

            {isStopTableConfirmOpen ? (
                <div className="table-dialog" role="dialog" aria-modal="true" aria-label="Confirm stop table">
                    <button className="table-dialog__backdrop" type="button" aria-label="Cancel stop table" onClick={() => setIsStopTableConfirmOpen(false)} />
                    <section className="table-dialog__panel table-dialog__panel--compact">
                        <header className="table-dialog__header">
                            <div>
                                <span className="table-menu-drawer__eyebrow">Stop table</span>
                                <h2>Are you sure?</h2>
                                <p>Games can be resumed, but this will reset the blind schedule. Use Pause if you plan on continuing later.</p>
                            </div>
                            <button className="table-dialog__close" type="button" onClick={() => setIsStopTableConfirmOpen(false)} aria-label="Cancel stop table">
                                ×
                            </button>
                        </header>

                        {actionError ? <p className="form-error table-dialog__error">{actionError}</p> : null}

                        <div className="table-dialog__actions">
                            <button className="button button--secondary" type="button" onClick={() => setIsStopTableConfirmOpen(false)} disabled={isMutating}>
                                Cancel
                            </button>
                            <button className="button button--danger" type="button" onClick={() => void handleConfirmStopTable()} disabled={isMutating}>
                                Stop table
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
                                min={snapshot?.buyInState.minRebuyAmount ?? 1}
                                max={snapshot?.buyInState.maxRebuyAmount}
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

            {houseRulesConfig.visible && isHouseRulesOpen ? (
                <div className="table-dialog" role="dialog" aria-modal="true" aria-label="House rules">
                    <button className="table-dialog__backdrop" type="button" aria-label="Close house rules" onClick={() => setIsHouseRulesOpen(false)} />
                    <section className="table-dialog__panel table-dialog__panel--wide table-dialog__panel--scrollable">
                        <header className="table-dialog__header">
                            <div>
                                <span className="table-menu-drawer__eyebrow">House Rules</span>
                                <h2>{houseRulesConfig.title}</h2>
                                <p>Last updated: {houseRulesConfig.lastUpdated}</p>
                            </div>
                            <button className="table-dialog__close" type="button" onClick={() => setIsHouseRulesOpen(false)} aria-label="Close house rules">
                                ×
                            </button>
                        </header>

                        <div className="table-dialog__content table-dialog__content--house-rules">
                            <section className="table-dialog__section table-dialog__section--house-rules-intro">
                                {houseRulesConfig.overview.map((paragraph, index) => (
                                    <p key={index}>{paragraph}</p>
                                ))}
                            </section>

                            {houseRulesConfig.sections.map((section) => (
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
                <div className="session-ledger-modal" role="dialog" aria-modal="true" aria-label="Table log and ledger">
                    <button className="session-ledger-modal__backdrop" type="button" aria-label="Close session ledger" onClick={() => setIsSessionLedgerOpen(false)} />
                    <section className="session-ledger-modal__panel session-ledger-modal__panel--log">
                        <header className="session-ledger-modal__header">
                            <div>
                                <h2>Log / Ledger</h2>
                                <p>Compact hand history with the session ledger up front.</p>
                            </div>
                            <div className="session-ledger-modal__header-actions">
                                {sessionLogView === "ledger" ? (
                                    <button className="button button--secondary session-ledger-modal__download" type="button" onClick={handleDownloadSessionLedgerCsv}>
                                        Download CSV
                                    </button>
                                ) : null}
                                <button className="session-ledger-modal__close" type="button" onClick={() => setIsSessionLedgerOpen(false)} aria-label="Close session ledger">
                                    ×
                                </button>
                            </div>
                        </header>

                        <div className="session-ledger-modal__controls">
                            <div className="table-log-panel__tabs" role="tablist" aria-label="Log and ledger views">
                                <button
                                    className={[
                                        "table-log-panel__tab",
                                        sessionLogView === "ledger" ? "table-log-panel__tab--active" : "",
                                    ].filter(Boolean).join(" ")}
                                    type="button"
                                    role="tab"
                                    aria-selected={sessionLogView === "ledger"}
                                    onClick={() => setSessionLogView("ledger")}
                                >
                                    Ledger
                                </button>
                                <button
                                    className={[
                                        "table-log-panel__tab",
                                        sessionLogView === "log" ? "table-log-panel__tab--active" : "",
                                    ].filter(Boolean).join(" ")}
                                    type="button"
                                    role="tab"
                                    aria-selected={sessionLogView === "log"}
                                    onClick={() => setSessionLogView("log")}
                                >
                                    Log
                                </button>
                            </div>

                            <span className="session-ledger-modal__summary-pill">
                                {sessionLogView === "log"
                                    ? currentHand
                                        ? `Hand ${currentHand.handNumber} live`
                                        : selectedCompletedHand
                                            ? `Hand ${selectedCompletedHand.handNumber} selected`
                                            : "Waiting for next hand"
                                    : `${sessionLedgerRows.length} ${sessionLedgerRows.length === 1 ? "player" : "players"}`}
                            </span>
                        </div>

                        <div className="session-ledger-modal__table-wrap">
                            {sessionLogView === "log" ? renderTableLogContent() : (
                                <div className="session-ledger-modal__table session-ledger-modal__table--compact">
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
                            )}
                        </div>
                    </section>
                </div>
            ) : null}

            {archivePreview ? (
                <div className="session-ledger-modal" role="dialog" aria-modal="true" aria-label="Archive club session">
                    <button className="session-ledger-modal__backdrop" type="button" aria-label="Close archive preview" onClick={closeArchivePreview} />
                    <section className="session-ledger-modal__panel session-ledger-modal__panel--archive">
                        <header className="session-ledger-modal__header">
                            <div>
                                <h2>Match ledger to club users</h2>
                                <p>{archivePreview.clubName} recorded at {formatArchivePreviewTimestamp(archivePreview.playedAt)}</p>
                                <p className="session-ledger-modal__summary">Choose a system user for duplicate or alternate accounts before archiving. Leaving a row on None keeps the current room account.</p>
                            </div>
                            <button className="session-ledger-modal__close" type="button" onClick={closeArchivePreview} aria-label="Close archive preview">
                                ×
                            </button>
                        </header>

                        <div className="session-ledger-modal__table-wrap">
                            <div className="session-ledger-modal__table session-ledger-modal__table--archive">
                                <div className="session-ledger-modal__row session-ledger-modal__row--header session-ledger-modal__row--archive">
                                    <span>Player</span>
                                    <span>Buy-in</span>
                                    <span>Buy-out</span>
                                    <span>Stack</span>
                                    <span>Wins</span>
                                    <span>Rebuys</span>
                                    <span>Net</span>
                                    <span>Match to user</span>
                                </div>

                                {archivePreview.ledger.map((row) => (
                                    <div key={row.sourceAccountId} className="session-ledger-modal__row session-ledger-modal__row--archive">
                                        <div className="session-ledger-modal__player-cell">
                                            <strong>{row.displayName}</strong>
                                            <span>@{row.sourceUsername} · {formatSessionLedgerHandle(row.sourceAccountId)}</span>
                                        </div>
                                        <span>{formatNumber(row.totalBuyIn)}</span>
                                        <span>{formatNumber(row.buyOut)}</span>
                                        <span>{formatNumber(row.stack)}</span>
                                        <span>{formatNumber(row.wins)}</span>
                                        <span>{formatNumber(row.rebuys)}</span>
                                        <span className={row.netResult >= 0 ? "session-ledger-modal__net session-ledger-modal__net--positive" : "session-ledger-modal__net session-ledger-modal__net--negative"}>
                                            {row.netResult >= 0 ? "+" : ""}{formatNumber(row.netResult)}
                                        </span>
                                        <label className="session-ledger-modal__match-field">
                                            <span className="session-ledger-modal__match-label">Match</span>
                                            <select
                                                className="control-input"
                                                value={archiveMatchDrafts[row.sourceAccountId] ?? ""}
                                                onChange={(event) => setArchiveMatchDrafts((current) => ({
                                                    ...current,
                                                    [row.sourceAccountId]: event.target.value,
                                                }))}
                                                disabled={isMutating}
                                                aria-label={`Match ${row.displayName} to a system user`}
                                            >
                                                <option value="">None - keep current account</option>
                                                {archivePreview.users
                                                    .filter((user) => user.accountId !== row.sourceAccountId)
                                                    .map((user) => (
                                                        <option key={`${row.sourceAccountId}-${user.accountId}`} value={user.accountId}>
                                                            {user.username}{user.isClubMember ? " - club member" : ""}
                                                        </option>
                                                    ))}
                                            </select>
                                        </label>
                                    </div>
                                ))}

                                <div className="session-ledger-modal__row session-ledger-modal__row--footer session-ledger-modal__row--archive">
                                    <span>Table total</span>
                                    <span>{formatNumber(archivePreviewTotals.buyIn)}</span>
                                    <span>{formatNumber(archivePreviewTotals.buyOut)}</span>
                                    <span>{formatNumber(archivePreviewTotals.stack)}</span>
                                    <span>{formatNumber(archivePreviewTotals.wins)}</span>
                                    <span>{formatNumber(archivePreviewTotals.rebuys)}</span>
                                    <span className={archivePreviewTotals.net >= 0 ? "session-ledger-modal__net session-ledger-modal__net--positive" : "session-ledger-modal__net session-ledger-modal__net--negative"}>
                                        {archivePreviewTotals.net >= 0 ? "+" : ""}{formatNumber(archivePreviewTotals.net)}
                                    </span>
                                    <span>{archiveMatchedCount} remapped</span>
                                </div>
                            </div>
                        </div>

                        <div className="table-dialog__actions session-ledger-modal__actions">
                            <button className="button button--secondary" type="button" onClick={closeArchivePreview} disabled={isMutating}>
                                Cancel
                            </button>
                            <button className="button button--primary" type="button" onClick={() => void handleConfirmArchiveTable()} disabled={isMutating}>
                                Archive table
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
                                <p>Phone mode now mirrors the desktop table layout, including the in-table action pad, chat surface, and menu cluster.</p>
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

            {connectionRefreshModal}
            {accountDialogs}
        </main>
    );
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