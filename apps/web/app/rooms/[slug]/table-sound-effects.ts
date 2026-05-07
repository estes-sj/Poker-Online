"use client";

import { useEffect, useRef } from "react";

import type { RoomSnapshot } from "./room-types";

type TableSoundName =
    | "requestNotification"
    | "handDealt"
    | "check"
    | "fold"
    | "chipAction"
    | "yourTurn"
    | "cardReveal"
    | "flopReveal"
    | "victory"
    | "turnCountdown"
    | "chatMessage";

interface TableSoundEffectSpec {
    src: string;
    volume: number;
}

interface RevealState {
    contextId: string | null;
    boardCount: number;
}

interface UseTableSoundEffectsOptions {
    snapshot: RoomSnapshot | null;
    accountId?: string;
    isAdmin: boolean;
    viewerHasRoomAccess: boolean;
    displayedBoardCount: number;
    isAllInRunoutActive: boolean;
    turnActorAccountId: string | null;
    turnStartedAt: string | null;
    turnMainSecondsRemaining: number | null;
    isUsingTimeBank: boolean;
    demoMode?: boolean;
}

const TABLE_SOUND_EFFECTS: Record<TableSoundName, TableSoundEffectSpec> = {
    requestNotification: {
        src: "/sounds/table/request-notification.mp3",
        volume: 0.55,
    },
    handDealt: {
        src: "/sounds/table/chip-action.mp3",
        volume: 0.45,
    },
    check: {
        src: "/sounds/table/check.mp3",
        volume: 0.45,
    },
    fold: {
        src: "/sounds/table/fold.mp3",
        volume: 0.6,
    },
    chipAction: {
        src: "/sounds/table/chip-action.mp3",
        volume: 0.45,
    },
    yourTurn: {
        src: "/sounds/table/your-turn.mp3",
        volume: 0.6,
    },
    cardReveal: {
        src: "/sounds/table/card-reveal.mp3",
        volume: 0.5,
    },
    flopReveal: {
        src: "/sounds/table/flop-reveal.mp3",
        volume: 0.5,
    },
    victory: {
        src: "/sounds/table/victory.wav",
        volume: 0.7,
    },
    turnCountdown: {
        src: "/sounds/table/turn-countdown.ogg",
        volume: 0.5,
    },
    chatMessage: {
        src: "/sounds/table/request-notification.mp3",
        volume: 0.45,
    },
};

class TableSoundBank {
    private unlocked = false;

    private readonly templates = new Map<TableSoundName, HTMLAudioElement>();

    constructor() {
        if (typeof Audio === "undefined") {
            return;
        }

        for (const [soundName, spec] of Object.entries(TABLE_SOUND_EFFECTS) as Array<[TableSoundName, TableSoundEffectSpec]>) {
            const audio = new Audio(spec.src);
            audio.preload = "auto";
            audio.volume = spec.volume;
            audio.load();
            this.templates.set(soundName, audio);
        }
    }

    unlock() {
        this.unlocked = true;
    }

    play(soundName: TableSoundName) {
        if (!this.unlocked) {
            return;
        }

        const template = this.templates.get(soundName);

        if (!template) {
            return;
        }

        const instance = template.cloneNode(true) as HTMLAudioElement;
        instance.volume = template.volume;
        void instance.play().catch(() => undefined);
    }
}

const EMPTY_REVEAL_STATE: RevealState = {
    contextId: null,
    boardCount: 0,
};

export function useTableSoundEffects({
    snapshot,
    accountId,
    isAdmin,
    viewerHasRoomAccess,
    displayedBoardCount,
    isAllInRunoutActive,
    turnActorAccountId,
    turnStartedAt,
    turnMainSecondsRemaining,
    isUsingTimeBank,
    demoMode = false,
}: UseTableSoundEffectsOptions) {
    const soundBankRef = useRef<TableSoundBank | null>(null);
    const previousSnapshotRef = useRef<RoomSnapshot | null>(null);
    const revealStateRef = useRef<RevealState>(EMPTY_REVEAL_STATE);
    const initializedRef = useRef(false);
    const playedVictoryHandIdRef = useRef<string | null>(null);
    const pendingVictoryHandIdRef = useRef<string | null>(null);
    const lastCountdownTurnKeyRef = useRef<string | null>(null);
    const lastCountdownSecondRef = useRef<number | null>(null);

    useEffect(() => {
        if (typeof window === "undefined") {
            return;
        }

        const soundBank = new TableSoundBank();
        soundBankRef.current = soundBank;

        const unlockSoundBank = () => {
            soundBank.unlock();
            window.removeEventListener("pointerdown", unlockSoundBank);
            window.removeEventListener("keydown", unlockSoundBank);
        };

        window.addEventListener("pointerdown", unlockSoundBank);
        window.addEventListener("keydown", unlockSoundBank);

        return () => {
            window.removeEventListener("pointerdown", unlockSoundBank);
            window.removeEventListener("keydown", unlockSoundBank);
            soundBankRef.current = null;
        };
    }, []);

    useEffect(() => {
        const currentHand = snapshot?.currentHand ?? null;
        const revealContextId = currentHand?.id ?? (isAllInRunoutActive ? `runout:${snapshot?.lastCompletedHand?.handId ?? ""}` : null);
        const nextRevealState: RevealState = {
            contextId: revealContextId,
            boardCount: displayedBoardCount,
        };
        const turnKey = currentHand?.id && turnActorAccountId && turnStartedAt
            ? `${currentHand.id}:${turnActorAccountId}:${turnStartedAt}`
            : null;

        if (demoMode || !viewerHasRoomAccess || !snapshot) {
            initializedRef.current = false;
            previousSnapshotRef.current = snapshot;
            revealStateRef.current = nextRevealState;
            pendingVictoryHandIdRef.current = null;
            lastCountdownTurnKeyRef.current = turnKey;
            lastCountdownSecondRef.current = turnMainSecondsRemaining !== null && turnMainSecondsRemaining <= 3
                ? turnMainSecondsRemaining
                : null;
            return;
        }

        if (!initializedRef.current) {
            initializedRef.current = true;
            previousSnapshotRef.current = snapshot;
            revealStateRef.current = nextRevealState;
            playedVictoryHandIdRef.current = snapshot.lastCompletedHand?.handId ?? null;
            pendingVictoryHandIdRef.current = null;
            lastCountdownTurnKeyRef.current = turnKey;
            lastCountdownSecondRef.current = turnMainSecondsRemaining !== null && turnMainSecondsRemaining <= 3
                ? turnMainSecondsRemaining
                : null;
            return;
        }

        const previousSnapshot = previousSnapshotRef.current;
        const previousRevealState = revealStateRef.current;

        if (currentHand?.id && currentHand.id !== previousSnapshot?.currentHand?.id) {
            playTableSound(soundBankRef, "handDealt");
        }

        if (currentHand && previousSnapshot?.currentHand?.id === currentHand.id) {
            const appendedActions = currentHand.actions.slice(previousSnapshot.currentHand.actions.length);

            for (const action of appendedActions) {
                if (action.type === "check") {
                    playTableSound(soundBankRef, "check");
                    continue;
                }

                if (action.type === "fold") {
                    playTableSound(soundBankRef, "fold");
                    continue;
                }

                if (action.type === "call" || action.type === "bet" || action.type === "raise" || action.type === "all_in") {
                    playTableSound(soundBankRef, "chipAction");
                }
            }
        }

        if (isAdmin) {
            const previousRequestKeys = new Set(buildPendingRequestKeys(previousSnapshot));
            const incomingRequestKeys = buildPendingRequestKeys(snapshot).filter((requestKey) => !previousRequestKeys.has(requestKey));

            if (incomingRequestKeys.length > 0) {
                playTableSound(soundBankRef, "requestNotification");
            }
        }

        const previousChatIds = new Set((previousSnapshot?.chatMessages ?? []).map((message) => message.id));
        const hasNewExternalChatMessage = snapshot.chatMessages.some((message) => !previousChatIds.has(message.id) && message.accountId !== accountId);

        if (hasNewExternalChatMessage) {
            playTableSound(soundBankRef, "chatMessage");
        }

        if (previousRevealState.contextId === nextRevealState.contextId && nextRevealState.boardCount > previousRevealState.boardCount) {
            const revealedCardCount = nextRevealState.boardCount - previousRevealState.boardCount;
            const crossedFlopThreshold = previousRevealState.boardCount < 3 && nextRevealState.boardCount >= 3;

            if (!isAllInRunoutActive && crossedFlopThreshold && revealedCardCount >= 3) {
                playTableSound(soundBankRef, "flopReveal");

                for (let index = Math.max(previousRevealState.boardCount, 3); index < nextRevealState.boardCount; index += 1) {
                    playTableSound(soundBankRef, "cardReveal");
                }
            } else {
                for (let index = previousRevealState.boardCount; index < nextRevealState.boardCount; index += 1) {
                    playTableSound(soundBankRef, "cardReveal");
                }
            }
        }

        if (currentHand?.id && turnActorAccountId === accountId && turnKey !== lastCountdownTurnKeyRef.current) {
            playTableSound(soundBankRef, "yourTurn");
        }

        previousSnapshotRef.current = snapshot;
        revealStateRef.current = nextRevealState;
        lastCountdownTurnKeyRef.current = turnKey;
        if (turnKey === null) {
            lastCountdownSecondRef.current = null;
        }
    }, [
        accountId,
        demoMode,
        displayedBoardCount,
        isAdmin,
        isAllInRunoutActive,
        snapshot,
        turnActorAccountId,
        turnMainSecondsRemaining,
        turnStartedAt,
        viewerHasRoomAccess,
    ]);

    useEffect(() => {
        if (!initializedRef.current || demoMode || !viewerHasRoomAccess || !snapshot?.lastCompletedHand || !accountId) {
            if (!snapshot?.lastCompletedHand) {
                pendingVictoryHandIdRef.current = null;
            }
            return;
        }

        const latestCompletedHand = snapshot.lastCompletedHand;
        const heroWon = latestCompletedHand.winners.some((winner) => winner.accountId === accountId);

        if (!heroWon) {
            if (pendingVictoryHandIdRef.current === latestCompletedHand.handId) {
                pendingVictoryHandIdRef.current = null;
            }
            return;
        }

        if (playedVictoryHandIdRef.current === latestCompletedHand.handId) {
            return;
        }

        if (isAllInRunoutActive) {
            pendingVictoryHandIdRef.current = latestCompletedHand.handId;
            return;
        }

        if (pendingVictoryHandIdRef.current === latestCompletedHand.handId || playedVictoryHandIdRef.current !== latestCompletedHand.handId) {
            playTableSound(soundBankRef, "victory");
            playedVictoryHandIdRef.current = latestCompletedHand.handId;
            pendingVictoryHandIdRef.current = null;
        }
    }, [accountId, demoMode, isAllInRunoutActive, snapshot?.lastCompletedHand, viewerHasRoomAccess]);

    useEffect(() => {
        const currentHand = snapshot?.currentHand ?? null;
        const turnKey = currentHand?.id && turnActorAccountId && turnStartedAt
            ? `${currentHand.id}:${turnActorAccountId}:${turnStartedAt}`
            : null;

        if (!initializedRef.current || demoMode || !viewerHasRoomAccess || !turnKey || turnActorAccountId !== accountId) {
            lastCountdownTurnKeyRef.current = turnKey;
            lastCountdownSecondRef.current = null;
            return;
        }

        if (lastCountdownTurnKeyRef.current !== turnKey) {
            lastCountdownTurnKeyRef.current = turnKey;
            lastCountdownSecondRef.current = null;
        }

        if (isUsingTimeBank || turnMainSecondsRemaining === null || turnMainSecondsRemaining < 1 || turnMainSecondsRemaining > 3) {
            return;
        }

        if (lastCountdownSecondRef.current === turnMainSecondsRemaining) {
            return;
        }

        lastCountdownSecondRef.current = turnMainSecondsRemaining;
        playTableSound(soundBankRef, "turnCountdown");
    }, [
        accountId,
        demoMode,
        isUsingTimeBank,
        snapshot?.currentHand?.id,
        turnActorAccountId,
        turnMainSecondsRemaining,
        turnStartedAt,
        viewerHasRoomAccess,
    ]);
}

function buildPendingRequestKeys(snapshot: RoomSnapshot | null): string[] {
    if (!snapshot) {
        return [];
    }

    return [
        ...snapshot.pendingSeatRequests.map((request) => `seat:${request.id}`),
        ...snapshot.pendingRebuyRequests.map((request) => `rebuy:${request.id}`),
    ];
}

function playTableSound(soundBankRef: React.MutableRefObject<TableSoundBank | null>, soundName: TableSoundName) {
    soundBankRef.current?.play(soundName);
}