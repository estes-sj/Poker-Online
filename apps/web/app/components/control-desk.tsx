"use client";

import Link from "next/link";
import { useEffect, useId, useState, type ReactNode } from "react";

import {
    clearStoredBrowserSession,
    isConfiguredRoomCreationAdmin,
    readStoredBrowserSession,
    writeStoredBrowserSession,
    type BrowserSessionState,
} from "../lib/browser-session";
import { buildBrowserHttpUrl, getBrowserApiBaseUrl, getBrowserGameHttpBaseUrl } from "../lib/public-service-urls";

interface ControlDeskProps {
    roomCreationPolicy: {
        adminOnly: boolean;
        adminUsername: string | null;
    };
}

interface ClubOption {
    clubId: string;
    slug: string;
    name: string;
}

export function ControlDesk({ roomCreationPolicy }: ControlDeskProps) {
    const [session, setSession] = useState<BrowserSessionState | null>(null);
    const [registerError, setRegisterError] = useState<string | null>(null);
    const [loginError, setLoginError] = useState<string | null>(null);
    const [roomError, setRoomError] = useState<string | null>(null);
    const [clubsError, setClubsError] = useState<string | null>(null);
    const [roomLink, setRoomLink] = useState<string | null>(null);
    const [clubs, setClubs] = useState<ClubOption[]>([]);
    const [isRegistering, setIsRegistering] = useState(false);
    const [isLoggingIn, setIsLoggingIn] = useState(false);
    const [isCreatingRoom, setIsCreatingRoom] = useState(false);
    const [isLoadingClubs, setIsLoadingClubs] = useState(false);

    useEffect(() => {
        const storedSession = readStoredBrowserSession();

        if (storedSession) {
            setSession(storedSession);
        }
    }, []);

    async function handleRegister(formData: FormData) {
        setIsRegistering(true);
        setRegisterError(null);

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

            const payload = (await response.json()) as Partial<BrowserSessionState> & { error?: string };

            if (!response.ok || !payload.account || !payload.token) {
                throw new Error(payload.error ?? "Unable to register account.");
            }

            persistSession(payload.account, payload.token);
        } catch (error) {
            setRegisterError(error instanceof Error ? error.message : "Unable to register account.");
        } finally {
            setIsRegistering(false);
        }
    }

    async function handleLogin(formData: FormData) {
        setIsLoggingIn(true);
        setLoginError(null);

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

            const payload = (await response.json()) as Partial<BrowserSessionState> & { error?: string };

            if (!response.ok || !payload.account || !payload.token) {
                throw new Error(payload.error ?? "Unable to sign in.");
            }

            persistSession(payload.account, payload.token);
        } catch (error) {
            setLoginError(error instanceof Error ? error.message : "Unable to sign in.");
        } finally {
            setIsLoggingIn(false);
        }
    }

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
                    password: formData.get("roomPassword") || undefined,
                    maxPlayers: Number(formData.get("maxPlayers") ?? 6),
                    startingStack: Number(formData.get("startingStack") ?? 1000),
                    autoStartNextHand: formData.get("autoStartNextHand") === "on",
                    autoStartDelaySeconds: Number(formData.get("autoStartDelaySeconds") ?? 8),
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

    function persistSession(account: BrowserSessionState["account"], token: string) {
        const nextSession = { account, token };
        setSession(nextSession);
        writeStoredBrowserSession(nextSession);
    }

    function signOut() {
        setSession(null);
        setRoomLink(null);
        clearStoredBrowserSession();
    }

    const sessionUsername = session?.account.username ?? null;
    const canCreateRooms = Boolean(sessionUsername) && (!roomCreationPolicy.adminOnly || isConfiguredRoomCreationAdmin(sessionUsername, roomCreationPolicy.adminUsername));
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
        <div className="control-desk control-desk--landing" id="host-a-game">
            <section className="ui-panel hero__panel control-desk__panel">
                <header className="ui-panel__header">
                    <span className="ui-panel__eyebrow">Account access</span>
                    <h3 className="ui-panel__title">{session ? `Signed in as ${session.account.username}` : "Create an account or sign in"}</h3>
                </header>
                <div className="ui-panel__body control-desk__body">
                    {session ? (
                        <div className="status-card control-desk__status">
                            <span className="control-desk__kicker">Signed in</span>
                            <strong>{session.account.username}</strong>
                            <p>{session.account.email}</p>
                            <p className="muted-copy">
                                {canManageRooms
                                    ? "This account can open and manage rooms on this deployment."
                                    : "Use this account to join rooms now and return to previous sessions later."}
                            </p>
                            <div className="status-card__actions">
                                <Link className="button button--secondary" href="/rooms">
                                    Browse rooms
                                </Link>
                                <Link className="button button--secondary" href="/clubs">
                                    Browse clubs
                                </Link>
                                {canManageRooms ? (
                                    <>
                                        <Link className="button button--secondary" href="/admin/rooms">
                                            Manage rooms
                                        </Link>
                                        <Link className="button button--secondary" href="/admin/clubs">
                                            Manage clubs
                                        </Link>
                                    </>
                                ) : null}
                                <button className="button button--secondary" type="button" onClick={signOut}>
                                    Sign out
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="control-desk__auth-stack">
                            <section className="control-desk__form-block">
                                <div className="control-desk__form-copy">
                                    <strong>New account</strong>
                                    <p>Create an account to join rooms now and open tables later if you are hosting.</p>
                                </div>
                                <form className="control-form" action={handleRegister}>
                                    <input className="control-input" type="email" name="email" placeholder="email" required />
                                    <input className="control-input" type="text" name="username" placeholder="username" required />
                                    <input className="control-input" type="password" name="password" placeholder="password" required minLength={8} />
                                    <button className="button button--primary" type="submit" disabled={isRegistering}>
                                        {isRegistering ? "Creating account..." : "Create account"}
                                    </button>
                                    {registerError ? <p className="form-error">{registerError}</p> : null}
                                </form>
                            </section>

                            <section className="control-desk__form-block">
                                <div className="control-desk__form-copy">
                                    <strong>Sign in</strong>
                                    <p>Come back to live rooms, archived sessions, or the table you manage.</p>
                                </div>
                                <form className="control-form" action={handleLogin}>
                                    <input className="control-input" type="text" name="identifier" placeholder="email or username" required />
                                    <input className="control-input" type="password" name="password" placeholder="password" required />
                                    <button className="button button--secondary" type="submit" disabled={isLoggingIn}>
                                        {isLoggingIn ? "Signing in..." : "Sign in"}
                                    </button>
                                    {loginError ? <p className="form-error">{loginError}</p> : null}
                                </form>
                            </section>
                        </div>
                    )}
                </div>
            </section>

            <section className="ui-panel hero__panel control-desk__panel">
                <header className="ui-panel__header">
                    <span className="ui-panel__eyebrow">Open a room</span>
                    <h3 className="ui-panel__title">Set the table before anyone joins</h3>
                </header>
                <div className="ui-panel__body control-desk__body">
                    <p className="control-desk__intro">Choose the room name, seat count, starting stack, and between-hand pace. Live table controls stay available after the room opens.</p>
                    {roomCreationNotice ? <p className="muted-copy control-desk__notice">{roomCreationNotice}</p> : null}
                    <form className="control-form" action={handleCreateRoom}>
                        <ControlField
                            htmlFor="room-name"
                            label="Room name"
                            tooltip="The table name players see in the lobby, room header, and invite link preview."
                        >
                            <input className="control-input" id="room-name" type="text" name="roomName" placeholder="Friday cash game" required />
                        </ControlField>
                        <ControlField
                            htmlFor="club-id"
                            label="Club leaderboard"
                            tooltip="Optional. If selected, winnings from this room update that club's all-time leaderboard."
                        >
                            <select className="control-input" id="club-id" name="clubId" defaultValue="" disabled={isLoadingClubs}>
                                <option value="">{isLoadingClubs ? "Loading clubs..." : "No club leaderboard"}</option>
                                {clubs.map((club) => (
                                    <option key={club.clubId} value={club.clubId}>{club.name}</option>
                                ))}
                            </select>
                        </ControlField>
                        {clubsError ? <p className="form-error">{clubsError}</p> : null}
                        <ControlField
                            htmlFor="room-password"
                            label="Room password"
                            tooltip="Optional. If you set one, anyone joining the table has to enter it before they can see the room."
                        >
                            <input className="control-input" id="room-password" type="password" name="roomPassword" placeholder="room password (optional)" />
                        </ControlField>
                        <div className="control-grid">
                            <ControlField
                                htmlFor="max-players"
                                label="Max players"
                                tooltip="How many seats the table opens. This layout supports between 2 and 10 players."
                            >
                                <input className="control-input" id="max-players" type="number" name="maxPlayers" placeholder="8 players" defaultValue={8} min={2} max={10} required />
                            </ControlField>
                            <ControlField
                                htmlFor="starting-stack"
                                label="Starting stack"
                                tooltip="The default chip stack each newly seated player buys in for. Values are tracked as whole-number chips."
                            >
                                <input className="control-input" id="starting-stack" type="number" name="startingStack" placeholder="1,000" defaultValue={1000} min={1000} step={100} required />
                            </ControlField>
                        </div>
                        <div className="control-grid">
                            <div className="control-field">
                                <div className="control-field__label-row">
                                    <label className="control-field__label" htmlFor="auto-start-next-hand">Auto-start next hand</label>
                                    <FieldTooltip label="Explain auto-start next hand" text="If enabled, the server waits for the showdown presentation to finish and then deals the next hand automatically." />
                                </div>
                                <label className="control-checkbox" htmlFor="auto-start-next-hand">
                                    <input id="auto-start-next-hand" type="checkbox" name="autoStartNextHand" defaultChecked />
                                    <span>Deal the next hand automatically</span>
                                </label>
                            </div>
                            <ControlField
                                htmlFor="auto-start-delay-seconds"
                                label="Auto-start delay"
                                tooltip="How many seconds the table waits between hands before dealing again when auto-start is on."
                            >
                                <input className="control-input" id="auto-start-delay-seconds" type="number" name="autoStartDelaySeconds" placeholder="8 seconds" defaultValue={8} min={0} required />
                            </ControlField>
                        </div>
                        <button className="button button--primary" type="submit" disabled={isCreatingRoom || !canCreateRooms}>
                            {isCreatingRoom ? "Opening room..." : "Open room"}
                        </button>
                        {roomError ? <p className="form-error">{roomError}</p> : null}
                        {roomLink ? (
                            <a className="room-link control-desk__room-link" href={roomLink}>
                                Enter {roomLink}
                            </a>
                        ) : null}
                    </form>
                </div>
            </section>
        </div>
    );
}

interface ControlFieldProps {
    children: ReactNode;
    htmlFor: string;
    label: string;
    tooltip: string;
}

function ControlField({ children, htmlFor, label, tooltip }: ControlFieldProps) {
    return (
        <div className="control-field">
            <div className="control-field__label-row">
                <label className="control-field__label" htmlFor={htmlFor}>{label}</label>
                <FieldTooltip label={`Explain ${label.toLowerCase()}`} text={tooltip} />
            </div>
            {children}
        </div>
    );
}

interface FieldTooltipProps {
    label: string;
    text: string;
}

function FieldTooltip({ label, text }: FieldTooltipProps) {
    const tooltipId = useId();

    return (
        <span className="control-tooltip">
            <button className="control-tooltip__trigger" type="button" aria-label={label} aria-describedby={tooltipId}>
                ?
            </button>
            <span className="control-tooltip__bubble" id={tooltipId} role="tooltip">
                {text}
            </span>
        </span>
    );
}
