import { useEffect, useRef, type CSSProperties } from "react";

import type { MediaParticipantState } from "./media-types";
import type { Card, HandActionRecord, HeroActionState, LastHandResult, RoomPlayer, RoomSnapshot } from "./room-types";

const VICTORY_CONFETTI_DURATION_MS = 6_000;
const VICTORY_CONFETTI_ANIMATION_MS = 3_200;
const VICTORY_CONFETTI_PARTICLE_COUNT = 150;
const VICTORY_CONFETTI_COLORS = ["#4CAF50", "#2196F3", "#FFC107", "#E91E63", "#9C27B0", "#FF5722", "#00BCD4", "#FFEB3B"] as const;

type VictoryConfettiParticle = {
    x: number;
    y: number;
    rotation: number;
    rotationSpeed: number;
    velocityX: number;
    velocityY: number;
    color: string;
    size: number;
    opacity: number;
};

export type QueuedHeroAction =
    | { type: "check_or_fold" }
    | { type: "check" }
    | { type: "fold" }
    | { type: "call"; amount: number };

export function VictoryConfettiCanvas({ active }: { active: boolean }) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);

    useEffect(() => {
        if (!active) {
            return undefined;
        }

        const canvas = canvasRef.current;
        const context = canvas?.getContext("2d");
        if (!canvas || !context) {
            return undefined;
        }

        let animationFrameId = 0;
        const particles: VictoryConfettiParticle[] = [];
        const startTime = performance.now();

        const resizeCanvas = () => {
            const devicePixelRatio = window.devicePixelRatio || 1;
            const width = window.innerWidth;
            const height = window.innerHeight;

            canvas.width = Math.floor(width * devicePixelRatio);
            canvas.height = Math.floor(height * devicePixelRatio);
            canvas.style.width = `${width}px`;
            canvas.style.height = `${height}px`;
            context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
        };

        resizeCanvas();

        for (let index = 0; index < VICTORY_CONFETTI_PARTICLE_COUNT; index += 1) {
            particles.push({
                x: Math.random() * window.innerWidth,
                y: Math.random() * window.innerHeight - window.innerHeight,
                rotation: Math.random() * 360,
                rotationSpeed: Math.random() * 10 - 5,
                velocityX: Math.random() * 4 - 2,
                velocityY: Math.random() * 3 + 2,
                color: VICTORY_CONFETTI_COLORS[Math.floor(Math.random() * VICTORY_CONFETTI_COLORS.length)] ?? "#FFC107",
                size: Math.random() * 8 + 4,
                opacity: 1,
            });
        }

        const animate = (now: number) => {
            const elapsed = now - startTime;
            const progress = Math.min(elapsed / VICTORY_CONFETTI_ANIMATION_MS, 1);

            context.clearRect(0, 0, window.innerWidth, window.innerHeight);

            for (const particle of particles) {
                particle.x += particle.velocityX;
                particle.y += particle.velocityY;
                particle.rotation += particle.rotationSpeed;
                particle.velocityY += 0.1;

                if (progress > 0.7) {
                    particle.opacity = 1 - (progress - 0.7) / 0.3;
                }

                context.save();
                context.translate(particle.x, particle.y);
                context.rotate((particle.rotation * Math.PI) / 180);
                context.globalAlpha = Math.max(0, particle.opacity);
                context.fillStyle = particle.color;
                context.fillRect(-particle.size / 2, -particle.size / 2, particle.size, particle.size * 1.5);
                context.restore();
            }

            if (progress < 1) {
                animationFrameId = window.requestAnimationFrame(animate);
            }
        };

        animationFrameId = window.requestAnimationFrame(animate);
        window.addEventListener("resize", resizeCanvas);

        return () => {
            window.cancelAnimationFrame(animationFrameId);
            window.removeEventListener("resize", resizeCanvas);
            context.clearRect(0, 0, window.innerWidth, window.innerHeight);
        };
    }, [active]);

    if (!active) {
        return null;
    }

    return <canvas ref={canvasRef} className="victory-confetti-canvas" aria-hidden="true" />;
}

export function getHeroWagerInputConfig(heroActionState: HeroActionState): {
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

export function getDefaultWagerInputValue(heroActionState: HeroActionState): number {
    return getHeroWagerInputConfig(heroActionState)?.minInputAmount ?? 0;
}

export function getWagerTargetContribution(
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

export function areQueuedHeroActionsEqual(left: QueuedHeroAction | null, right: QueuedHeroAction | null): boolean {
    if (left === right) {
        return true;
    }

    if (!left || !right || left.type !== right.type) {
        return false;
    }

    if (left.type !== "call") {
        return true;
    }

    return right.type === "call" && left.amount === right.amount;
}

export function resolveQueuedHeroAction(
    queuedHeroAction: QueuedHeroAction,
    heroActionState: HeroActionState,
): Extract<HeroActionState["allowedActions"][number], "call" | "check" | "fold"> | null {
    switch (queuedHeroAction.type) {
        case "check_or_fold":
            if (heroActionState.allowedActions.includes("check")) {
                return "check";
            }

            return heroActionState.allowedActions.includes("fold") ? "fold" : null;
        case "check":
            return heroActionState.allowedActions.includes("check") ? "check" : null;
        case "fold":
            return heroActionState.allowedActions.includes("fold") ? "fold" : null;
        case "call":
            return heroActionState.allowedActions.includes("call") && heroActionState.callAmount === queuedHeroAction.amount
                ? "call"
                : null;
    }
}

export function describeMediaBadge(participant: MediaParticipantState, isHeroSeat: boolean): {
    label: string;
    tone: "awaiting" | "joined" | "live" | "mic" | "muted-mic" | "no-cam";
} {
    const cameraOn = participant.cameraEnabled;
    const microphoneOn = participant.microphoneEnabled;

    if (!isHeroSeat) {
        return microphoneOn
            ? {
                label: "Mic on",
                tone: "mic",
            }
            : {
                label: "Mic muted",
                tone: "muted-mic",
            };
    }

    if (cameraOn && microphoneOn && participant.isSpeaking) {
        return {
            label: participant.isLocal ? "You live" : "Live",
            tone: "live",
        };
    }

    if (cameraOn && microphoneOn) {
        return {
            label: "Mic on",
            tone: "mic",
        };
    }

    if (cameraOn) {
        return {
            label: "Mic muted",
            tone: "muted-mic",
        };
    }

    if (microphoneOn) {
        return {
            label: "Cam off",
            tone: "no-cam",
        };
    }

    return {
        label: "Media off",
        tone: "awaiting",
    };
}

export function PokerCard({
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

export function describeHeroState(heroActionState: HeroActionState | null, heroPlayer: RoomPlayer | null): string {
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

export function describeRunItTwiceVoteState(
    prompt: NonNullable<RoomSnapshot["currentHand"]>["runItTwicePrompt"],
    heroPlayer: RoomPlayer | null,
): string {
    if (!prompt) {
        return "Waiting for the next action window.";
    }

    const unansweredCount = prompt.eligibleAccountIds.filter((accountId) => !prompt.responsesByAccountId[accountId]).length;
    const hasNoVote = Object.values(prompt.responsesByAccountId).includes("no");
    const everyoneAgreed = prompt.eligibleAccountIds.every((accountId) => prompt.responsesByAccountId[accountId] === "yes");

    if (hasNoVote) {
        return "A player declined. Dealing a single board.";
    }

    if (everyoneAgreed) {
        return "Everyone agreed. Running it twice.";
    }

    if (!heroPlayer || !prompt.eligibleAccountIds.includes(heroPlayer.accountId)) {
        return unansweredCount > 0
            ? `Run it twice vote underway. Waiting on ${unansweredCount} player${unansweredCount === 1 ? "" : "s"}.`
            : "Run it twice vote in progress.";
    }

    const response = prompt.responsesByAccountId[heroPlayer.accountId];

    if (response === "yes") {
        return unansweredCount > 0
            ? `You voted yes. Waiting on ${unansweredCount} more player${unansweredCount === 1 ? "" : "s"}.`
            : "You voted yes. Waiting for the board to run twice.";
    }

    if (response === "no") {
        return "You voted no. The hand will continue with a single board.";
    }

    return "Run it twice is available here. Everyone in the showdown has to agree.";
}

export function buildCenterStatus(snapshot: RoomSnapshot | null, nextHandCountdown: string | null): string {
    if (!snapshot) {
        return "Loading table state.";
    }

    if (snapshot.status === "paused") {
        return "Table paused by admin.";
    }

    if (snapshot.currentHand?.runItTwicePrompt) {
        const prompt = snapshot.currentHand.runItTwicePrompt;

        if (Object.values(prompt.responsesByAccountId).includes("no")) {
            return "Run it twice declined. Dealing one board.";
        }

        if (prompt.eligibleAccountIds.every((accountId) => prompt.responsesByAccountId[accountId] === "yes")) {
            return "Run it twice agreed. Dealing two boards.";
        }

        return "Run it twice vote in progress.";
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

export function formatSeatActionBubble(actions: HandActionRecord[], accountId: string, currentStreet: string): string | null {
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

export function safeParse(value: string): { type?: string; message?: string; payload?: unknown } | null {
    try {
        return JSON.parse(value) as { type?: string; message?: string; payload?: unknown };
    } catch {
        return null;
    }
}

export function formatActionSummary(action: HandActionRecord): string {
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

export function formatStreet(value: string): string {
    return value.charAt(0).toUpperCase() + value.slice(1);
}

export function formatCard(card: { rank: string; suit: string }): string {
    return `${card.rank}${getSuitSymbol(card.suit as Card["suit"])}`;
}

export function formatTurnSeconds(value: number): string {
    return `${Math.max(0, value)}s`;
}

export function parseRequiredWholeNumber(value: string, label: string): number {
    const normalized = Number(value);

    if (!Number.isFinite(normalized) || !Number.isInteger(normalized) || normalized <= 0) {
        throw new Error(`${label} must be a positive integer.`);
    }

    return normalized;
}

export function parseOptionalWholeNumber(value: string, label: string): number | null {
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

export function parseProbabilityInput(value: string, label: string): number {
    const trimmed = value.trim();

    if (!trimmed) {
        throw new Error(`${label} is required.`);
    }

    const normalized = Number(trimmed);

    if (!Number.isFinite(normalized) || normalized < 0 || normalized > 1) {
        throw new Error(`${label} must be between 0 and 1.`);
    }

    return Math.round(normalized * 1000) / 1000;
}

export function formatChatTimestamp(value: string): string {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return "Now";
    }

    return new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        minute: "2-digit",
    }).format(date);
}

export function formatArchivePreviewTimestamp(value: string): string {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return "this session";
    }

    return new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
    }).format(date);
}

export function formatNumber(value: number): string {
    return new Intl.NumberFormat("en-US").format(value);
}

export function formatCountdown(nextHandStartsAt: string): string {
    const remainingSeconds = Math.max(0, Math.ceil((Date.parse(nextHandStartsAt) - Date.now()) / 1000));

    if (remainingSeconds === 0) {
        return "Auto-starting the next hand now.";
    }

    return `Next hand auto-starts in ${remainingSeconds}s.`;
}

export function getAvatarLabel(name: string): string {
    const tokens = name.trim().split(/\s+/).filter(Boolean);

    if (tokens.length === 0) {
        return "?";
    }

    if (tokens.length === 1) {
        return tokens[0]!.slice(0, 2).toUpperCase();
    }

    return `${tokens[0]![0] ?? ""}${tokens[tokens.length - 1]![0] ?? ""}`.toUpperCase();
}

export function clampSeatCount(value: number): number {
    return Math.max(2, Math.min(10, value));
}
