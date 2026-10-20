"use client";

import { useEffect, useState, type ReactNode } from "react";

import {
    isConfiguredRoomCreationAdmin,
    readStoredBrowserSession,
    type BrowserSessionState,
} from "../lib/browser-session";
import type { GuestMode } from "../lib/guest-policy";
import { buildBrowserHttpUrl, getBrowserGameHttpBaseUrl } from "../lib/public-service-urls";
import { AccountCard } from "./account-card";

interface ControlDeskProps {
    roomCreationPolicy: {
        adminOnly: boolean;
        adminUsername: string | null;
    };
    guestMode: GuestMode;
}

interface ClubOption {
    clubId: string;
    slug: string;
    name: string;
}

interface BlindLevelDraft {
    smallBlind: string;
    bigBlind: string;
    durationMinutes: string;
}

interface BlindLevelDraftValidation {
    smallBlind?: string;
    bigBlind?: string;
    durationMinutes?: string;
}

const DEFAULT_BLIND_LEVELS: Array<{ smallBlind: number; bigBlind: number; durationMinutes: number }> = [
    { smallBlind: 10, bigBlind: 20, durationMinutes: 15 },
    { smallBlind: 20, bigBlind: 40, durationMinutes: 15 },
    { smallBlind: 30, bigBlind: 60, durationMinutes: 15 },
    { smallBlind: 40, bigBlind: 80, durationMinutes: 15 },
    { smallBlind: 50, bigBlind: 100, durationMinutes: 15 },
    { smallBlind: 75, bigBlind: 150, durationMinutes: 15 },
    { smallBlind: 125, bigBlind: 250, durationMinutes: 15 },
    { smallBlind: 200, bigBlind: 400, durationMinutes: 15 },
    { smallBlind: 300, bigBlind: 600, durationMinutes: 15 },
    { smallBlind: 500, bigBlind: 1000, durationMinutes: 15 },
    { smallBlind: 700, bigBlind: 1400, durationMinutes: 15 },
    { smallBlind: 1000, bigBlind: 2000, durationMinutes: 15 },
];

export function ControlDesk({ roomCreationPolicy, guestMode }: ControlDeskProps) {
    const [session, setSession] = useState<BrowserSessionState | null>(null);
    const [roomError, setRoomError] = useState<string | null>(null);
    const [clubsError, setClubsError] = useState<string | null>(null);
    const [roomLink, setRoomLink] = useState<string | null>(null);
    const [clubs, setClubs] = useState<ClubOption[]>([]);
    const [isCreatingRoom, setIsCreatingRoom] = useState(false);
    const [isLoadingClubs, setIsLoadingClubs] = useState(false);
    const [useBlindSchedule, setUseBlindSchedule] = useState(false);
    const [blindLevels, setBlindLevels] = useState<BlindLevelDraft[]>(() => buildDefaultBlindLevelDrafts());
    const [blindScheduleValidation, setBlindScheduleValidation] = useState<BlindLevelDraftValidation[]>(() => buildEmptyBlindLevelDraftValidations(DEFAULT_BLIND_LEVELS.length));

    useEffect(() => {
        const storedSession = readStoredBrowserSession();

        if (storedSession) {
            setSession(storedSession);
        }
    }, []);

    async function handleCreateRoom(formData: FormData) {
        if (!session) {
            setRoomError("Sign in before creating a room.");
            return;
        }

        if (roomCreationPolicy.adminOnly && !isConfiguredRoomCreationAdmin(session.account.username, roomCreationPolicy.adminUsername)) {
            setRoomError(roomCreationPolicy.adminUsername
                ? `Only ${roomCreationPolicy.adminUsername} can create tables on this site.`
                : "Only the configured admin account can create tables on this site.");
            return;
        }

        const scheduleValidation = useBlindSchedule
            ? validateBlindScheduleDrafts(blindLevels)
            : { rows: buildEmptyBlindLevelDraftValidations(blindLevels.length), errors: [] };

        setBlindScheduleValidation(scheduleValidation.rows);

        if (useBlindSchedule && scheduleValidation.errors.length > 0) {
            setRoomError(scheduleValidation.errors[0] ?? "Fix the blind schedule before opening the room.");
            return;
        }

        setIsCreatingRoom(true);
        setRoomError(null);
        setRoomLink(null);

        try {
            const gameBaseUrl = getBrowserGameHttpBaseUrl();
            const response = await fetch(buildBrowserHttpUrl(gameBaseUrl, "/v1/rooms"), {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${session.token}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    name: formData.get("roomName"),
                    adminAccountId: session.account.id,
                    clubId: formData.get("clubId") || undefined,
                    isPubliclyListed: formData.get("isPubliclyListed") === "on",
                    password: formData.get("roomPassword") || undefined,
                    maxPlayers: Number(formData.get("maxPlayers") ?? 10),
                    startingStack: Number(formData.get("startingStack") ?? 1000),
                    autoStartNextHand: formData.get("autoStartNextHand") === "on",
                    autoStartDelaySeconds: Number(formData.get("autoStartDelaySeconds") ?? 8),
                    runItTwiceEnabled: formData.get("runItTwiceEnabled") === "on",
                    allowGuests: formData.get("allowGuests") === "on",
                    blindSchedule: useBlindSchedule ? parseBlindScheduleDrafts(blindLevels) : undefined,
                }),
            });

            const payload = (await response.json()) as { slug?: string; error?: string };

            if (!response.ok || !payload.slug) {
                throw new Error(payload.error ?? "Unable to create room.");
            }

            const link = `/rooms/${payload.slug}`;
            setRoomLink(link);
        } catch (error) {
            setRoomError(error instanceof Error ? error.message : "Unable to create room.");
        } finally {
            setIsCreatingRoom(false);
        }
    }

    function applyBlindLevels(nextLevels: BlindLevelDraft[]) {
        setBlindLevels(nextLevels);
        setBlindScheduleValidation(buildEmptyBlindLevelDraftValidations(nextLevels.length));
        setRoomError(null);
    }

    function updateBlindLevel(index: number, field: keyof BlindLevelDraft, value: string) {
        applyBlindLevels(blindLevels.map((level, levelIndex) => levelIndex === index ? { ...level, [field]: value } : level));
    }

    function addBlindLevel() {
        applyBlindLevels([...blindLevels, buildNextBlindLevelDraft(blindLevels)]);
    }

    function removeBlindLevel(index: number) {
        applyBlindLevels(blindLevels.filter((_, levelIndex) => levelIndex !== index));
    }

    const sessionUsername = session?.account.username ?? null;
    const isGuestSession = Boolean(session?.account.isGuest);
    const canCreateRooms = Boolean(sessionUsername) && !isGuestSession && (!roomCreationPolicy.adminOnly || isConfiguredRoomCreationAdmin(sessionUsername, roomCreationPolicy.adminUsername));
    const canManageRooms = Boolean(sessionUsername) && isConfiguredRoomCreationAdmin(sessionUsername, roomCreationPolicy.adminUsername);
    const roomCreationNotice = roomCreationPolicy.adminOnly
        ? sessionUsername
            ? isConfiguredRoomCreationAdmin(sessionUsername, roomCreationPolicy.adminUsername)
                ? `Room creation is limited to ${roomCreationPolicy.adminUsername ?? "the configured admin"}, and you are signed in with that host account.`
                : `Room creation is limited to ${roomCreationPolicy.adminUsername ?? "the configured admin"}. You are signed in as ${sessionUsername}.`
            : `Room creation is limited to ${roomCreationPolicy.adminUsername ?? "the configured admin"}. Sign in with that host account to open a table.`
        : null;

    useEffect(() => {
        if (!canCreateRooms) {
            setClubs([]);
            setClubsError(null);
            return;
        }

        let cancelled = false;

        async function loadClubs() {
            setIsLoadingClubs(true);
            setClubsError(null);

            try {
                const gameBaseUrl = getBrowserGameHttpBaseUrl();
                const response = await fetch(buildBrowserHttpUrl(gameBaseUrl, "/v1/clubs"));
                const payload = (await response.json()) as ClubOption[] | { error?: string };

                if (!response.ok || !Array.isArray(payload)) {
                    throw new Error((payload as { error?: string }).error ?? "Unable to load clubs.");
                }

                if (!cancelled) {
                    setClubs(payload);
                }
            } catch (error) {
                if (!cancelled) {
                    setClubs([]);
                    setClubsError(error instanceof Error ? error.message : "Unable to load clubs.");
                }
            } finally {
                if (!cancelled) {
                    setIsLoadingClubs(false);
                }
            }
        }

        void loadClubs();

        return () => {
            cancelled = true;
        };
    }, [canCreateRooms]);

    return (
        <>
            <AccountCard
                session={session}
                onSessionChange={(nextSession) => {
                    setSession(nextSession);
                    setRoomLink(null);
                }}
                canManageRooms={canManageRooms}
                guestMode={guestMode}
            />

            <section className="card home__create" id="host-a-game">
                <header className="card__header">
                    <div>
                        <h2>Open a table</h2>
                        <p>Pick the basics now. Blinds, timers, and seats can still be changed from the table.</p>
                    </div>
                </header>

                {!canCreateRooms ? (
                    <p className="notice">
                        {isGuestSession
                            ? "Guests can join tables but not open them. Create a full account from the account card to host."
                            : roomCreationNotice ?? "Sign in to open a table."}
                    </p>
                ) : (
                    <form className="form" action={handleCreateRoom}>
                        <div className="form-grid form-grid--3">
                            <Field className="form-grid__span-2" htmlFor="room-name" label="Table name">
                                <input className="control-input" id="room-name" type="text" name="roomName" placeholder="Friday cash game" required />
                            </Field>
                            <Field htmlFor="club-id" label="Club" hint="Results count toward this club's leaderboard.">
                                <select className="control-input" id="club-id" name="clubId" defaultValue="" disabled={isLoadingClubs}>
                                    <option value="">{isLoadingClubs ? "Loading clubs..." : "None"}</option>
                                    {clubs.map((club) => (
                                        <option key={club.clubId} value={club.clubId}>{club.name}</option>
                                    ))}
                                </select>
                            </Field>
                            <Field htmlFor="room-password" label="Password" hint="Optional. Required to view the table.">
                                <input className="control-input" id="room-password" type="password" name="roomPassword" autoComplete="new-password" />
                            </Field>
                            <Field htmlFor="max-players" label="Seats" hint="2 to 10 players.">
                                <input className="control-input" id="max-players" type="number" name="maxPlayers" defaultValue={10} min={2} max={10} required />
                            </Field>
                            <Field htmlFor="starting-stack" label="Starting stack" hint="Chips per buy-in.">
                                <input className="control-input" id="starting-stack" type="number" name="startingStack" defaultValue={1000} min={1000} step={100} required />
                            </Field>
                        </div>
                        {clubsError ? <p className="form-error">{clubsError}</p> : null}

                        <div className="toggle-list">
                            <Toggle
                                id="auto-start-next-hand"
                                name="autoStartNextHand"
                                label="Auto-deal next hand"
                                hint="Deal again automatically after the showdown finishes."
                            >
                                <label className="toggle-row__inline" htmlFor="auto-start-delay-seconds">
                                    <span>Delay</span>
                                    <input className="control-input control-input--compact" id="auto-start-delay-seconds" type="number" name="autoStartDelaySeconds" defaultValue={8} min={0} required />
                                    <span>sec</span>
                                </label>
                            </Toggle>
                            <Toggle
                                id="run-it-twice-enabled"
                                name="runItTwiceEnabled"
                                label="Run it twice"
                                hint="Offer a vote to run the board twice on all-in showdowns."
                                defaultChecked
                            />
                            <Toggle
                                id="public-room-listing"
                                name="isPubliclyListed"
                                label="List on the tables page"
                                hint="When off, only people with the link can find the table."
                                defaultChecked
                            />
                            {guestMode === "per-room" ? (
                                <Toggle
                                    id="allow-guests"
                                    name="allowGuests"
                                    label="Allow guests"
                                    hint="Players can join without creating an account."
                                />
                            ) : null}
                            <Toggle
                                id="use-blind-schedule"
                                label="Custom blind schedule"
                                hint="Replace the default blind levels for this table."
                                checked={useBlindSchedule}
                                onChange={(checked) => {
                                    setUseBlindSchedule(checked);
                                    setBlindScheduleValidation(buildEmptyBlindLevelDraftValidations(blindLevels.length));
                                    setRoomError(null);
                                }}
                            />
                        </div>

                        {useBlindSchedule ? (
                            <div className="blind-schedule">
                                <div className="blind-schedule__toolbar">
                                    <p>Each level starts when the previous one ends.</p>
                                    <button className="button button--secondary button--small" type="button" onClick={addBlindLevel}>
                                        Add level
                                    </button>
                                </div>
                                <div className="data-table-wrap">
                                    <table className="data-table data-table--compact">
                                        <thead>
                                            <tr>
                                                <th scope="col">Level</th>
                                                <th scope="col">Starts</th>
                                                <th scope="col">Small blind</th>
                                                <th scope="col">Big blind</th>
                                                <th scope="col">Minutes</th>
                                                <th scope="col"><span className="visually-hidden">Remove</span></th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {blindLevels.map((level, index) => {
                                                const offsetLabel = formatBlindScheduleOffset(getBlindScheduleOffsetMinutes(blindLevels, index));
                                                const rowValidation = blindScheduleValidation[index] ?? {};

                                                return (
                                                    <tr key={index}>
                                                        <td className="data-table__muted">{index + 1}</td>
                                                        <td className="data-table__muted">{offsetLabel}</td>
                                                        <td>
                                                            <input
                                                                className="control-input control-input--compact"
                                                                type="number"
                                                                min={1}
                                                                step={1}
                                                                value={level.smallBlind}
                                                                onChange={(event) => updateBlindLevel(index, "smallBlind", event.target.value)}
                                                                aria-label={`Level ${index + 1} small blind`}
                                                                aria-invalid={rowValidation.smallBlind ? true : undefined}
                                                            />
                                                            {rowValidation.smallBlind ? <p className="form-error">{rowValidation.smallBlind}</p> : null}
                                                        </td>
                                                        <td>
                                                            <input
                                                                className="control-input control-input--compact"
                                                                type="number"
                                                                min={1}
                                                                step={1}
                                                                value={level.bigBlind}
                                                                onChange={(event) => updateBlindLevel(index, "bigBlind", event.target.value)}
                                                                aria-label={`Level ${index + 1} big blind`}
                                                                aria-invalid={rowValidation.bigBlind ? true : undefined}
                                                            />
                                                            {rowValidation.bigBlind ? <p className="form-error">{rowValidation.bigBlind}</p> : null}
                                                        </td>
                                                        <td>
                                                            <input
                                                                className="control-input control-input--compact"
                                                                type="number"
                                                                min={1}
                                                                step={1}
                                                                value={level.durationMinutes}
                                                                onChange={(event) => updateBlindLevel(index, "durationMinutes", event.target.value)}
                                                                aria-label={`Level ${index + 1} duration in minutes`}
                                                                aria-invalid={rowValidation.durationMinutes ? true : undefined}
                                                            />
                                                            {rowValidation.durationMinutes ? <p className="form-error">{rowValidation.durationMinutes}</p> : null}
                                                        </td>
                                                        <td className="data-table__action">
                                                            <button
                                                                className="icon-button"
                                                                type="button"
                                                                onClick={() => removeBlindLevel(index)}
                                                                disabled={blindLevels.length <= 1}
                                                                aria-label={`Remove level ${index + 1}`}
                                                            >
                                                                ×
                                                            </button>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        ) : null}

                        <div className="form-footer">
                            {roomError ? <p className="form-error">{roomError}</p> : null}
                            {roomLink ? (
                                <a className="form-success" href={roomLink}>
                                    Table ready. Open {roomLink}
                                </a>
                            ) : null}
                            <button className="button button--primary" type="submit" disabled={isCreatingRoom}>
                                {isCreatingRoom ? "Opening table..." : "Open table"}
                            </button>
                        </div>
                    </form>
                )}
            </section>
        </>
    );
}

interface FieldProps {
    children: ReactNode;
    className?: string;
    hint?: string;
    htmlFor: string;
    label: string;
}

function Field({ children, className, hint, htmlFor, label }: FieldProps) {
    return (
        <div className={className ? `field ${className}` : "field"}>
            <label className="field__label" htmlFor={htmlFor}>{label}</label>
            {children}
            {hint ? <span className="field__hint">{hint}</span> : null}
        </div>
    );
}

interface ToggleProps {
    checked?: boolean;
    children?: ReactNode;
    defaultChecked?: boolean;
    hint: string;
    id: string;
    label: string;
    name?: string;
    onChange?: (checked: boolean) => void;
}

function Toggle({ checked, children, defaultChecked, hint, id, label, name, onChange }: ToggleProps) {
    return (
        <div className="toggle-row">
            <label className="toggle-row__text" htmlFor={id}>
                <span className="toggle-row__label">{label}</span>
                <span className="toggle-row__hint">{hint}</span>
            </label>
            {children ? <div className="toggle-row__extra">{children}</div> : null}
            <input
                className="switch"
                id={id}
                type="checkbox"
                name={name}
                role="switch"
                checked={checked}
                defaultChecked={defaultChecked}
                onChange={onChange ? (event) => onChange(event.target.checked) : undefined}
            />
        </div>
    );
}

function buildDefaultBlindLevelDrafts(): BlindLevelDraft[] {
    return DEFAULT_BLIND_LEVELS.map((level) => ({
        smallBlind: String(level.smallBlind),
        bigBlind: String(level.bigBlind),
        durationMinutes: String(level.durationMinutes),
    }));
}

function buildEmptyBlindLevelDraftValidations(count: number): BlindLevelDraftValidation[] {
    return Array.from({ length: count }, () => ({}));
}

function buildNextBlindLevelDraft(levels: BlindLevelDraft[]): BlindLevelDraft {
    const lastLevel = levels.at(-1);
    const lastSmallBlind = parseWholeNumberInput(lastLevel?.smallBlind ?? "");
    const lastBigBlind = parseWholeNumberInput(lastLevel?.bigBlind ?? "");
    const lastDuration = parseWholeNumberInput(lastLevel?.durationMinutes ?? "15");

    return {
        smallBlind: lastSmallBlind !== null && lastSmallBlind > 0 ? String(lastSmallBlind * 2) : "",
        bigBlind: lastBigBlind !== null && lastBigBlind > 0 ? String(lastBigBlind * 2) : "",
        durationMinutes: lastDuration !== null && lastDuration > 0 ? String(lastDuration) : "15",
    };
}

function validateBlindScheduleDrafts(levels: BlindLevelDraft[]): { rows: BlindLevelDraftValidation[]; errors: string[] } {
    const rows = buildEmptyBlindLevelDraftValidations(levels.length);
    const errors: string[] = [];

    if (levels.length === 0) {
        return {
            rows,
            errors: ["Add at least one blind level."],
        };
    }

    levels.forEach((level, index) => {
        const row = rows[index]!;
        const smallBlind = parseWholeNumberInput(level.smallBlind);
        const bigBlind = parseWholeNumberInput(level.bigBlind);
        const durationMinutes = parseWholeNumberInput(level.durationMinutes);
        const rowLabel = `Level ${index + 1}`;

        if (smallBlind === null || smallBlind <= 0) {
            row.smallBlind = "Enter a positive whole-number small blind.";
            errors.push(`${rowLabel}: small blind must be a positive integer.`);
        }

        if (bigBlind === null || bigBlind <= 0) {
            row.bigBlind = "Enter a positive whole-number big blind.";
            errors.push(`${rowLabel}: big blind must be a positive integer.`);
        }

        if (smallBlind !== null && bigBlind !== null && bigBlind <= smallBlind) {
            row.bigBlind = "Big blind must be greater than the small blind.";
            errors.push(`${rowLabel}: big blind must be greater than the small blind.`);
        }

        if (durationMinutes === null || durationMinutes <= 0) {
            row.durationMinutes = "Enter a duration above zero minutes.";
            errors.push(`${rowLabel}: duration must be a positive integer.`);
        }
    });

    return { rows, errors };
}

function parseBlindScheduleDrafts(levels: BlindLevelDraft[]): Array<{
    level: number;
    smallBlind: number;
    bigBlind: number;
    ante: number;
    durationMinutes: number;
}> {
    return levels.map((level, index) => {
        const smallBlind = parseRequiredWholeNumber(level.smallBlind, `Blind level ${index + 1} small blind`);
        const bigBlind = parseRequiredWholeNumber(level.bigBlind, `Blind level ${index + 1} big blind`);
        const durationMinutes = parseRequiredWholeNumber(level.durationMinutes, `Blind level ${index + 1} duration`);

        if (bigBlind <= smallBlind) {
            throw new Error(`Blind level ${index + 1} big blind must be greater than the small blind.`);
        }

        return {
            level: index + 1,
            smallBlind,
            bigBlind,
            ante: 0,
            durationMinutes,
        };
    });
}

function getBlindScheduleOffsetMinutes(levels: BlindLevelDraft[], index: number): number {
    return levels.slice(0, index).reduce((total, level) => total + (parseWholeNumberInput(level.durationMinutes) ?? 0), 0);
}

function formatBlindScheduleOffset(totalMinutes: number): string {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `+${hours}:${String(minutes).padStart(2, "0")}`;
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

function parseRequiredWholeNumber(value: string, label: string): number {
    const normalized = Number(value);

    if (!Number.isFinite(normalized) || !Number.isInteger(normalized) || normalized <= 0) {
        throw new Error(`${label} must be a positive integer.`);
    }

    return normalized;
}
